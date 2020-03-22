
# Copyright (C) 2018 Intel Corporation
#
# SPDX-License-Identifier: MIT

from django.urls import path
from . import views

urlpatterns = [
    path('', views.dispatch_request),
    path('create/task', views.create_task),
    path('get/task/<int:tid>/frame/<int:frame>', views.get_frame),
    path('get/task/<int:tid>/frame_watershed/<int:frame>', views.get_frame_watershed),
    path('get/next/task/<str:status>/<int:tid>', views.get_next_task),
    path('check/task/<int:tid>', views.check_task),
    path('delete/task/<int:tid>', views.delete_task),
    path('update/task/<int:tid>', views.update_task),
    path('update/properties/task/<int:tid>', views.update_task_properties),
    path('get/job/<int:jid>', views.get_job),
    path('get/task/<int:tid>', views.get_task),
    path('get/task/byjob/<int:jid>', views.get_task_byjob),
    path('dump/annotation/task/<int:tid>', views.dump_annotation),
    path('check/annotation/task/<int:tid>', views.check_annotation),
    path('delete/txt/annotation/task/<int:tid>', views.delete_txt_annotation),
    path('download/annotation/task/<int:tid>', views.download_annotation),
    path('download/segmentation/task/<int:tid>', views.download_segmentation),
    path('save/annotation/job/<int:jid>', views.save_annotation_for_job),
    path('parse/annotation/task/<int:tid>', views.parse_annotation_for_task),
    path('save/annotation/task/<int:tid>', views.save_annotation_for_task),
    path('delete/annotation/task/<int:tid>', views.delete_annotation_for_task),
    path('get/annotation/job/<int:jid>', views.get_annotation),
    path('get/username', views.get_username),
    path('is_staff', views.is_staff),
    path('save/exception/<int:jid>', views.catch_client_exception),
    path('save/status/job/<int:jid>', views.save_job_status),
    path('track/task/<int:tid>', views.track_task),
    path('stop/track/task/<int:tid>', views.stop_track_task),
    path('segmentation/frame/task/<int:tid>/frame/<int:frame>', views.frames_for_watershed),
    path('segmentation/exit/task/<int:tid>', views.exitFromSegmentationMode),
    path('segmentation/watershed/task/<int:tid>/frame/<int:frame>', views.watershed),
    path('segmentation/task/<int:tid>/frame/<int:frame>', views.save_paintings),
    path('get/segmentation/task/<int:tid>/frame/<int:frame>', views.get_paintings),
    path('update/task/<int:tid>/frame/<int:frame>', views.updateTargetFrame),
    path('save/framecomments/task/<int:tid>', views.save_framecomments),
    path('check/comments/task/<int:id>', views.check_comments),
    path('exit/task/<int:tid>', views.exitProccess),
    path('update/status/<str:newStatus>/<int:taskId>', views.updateTaskStatus),
    path('is_manager', views.isManager),
    path('get/matomo', views.get_matomo),
    path('track_full_video/<int:tid>', views.track_all),
    path('stop_video_tracking/<int:tid>/<int:shapeId>', views.pause_tracking_all),
    path('does_video_file_exist/<int:tid>', views.video_file_exists)
]
