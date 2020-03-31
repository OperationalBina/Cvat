from oswrapper import *
from cvat.apps.engine.models import *
from django.db.models import Q
import requests
import json 
import os

global generator_id
generator_id = 0
global generator_id_sorted
generator_id_sorted = 0


def getObjectStoragesPerProject(user_id, project_id, isAdmin):
    # if the user authorize to connect this project
    if Projects_Users.objects.filter(user_id=user_id).filter(project_id=project_id).exists() or isAdmin:
        return list(Projects_ObjectStorages.objects.filter(project_id=project_id).values_list('object_storage__name', 'channels', 'object_storage__secret_key', 'object_storage__access_key', 'object_storage__id', 'object_storage__endpoint_url'))
    else: 
        return []

def handleObjectStorages(request):
    # get list of all object storages the user can connect
    list_of_os = getObjectStoragesPerProject(request.user.id, request.GET['project_id'], request.user.has_perm('dashboard.views.isAdmin'))
    items = []
    final_items = []

    # for each object storage add to the item list all files 
    for os_details in list_of_os:
        items = []
        secret_key = os_details[2]
        access_key = os_details[3]
        endpoint_url = os_details[5]
        objs = ObjectStorageWrapper(access_key=access_key, secret_key=secret_key, endpt_url=endpoint_url)

        # if there is a channel in this object storage
        if os_details[1] == None:
            path = os_details[0]
            items = objs.find_objects(path, formats=('.mp4', '.avi'))
        else:

            # for each channel get all 1500kbps files
            for channel in os_details[1]:
                path = os_details[0] + '/' + channel
                items += objs.find_objects(path, formats=('1500kbps_init_gpac.mp4'))

        # for each file add the object storage id to know from where to connect
        for item in items:
            item['OS_ID'] = os_details[4]
            item['Bucket'] = os_details[0].split('/')[0]
            final_items.append(item)

    return final_items
def checkIfVideoExist(source, video_id):
    return Task.objects.filter(Q(source=source) | Q(video_id=video_id)).exists()

def toList(items):
    # return only the path splited by / : [['path', 'to', 'file'], ['another', 'file', 'path']]
    return [[str(item['OS_ID'])] + [item['Bucket']] + item["Key"].split('/') for item in items]

def createJson(text, parent, os_id, treeType):
    global generator_id
    global generator_id_sorted
    iconPath = ''
    if '.mp4' in text:
        iconPath = '/static/engine/icons/MP4.png'
    elif '.avi' in text:
        iconPath = '/static/engine/icons/AVI.png'

    if treeType == 0:
        currId = generator_id
    else:
        currId = generator_id_sorted
    currJson = { 'id' : currId, 
                'parent' : parent,
                'text' : text,
                'icon' :  iconPath,
                'os_id' : int(os_id) }
    if treeType == 0:
        generator_id+=1
    else:
        generator_id_sorted+=1
    return currJson

def createJsonSorted(currId, text, parent, score, video_id, os_id, path):
    iconPath = ''
    if '.mp4' in text:
        iconPath = '/static/engine/icons/MP4.png'
    elif '.avi' in text:
        iconPath = '/static/engine/icons/AVI.png'

    currJson = { 'id' : currId, 
                'parent' : parent,
                'text' : text,
                'icon' :  iconPath,
                'os_id' : int(os_id),
                'score': score,
                'video_id': video_id,
                'path': path }
    return currJson

def getJsonTree(list_of_paths, parent, data, typeTree):
    currDict = dict()

    for path in list_of_paths:
        os_id = path[0]
        name = path[1]

        # if it's the last name in path 
        if len(path) > 2: 

            # if it's a new dir  
            if name not in currDict.keys():
                currDict[name] = [[os_id] + path[2:]]
            else:
                currDict[name].append([os_id] + path[2:])
        else:
            jsTreeJson = createJson(name, parent, os_id, typeTree)
            data.append(jsTreeJson)

    # for each key in dict create json and create it also to his children 
    for key in currDict.keys():
        jsTreeJson = createJson(key, parent, 0, typeTree)
        data.append(jsTreeJson)
        data = getJsonTree(currDict[key], jsTreeJson['id'], data, typeTree)
    
    return data

def getJsonById(data, myId):
    return [currJson for currJson in data if currJson['id'] == myId][0]
    
def getPath(data, currJson):
    if currJson['parent'] == '#':
        return currJson['text']
    
    return getPath(data, getJsonById(data, currJson['parent'])) + '/' +  currJson['text']

def addPath(data):
    newData = []
    for currJson in data:
        currJson["path"] = getPath(data, currJson)
        newData.append(currJson)
    
    return newData


def getTree(request):
    global generator_id
    generator_id = 0
    data = []

    # get all objects in json type
    items = handleObjectStorages(request)

    # split each path to an array 
    list_of_paths = toList(items)

    # get all path by js tree type  : [{'id': value, 'parent' : value, 'text' : value}]
    data = getJsonTree(list_of_paths, '#', [], 1)

    # add path to json for downloading the file from OS : [{'id': value, 'parent' : value, 'text' : value, 'path' : path}]
    data = addPath(data)

    return data