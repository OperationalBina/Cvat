
# Copyright (C) 2018 Intel Corporation
#
# SPDX-License-Identifier: MIT

from django.urls import path
from . import views

urlpatterns = [
    path('get_share_nodes', views.JsTreeView),
    path('get_os_nodes', views.JsTreeViewZtube),
    path('get_labels_nodes', views.JsTreeViewLabels),
    path('get_frameprops_nodes', views.JsTreeViewFrameProperties),
    path('get_projects_nodes', views.JsTreeViewProjects),
    path('get_labels_db', views.getLabelsViewDb),
    path('save_label_type_db', views.saveLabelType),
    path('save_frame_property_to_db', views.saveFrameProperty),
    path('create_project', views.addNewProject),
    path('is_admin', views.isAdmin),
    path('is_manager', views.isManager),
    path('does_task_exist/project/<int:projectId>/task/<str:taskName>', views.doesTaskExist),
    path('has_object_storage/<int:projectId>', views.projectHasObjectStorage),
    path('get/projects', views.getProjectsFromDB),
    path('get/allUsers', views.getAllUsersFromDB),
    path('get/userForProject/<str:projectName>', views.getUsersForProjectFromDB),
    path('save_users_to_projects', views.saveUsersForProjectToDB),
    path('update/status/<str:newStatus>/<int:taskId>', views.updateTaskStatus),
    path('get/userProjectRelation', views.getUsersRelatedToProjects),
    path('project/<str:projectName>/has_score', views.projectHasScore),
    path('update_label', views.updateLabel),
    path('update_label_color', views.updateLabelColor),
    path('update_attribute', views.updateAttribute),
    path('update_value', views.updateValue),
    path('delete_label', views.deleteLabel),
    path('delete_attribute', views.deleteAttribute),
    path('delete_value', views.deleteValue),
    path('update_project_name', views.updateProjectName),
    path('update/project/<str:projectName>/has_score/<str:hasScore>', views.updateProjectScore),
    path('delete_project', views.deleteProject),
    path('update_frameProperty', views.updateFrameProp),
    path('update_frameValue', views.updateFrameValue),
    path('delete_frameProp', views.deleteFrameProp),
    path('delete_frameProp_value', views.deleteFramePropValue),
    path('get/matomo', views.get_matomo),
    path('', views.DashboardView),
]