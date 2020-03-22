from django.conf import settings
import boto3
from threading import Thread
import os
from .log import slogger
import urllib3
from shutil import copyfile, rmtree
import requests
from io import BytesIO

s3_cli = None

if os.environ.get('WITH_OS') == 'True':
    s3_res = boto3.resource('s3', 
        endpoint_url=settings.AWS_S3_HOST,
        config=boto3.session.Config(signature_version='s3v4'),
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        verify=False)							 
    s3_cli = s3_res.meta.client

    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    ##################### Check if bucket exists #####################
    response = s3_cli.list_buckets()
    buckets = [bucket['Name'] for bucket in response['Buckets']]

    if not buckets or settings.AWS_STORAGE_BUCKET_NAME not in buckets:
        s3_cli.create_bucket(Bucket=settings.AWS_STORAGE_BUCKET_NAME)
    ##################################################################

def getBucketConnection():
    s3_res_copy = boto3.resource('s3', 
    endpoint_url=settings.AWS_S3_HOST,
    config=boto3.session.Config(signature_version='s3v4'),
    aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
    aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
    verify=False)						 
    s3_bucket = s3_res_copy.Bucket(settings.AWS_STORAGE_BUCKET_NAME)
    return s3_bucket

def copyFileToOS(orig_path, dest_path):
    if os.environ.get('WITH_OS') == 'True':
        getBucketConnection().upload_file(orig_path, dest_path)
        os.remove(orig_path)
    elif orig_path != dest_path:
        copyfile(orig_path, dest_path)
        os.remove(orig_path)
    

def copyFileToOSByThread(orig_path, dest_path): 
    return Thread(target=copyFileToOS, args=(orig_path, dest_path,))

def deleteObject(obj):
    obj.delete()

def deleteFolder(folder):
    threads = []
    if os.environ.get('WITH_OS') == 'False':
        return threads
    
    files = getBucketConnection().objects.filter(Prefix=folder)
    for currentFile in files:
        t = Thread(target=deleteObject, args=(currentFile,))
        t.start()
        threads.append(t)

    return [t for t in threads if t.isAlive()]

def getFileUrl(path):
    if os.environ.get('WITH_OS') == 'False':
        return path

    url = s3_cli.generate_presigned_url(ClientMethod='get_object',
        Params={'Bucket':settings.AWS_STORAGE_BUCKET_NAME, 'Key':path},
        ExpiresIn=15)

    image = BytesIO(requests.get(url, verify=False).content)

    return image

def downloadFile(bucket_name, source_path, target_path):
    if os.environ.get('WITH_OS') == 'False':
        return False

    s3_cli.download_file(bucket_name, source_path, target_path)
    return True

def uploadFile(source_path, target_path):
    if os.environ.get('WITH_OS') == 'False':
        if source_path != target_path:
            dirname = os.path.dirname(target_path)
            if not os.path.exists(dirname):
                os.makedirs(dirname)
            copyfile(source_path, target_path)
    else:
        getBucketConnection().upload_file(source_path, target_path)