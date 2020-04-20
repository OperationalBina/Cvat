# Copyright (C) 2018 Intel Corporation
#
# SPDX-License-Identifier: MIT

from django.http import HttpResponse, JsonResponse, HttpResponseBadRequest, HttpResponseForbidden
from django.shortcuts import redirect
from django.shortcuts import render
from django.conf import settings
from django.core import serializers
from cvat.apps.authentication.decorators import login_required

from cvat.apps.engine.models import Task as TaskModel, Job as JobModel, Projects_Users, Projects, Comments
from django.contrib.auth.models import User, Group
from cvat.settings.base import JS_3RDPARTY
from .parseToJsTree import getTree
from .labelsTree import getLabelsTree, getAdminLabelsTree
from .framePropertiesTree import getFramePropertiesTree, getAdminFramePropertiesTree
from .dbFetcher import *
from ..engine.models import FrameProperties, LabelTypes, AttributeDetails, LabelDetails
from django.db import transaction
from django.db.models import Q
import json
from .projectsDB import *
import boto3
import urllib3

from cvat.apps.engine.log import slogger
import os
import re

def ScanNode(directory):
    if '..' in directory.split(os.path.sep):
        return HttpResponseBadRequest('Permission Denied')

    act_dir = os.path.normpath(settings.SHARE_ROOT + directory)
    result = []

    nodes = os.listdir(act_dir)
    files = filter(os.path.isfile, map(lambda f: os.path.join(act_dir, f), nodes))
    dirs = filter(os.path.isdir, map(lambda d: os.path.join(act_dir, d), nodes))

    for d in dirs:
        name = os.path.basename(d)
        children = len(os.listdir(d)) > 0
        node = {'id': directory + name + '/', 'text': name, 'children': children}
        result.append(node)

    for f in files:
        name = os.path.basename(f)
        node = {'id': directory + name, 'text': name, "icon" : "jstree-file"}
        result.append(node)

    return result

@login_required
def JsTreeView(request):
    node_id = None
    if 'id' in request.GET:
        node_id = request.GET['id']

    if node_id is None or node_id == '#':
        node_id = '/'
        response = [{"id": node_id, "text": node_id, "children": ScanNode(node_id)}]
    else:
        response = ScanNode(node_id)

    return JsonResponse(response, safe=False,
        json_dumps_params=dict(ensure_ascii=False))

@login_required
def JsTreeViewZtube(request):
    response = getTree(request)

    return JsonResponse(response, safe=False,
        json_dumps_params=dict(ensure_ascii=False))

@login_required
def JsTreeViewLabels(request):
    if request.user.has_perm('dashboard.views.isAdmin'):
        response = getAdminLabelsTree()
    else:
        response = getLabelsTree(request.user.username)

    return JsonResponse(response, safe=False,
        json_dumps_params=dict(ensure_ascii=False))

@login_required
def JsTreeViewFrameProperties(request):
    if request.user.has_perm('dashboard.views.isAdmin'):
        response = getAdminFramePropertiesTree()
    else:
        response = getFramePropertiesTree(request.user.username)
    
    return JsonResponse(response, safe=False,
        json_dumps_params=dict(ensure_ascii=False))

@login_required
def JsTreeViewProjects(request):
    response = getProjectsTree()

    return JsonResponse(response, safe=False)

@login_required
def updateLabel(request):
    if (request.user.has_perm('dashboard.views.isAdmin') or request.user.has_perm('dashboard.views.isManager')):
        requestContent = json.loads(request.body.decode("utf-8"))
        response = updateLabelInDb(requestContent["oldName"], requestContent["newName"], requestContent["project"])

        if (response != "Success"):
            return HttpResponseBadRequest(response)
        else:
            return HttpResponse()
    else:
        return HttpResponseForbidden()
        
@login_required
def updateLabelColor(request):
    if (request.user.has_perm('dashboard.views.isAdmin') or request.user.has_perm('dashboard.views.isManager')):
        requestContent = json.loads(request.body.decode("utf-8"))
        response = updateLabelColorInDb(requestContent["labelName"], requestContent["newColor"], requestContent["project"])

        if (response != "Success"):
            return HttpResponseBadRequest(response)
        else:
            return HttpResponse()
    else:
        return HttpResponseForbidden()

@login_required
def updateAttribute(request):
    if (request.user.has_perm('dashboard.views.isAdmin') or request.user.has_perm('dashboard.views.isManager')):
        requestContent = json.loads(request.body.decode("utf-8"))
        response = updateAttributeInDb(requestContent["oldName"], requestContent["newName"], requestContent["parent"], requestContent["project"])

        if (response != "Success"):
            return HttpResponseBadRequest(response)
        else:
            return HttpResponse()
    else:
        return HttpResponseForbidden()

@login_required
def updateValue(request):
    if (request.user.has_perm('dashboard.views.isAdmin') or request.user.has_perm('dashboard.views.isManager')):
        requestContent = json.loads(request.body.decode("utf-8"))
        response = updateValueInDb(requestContent["oldName"], requestContent["newName"], requestContent["attribute"], requestContent["label"], requestContent["project"])

        if (response != "Success"):
            return HttpResponseBadRequest(response)
        else:
            return HttpResponse()
    else:
        return HttpResponseForbidden()

@login_required
def deleteLabel(request):
    if (request.user.has_perm('dashboard.views.isAdmin') or request.user.has_perm('dashboard.views.isManager')):
        requestContent = json.loads(request.body.decode("utf-8"))
        response = deleteLabelInDb(requestContent["labelName"], requestContent["project"])

        if (response != "Success"):
            return HttpResponseBadRequest(response)
        else:
            return HttpResponse()
    else:
        return HttpResponseForbidden()

@login_required
def deleteAttribute(request):
    if (request.user.has_perm('dashboard.views.isAdmin') or request.user.has_perm('dashboard.views.isManager')):
        requestContent = json.loads(request.body.decode("utf-8"))
        response = deleteAttributeInDb(requestContent["labelName"], requestContent["attributeName"], requestContent["project"])

        if (response != "Success"):
            return HttpResponseBadRequest(response)
        else:
            return HttpResponse()
    else:
        return HttpResponseForbidden()

@login_required
def deleteValue(request):
    if (request.user.has_perm('dashboard.views.isAdmin') or request.user.has_perm('dashboard.views.isManager')):
        requestContent = json.loads(request.body.decode("utf-8"))
        response = deleteValueInDb(requestContent["labelName"], requestContent["attributeName"], requestContent["valueName"], requestContent["project"])

        if (response != "Success"):
            return HttpResponseBadRequest(response)
        else:
            return HttpResponse()
    else:
        return HttpResponseForbidden()

@login_required
def updateProjectName(request):
    if (request.user.has_perm('dashboard.views.isAdmin')):
        requestContent = json.loads(request.body.decode("utf-8"))
        response = updateProjectNameInDb(requestContent["oldName"], requestContent["newName"])

        if (response != "Success"):
            return HttpResponseBadRequest(response)
        else:
            return HttpResponse()
    else:
        return HttpResponseForbidden()

@login_required
def updateProjectScore(request, projectName, hasScore):
    if (request.user.has_perm('dashboard.views.isAdmin')):
        response = updateProjectScoreInDb(projectName, hasScore)

        if (response != "Success"):
            return HttpResponseBadRequest(response)
        else:
            return HttpResponse()
    else:
        return HttpResponseForbidden()

@login_required
def deleteProject(request):
    if (request.user.has_perm('dashboard.views.isAdmin')):
        requestContent = json.loads(request.body.decode("utf-8"))
        response = deleteProjectInDb(requestContent["projectName"])

        if (response != "Success"):
            return HttpResponseBadRequest(response)
        else:
            return HttpResponse()
    else:
        return HttpResponseForbidden()


@login_required
def updateFrameProp(request):
    if not (request.user.has_perm('dashboard.views.isManager') or request.user.has_perm('dashboard.views.isAdmin')):
        return HttpResponseForbidden()

    requestContent = json.loads(request.body.decode("utf-8"))
    response = updateFramePropInDb(requestContent["oldName"], requestContent["newName"], requestContent["project"])

    if (response != "Success"):
        return HttpResponseBadRequest(response)
    else:
        return HttpResponse()

@login_required
def updateFrameValue(request):
    if not (request.user.has_perm('dashboard.views.isManager') or request.user.has_perm('dashboard.views.isAdmin')):
        return HttpResponseForbidden()

    requestContent = json.loads(request.body.decode("utf-8"))
    response = updateFrameValueInDb(requestContent["oldName"], requestContent["newName"], requestContent["frameProp"], requestContent["project"])

    if (response != "Success"):
        return HttpResponseBadRequest(response)
    else:
        return HttpResponse()

@login_required
def deleteFrameProp(request):
    if (request.user.has_perm('dashboard.views.isAdmin') or request.user.has_perm('dashboard.views.isManager')):
        requestContent = json.loads(request.body.decode("utf-8"))
        response = deleteFramePropInDb(requestContent["frameProp"], requestContent["project"])

        if (response != "Success"):
            return HttpResponseBadRequest(response)
        else:
            return HttpResponse()
    else:
        return HttpResponseForbidden()
        
@login_required
def deleteFramePropValue(request):
    if (request.user.has_perm('dashboard.views.isAdmin') or request.user.has_perm('dashboard.views.isManager')):
        requestContent = json.loads(request.body.decode("utf-8"))
        response = deleteFramePropValueInDb(requestContent["frameProp"], requestContent["value"], requestContent["project"])

        if (response != "Success"):
            return HttpResponseBadRequest(response)
        else:
            return HttpResponse()
    else:
        return HttpResponseForbidden()

def getProjectsFromDB(request):
    if (request.user.has_perm('dashboard.views.isAdmin')):
        response = getAllProjects()
    else:
        response = getProjectsByUser(request.user.username)

    return JsonResponse(response, safe=False)

@login_required
def getAllUsersFromDB(request):
    if (request.user.has_perm('dashboard.views.getAllUsersFromDB')):
        response = getAllUsers(request.user.username)

        return JsonResponse(response, safe=False)
    else:
        return HttpResponseForbidden()

@login_required
def getUsersForProjectFromDB(request, projectName):
    if (request.user.has_perm('dashboard.views.getUsersForProjectFromDB')):
        response = getUsersForProject(projectName)

        return JsonResponse(response, safe=False)
    else:
        return HttpResponseForbidden()
    
@login_required
def getUsersRelatedToProjects(request):
    if (request.user.has_perm('dashboard.views.isAdmin')):
        response = getAnnotatorsForAllProjects()
    else:
        response = getAnnotatorsForEachProject(request.user.username)
    
    return JsonResponse(response, safe=False)

@login_required
def saveUsersForProjectToDB(request):
    if (request.user.has_perm('dashboard.views.saveUsersForProjectToDB')):
        requestContent = json.loads(request.body.decode("utf-8"))
        project = Projects.objects.get(name=requestContent["projectName"])
        currentUser = User.objects.get(username=request.user.username)

        # Get the annotator group
        annotator = Group.objects.get(name="annotator")

        # Delete all relation rows with the current project in the db except for rows of the
        # current user
        Projects_Users.objects.filter(~Q(user=currentUser), project_id=project.pk).delete()

        # Get all of the users that are requested and add them the database
        users = User.objects.filter(username__in=requestContent["usernames"])
        for user in users:
            try:     
                latestPK = Projects_Users.objects.latest('pk').pk
            except:
                latestPK = 0
            if user.groups.filter(name__in=['admin', 'manager', 'user', 'annotator', 'observer']).count() == 0:
                user.groups.add(annotator)
            Projects_Users.objects.create(pk=latestPK + 1, user=user, project=project)
        
        assigneeTasksBackToTheManager(currentUser, project, users)

        return HttpResponse()
    else:
        return HttpResponseForbidden()

def assigneeTasksBackToTheManager(currentUser, project, users):
    tasks = Task.objects.filter(project_id=project.pk).all()

    manager = currentUser

    # Check if the current user is admin
    if currentUser.groups.all()[0].id == 1:
        for user in users:

            # Checking for manager
            if user.groups.all()[0].id == 2:
                manager = user
                break

    for task in tasks:
        if task.assignee not in users:
            task.assignee = manager
            task.save()

# Convert the priority to string, happens only if the task's project has_score attribute is false.
def convert_priority_to_string(priority):
    if (priority == 0):
        return 'LOW'
    elif (priority == 0.5):
        return 'MEDIUM'
    else:
        return 'HIGH'

@login_required
def DashboardView(request):
    query_name = request.GET['search'] if 'search' in request.GET else None
    query_job = int(request.GET['jid']) if 'jid' in request.GET and request.GET['jid'].isdigit() else None
    task_list = None
    projects = []

    if (request.user.has_perm('dashboard.views.isAdmin')):
        projects = list(Projects.objects.all().values_list('pk', flat=True))
    else:
        projectsQuery = Projects_Users.objects.filter(user__username=request.user).select_related('project')
        for project in projectsQuery:
            projects.append(project.project.pk)

    if query_job is not None and JobModel.objects.filter(pk = query_job).exists():
        task_list = [JobModel.objects.select_related('segment__task').filter(segment__task__project__pk__in=projects).get(pk = query_job).segment.task]
    else:
        task_list = list(TaskModel.objects.filter(project__pk__in=projects).prefetch_related('segment_set__job_set').order_by('-created_date').all())
        if query_name is not None:
            task_list = list(filter(lambda x: query_name.lower() in x.name.lower(), task_list))

    task_list = list(filter(lambda task: request.user.has_perm(
        'engine.task.access', task), task_list))

    comments_task_ids = list(Comments.objects.all().values_list('task__id', flat=True))

    open_tasks = list()
    pending_tasks = list()
    closed_tasks = list()

    for task in task_list:
        # For each task, check if it has comments.
        task.has_comments = task.id in comments_task_ids

        # Add the "priority" attribute to the python object if its project has_score == false
        if not task.project.has_score:
            task.priority = convert_priority_to_string(task.score)

        # Count tasks by tabs
        if (task.status == 'annotation'):
            open_tasks.append(task)
        if (task.status == 'validation'):
            pending_tasks.append(task)
        if (task.status == 'completed'):
            closed_tasks.append(task)
    return render(request, 'dashboard/dashboard.html', {
        'data': task_list,
        'open_data': open_tasks,
        'pending_data': pending_tasks,
        'closed_data': closed_tasks,
        'open_tasks': len(open_tasks),
        'pending_tasks': len(pending_tasks),
        'closed_tasks': len(closed_tasks),
        'max_upload_size': settings.LOCAL_LOAD_MAX_FILES_SIZE,
        'max_upload_count': settings.LOCAL_LOAD_MAX_FILES_COUNT,
        'base_url': "{0}://{1}/".format('https' if os.environ.get('SECURE_SITE') == 'True' else 'http', request.get_host()),
        'share_path': os.getenv('CVAT_SHARE_URL', default=r'${cvat_root}/share'),
        'js_3rdparty': JS_3RDPARTY.get('dashboard', []),
    })

@login_required
def isAdmin(request):
    if (request.user.has_perm('dashboard.views.isAdmin')):
        return HttpResponse()
    else:
        return HttpResponseForbidden()

@login_required
def isManager(request):
    if (request.user.has_perm('dashboard.views.isManager')):
        return HttpResponse()
    else:
        return HttpResponseForbidden()
    
@login_required
def projectHasObjectStorage(request, projectId):
    response = getProjectHasObjectStorage(projectId)

    return HttpResponse(response)

@login_required
def updateTaskStatus(request, newStatus, taskId):
    # If the new status is not validation the user must be a manager to update it
    if (newStatus != 'validation'):
        if (not request.user.has_perm('dashboard.views.isManager')):
            return HttpResponseForbidden()
    try:
        db_task = TaskModel.objects.get(pk=taskId)
        db_task.status = newStatus
        db_task.last_viewed_frame = 0
        db_task.save()
        db_job = JobModel.objects.get(segment__task=db_task)
        db_job.status = newStatus
        db_job.save()
    except Exception as e:
        slogger.glob.error("cannot update the target frame for task #{}".format(tid), exc_info=True)
        return HttpResponseBadRequest(str(e))

    return HttpResponse()

@login_required
def getLabelsViewDb(request):
    if (request.user.has_perm('dashboard.views.isAdmin')):
        response = getAdminLabelsFromDb()
    else:
        response = getLabelsFromDb(request.user.username)
    return JsonResponse(response, safe=False,
        json_dumps_params=dict(ensure_ascii=False))

@login_required
def projectHasScore(request, projectName):
    response = getProjectHasScore(projectName)

    return HttpResponse(response)

@login_required
def saveLabelType(request):
    if not (request.user.has_perm('dashboard.views.isManager') or request.user.has_perm('dashboard.views.isAdmin')):
        return HttpResponseForbidden()

    def saveNewLabel(labelName, labelColor, project):
        try:
            latestLabelPK = LabelTypes.objects.latest('pk').pk
        except:
            latestLabelPK = 0

        try:
            latestLabelDetailsPK = LabelDetails.objects.latest('pk').pk
        except:
            latestLabelDetailsPK = 0

        labelType = LabelTypes.objects.create(pk=(latestLabelPK + 1), label=labelName, project=project)
        LabelDetails.objects.create(pk=(latestLabelDetailsPK + 1), color=labelColor, labelType=labelType)
        return labelType
        
    def saveNewAttribute(label, attributeName, canChange, project):
        try:
            latestLabelPK = LabelTypes.objects.latest('pk').pk
        except:
            latestLabelPK = 0

        try:
            latestAttributeDetailsPK = AttributeDetails.objects.latest('pk').pk
        except:
            latestAttributeDetailsPK = 0

        labelType = LabelTypes.objects.create(pk=(latestLabelPK + 1), label=label.label, attribute=attributeName, project=project, parent=label)
        AttributeDetails.objects.create(pk=(latestAttributeDetailsPK + 1), can_change=canChange, labelType=labelType)
        return labelType
        
    def saveNewValue(attribute, valueName, project):
        try:
            latestLabelPK = LabelTypes.objects.latest('pk').pk
        except:
            latestLabelPK = 0
        return LabelTypes.objects.create(pk=(latestLabelPK + 1), label=attribute.label, attribute=attribute.attribute, value=valueName, project=project, parent=attribute)
    
    requestContent = json.loads(request.body.decode("utf-8"))
    labelName = requestContent["label"]
    attributeName = requestContent["attribute"]
    canChange = requestContent["change"]
    valueName = requestContent["value"]
    color = requestContent["color"]
    projectId = requestContent["project"]
    project = Projects.objects.get(pk=projectId)

    # If the attribute sent is empty, that means a new label needs to be added
    if attributeName == "":
        if LabelTypes.objects.filter(label=labelName, project=project).exists():
            return HttpResponseBadRequest("Label already exists")
        else:
            if re.search("^[\d\w_-]+$", labelName) is not None:
                saveNewLabel(labelName, color, project)
    else:
        label = LabelTypes.objects.get(label=labelName, project=project, attribute=None, value=None, parent=None)

        # If can change is empty, that means only a new value needs to be added.
        if canChange == "":
            attribute = LabelTypes.objects.get(label=labelName, project=project, attribute=attributeName, value=None, parent=label)
            if LabelTypes.objects.filter(project=project, parent=attribute, value=valueName).exists():
                return HttpResponseBadRequest("Value already exists for the given attribute")
            else:
                saveNewValue(attribute, valueName, project)
        else:
            if LabelTypes.objects.filter(label=labelName, project=project, attribute=attributeName, value=None, parent=label).exists():
                attribute = LabelTypes.objects.get(label=labelName, project=project, attribute=attributeName, value=None, parent=label)
                if LabelTypes.objects.filter(project=project, parent=attribute, value=valueName).exists():
                    return HttpResponseBadRequest("Value already exists for the given attribute")
            else:
                attribute = saveNewAttribute(label, attributeName, canChange, project)
            if valueName != "":
                saveNewValue(attribute, valueName, project)
    return HttpResponse()

@login_required
def addNewProject(request):
    if not (request.user.has_perm('dashboard.views.isAdmin')):
        return HttpResponseForbidden()

    def createNewProject(projectName, isScored):
        try:     
            latestPK = Projects.objects.latest('pk').pk
        except:
            latestPK = 0
        return Projects.objects.create(pk=(latestPK + 1), name=projectName, has_score=isScored)
    
    requestContent = json.loads(request.body.decode("utf-8"))
    projectName = requestContent["projectName"]
    isScored = requestContent["isScored"]

    if (projectName == ""):
        return HttpResponseBadRequest("Can't create a project with no name")
    else:
        if (Projects.objects.filter(name=projectName).count() > 0):
            return HttpResponseBadRequest("Porject already exists")
        else:
            createNewProject(projectName, isScored)

    return HttpResponse()

@login_required
def addNewObjectStorage(request):
    if not (request.user.has_perm('dashboard.views.isAdmin') or request.user.has_perm('dashboard.views.isManager')):
        return HttpResponseForbidden()

    def createNewObjectStorage(data):
        try:     
            latestPK = ObjectStorages.objects.latest('pk').pk
        except:
            latestPK = 0
        
        return ObjectStorages.objects.create(pk=(latestPK + 1), 
                                             name=data['name'], 
                                             access_key=data['access_key'],
                                             secret_key=data['secret_key'],
                                             endpoint_url=data['endpoint_url'])
    
    def connectObjectStorageToProject(os_id, p_id):
        try:     
            latestPK = Projects_ObjectStorages.objects.latest('pk').pk
        except:
            latestPK = 0
        
        return Projects_ObjectStorages.objects.create(pk=(latestPK + 1), 
                                                      object_storage_id=os_id, 
                                                      project_id=p_id)
    
    requestContent = json.loads(request.body.decode("utf-8"))

    if (requestContent['name'] == ''):
        response = HttpResponseBadRequest("Can't create an object storage without a path")
    else:
        object_storage = createNewObjectStorage(requestContent)
        response = HttpResponse(connectObjectStorageToProject(object_storage.id, requestContent['projectId']))

    return response

@login_required
def updateObjectStorage(request):
    if not (request.user.has_perm('dashboard.views.isAdmin') or request.user.has_perm('dashboard.views.isManager')):
        return HttpResponseForbidden()

    def updateObjectStorageFunc(data):
        try:     
            all_os_names_per_projects = list(Projects_ObjectStorages.objects.filter(project__id=data['projectId']).values_list('object_storage__id', flat=True))
            object_storage_to_update = ObjectStorages.objects.filter(id__in=all_os_names_per_projects ,name=data['name']).first()
            object_storage_to_update.name = data['name']
            if 'secret_key' in data:
                object_storage_to_update.secret_key = data['secret_key']
            if 'access_key' in data:
                object_storage_to_update.access_key = data['access_key']
            if 'endpoint_url' in data:
                object_storage_to_update.endpoint_url = data['endpoint_url']

            object_storage_to_update.save()

        except Exception as e:
            slogger.glob.error("cannot update this object storage {} for project #{}".format(data['name'], data['projectId']), exc_info=True)
            return HttpResponseBadRequest(str(e))

        return HttpResponse('Updated')
    
    requestContent = json.loads(request.body.decode("utf-8"))

    if (requestContent['name'] == ''):
        response = HttpResponseBadRequest("Can't updated an object storage without a path")
    else:
        response = updateObjectStorageFunc(requestContent)

    return response

@login_required
def deleteObjectStorage(request):
    if not (request.user.has_perm('dashboard.views.isAdmin') or request.user.has_perm('dashboard.views.isManager')):
        return HttpResponseForbidden()

    def deleteObjectStorageFunc(data):
        try:     
            all_os_names_per_projects = list(Projects_ObjectStorages.objects.filter(project__id=data['projectId']).values_list('object_storage__id', flat=True))
            object_storage_to_delete = ObjectStorages.objects.filter(id__in=all_os_names_per_projects ,name=data['name']).first()

            object_storage_to_delete.delete()

        except Exception as e:
            slogger.glob.error("cannot delete this object storage {} for project #{}".format(data['name'], data['projectId']), exc_info=True)
            return HttpResponseBadRequest(str(e))

        return HttpResponse('Deleted')
    
    requestContent = json.loads(request.body.decode("utf-8"))

    if (requestContent['name'] == ''):
        response = HttpResponseBadRequest("Can't deleted an object storage without a path")
    else:
        response = deleteObjectStorageFunc(requestContent)

    return response

@login_required
def testObjectStorage(request):
    if not (request.user.has_perm('dashboard.views.isAdmin') or request.user.has_perm('dashboard.views.isManager')):
        return HttpResponseForbidden()

    def testObjectStorageFunc(data):
        try:     
            s3_res = boto3.resource('s3', 
                                    endpoint_url=data['endpoint_url'],
                                    config=boto3.session.Config(signature_version='s3v4'),
                                    aws_access_key_id=data['access_key'],
                                    aws_secret_access_key=data['secret_key'],
                                    verify=False)	
            s3_cli = s3_res.meta.client

            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

            ##################### Check if bucket exists #####################
            response = s3_cli.list_buckets()
            buckets = [bucket['Name'] for bucket in response['Buckets']]

            if not buckets or data['name'].split('/')[0] not in buckets:
                return HttpResponseBadRequest("Can't find this path in this connection")
            ##################################################################	
        except Exception as e:
            slogger.glob.error("Can't connect this object storage {} for project #{}".format(data['name'], data['projectId']), exc_info=True)
            return HttpResponseBadRequest(str(e))

        return HttpResponse('Connected')
    
    requestContent = json.loads(request.body.decode("utf-8"))

    if (requestContent['name'] == ''):
        response = HttpResponseBadRequest("Can't check an object storage without a path")
    else:
        response = testObjectStorageFunc(requestContent)

    return response

@login_required
def saveFrameProperty(request):
    if not (request.user.has_perm('dashboard.views.isManager') or request.user.has_perm('dashboard.views.isAdmin')):
        return HttpResponseForbidden()

    def saveNewFrameProperty(framePropertyName, project):
        try:     
            latestPK = FrameProperties.objects.latest('pk').pk
        except:
            latestPK = 0
        return FrameProperties.objects.create(pk=(latestPK + 1), prop=framePropertyName, project=project)
        
    def saveNewValue(frameProperty, valueName, project):
        try:     
            latestPK = FrameProperties.objects.latest('pk').pk
        except:
            latestPK = 0
        return FrameProperties.objects.create(pk=(latestPK + 1), prop=frameProperty.prop, value=valueName, project=project, parent=frameProperty)

    requestContent = json.loads(request.body.decode("utf-8"))
    framePropertyName = requestContent["property"]
    valueName = requestContent["value"]
    projectId = requestContent["project"]
    project = Projects.objects.get(pk=projectId)

    if (valueName == ""):
        return HttpResponseBadRequest("Can't create a property with no value")
    else:
        if FrameProperties.objects.filter(prop=framePropertyName, value=valueName, project=project).exists():
            return HttpResponseBadRequest("Property already exists with the given value")

        if FrameProperties.objects.filter(prop=framePropertyName, project=project).exists():
            frameProperty = FrameProperties.objects.get(prop=framePropertyName, value=None, project=project, parent=None)
            saveNewValue(frameProperty, valueName, project)
        else:
            frameProperty = saveNewFrameProperty(framePropertyName, project)
            saveNewValue(frameProperty, valueName, project)
        
    return HttpResponse()

def get_matomo(request):
    response = None

    if (os.environ.get('MATOMO')):
        response = {'url': os.environ.get('MATOMO'), 'siteId': os.environ.get('MATOMO_SITE_ID'), 'userId': request.user.username}

    return JsonResponse(response, safe=False)

@login_required
def doesTaskExist(request, projectId, taskName):
    response = {"result": doesTaskNameExist(projectId, taskName)}
    return JsonResponse(response)

@login_required
def doesObjectStorageExist(request, projectId):
    requestContent = json.loads(request.body.decode("utf-8"))
    response = {"result": doesObjectStorageExistInProject(projectId, requestContent['name'])}
    return JsonResponse(response)