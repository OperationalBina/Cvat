# Copyright (C) 2018 Intel Corporation
#
# SPDX-License-Identifier: MIT

import os
import errno
import shutil
import json
import traceback
import requests
import zipfile
from cvat.apps.engine.models import Comments

import time
import django_rq
import re
from threading import Thread

from django.views.decorators.cache import never_cache
from django.http import HttpResponse, HttpResponseBadRequest, JsonResponse, HttpResponseRedirect, FileResponse
from django.shortcuts import redirect, render
from django.conf import settings
from rules.contrib.views import permission_required, objectgetter
from django.views.decorators.gzip import gzip_page
from sendfile import sendfile
from io import BytesIO
from PIL import Image
from shutil import copyfile

from . import annotation, task, models
from .task import download_vid, track_all_video, check_video_path
from cvat.settings.base import JS_3RDPARTY
from cvat.apps.authentication.decorators import login_required
from requests.exceptions import RequestException
import logging
from .log import slogger, clogger
from cvat.apps.engine.models import StatusChoice
from .downloader import download_file, download_file_m4s
from .handle_file_s3 import getFileUrl, downloadFile, copyFileToOS
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.models import User
watershedFrames = {}
runningThreads = {}
downloadFrames = {}
entireVideoTracking = {}
MAX_WORKER_COUNT = 5
FRAMES_DOWNLOAD_BUFFER = 100

############################# High Level server API
@login_required
@permission_required(perm=['engine.job.access'],
    fn=objectgetter(models.Job, 'jid'), raise_exception=True)
def catch_client_exception(request, jid):
    data = json.loads(request.body.decode('utf-8'))
    for event in data['exceptions']:
        clogger.job[jid].error(json.dumps(event))

    return HttpResponse()

@login_required
def dispatch_request(request):
    """An entry point to dispatch legacy requests"""
    if request.method == 'GET' and 'id' in request.GET:
        return render(request, 'engine/annotation.html', {
            'js_3rdparty': JS_3RDPARTY.get('engine', []),
            'status_list': [str(i) for i in StatusChoice]
        })
    else:
        return redirect('/dashboard/')

@csrf_exempt
@login_required
@permission_required(perm=['engine.task.create'], raise_exception=True)
def create_task(request):
    """Create a new annotation task"""
    db_task = None
    params = request.POST.dict()
    if request.user.is_anonymous:
        request.user = User.objects.get(pk=params['owner'])
    params['owner'] = request.user
    slogger.glob.info("create task with params = {}".format(params))
    try:
        db_task = task.create_empty(params)
        target_paths = []
        source_paths = []
        upload_dir = db_task.get_upload_dirname()   
        share_root = settings.SHARE_ROOT
        if params['storage'] == 'share' or params['storage'] == 'sorted':    
            data_list = request.POST.getlist('data')
            file_path = data_list[0]
            if 'init_' in file_path:
                download_file_m4s(request, data_list[0], upload_dir, params['project'], params['os_id'])
            else:
                download_file(request, data_list[0], upload_dir, params['project'], params['os_id'])
            file_name = data_list[0].split('/')[-1]
            source_paths.append(upload_dir + '/' +  file_name)
            upload_dir = os.path.join(upload_dir, file_name)
            target_paths.append(upload_dir)
        else:
            data_list = request.FILES.getlist('data')

            if len(data_list) > settings.LOCAL_LOAD_MAX_FILES_COUNT:
                raise Exception('Too many files. Please use download via share')
            common_size = 0
            for f in data_list:
                common_size += f.size
            if common_size > settings.LOCAL_LOAD_MAX_FILES_SIZE:
                raise Exception('Too many size. Please use download via share')

            for data_file in data_list:
                source_paths.append(data_file.name)
                path = os.path.join(upload_dir, data_file.name)
                target_paths.append(path)
                with open(path, 'wb') as upload_file:
                    for chunk in data_file.chunks():
                        upload_file.write(chunk)

        params['SOURCE_PATHS'] = source_paths
        params['TARGET_PATHS'] = target_paths

        task.create(db_task.id, params)

        return JsonResponse({'tid': db_task.id})
    except Exception as exc:
        slogger.glob.error("cannot create task {}".format(params['task_name']), exc_info=True)
        if (db_task):
            db_task.delete()
        return HttpResponseBadRequest(str(exc))

    return JsonResponse({'tid': db_task.id})

@login_required
def updateTargetFrame(request, tid, frame):
    try:
        db_task = models.Task.objects.get(pk=tid)
        db_task.last_viewed_frame = frame
        db_task.save()
    except Exception as e:
        slogger.glob.error("cannot update the target frame for task #{}".format(tid), exc_info=True)
        return HttpResponseBadRequest(str(e))
    
    return HttpResponse()

@login_required
@permission_required(perm=['engine.task.access'], fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def save_framecomments(request, tid):
    try:
        comments = json.loads(request.body.decode('utf-8'))["comments"]
        task = models.Task.objects.get(pk=tid)
        
        # Delete all current comments for the current task since we are sending a new dictionary of comments
        models.Comments.objects.filter(task=task).delete()

        # Create each comment for the current task
        for comment in comments:
            models.Comments.objects.update_or_create(task=task, frame=comment, defaults={"comment": comments[comment]})
    except Exception as e:
        slogger.glob.error("cannot update/create comment, error: {}".format(str(e)), exc_info=True)
        return HttpResponseBadRequest(str(e))

    return HttpResponse()
    
@login_required
@permission_required(perm=['engine.task.access'], fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def check_comments(request, tid):
    try:
        task = models.Task.objects.get(pk=tid)
        task_has_comments = models.Comments.objects.filter(task=task).exists()

        return JsonResponse({"has_comments" : task_has_comments})

    except Exception as e:
        slogger.glob.error("cannot get task comments, error: {}".format(str(e)), exc_info=True)
        return HttpResponseBadRequest(str(e))

@login_required
@permission_required(perm=['engine.task.access'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def check_task(request, tid):
    """Check the status of a task"""
    try:
        slogger.glob.info("check task #{}".format(tid))
        response = task.check(tid)
    except Exception as e:
        slogger.glob.error("cannot check task #{}".format(tid), exc_info=True)
        return HttpResponseBadRequest(str(e))

    return JsonResponse(response)

@login_required
def delete_txt_annotation(request, tid):
    destFile = r'/home/django/data/' + str(tid) + r'/data/xml/annotations.txt'
    if os.path.exists(destFile):
        shutil.rmtree(os.path.dirname(os.path.abspath(destFile)))

    return HttpResponse()

@login_required
@permission_required(perm=['engine.task.access'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def get_frame(request, tid, frame):
    """Stream corresponding from for the task"""
    try:
        if os.environ.get('WITH_OS') == 'False':
            return sendfile(request, task.get_frame_path(tid, frame))
        else:
            # If the frame requested is 0, the user might be on the dashboard so there is no need to start threads.
            if frame == 0:
                frame_path = task.get_frame_path(tid, frame)
                is_downloaded = downloadFile(settings.AWS_STORAGE_BUCKET_NAME, frame_path, frame_path)
                img = open(frame_path, 'rb')
                response = FileResponse(img)
                if is_downloaded:
                    os.remove(frame_path)
                return response

            currentUser = request.user.username
            stop_frame = list(models.Segment.objects.filter(task_id=tid).values_list("stop_frame", flat=True))[0]

            # If the user is not in running threads create a dictionary for him.
            if currentUser not in runningThreads:
                runningThreads[currentUser] = {}
                downloadFrames[currentUser] = {}

            # If the user moved the video backwards after starting at an advanced frame, or moved forward to an advanced frame, stop all threads.
            if ((tid in runningThreads[currentUser]) and (frame < runningThreads[currentUser][tid]['startFrame'])) or ((tid in runningThreads[currentUser]) and (frame >= runningThreads[currentUser][tid]['endFrame'])):
                shutdownThreads(tid, currentUser)

            # Start a new thread proccess if none is active.
            if tid not in runningThreads[currentUser]:
                runningThreads[currentUser][tid] = {}
                downloadFrames[currentUser][tid] = {}

                # Save up to FRAMES_DOWNLOAD_BUFFER frames to the server.
                end_frame = frame + FRAMES_DOWNLOAD_BUFFER
                if end_frame > stop_frame + 1:
                    end_frame = stop_frame + 1
                runningThreads[currentUser][tid]['endFrame'] = end_frame
                runningThreads[currentUser][tid]['startFrame'] = frame
                fetch_all(range(frame, end_frame), tid, currentUser)

            # If the frame is the last frame the user finished the video.
            if frame == stop_frame:
                runningThreads[currentUser].pop(tid, None)

            frame_path = task.get_frame_path(tid, frame)

            # The frame path is the root/<currentUser>/frame.jpg
            fileNameIndex = re.search(r'/\d+.jpg', frame_path)
            frame_path = frame_path[:fileNameIndex.start()] + '/' + currentUser + frame_path[fileNameIndex.start():]
            
            if not os.path.exists(frame_path):
                if str(frame) in downloadFrames[currentUser][tid]:
                    downloadFrames[currentUser][tid][str(frame)].join()
                else:
                    s3_cli.download_file(settings.AWS_STORAGE_BUCKET_NAME, frame_path, frame_path)

            del downloadFrames[currentUser][tid][str(frame)]
            img = open(frame_path, 'rb')
            response = FileResponse(img)
            os.remove(frame_path)
            return response
    except Exception as e:
        slogger.task[tid].error("cannot get frame #{}".format(frame), exc_info=True)
        return HttpResponseBadRequest(str(e))

def fetch_all(all_frames, tid, currentUser):
    for frame in all_frames:
        t = Thread(target=downloadThread, args=([frame],tid,currentUser,))
        downloadFrames[currentUser][tid][str(frame)] = t
        t.start()

def downloadThread(frames, tid, currentUser):
    for frame in frames:
        # Download the requested frame
        frame_path = task.get_frame_path(tid, frame)
        is_downloaded = downloadFile(settings.AWS_STORAGE_BUCKET_NAME, frame_path, frame_path)

        # Move the frame to a new folder under the current user name
        fileNameIndex = re.search(r'/\d+.jpg', frame_path)
        destination_path = frame_path[:fileNameIndex.start()] + '/' + currentUser + frame_path[fileNameIndex.start():]
        dir_path = frame_path[:fileNameIndex.start()] + '/' + currentUser
        if not os.path.isdir(dir_path):
            try:
                os.mkdir(dir_path)
            except OSError as e:
                if e.errno == errno.EEXIST:
                    os.remove(dir_path)
                    os.mkdir(dir_path)
        
        if is_downloaded:
            os.rename(frame_path, destination_path)
        else:
            copyfile(frame_path, destination_path)

def shutdownThreads(tid, currentUser):
    if tid in runningThreads[currentUser]:
        end_frame = runningThreads[currentUser][tid]['endFrame']
        start_frame = runningThreads[currentUser][tid]['startFrame']
        runningThreads[currentUser].pop(tid, None)

        for frame in range(start_frame, end_frame):
            if str(frame) in downloadFrames[currentUser][tid]:
                downloadFrames[currentUser][tid][str(frame)].do_run = False
                del downloadFrames[currentUser][tid][str(frame)]

@login_required
@permission_required(perm=['engine.task.access'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def exitProccess(request, tid):
    if request.user.username in watershedFrames:
        delete_frames_for_watershed(tid, request.user.username)

    # Stop all of the running threads and delete all leftover images on the server when the user exists the task.
    shutdownThreads(tid, request.user.username)
    for root, dirs, _ in os.walk('/home/django/data/' + str(tid)):
        for d in dirs:
            if os.path.join(root, d).endswith(request.user.username):
                shutil.rmtree(os.path.join(root, d))

    return HttpResponse()

@login_required
@permission_required(perm=['engine.task.access'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def exitFromSegmentationMode(request, tid):

    delete_frames_for_watershed(tid, request.user.username)

    return HttpResponse()

def delete_frames_for_watershed(tid, username):
    watershedFrames.pop(username, None)
    for root, dirs, _ in os.walk('/home/django/data/watershed/' + str(tid)):
        for d in dirs:
            if os.path.join(root, d).endswith(username):
                shutil.rmtree(os.path.join(root, d))

@login_required
@permission_required(perm=['engine.task.access'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def frames_for_watershed(request, tid, frame):
    try:
        stop_frame = list(models.Segment.objects.filter(task_id=tid).values_list("stop_frame", flat=True))[0] + 1
        q = django_rq.get_queue('mid')
        wanted_frames = []
        unwanted_frames = []

        # Set the range of frames to download
        if frame + 5 < stop_frame:
            stop_frame = frame + 5
        start_frame = frame - 2
        if start_frame < 0:
            start_frame = 0

        # If the user is not in the watershed frames create a dictionary for him.
        if request.user.username not in watershedFrames:
            watershedFrames[request.user.username] = {}
        if str(tid) in watershedFrames[request.user.username]:
            for i in range(start_frame, stop_frame):
                if i not in watershedFrames[request.user.username][str(tid)]:
                    wanted_frames.append(i)
            for j in watershedFrames[request.user.username][str(tid)]:
                if j < start_frame or j > stop_frame:
                    unwanted_frames.append(j)
            watershedFrames[request.user.username][str(tid)] = [i for i in range(start_frame, stop_frame)]
        else:
            watershedFrames[request.user.username][str(tid)] = [i for i in range(start_frame, stop_frame)]
            wanted_frames += watershedFrames[request.user.username][str(tid)]

        for wanted_frame in wanted_frames:
            q.enqueue_call(func=download_frame, args=(tid, wanted_frame, request.user.username),
                job_id="task/{}.frame/{}.download_frame".format(tid, wanted_frame))
        for unwanted_frame in unwanted_frames:
            q.enqueue_call(func=delete_frame, args=(tid, unwanted_frame, request.user.username),
                job_id="task/{}.frame/{}.delete_frame".format(tid, unwanted_frame))
        
        return HttpResponse()
    except Exception as e:
        slogger.task[tid].error("cannot get frame #{} for watershed".format(frame), exc_info=True)
        return HttpResponseBadRequest(str(e))

def download_frame(tid, frame, username):
    frame_path = task.get_frame_path(tid, frame)
    is_downloaded = downloadFile(settings.AWS_STORAGE_BUCKET_NAME, frame_path, frame_path)

    # Move the frame to a new folder under the current user name
    fileNameIndex = re.search(r'/\d+.jpg', frame_path)
    destination_path = '/home/django/data/watershed/' + str(tid) + "/" + username + frame_path[fileNameIndex.start():]
    dir_path = '/home/django/data/watershed/' + str(tid) + "/" + username
    if not os.path.isdir(dir_path):
        os.makedirs(dir_path)
    
    if is_downloaded:
        os.rename(frame_path, destination_path)
    else:
        copyfile(frame_path, destination_path)

def delete_frame(tid, frame, username):
    frame_path = task.get_frame_path(tid, frame)
    fileNameIndex = re.search(r'/\d+.jpg', frame_path)
    destination_path = '/home/django/data/watershed/' + str(tid) + "/" + username + frame_path[fileNameIndex.start():]
    os.remove(destination_path)

@login_required
@permission_required(perm=['engine.task.access'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
@never_cache
def get_frame_watershed(request, tid, frame):
    try:
        frame_watershed_path = task.get_frame_watershed_path(tid, frame)
    
        if os.environ.get('WITH_OS') == 'True':
            if os.path.exists(frame_watershed_path):
                q = django_rq.get_queue('default')
                q.enqueue_call(func=save_watershed_mask, args=(tid, frame),
                    job_id="task/{}.frame/{}.save_watershed_mask".format(tid, frame))
            else:
                try:
                    downloadFile(settings.AWS_STORAGE_BUCKET_NAME, frame_watershed_path, frame_watershed_path)
                except Exception as e:
                    pass
        
        if os.path.exists(frame_watershed_path):
            response = FileResponse(open(frame_watershed_path, 'rb'))
        else:
            response = FileResponse()

        return response
    except Exception as e:
        slogger.task[tid].error("cannot get frame #{} watershed".format(frame), exc_info=True)
        return HttpResponseBadRequest(str(e))

def save_watershed_mask(tid, frame):
    frame_watershed_path = task.get_frame_watershed_path(tid, frame)
    copyFileToOS(frame_watershed_path, frame_watershed_path)

@login_required
@permission_required(perm=['engine.task.delete'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def delete_task(request, tid):
    """Delete the task"""
    try:
        slogger.glob.info("delete task #{}".format(tid))
        task.delete(tid)
    except Exception as e:
        slogger.glob.error("cannot delete task #{}".format(tid), exc_info=True)
        return HttpResponseBadRequest(str(e))

    return HttpResponse()

@login_required
@permission_required(perm=['engine.task.change'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def update_task(request, tid):
    """Update labels & score for the task"""
    try:
        slogger.task[tid].info("update task request")
        labels = request.POST['labels']
        score = request.POST['score']
        assignee = request.POST['assignee']
        task.update(tid, labels, score, assignee)
    except Exception as e:
        slogger.task[tid].error("cannot update task", exc_info=True)
        return HttpResponseBadRequest(str(e))

    return HttpResponse()
    
@login_required
@permission_required(perm=['engine.task.change'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def update_task_properties(request, tid):
    """Update labels for the task"""
    try:
        properties = json.loads(request.body.decode('utf-8'))
        task.updateProperties(tid, properties)
    except Exception as e:
        return HttpResponseBadRequest(str(e))

    return HttpResponse()

@login_required
@permission_required(perm=['engine.task.access'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def get_task(request, tid):
    try:
        slogger.task[tid].info("get task request")
        response = task.get(tid)
    except Exception as e:
        slogger.task[tid].error("cannot get task", exc_info=True)
        return HttpResponseBadRequest(str(e))

    return JsonResponse(response, safe=False)

@login_required
@permission_required(perm=['engine.job.access'],
    fn=objectgetter(models.Job, 'jid'), raise_exception=True)
def get_job(request, jid):
    try:
        slogger.job[jid].info("get job #{} request".format(jid))
        response = task.get_job(jid)
    except Exception as e:
        slogger.job[jid].error("cannot get job #{}".format(jid), exc_info=True)
        return HttpResponseBadRequest(str(e))

    return JsonResponse(response, safe=False)

@login_required
@permission_required(perm=['engine.job.access'],
    fn=objectgetter(models.Job, 'jid'), raise_exception=True)
def get_task_byjob(request, jid):
    try:
        slogger.job[jid].info("get task by job #{} request".format(jid))
        response = task.get_task_byjob(jid)

        if response == {}:
            return HttpResponseBadRequest(str("Can not get task by jid #{}".format(jid)))

    except Exception as e:
        slogger.job[jid].error("cannot get job #{}".format(jid), exc_info=True)
        return HttpResponseBadRequest(str(e))

    return JsonResponse(response, safe=False)

@login_required
@permission_required(perm=['engine.task.access'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def dump_annotation(request, tid):
    try:
        slogger.task[tid].info("dump annotation request")
        annotation.dump(tid, annotation.FORMAT_XML, request.scheme, request.get_host())
    except Exception as e:
        slogger.task[tid].error("cannot dump annotation", exc_info=True)
        return HttpResponseBadRequest(str(e))

    return HttpResponse()

@login_required
@gzip_page
@permission_required(perm=['engine.task.access'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def check_annotation(request, tid):
    try:
        slogger.task[tid].info("check annotation")
        response = annotation.check(tid)
    except Exception as e:
        slogger.task[tid].error("cannot check annotation", exc_info=True)
        return HttpResponseBadRequest(str(e))

    return JsonResponse(response)


@login_required
@gzip_page
@permission_required(perm=['engine.task.access'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def download_annotation(request, tid):
    try:
        slogger.task[tid].info("get dumped annotation")
        db_task = models.Task.objects.get(pk=tid)
        response = sendfile(request, db_task.get_dump_path(), attachment=True,
            attachment_filename='{}_{}.xml'.format(db_task.id, db_task.name))
    except Exception as e:
        slogger.task[tid].error("cannot get dumped annotation", exc_info=True)
        return HttpResponseBadRequest(str(e))

    return response

@login_required
@gzip_page
@permission_required(perm=['engine.task.access'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def download_segmentation(request, tid):
    try:
        slogger.task[tid].info("get dumped segmentation")
        db_task = models.Task.objects.get(pk=tid)

        if os.environ.get('WITH_OS') == 'True':
            api_host = os.environ.get('API_HOST')
            api_secret = os.environ.get('API_SECRET')
            payload = { 'secret' : api_secret }
            payload = json.dumps(payload)
            headers = {
                "content-type": "application/json"
            }
            zip_url = "{}://{}/watershed/images?project.name={}&task.name={}".format('https' if os.environ.get('API_SECURE_SITE') == 'True' else 'http', 
                                                                                            api_host, 
                                                                                            db_task.project.name, 
                                                                                            db_task.name)
            response = requests.post(zip_url, data=payload, headers=headers, verify=False).content
            response = HttpResponse(response,  content_type='application/force-download')
        else:
            
            b = BytesIO()
            imagesZipFile = zipfile.ZipFile(b, mode='w')
            for frame in range(db_task.size):
                frame_watershed_path = task.get_frame_watershed_path(tid, frame)

                if os.path.exists(frame_watershed_path):
                    if db_task.mode == 'annotation':
                        db_task_source = models.TaskSource.objects.filter(task=db_task).filter(frame=frame)[0]
                        fname = db_task_source.source_name
                    else:
                        fdir, fname = os.path.split(frame_watershed_path)

                    zip_path = os.path.join(db_task.name, fname)
                    imagesZipFile.write(frame_watershed_path, zip_path)
            
            imagesZipFile.close()
            response = HttpResponse(b.getvalue(),  content_type="application/x-zip-compressed")

        response['Content-Disposition'] = 'attachment; filename="{}.zip"'.format(db_task.name)

    except Exception as e:
        slogger.task[tid].error("cannot get dumped segmentation", exc_info=True)
        return HttpResponseBadRequest(str(e))

    return response

@login_required
@gzip_page
@permission_required(perm=['engine.job.access'],
    fn=objectgetter(models.Job, 'jid'), raise_exception=True)
def get_annotation(request, jid):
    try:
        slogger.job[jid].info("get annotation for {} job".format(jid))
        response = annotation.get(jid)
    except Exception as e:
        slogger.job[jid].error("cannot get annotation for job {}".format(jid), exc_info=True)
        return HttpResponseBadRequest(str(e))

    return JsonResponse(response, safe=False)

@login_required
@permission_required(perm=['engine.job.change'],
    fn=objectgetter(models.Job, 'jid'), raise_exception=True)
def save_annotation_for_job(request, jid):
    try:
        slogger.job[jid].info("save annotation for {} job".format(jid))
        data = json.loads(request.body.decode('utf-8'))
        if 'annotation' in data:
            annotation.save_job(jid, json.loads(data['annotation']), data["taskid"], json.loads(data['frameProperties']))
        if 'logs' in data:
            for event in json.loads(data['logs']):
                clogger.job[jid].info(json.dumps(event))
        slogger.job[jid].info("annotation have been saved for the {} job".format(jid))
    except RequestException as e:
        slogger.job[jid].error("cannot send annotation logs for job {}".format(jid), exc_info=True)
        return HttpResponseBadRequest(str(e))
    except Exception as e:
        slogger.job[jid].error("cannot save annotation for job {}".format(jid), exc_info=True)
        return HttpResponseBadRequest(str(e))

    return HttpResponse()

@login_required
def parse_annotation_for_task(request, tid):
    return HttpResponse(task.parseTxtToXml(request.FILES.getlist('data')[0],tid))

@login_required
@permission_required(perm=['engine.task.change'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def save_annotation_for_task(request, tid):
    try:
        slogger.task[tid].info("save annotation request")
        data = json.loads(request.body.decode('utf-8'))
        annotation.save_task(tid, data)
    except Exception as e:
        slogger.task[tid].error("cannot save annotation", exc_info=True)
        return HttpResponseBadRequest(str(e))

    return HttpResponse()

@login_required
@permission_required(perm=['engine.task.change'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def delete_annotation_for_task(request, tid):
    try:
        slogger.task[tid].info("delete annotation request")
        annotation.clear_task(tid)
    except Exception as e:
        slogger.task[tid].error("cannot delete annotation", exc_info=True)
        return HttpResponseBadRequest(str(e))

    return HttpResponse()


@login_required
@permission_required(perm=['engine.job.change'],
    fn=objectgetter(models.Job, 'jid'), raise_exception=True)
def save_job_status(request, jid):
    try:
        data = json.loads(request.body.decode('utf-8'))
        status = data['status']
        slogger.job[jid].info("changing job status request")
        task.save_job_status(jid, status, request.user.username)
    except Exception as e:
        if jid:
            slogger.job[jid].error("cannot change status", exc_info=True)
        else:
            slogger.glob.error("cannot change status", exc_info=True)
        return HttpResponseBadRequest(str(e))
    return HttpResponse()

@login_required
@permission_required(perm=['engine.task.access'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def track_task(request, tid):
    try:
        shapes = json.loads(request.body.decode('utf-8'))
        response = task.track_shapes(shapes, tid)
    except Exception as e:
        slogger.glob.error("cannot access/track", exc_info=True)
        return HttpResponseBadRequest(str(e))

    return JsonResponse(response, safe=False)

@login_required
@permission_required(perm=['engine.task.access'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def track_all(request, tid):
    global entireVideoTracking

    if request.user.username not in entireVideoTracking:
        entireVideoTracking[request.user.username] = {}

    if tid not in entireVideoTracking[request.user.username]:
        entireVideoTracking[request.user.username] = {tid : {"downloaded": False, "startedDownloading": False, "video path" : "", "shapes" : {}}}

    currentTask = entireVideoTracking[request.user.username][tid]

    if not currentTask["downloaded"] and not currentTask["startedDownloading"]:
        currentTask["startedDownloading"] = True
        Thread(target=download_vid, args=(tid, currentTask,)).start()

    shape = json.loads(request.body.decode('utf-8'))

    if shape["id"] not in currentTask["shapes"]:
        currentTask["shapes"][shape["id"]] = {"positions": {}, "stopped": False, "finished": False}
        
    if currentTask["startedDownloading"] and not currentTask["shapes"][shape["id"]]["positions"]:
        return HttpResponse("Downloading...")

    if not currentTask["shapes"][shape["id"]]["positions"] and not currentTask["shapes"][shape["id"]]["finished"]:
        currentTask["shapes"][shape["id"]]["Thread"] = Thread(target=track_all_video, args=(shape, currentTask,))
        currentTask["shapes"][shape["id"]]["Thread"].start()

    temp_dict = {"results": currentTask["shapes"][shape["id"]]["positions"], "finished": currentTask["shapes"][shape["id"]]["finished"]}
    response = JsonResponse(temp_dict, safe=False)

    if temp_dict["finished"]:
        currentTask["shapes"].pop(shape["id"])
    elif len(temp_dict["results"].keys()) > 0:
        for key in list(temp_dict["results"]):
            currentTask["shapes"][shape["id"]]["positions"].pop(key, None)

    return response

@login_required
@permission_required(perm=['engine.task.access'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def pause_tracking_all(request, tid, shapeId):
    if (request.user.username not in entireVideoTracking) or (tid not in entireVideoTracking[request.user.username]):
        return HttpResponse("No tracker stopped")

    currentTask = entireVideoTracking[request.user.username][tid]

    if shapeId in currentTask["shapes"]:
        currentTask["shapes"][shapeId]["stopped"] = True
    else:
        return HttpResponse("No tracker stopped")

    currentTask["shapes"][shapeId]["Thread"].join()

    response = JsonResponse({"results": currentTask["shapes"][shapeId]["positions"], "finished": currentTask["shapes"][shapeId]["finished"]}, safe=False)

    currentTask["shapes"].pop(shapeId)

    return response
    
@login_required
@permission_required(perm=['engine.task.access'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def exit_tracking_process(request, tid):
    currentTask = entireVideoTracking[request.user.username][tid]

    if os.path.exists(currentTask["video path"]):
        os.remove(currentTask["video path"])

    entireVideoTracking[request.user.username].pop(tid)

@login_required
@permission_required(perm=['engine.task.access'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def video_file_exists(request, tid):
    if check_video_path(tid):
        response = HttpResponse("Video file exists")
    else:
        response = HttpResponse("Video file does not exist")

    return response

@login_required
@permission_required(perm=['engine.task.access'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def stop_track_task(request, tid):
    try:
        task.stop_tracking(tid)
    except Exception as e:
        return HttpResponseBadRequest(str(e))
        
    return HttpResponse()
    
@login_required
@permission_required(perm=['engine.task.access'],
    fn=objectgetter(models.Task, 'tid'), raise_exception=True)
def watershed(request, tid, frame):
    try:
        frame_path = "/home/django/data/watershed/" + str(tid) + "/" + request.user.username + "/" + str(frame) + ".jpg"
        if not os.path.exists(frame_path):
            print("download frame")
            download_frame(tid, frame, request.user.username)
        draws = json.loads(request.body.decode('utf-8'))
        print("task watershed")
        task.watershed(tid, frame, draws['status'], request.user.username)
    except Exception as e:
        slogger.glob.error("cannot access/watershed", exc_info=True)
        return HttpResponseBadRequest(str(e))

    return HttpResponse()
    #return JsonResponse(response, safe=False)

def save_paintings(request, tid, frame):
    try:
        paintings = json.loads(request.body.decode('utf-8'))
        task.save_paintings(tid, frame, paintings['status'])
    except Exception as e:
        slogger.glob.error("cannot access/save_paintings", exc_info=True)
        return HttpResponseBadRequest(str(e))

    return HttpResponse()

def get_paintings(request, tid, frame):
    try:
        response = task.get_paintings(tid, frame)
    except Exception as e:
        slogger.glob.error("cannot access/get_paintings", exc_info=True)
        return HttpResponseBadRequest(str(e))

    return JsonResponse(response, safe=False)

@login_required
def is_staff(request):
    response = {'is_staff': request.user.has_perm("engine.views.is_staff")}
    return JsonResponse(response, safe=False)

@login_required
def get_username(request):
    response = {'username': request.user.username}
    return JsonResponse(response, safe=False)

def get_next_task(request, status, tid):
    if ((request.user.has_perm('dashboard.views.isManager')) or (request.user.has_perm('dashboard.views.isAdmin'))):
        response = task.nextJobIdByPriority("staff_user", status, tid)
    else:
        response = task.nextJobIdByPriority(request.user.username, status, tid)

    return HttpResponse(response)

@login_required
def updateTaskStatus(request, newStatus, taskId):
    try:
        # If the new status is not validation the user must be a manager to update it
        if (newStatus != 'validation'):
            if (not request.user.has_perm('dashboard.views.isManager')):
                return HttpResponseForbidden()
                
        db_task = models.Task.objects.get(pk=taskId)
        db_task.status = newStatus
        db_task.last_viewed_frame = 0
        db_task.save()
        db_job = models.Job.objects.get(segment__task=db_task)
        db_job.status = newStatus
        db_job.save()
    except Exception as e:
        slogger.glob.error("cannot update the target frame for task #{}".format(tid), exc_info=True)
        return HttpResponseBadRequest(str(e))

    return HttpResponse()

@login_required
def isManager(request):
    if (request.user.has_perm('dashboard.views.isManager')):
        return HttpResponse()
    else:
        return HttpResponseForbidden()
        
def get_matomo(request):
    response = None

    if (os.environ.get('MATOMO')):
        response = {'url': os.environ.get('MATOMO'), 'siteId': os.environ.get('MATOMO_SITE_ID'), 'userId': request.user.username}
        
    return JsonResponse(response, safe=False)

def rq_handler(job, exc_type, exc_value, tb):
    job.exc_info = "".join(traceback.format_exception_only(exc_type, exc_value))
    job.save()
    module = job.id.split('.')[0]
    if module == 'task':
        return task.rq_handler(job, exc_type, exc_value, tb)
    elif module == 'annotation':
        return annotation.rq_handler(job, exc_type, exc_value, tb)

    return True
