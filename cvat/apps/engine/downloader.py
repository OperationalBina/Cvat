from oswrapper import *
import os
from cvat.apps.engine.models import *


def get_tags(videos, objs):
    """Get tags for the specified videos.

    :param videos: Any number of videos, in ObjsFindResponse format to get tags for.
    :return: A dictionary {'tags': [List of tags found, in ObjsFindResponse format], 'no_tags': [List of videos for which
    tags were not found]}
    """
    tag_suffix='_tag.txt'
    vids_without_tag, vid_tag_names, tags = [], [], []

    try:
        for vid in videos:
            vid_tag_names.append(tagify(tag_suffix=tag_suffix, path=os.path.split(vid['Key'])[1], objs=True))

        pathToTags = videos[0]['Owner']['ID'] + '/' + '/'.join(os.path.split(vid['Key'])[:-1])
        tags = objs.find_objects(pathToTags, maxitems=len(videos), formats=vid_tag_names)

        tag_strings = [os.path.split(x['Key'])[1] for x in tags]
        vids_without_tag = [v for v in videos if tagify(tag_suffix=tag_suffix,
                                                        path=os.path.split(v['Key'])[1]) not in tag_strings]
    except Exception as e:
        print(exc_to_str(e))
    return {'tags': tags, 'no_tags': vids_without_tag}
		
def tagify(tag_suffix, path, objs=False):  # Turn video name into tag file name
    _dir, name = os.path.split(path)
    name, ext = os.path.splitext(name)

    tag_name = name + tag_suffix
    if objs:
        final = _dir + r'/' + tag_name
    else:
        final = os.path.join(_dir, tag_name)
    return final	

def connect_to_object_storage(user_id, project_id, os_id, isAdmin):
    secret_key_access_key = getObjectStorageSecretAndAccessKey(user_id, project_id, os_id, isAdmin)
    secret_key = secret_key_access_key[0]
    access_key = secret_key_access_key[1]

    objs = ObjectStorageWrapper(access_key=access_key, secret_key=secret_key, endpt_url=os.environ.get('ENDPT_URL_OS'))

    return objs 

def getObjectStorageSecretAndAccessKey(user_id, project_id, os_id, isAdmin):
    # if the user authorize to connect this project
    if (Projects_Users.objects.filter(user_id=user_id).filter(project_id=project_id).exists() or isAdmin) and \
        Projects_ObjectStorages.objects.filter(project_id=project_id, object_storage_id=os_id).exists():
        return list(ObjectStorages.objects.filter(id=os_id).values_list('secret_key', 'access_key'))[0]
    else: 
        return []


def download_file (request, file_path, destination_dir, project_id, os_id):

    objs = connect_to_object_storage(request.user.id, project_id, os_id, request.user.has_perm('dashboard.views.isAdmin'))
    tag_file = []
    # find the object file and tag file if exist needed to be download
    object_file = objs.find_objects(file_path)
    tag_file = get_tags(object_file, objs)['tags']
    files_to_download = object_file + tag_file

    for object_file in files_to_download:
        object_file['Owner']['ID'] = file_path.split('/')[0]
    # download the objects in destination directory
    objs.download_objects(files_to_download, dest_dir=destination_dir)
    
def download_file_m4s (request, file_path, destination_dir, project_id, os_id):

    objs = connect_to_object_storage(request.user.id, project_id, os_id)

    # find the object file needed to be download
    object_file = objs.find_objects(file_path)

    # get file path and name and resolution 
    file_name = file_path.split('/')[-1]
    file_resolution = file_name.split('_')[0]
    file_path = '/'.join(file_path.split('/')[:-1])

    # find all m4s files in path
    m4s_files = objs.find_objects(file_path, formats=('.m4s', '.mpd'))

    # get only files that fit to resolution
    m4s_files = [m4s for m4s in m4s_files if file_resolution in m4s['Key'] or '.mpd' in m4s['Key']]

    # download all objects to destination directory
    files_to_download = object_file + m4s_files
    dest_dir = destination_dir + '/m4s_files/'
    objs.download_objects(files_to_download, dest_dir=dest_dir)
    os.system("sed -i '6,8d' " + dest_dir + "dash.mpd")
    command = 'ffmpeg -y -i ' + dest_dir + 'dash.mpd ' + destination_dir + '/' + file_name
    os.system(command)
