# Copyright (C) 2018 Intel Corporation
#
# SPDX-License-Identifier: MIT

import os
import sys
import rq
import shlex
import shutil
import tempfile
import requests
import re
import xml.etree.ElementTree as ET
from threading import Thread
from io import BytesIO
from PIL import Image
from traceback import print_exception
from ast import literal_eval
from .handle_file_s3 import copyFileToOSByThread, deleteFolder, getFileUrl, copyFileToOS, uploadFile, downloadFile, getBucketConnection
from .segmentation import process_watershed

import numpy as np
import urllib
import ssl
from imutils.video import FPS
import argparse
import imutils
import cv2
import threading
import time
import json
import errno

import skvideo.io

import mimetypes
_SCRIPT_DIR = os.path.realpath(os.path.dirname(__file__))
_MEDIA_MIMETYPES_FILE = os.path.join(_SCRIPT_DIR, "media.mimetypes")
mimetypes.init(files=[_MEDIA_MIMETYPES_FILE])

from cvat.apps.engine.models import StatusChoice
from cvat.apps.engine import formatter

import django_rq
from django.forms.models import model_to_dict
from django.conf import settings
from django.core import serializers
from django.db import transaction
from django.db.models import Max
from ffmpy import FFmpeg
from pyunpack import Archive
from distutils.dir_util import copy_tree
from collections import OrderedDict
from django.contrib.auth.models import User

from . import models
from .log import slogger

############################# Global Variables
TRACKER_THREADS = {}

############################# Low Level server API

@transaction.atomic
def create_empty(params):
    """Create empty directory structure for a new task, add it to DB."""

    db_task = models.Task()

    db_task.name = params['task_name']
    db_task.bug_tracker = params['bug_tracker_link']
    db_task.path = ""
    db_task.size = 0
    db_task.owner = params['owner']
    db_task.project = models.Projects.objects.get(pk=params['project'])
    db_task.assignee = User.objects.get(pk=params['assignee'])
    db_task.save()
    task_path = os.path.join(settings.DATA_ROOT, str(db_task.id))
    db_task.set_task_dirname(task_path)

    task_path = db_task.get_task_dirname()
    if os.path.isdir(task_path):
        shutil.rmtree(task_path)
        os.mkdir(task_path)

    upload_dir = db_task.get_upload_dirname()
    os.makedirs(upload_dir)
    output_dir = db_task.get_data_dirname()
    os.makedirs(output_dir)

    return db_task

def create(tid, params):
    """Schedule the task"""
    q = django_rq.get_queue('default')
    q.enqueue_call(func=_create_thread, args=(tid, params),
        job_id="task.create/{}".format(tid))

def check(tid):
    """Check status of the scheduled task"""
    response = {}
    queue = django_rq.get_queue('default')
    job = queue.fetch_job("task.create/{}".format(tid))
    if job is None:
        response = {"state": "unknown"}
    elif job.is_failed:
        response = {"state": "error", "stderr": "Could not create the task. " + job.exc_info }
    elif job.is_finished:
        destFile = r'/home/django/data/' + str(tid) + r'/data/xml/annotations.txt'
        if os.path.exists(destFile):
            with open(destFile, 'r') as f:
                fileData = f.read()
                response = {"state": "created", "annotationFile" : fileData, "tid" : tid}
        else:
            response = {"state": "created"}
    else:
        response = {"state": "started"}

    if 'status' in job.meta:
        response['status'] = job.meta['status']

    return response

@transaction.atomic
def delete(tid):
    """Delete the task"""
    db_task = models.Task.objects.select_for_update().get(pk=tid)
    if db_task:
        db_task.delete()
        shutil.rmtree(db_task.get_task_dirname(), ignore_errors=True)
        threads = deleteFolder(db_task.get_task_dirname())

        for t in threads:
            t.join()
    else:
        raise Exception("The task doesn't exist")

@transaction.atomic
def update(tid, labels, score, assignee):
    """Update labels for the task"""

    db_task = models.Task.objects.select_for_update().get(pk=tid)
    db_labels = list(db_task.label_set.prefetch_related('attributespec_set').all())

    if (labels):
        new_labels = _parse_labels(labels)
        old_labels = _parse_db_labels(db_labels)

        for label_name in new_labels:
            if label_name in old_labels:
                db_label = [l for l in db_labels if l.name == label_name][0]
                for attr_name in new_labels[label_name]:
                    if attr_name in old_labels[label_name]:
                        db_attr = [attr for attr in db_label.attributespec_set.all()
                            if attr.get_name() == attr_name][0]
                        new_attr = new_labels[label_name][attr_name]
                        old_attr = old_labels[label_name][attr_name]
                        if new_attr['prefix'] != old_attr['prefix']:
                            raise Exception("new_attr['prefix'] != old_attr['prefix']")
                        if new_attr['type'] != old_attr['type']:
                            raise Exception("new_attr['type'] != old_attr['type']")
                        if set(old_attr['values']) - set(new_attr['values']):
                            raise Exception("set(old_attr['values']) - set(new_attr['values'])")

                        db_attr.text = "{}{}={}:{}".format(new_attr['prefix'],
                            new_attr['type'], attr_name, ",".join(new_attr['values']))
                        db_attr.save()
                    else:
                        db_attr = models.AttributeSpec()
                        attr = new_labels[label_name][attr_name]
                        db_attr.text = "{}{}={}:{}".format(attr['prefix'],
                            attr['type'], attr_name, ",".join(attr['values']))
                        db_attr.label = db_label
                        db_attr.save()
            else:
                db_label = models.Label()
                db_label.name = label_name
                db_label.task = db_task
                db_label.save()
                for attr_name in new_labels[label_name]:
                    db_attr = models.AttributeSpec()
                    attr = new_labels[label_name][attr_name]
                    db_attr.text = "{}{}={}:{}".format(attr['prefix'],
                        attr['type'], attr_name, ",".join(attr['values']))
                    db_attr.label = db_label
                    db_attr.save()

    db_task.assignee = User.objects.get(pk=assignee)
    # If score sent from the client is -1 it means there is no score because the project has_score attribute is set to true.
    if (score != -1):   
        db_task.score = score
        db_task.save()

@transaction.atomic
def updateProperties(tid, properties):
    db_task = models.Task.objects.select_for_update().get(pk=tid)

    newFrameProperties = _parse_frameproperties(properties)

    for frameprop in newFrameProperties:
        db_taskframespec = models.TaskFrameSpec()
        db_taskframespec.task = db_task

        db_framepropvals = models.FrameProperties.objects.get(prop=frameprop[0], value=frameprop[1], project__pk=db_task.project.pk)
        db_taskframespec.propVal = db_framepropvals
        if (models.TaskFrameSpec.objects.filter(task__id=db_task.id, propVal__id=db_framepropvals.id).count() == 0):
            db_taskframespec.save()

def get_frame_path(tid, frame):
    """Read corresponding frame for the task"""
    db_task = models.Task.objects.get(pk=tid)
    path = _get_frame_path(frame, db_task.get_data_dirname())

    return path

def get_frame_watershed_path(tid, frame):
    """Read corresponding frame for the task"""
    db_task = models.Task.objects.get(pk=tid)
    path = _get_frame_watershed_path(frame, db_task.get_data_dirname())

    return path

def get(tid):
    """Get the task as dictionary of attributes"""
    db_task = models.Task.objects.get(pk=tid)
    if db_task:
        db_labels = db_task.label_set.prefetch_related('attributespec_set').order_by('-pk').all()
        im_meta_data = get_image_meta_cache(db_task)
        attributes = {}
        for db_label in db_labels:
            attributes[db_label.id] = {}
            for db_attrspec in db_label.attributespec_set.all():
                attributes[db_label.id][db_attrspec.id] = db_attrspec.text
        db_segments = list(db_task.segment_set.prefetch_related('job_set').all())
        segment_length = max(db_segments[0].stop_frame - db_segments[0].start_frame + 1, 1)
        job_indexes = []
        for segment in db_segments:
            db_job = segment.job_set.first()
            job_indexes.append({
                "job_id": db_job.id,
                "max_shape_id": db_job.max_shape_id,
            })

        labels_colors = models.LabelDetails.objects.filter(labelType__label__in=[db_label.name for db_label in db_labels])

        response = {
            "status": db_task.status,
            "spec": {
                "labels": OrderedDict((db_label.id, db_label.name) for db_label in db_labels),
                "attributes": attributes,
                "segmentation": {label_color.labelType.label: {"color": label_color.color, "label_type_id": label_color.labelType.id} for label_color in labels_colors}
            },
            "size": db_task.size,
            "taskid": db_task.id,
            "name": db_task.name,
            "mode": db_task.mode,
            "segment_length": segment_length,
            "jobs": job_indexes,
            "overlap": db_task.overlap,
            "z_orded": db_task.z_order,
            "flipped": db_task.flipped,
            "score": db_task.score,
            "image_meta_data": im_meta_data,
        }
    else:
        raise Exception("Cannot find the task: {}".format(tid))

    return response


@transaction.atomic
def save_job_status(jid, status, user):
    db_job = models.Job.objects.select_related("segment__task").select_for_update().get(pk = jid)
    db_task = db_job.segment.task
    status = StatusChoice(status)

    slogger.job[jid].info('changing job status from {} to {} by an user {}'.format(db_job.status, str(status), user))

    db_job.status = status.value
    db_job.save()
    db_segments = list(db_task.segment_set.prefetch_related('job_set').all())
    db_jobs = [db_segment.job_set.first() for db_segment in db_segments]

    if len(list(filter(lambda x: StatusChoice(x.status) == StatusChoice.ANNOTATION, db_jobs))) > 0:
        db_task.status = StatusChoice.ANNOTATION
    elif len(list(filter(lambda x: StatusChoice(x.status) == StatusChoice.VALIDATION, db_jobs))) > 0:
        db_task.status = StatusChoice.VALIDATION
    else:
        db_task.status = StatusChoice.COMPLETED

    db_task.save()

class CSRTTrackerThread(threading.Thread):
    def __init__(self, data, base_dir, results):
        threading.Thread.__init__(self)
        self.data = data
        self.base_dir = base_dir
        self.results = results
        self._stop_event = False
    def stop(self):
        self._stop_event = True
    def stopped(self):
        return self._stop_event
    def run(self):
        def _frame_path(frame, base_dir):
            d1 = str(frame // 10000)
            d2 = str(frame // 100)
            path = os.path.join(d1, d2, str(frame) + '.jpg')
            if base_dir:
                path = os.path.join(base_dir, path)

            return path

        def _get_frame(currentFrame, base_dir):
            # Download the requested frame
            frame_path = _frame_path(currentFrame, base_dir)
            downloadFile(settings.AWS_STORAGE_BUCKET_NAME, frame_path, frame_path)

            return frame_path

        tracker = cv2.TrackerCSRT_create()
        currentFrame = self.data['frame']
        frame_path = _get_frame(currentFrame, self.base_dir)
        frame = cv2.imread(frame_path)
        self.results[self.data['id']] = {'results': {}}

        counter = 0

        x = self.data['positions']['x']
        y = self.data['positions']['y']
        w = self.data['positions']['w']
        h = self.data['positions']['h']

        bbox = (x, y, w, h)

        tracker.init(frame, bbox)

        if os.environ.get('WITH_OS') == 'True':
            os.remove(frame_path)

        while ((not self.stopped()) and (counter < 10)):
            currentFrame += 1

            frame_path = _get_frame(currentFrame, self.base_dir)
            frame = cv2.imread(frame_path)
            
            if frame is None:
                break

            ok, bbox = tracker.update(frame)
            if os.environ.get('WITH_OS') == 'True':
                os.remove(frame_path)

            (x, y, w, h) = [int(v) for v in bbox]
            
            if (h == 0 and w == 0):
                self.results[self.data['id']]['results'][currentFrame] = {'x': x, 'y': y, 'h': h, 'w': w}
                break

            self.results[self.data['id']]['results'][currentFrame] = {'x': x, 'y': y, 'h': h, 'w': w}

            key = cv2.waitKey(1) & 0xFF

            counter += 1

def track_shapes(data, tid):
    base_dir='/home/django/data/%d/data' % (tid)

    results = {}
    shape = data['shapes'][0]

    results[shape['id']] = {'results': {}}
    thread = CSRTTrackerThread(shape, base_dir, results)
    thread.start()

    if tid not in TRACKER_THREADS:
        TRACKER_THREADS[tid] = []

    TRACKER_THREADS[tid].append(thread)

    thread.join()
        
    return results

def stop_tracking(tid):
    for thread in TRACKER_THREADS[tid]:
        thread.stop()

def download_vid(tid, currentTask):
    base_dir = '/home/django/data/%d/data' % (tid)
    vid_dir_path = os.path.join(base_dir, 'video')
    if not os.path.isdir(vid_dir_path):
        try:
            os.mkdir(vid_dir_path)
        except OSError as e:
            if e.errno == errno.EEXIST:
                os.remove(vid_dir_path)
                os.mkdir(vid_dir_path)

    if os.environ.get('WITH_OS') == 'True':
        bucket = getBucketConnection()

        for object_summary in bucket.objects.filter(Prefix=base_dir + "/video"):
            currentTask["video path"] = object_summary.key
            downloadFile(settings.AWS_STORAGE_BUCKET_NAME, currentTask["video path"], currentTask["video path"])
            break
    else:
        currentTask["video path"] = os.path.join(vid_dir_path, os.listdir(vid_dir_path)[0])
    
    currentTask["downloaded"] = True
    currentTask["startedDownloading"] = False

def track_all_video(shape, currentTask):
    vs = cv2.VideoCapture(currentTask["video path"].split("?")[0])

    currentFrame = shape['frame']
    vs.set(1, currentFrame)
    
    box = (shape['positions']['x'], shape['positions']['y'], shape['positions']['h'], shape['positions']['w'])

    ok, frame = vs.read()
    
    # Add a tracker to each box in the frame
    tracker = cv2.TrackerCSRT_create()
    tracker.init(frame, box)

    while not currentTask["shapes"][shape["id"]]["stopped"]:
        currentFrame += 1
        ok, frame = vs.read()
        
        if frame is None:
            break
        
        ok, box = tracker.update(frame)

        (x, y, h, w) = [int(v) for v in box]
        
        if (h == 0 and w == 0):
            break

        # If the predicted position is lower than 0 the box is out of bounds.
        xtl = x if x > 0 else 0
        ytl = y if y > 0 else 0

        # If the predicted position is greater than either the frame width or height the box is out of bounds.
        xbr = shape["frameWidth"] if (x + w) > shape["frameWidth"] else (x + w)
        ybr = shape["frameHeight"] if (y + h) > shape["frameHeight"] else (y + h)

        currentTask["shapes"][shape["id"]]["positions"][currentFrame] = {"xtl": xtl, "ytl": ytl, "xbr": xbr, "ybr": ybr, "occluded": shape["occluded"], "z_order": shape["z_order"], "outside": shape["outside"]}
    currentTask["shapes"][shape["id"]]["finished"] = True

def check_video_path(tid):
    base_dir = '/home/django/data/%d/data' % (tid)

    if os.environ.get('WITH_OS') == 'False':
        return os.path.exists(base_dir + "/video")
    else:       
        bucket = getBucketConnection()

        objs = list(bucket.objects.filter(Prefix=base_dir + "/video"))
        
        return len(objs) > 0

def watershed(tid, frame, draws, username):

    frame_path = "/home/django/data/watershed/" + str(tid) + "/" + username + "/" + str(frame) + ".jpg"
    watershed_path = get_frame_path(tid, frame).replace('.jpg', '_w.png')

    cvImg = cv2.imread(frame_path)

    print("start process")
    overlay = process_watershed(cvImg, draws, tid, frame)
    print("end process")

    print("start save")
    save_watershed_image(overlay, watershed_path)
    print("end save")
    
    # q = django_rq.get_queue('default')
    # q.enqueue_call(func=save_watershed_matrix, args=(tid, frame, matrix),
    #     job_id="task/{}.frame/{}.save_matrix".format(tid, frame))

    #result['polygons'] = polygons

    #return result

def save_watershed_image(image, path):
    im = Image.fromarray(image)
    im.save(path)

def compress_matrix(matrix):
    compressedMatrix = []
    sequenceCount = 0
    prevLabel = matrix[0][0]

    # Each sequence (n elements) of label in matrix is reduced
    # to array with 2 elements: [the label, n (sequence count)]
    for currLabel in np.nditer(matrix):
        if currLabel == prevLabel:
            sequenceCount += 1
        else:
            compressedMatrix.append([prevLabel, sequenceCount])
            sequenceCount = 1

        prevLabel = currLabel

    return compressedMatrix

def save_watershed_matrix(tid, frame, matrix):
    db_task = models.Task.objects.get(pk=tid)
    models.Watershed.objects.update_or_create(task=db_task, frame=frame, defaults={'task':db_task, 'frame':frame, 'watershed':compress_matrix(matrix)})

def save_paintings(tid, frame, paintings):
    db_task = models.Task.objects.get(pk=tid)
    models.Watershed.objects.update_or_create(task=db_task, frame=frame, defaults={'task':db_task, 'frame':frame, 'paintings':paintings})

def get_paintings(tid, frame):
    db_task = models.Task.objects.get(pk=tid)
    db_frame_paintings = models.Watershed.objects.filter(task=db_task, frame=frame).first()

    if db_frame_paintings is None:
        paintings = []
    else:
        paintings = db_frame_paintings.paintings
    
    return paintings

def get_task_byjob(jid):
    """Get the task by the jobid"""
    db_job = models.Job.objects.select_related("segment__task").get(id=jid)
    if db_job:
        db_segment = db_job.segment
        db_task = db_segment.task

        return get(db_task.id)
    else:
        raise Exception("Cannot find the job: {}".format(jid))
    return {}

def get_job(jid):
    """Get the job as dictionary of attributes"""
    db_job = models.Job.objects.select_related("segment__task").get(id=jid)
    if db_job:
        db_segment = db_job.segment
        db_task = db_segment.task
        im_meta_data = get_image_meta_cache(db_task)

        # Truncate extra image sizes
        if db_task.mode == 'annotation':
            im_meta_data['original_size'] = im_meta_data['original_size'][db_segment.start_frame:db_segment.stop_frame + 1]

        db_labels = db_task.label_set.prefetch_related('attributespec_set').order_by('-pk').all()
        attributes = {}
        for db_label in db_labels:
            attributes[db_label.id] = {}
            for db_attrspec in db_label.attributespec_set.all():
                attributes[db_label.id][db_attrspec.id] = db_attrspec.text

        framePropertiesDict = {"allProperties": {}, "keyframeSpec": {}}

        # Get all of the task frame spec rows related to the requested task.
        taskFrameSpecQuerySet = db_task.taskframespec_set.all()

        # Save the prop name, value name, and relation id for each row in the database for the task in a dictionary
        for taskFrameSpec in taskFrameSpecQuerySet:
            propName = taskFrameSpec.propVal.prop
            valName = taskFrameSpec.propVal.value
            propValId = taskFrameSpec.propVal.pk

            # If the propName is not in the dictionary yet, add an empty dictionary to it
            if (propName not in framePropertiesDict["allProperties"]):
                framePropertiesDict["allProperties"][propName] = {}
            framePropertiesDict["allProperties"][propName][valName] = propValId
            
            keyframes = taskFrameSpec.keyframespec_set.all()
            for keyframe in keyframes:
                frame = keyframe.frame
                if (frame not in framePropertiesDict["keyframeSpec"]):
                    framePropertiesDict["keyframeSpec"][frame] = {}
                framePropertiesDict["keyframeSpec"][frame][propName] = propValId
        
        labels_colors = models.LabelDetails.objects.filter(labelType__label__in=[db_label.name for db_label in db_labels])
        commentsList = list(models.Comments.objects.filter(task=db_task).values_list('frame', 'comment'))
        comments = {}
        for comment in commentsList:
            comments[comment[0]] = comment[1]
            
        project = serializers.serialize('json', [db_task.project])

        response = {
            "status": db_job.status,
            "labels": OrderedDict((db_label.id, db_label.name) for db_label in db_labels),
            "frameProperties": framePropertiesDict,
            "comments": comments,
            "segmentation": {label_color.labelType.label: {"color": label_color.color, "label_type_id": label_color.labelType.id} for label_color in labels_colors},
            "stop": db_segment.stop_frame,
            "taskid": db_task.id,
            "slug": db_task.name,
            "jobid": jid,
            "start": db_segment.start_frame,
            "mode": db_task.mode,
            "overlap": db_task.overlap,
            "attributes": attributes,
            "z_order": db_task.z_order,
            "flipped": db_task.flipped,
            "score": db_task.score,
            "project": project,
            "image_meta_data": im_meta_data,
            "max_shape_id": db_job.max_shape_id,
            "current": models.Task.objects.get(pk=db_task.id).last_viewed_frame, # db_task.last_viewed_frame returns the previous value from the database
        }
    else:
        raise Exception("Cannot find the job: {}".format(jid))

    return response

@transaction.atomic
def rq_handler(job, exc_type, exc_value, traceback):
    tid = job.id.split('/')[1]
    db_task = models.Task.objects.select_for_update().get(pk=tid)
    with open(db_task.get_log_path(), "wt") as log_file:
        print_exception(exc_type, exc_value, traceback, file=log_file)
    db_task.delete()

    return False

def nextJobIdByPriority(username, status, tid):
    project = models.Task.objects.get(pk=tid).project
    if not username == "staff_user":
        currentUser = User.objects.get(username=username)
        opened_tasks = models.Task.objects.filter(project=project, assignee=currentUser, status=status)
    else:
        currentUser = username 
        opened_tasks = models.Task.objects.filter(project=project, status=status)

    if opened_tasks.exists():
        max_score = opened_tasks.aggregate(maxscore=Max('score'))['maxscore']

        if currentUser == "staff_user":
            highest_priority_task = models.Task.objects.filter(project=project, status=status, score=max_score)
        else:
            highest_priority_task = models.Task.objects.filter(project=project, assignee=currentUser, status=status, score=max_score)

        return models.Job.objects.get(segment__task=highest_priority_task[0]).id
    else:
        return "No task found"

############################# Internal implementation for server API

def _make_image_meta_cache(db_task, sorted_filenames=None):
    with open(db_task.get_image_meta_cache_path(), 'w') as meta_file:
        cache = {
            'original_size': []
        }

        if db_task.mode == 'interpolation':
            frame_0_url = getFileUrl(get_frame_path(db_task.id, 0))
            image = Image.open(frame_0_url)
            cache['original_size'].append({
                'width': image.size[0],
                'height': image.size[1]
            })
            image.close()
        else:
            filenames = []

            if sorted_filenames is None:
                for root, _, files in os.walk(db_task.get_upload_dirname()):
                    fullnames = map(lambda f: os.path.join(root, f), files)
                    images = filter(lambda x: _get_mime(x) == 'image', fullnames)
                    filenames.extend(images)
                filenames.sort()
            else:
                filenames = sorted_filenames

            for image_path in filenames:
                image = Image.open(image_path)
                cache['original_size'].append({
                    'width': image.size[0],
                    'height': image.size[1]
                })
                image.close()

        meta_file.write(str(cache))

def get_image_meta_cache(db_task):
    try:
        with open(db_task.get_image_meta_cache_path()) as meta_cache_file:
            return literal_eval(meta_cache_file.read())
    except Exception:
        _make_image_meta_cache(db_task)
        with open(db_task.get_image_meta_cache_path()) as meta_cache_file:
            return literal_eval(meta_cache_file.read())


def _get_mime(name):
    mime = mimetypes.guess_type(name)
    mime_type = mime[0]
    encoding = mime[1]
    # zip, rar, tar, tar.gz, tar.bz2, 7z, cpio
    supportedArchives = ['application/zip', 'application/x-rar-compressed',
        'application/x-tar', 'application/x-7z-compressed', 'application/x-cpio',
        'gzip', 'bzip2']
    if mime_type is not None:
        if mime_type.startswith('video'):
            return 'video'
        elif mime_type in supportedArchives or encoding in supportedArchives:
            return 'archive'
        elif mime_type.startswith('image'):
            return 'image'
        else:
            return 'empty'
    else:
        if os.path.isdir(name):
            return 'directory'
        else:
            return 'empty'


def _get_frame_path(frame, base_dir):
    d1 = str(frame // 10000)
    d2 = str(frame // 100)
    path = os.path.join(d1, d2, str(frame) + '.jpg')
    if base_dir:
        path = os.path.join(base_dir, path)

    return path

def _parse_frameproperties(frameproperties):
    parsed_frameprops = []
    for row in frameproperties:
        if (row['parent'] != '#' and row['parent'] != '$$$'):
            parsed_frameprops.append(row['original']['path'].split("/"))

    return parsed_frameprops
    
def _get_frame_watershed_path(frame, base_dir):
    d1 = str(frame // 10000)
    d2 = str(frame // 100)
    path = os.path.join(d1, d2, str(frame) + '_w.png')
    if base_dir:
        path = os.path.join(base_dir, path)

    return path

def _parse_labels(labels):
    parsed_labels = OrderedDict()

    last_label = ""
    for token in shlex.split(labels):
        if token[0] != "~" and token[0] != "@":
            if token in parsed_labels:
                raise ValueError("labels string is not corect. " +
                    "`{}` label is specified at least twice.".format(token))

            parsed_labels[token] = {}
            last_label = token
        else:
            attr = models.parse_attribute(token)
            attr['text'] = token
            if not attr['type'] in ['checkbox', 'radio', 'number', 'text', 'select']:
                raise ValueError("labels string is not corect. " +
                    "`{}` attribute has incorrect type {}.".format(
                    attr['name'], attr['type']))

            values = attr['values']
            if attr['type'] == 'checkbox': # <prefix>checkbox=name:true/false
                if not (len(values) == 1 and values[0] in ['true', 'false']):
                    raise ValueError("labels string is not corect. " +
                        "`{}` attribute has incorrect value.".format(attr['name']))
            elif attr['type'] == 'number': # <prefix>number=name:min,max,step
                try:
                    if len(values) != 3 or float(values[2]) <= 0 or \
                        float(values[0]) >= float(values[1]):
                        raise ValueError
                except ValueError:
                    raise ValueError("labels string is not correct. " +
                        "`{}` attribute has incorrect format.".format(attr['name']))

            if attr['name'] in parsed_labels[last_label]:
                raise ValueError("labels string is not corect. " +
                    "`{}` attribute is specified at least twice.".format(attr['name']))

            parsed_labels[last_label][attr['name']] = attr

    return parsed_labels

def _parse_db_labels(db_labels):
    result = []
    for db_label in db_labels:
        result += [db_label.name]
        result += [attr.text for attr in db_label.attributespec_set.all()]
    return _parse_labels(" ".join(result))


'''
    Count all files, remove garbage (unknown mime types or extra dirs)
'''
def _prepare_paths(source_paths, target_paths, storage):
    counters = {
        "image": 0,
        "directory": 0,
        "video": 0,
        "archive": 0
    }

    share_dirs_mapping = {}
    share_files_mapping = {}

    if storage == 'local':
        # Files were uploaded early. Remove trash if it exists. Count them.
        for path in target_paths:
            mime = _get_mime(path)
            if mime in ['video', 'archive', 'image']:
                counters[mime] += 1
            else:
                try:
                    os.remove(path)
                except:
                    os.rmdir(path)
    else:
        # Files are available via mount share. Count them and separate dirs.
        for source_path, target_path in zip(source_paths, target_paths):
            mime = _get_mime(source_path)
            if mime in ['directory', 'image', 'video', 'archive']:
                counters[mime] += 1
                if mime == 'directory':
                    share_dirs_mapping[source_path] = target_path
                else:
                    share_files_mapping[source_path] = target_path

        # Remove directories if other files from them exists in input paths
        exclude = []
        for dir_name in share_dirs_mapping.keys():
            for patch in share_files_mapping.keys():
                if dir_name in patch:
                    exclude.append(dir_name)
                    break

        for excluded_dir in exclude:
            del share_dirs_mapping[excluded_dir]

        counters['directory'] = len(share_dirs_mapping.keys())

    return (counters, share_dirs_mapping, share_files_mapping)


'''
    Check file set on valid
    Valid if:
        1 video, 0 images and 0 dirs (interpolation mode)
        1 archive, 0 images and 0 dirs (annotation mode)
        Many images or many dirs with images (annotation mode), 0 archives and 0 videos
'''
def _valid_file_set(counters):
    if (counters['image'] or counters['directory']) and (counters['video'] or counters['archive']):
        return False
    elif counters['video'] > 1 or (counters['video'] and (counters['archive'] or counters['image'] or counters['directory'])):
        return False
    elif counters['archive'] > 1 or (counters['archive'] and (counters['video'] or counters['image'] or counters['directory'])):
        return False

    return True


'''
    Copy data from share to local
'''
def _copy_data_from_share(share_files_mapping, share_dirs_mapping):
    for source_path in share_dirs_mapping:
        copy_tree(source_path, share_dirs_mapping[source_path])
    for source_path in share_files_mapping:
        target_path = share_files_mapping[source_path]
        target_dir = os.path.dirname(target_path)
        if not os.path.exists(target_dir):
            os.makedirs(target_dir)
        shutil.copyfile(source_path, target_path)


'''
    Find and unpack archive in upload dir
'''
def _find_and_unpack_archive(upload_dir):
    archive = None
    for root, _, files in os.walk(upload_dir):
        fullnames = map(lambda f: os.path.join(root, f), files)
        archives = list(filter(lambda x: _get_mime(x) == 'archive', fullnames))
        if len(archives):
            archive = archives[0]
            break
    if archive:
        Archive(archive).extractall(upload_dir)
        os.remove(archive)
    else:
        raise Exception('Type defined as archive, but archives were not found.')

    return archive


'''
    Search a video in upload dir and split it by frames. Copy frames to target dirs
'''
def _find_and_extract_video(upload_dir, output_dir, db_task, job):
    video = None
    for root, _, files in os.walk(upload_dir):
        fullnames = map(lambda f: os.path.join(root, f), files)
        videos = list(filter(lambda x: _get_mime(x) == 'video', fullnames))
        if len(videos):
            video = videos[0]
            break

    if video:
        job.meta['status'] = 'Video is being extracted..'
        job.save_meta()
        _dir, vid_name = os.path.split(video)
        uploadFile(video, os.path.join(output_dir, 'video', vid_name))
        frame_count = extract_frames(video, output_dir)
        db_task.size += frame_count

    else:
        raise Exception("Video files were not found")

    return video

def count_frames(path):
    video = cv2.VideoCapture(path)
    total = 0

    # Try to count the frames using opencv property.
    # If opencv can't count the frames, count them manually.
    try:
        # VieoCapture.get returns float value, so we need to convert it to int.
        total = int(video.get(cv2.CAP_PROP_FRAME_COUNT))
    except:
        total = count_frames_manual(video)
    
    video.release()

    return total

def count_frames_manual(video):
    total = 0

    # frameExists is a boolean returned from read that indicates wether or not 
    # a frame was read.
    (frameExists, _) = video.read()
    
    # Continue to iterate over the video frames until the end of the video.
    while frameExists:        
        total += 1
        
        # video.read() is a function that advances the pointer of the video and
        # returns wether or not the frame exists and the frame itself.
        (frameExists, _) = video.read()
    
    return total

def get_meta_data(source_path):
    meta_data = skvideo.io.ffprobe(source_path)['video']

    if '@nb_frames' not in meta_data:
        meta_data['@nb_frames'] = count_frames(source_path)
    
    return meta_data

def extract_frames(source_path, output_dir):
    count = 0
    threads = []
    output = tempfile.mkdtemp(prefix='cvat-', suffix='.data')
    target_path = os.path.join(output, '%d.jpg')
    LocalImagesPath = target_path

    # create a folder for this video and for entire dataser (if doesnt exist)
    _dir, vid_name = os.path.split(source_path)
    name = os.path.splitext(vid_name)[0]
    save_dir = os.path.abspath(os.path.join(LocalImagesPath, name))
    os.makedirs(save_dir)

    # Parse the video
    for frame_count, frame in protected_reader(source_path):
        if frame is not False:
            img_path = os.path.join(save_dir, str(frame_count) + 'jpg')
            
            #Remove combing lines effect from image
            deint_image = deinterlace(frame)
            cv2.imwrite(img_path, deint_image[:, :,::-1])  # save image (cv2 uses BGR color channels so reverse)
            image_dest_path = _get_frame_path(frame_count, output_dir)
            count += 1
            dirname = os.path.dirname(image_dest_path)
            if not os.path.exists(dirname):
                os.makedirs(dirname)
            t = copyFileToOSByThread(img_path, image_dest_path)
            t.start()
            threads.append(t) 

        else:
            break

    threads = [t for t in threads if t.isAlive()]
    for t in threads:
        t.join()
    
    return count
    
def protected_reader(src_path, max_frames=None):
    """A wrapper reader for skvideo.io.FFmpegReader to avoid crashing on a RuntimeError exception.

    :param src_path: Path to the video file to be read.
    :param max_frames: (default=None) Number of frames to read. If left as None will attempt to read the entire video.
    :return: A tuple of frame_count, frame
    """
    frame, reader, count = False, None, 0
    metadata = get_meta_data(src_path)
    if max_frames is None:
        max_frames = metadata['@nb_frames']

    video_codec = metadata['@codec_name']
    reader = skvideo.io.FFmpegReader(filename=src_path, inputdict={'-vcodec': video_codec})
    gen = reader.nextFrame()

    while count < int(max_frames):
        try:
            frame = gen.__next__()
        except Exception:
            frame = False
            reader.close()
        finally:
            yield count, frame
            count += 1
    try:
        reader.close()
    except Exception:
        pass


def deinterlace(image):
    interpolation = cv2.INTER_LINEAR # cv2.INTER_NEAREST - fast, looks ok for tagging | cv2.INTER_LINEAR - slower, looks good

    # if sample of image and tags
    h, w, c = image.shape

    # cut image in half
    temp = image[::2, :, :] if h % 2 == 0 else image[:h-1:2, :, :]

    return cv2.resize(temp, (w, h), interpolation=interpolation)

'''
    Recursive search for all images in upload dir and compress it to RGB jpg with specified quality. Create symlinks for them.
'''
def _find_and_compress_images(upload_dir, output_dir, db_task, compress_quality, flip_flag, job):
    filenames = []
    for root, _, files in os.walk(upload_dir):
        fullnames = map(lambda f: os.path.join(root, f), files)
        images = filter(lambda x: _get_mime(x) == 'image', fullnames)
        filenames.extend(images)
    filenames.sort()

    _make_image_meta_cache(db_task, filenames)

    if len(filenames):
        for idx, name in enumerate(filenames):
            job.meta['status'] = 'Images are being compressed.. {}%'.format(idx * 100 // len(filenames))
            job.save_meta()
            compressed_name = os.path.splitext(name)[0] + '.jpg'
            image = Image.open(name).convert('RGB')
            if flip_flag:
                image = image.transpose(Image.ROTATE_180)
            image.save(compressed_name, quality=compress_quality, optimize=True)
            image.close()
            if compressed_name != name:
                os.remove(name)
                # PIL::save uses filename in order to define image extension.
                # We need save it as jpeg for compression and after rename the file
                # Else annotation file will contain invalid file names (with other extensions)
                os.rename(compressed_name, name)

        threads = []
        for frame, image_orig_path in enumerate(filenames):
            image_dest_path = _get_frame_path(frame, output_dir)
            image_orig_path = os.path.abspath(image_orig_path)
            db_task.size += 1
            dirname = os.path.dirname(image_dest_path)
            if not os.path.exists(dirname):
                os.makedirs(dirname)
            os.rename(image_orig_path, image_dest_path)
            t = copyFileToOSByThread(image_orig_path, image_dest_path)
            t.start()
            threads.append(t) 
        
        threads = [t for t in threads if t.isAlive()]
        for t in threads:
            t.join()
    else:
        raise Exception("Image files were not found")

    return filenames

def _save_task_to_db(db_task, task_params):

    db_task.overlap = min(db_task.size, task_params['overlap'])
    db_task.mode = task_params['mode']
    db_task.z_order = task_params['z_order']
    db_task.flipped = task_params['flip']
    db_task.score = task_params['score'] and task_params['score'] or 0 # Set to task_params['score'] unless its undefined, then 0.
    db_task.video_id = task_params['video_id']
    db_task.source = task_params['data']

    segment_step = task_params['segment'] - db_task.overlap
    for x in range(0, db_task.size, segment_step):
        start_frame = x
        stop_frame = min(x + task_params['segment'] - 1, db_task.size - 1)
        slogger.glob.info("New segment for task #{}: start_frame = {}, \
            stop_frame = {}".format(db_task.id, start_frame, stop_frame))

        db_segment = models.Segment()
        db_segment.task = db_task
        db_segment.start_frame = start_frame
        db_segment.stop_frame = stop_frame
        db_segment.save()

        db_job = models.Job()
        db_job.segment = db_segment
        db_job.save()

    parsed_frameprops = _parse_frameproperties(task_params['frame_properties'])
    for frameprop in parsed_frameprops:
        db_taskframespec = models.TaskFrameSpec()
        db_taskframespec.task = db_task

        db_framepropvals = models.FrameProperties.objects.get(prop=frameprop[0], value=frameprop[1], project__pk=db_task.project.pk)
        db_taskframespec.propVal = db_framepropvals
        db_taskframespec.save()

    parsed_labels = _parse_labels(task_params['labels'])
    for label in parsed_labels:
        db_label = models.Label()
        db_label.task = db_task
        db_label.name = label
        db_label.save()

        for attr in parsed_labels[label]:
            db_attrspec = models.AttributeSpec()
            db_attrspec.label = db_label
            db_attrspec.text = parsed_labels[label][attr]['text']
            db_attrspec.save()

    db_task.save()

def _save_paths_to_db(task, files):
    count = 0
    for currFile in files:
        db_task_source = models.TaskSource()
        db_task_source.task = task
        db_task_source.source_name = currFile
        db_task_source.frame = count
        count+=1
        db_task_source.save()

def parseTxtToXml(fileData, taskId):
    try:
        # Getting image size
        frame_0_url = getFileUrl(get_frame_path(taskId, 0))
        width, height = Image.open(frame_0_url).size
    except Exception:
        raise ex

    return (formatter.parse_format(fileData, frame_0_url, width, height))


@transaction.atomic
def _create_thread(tid, params):
    def raise_exception(images, dirs, videos, archives):
        raise Exception('Only one archive, one video or many images can be dowloaded simultaneously. \
            {} image(s), {} dir(s), {} video(s), {} archive(s) found'.format(images, dirs, videos, archives))

    slogger.glob.info("create task #{}".format(tid))
    job = rq.get_current_job()

    db_task = models.Task.objects.select_for_update().get(pk=tid)
    upload_dir = db_task.get_upload_dirname()
    output_dir = db_task.get_data_dirname()

    counters, share_dirs_mapping, share_files_mapping = _prepare_paths(
        params['SOURCE_PATHS'],
        params['TARGET_PATHS'],
        params['storage']
    )

    if (not _valid_file_set(counters)):
        raise Exception('Only one archive, one video or many images can be dowloaded simultaneously. \
            {} image(s), {} dir(s), {} video(s), {} archive(s) found'.format(
                counters['image'],
                counters['directory'],
                counters['video'],
                counters['archive']
            )
        )

    archive = None
    if counters['archive']:
        job.meta['status'] = 'Archive is being unpacked..'
        job.save_meta()
        archive = _find_and_unpack_archive(upload_dir)

    # Define task mode and other parameters
    task_video_id = -1
    print(params)
    task_score = params['score']
    if 'video_id' in params:
        task_video_id = params['video_id']

    task_params = {
        'mode': 'annotation' if counters['image'] or counters['directory'] or counters['archive'] else 'interpolation',
        'flip': params['flip_flag'].lower() == 'true',
        'score': task_score,
        'video_id': task_video_id,
        'z_order': params['z_order'].lower() == 'true',
        'compress': int(params.get('compress_quality', 50)),
        'segment': int(sys.maxsize),
        'labels': params['labels'],
        'frame_properties': json.loads(params['frame_properties'])
    }

    task_params['overlap'] = int(params.get('overlap_size', 5 if task_params['mode'] == 'interpolation' else 0))
    slogger.glob.info("Task #{} parameters: {}".format(tid, task_params))

    files = []

    if task_params['mode'] == 'interpolation':
        video = _find_and_extract_video(upload_dir, output_dir, db_task, job)
        task_params['data'] = os.path.relpath(video, upload_dir)
    else:
        files =_find_and_compress_images(upload_dir, output_dir, db_task,
            task_params['compress'], task_params['flip'], job)
        if archive:
            task_params['data'] = os.path.relpath(archive, upload_dir)
        else:
            task_params['data'] = '{} images: {}, ...'.format(len(files),
                ", ".join([os.path.relpath(x, upload_dir) for x in files[0:2]]))

    slogger.glob.info("Founded frames {} for task #{}".format(db_task.size, tid))

    task_params['segment'] = db_task.size + 10
    job.meta['status'] = 'Task is being saved in database'
    job.save_meta()

    try:
        _save_task_to_db(db_task, task_params)
        
        if task_params['mode'] == 'annotation':
            # add sources paths to db
            _save_paths_to_db(db_task, params['SOURCE_PATHS'])

        # Parsing taggs file
        if params['storage'] == 'share':
            txt = parseTxtToXml(upload_dir, db_task.id)
            destDir = r'/home/django/data/' + str(db_task.id) + r'/data/xml/'
            os.makedirs(destDir)
            with open(destDir + r'annotations.txt', 'w') as annotationFile:
                annotationFile.write(txt)
    except Exception:
        pass
    finally:
        # Deleting upload dir    
        shutil.rmtree(upload_dir) 
