from ..engine.models import Projects_Users, Task, Projects, Projects_ObjectStorages
from django.contrib.auth.models import User
from django.db.models import Q
from cvat.apps.engine.log import slogger

def getAllProjects():
    allProjects = list(Projects.objects.values())
    for project in allProjects:
        taskIds = list(Task.objects.filter(project_id=project['id']).values_list('pk', flat=True))
        project['tasks'] = taskIds
    return allProjects

def getProjectsTree():
    projectsTree = []
    allProjects = list(Projects.objects.values())
    projectsTree.append({'id': '$$$', 'parent': '#', 'text': 'All Projects'})
    for project in allProjects:
        projectsTree.append({'id': project['id'], 'parent': '$$$', 'text': project['name']})
    return projectsTree

def getProjectsByUser(username):
    projectNames = {}
    index = 0
    projectsUsersQuerySet = Projects_Users.objects.filter(user__username=username).select_related('project')
    for project in projectsUsersQuerySet:
        taskIds = list(Task.objects.filter(project_id=project.project.pk).values_list('pk', flat=True))
        projectNames[index] = {'id': project.project.pk, 'name': project.project.name, 'tasks': taskIds}
        index += 1

    return projectNames

def getAllUsers(username):
    # Get all usernames other than the current user and the superuser
    allUsers = list(User.objects.filter(~Q(username=username), is_superuser=False).values_list('username', flat=True))
    # Get all of the manager usernames
    managers = list(User.objects.filter(groups__name='manager').values_list('username', flat=True))
    usernames = {}
    usernames['usernames'] = allUsers
    usernames['managers'] = managers

    return usernames

def getUsersForProject(projectName):
    usernames = []
    # Gets every user related to the project name provided.
    projectsUsersQuerySet = Projects_Users.objects.filter(project__name=projectName).select_related('user')
    # Save only the usernames and return them to the client.
    for user in projectsUsersQuerySet:
        usernames.append(user.user.username)

    return usernames

def getAnnotatorsForEachProject(username):
    # Get a list of all projects related to the user, and then get all of the users related to all of those projects.
    projectsIds = list(Projects_Users.objects.filter(user__username=username).values_list('project__id', flat=True))
    projectUserList = list(Projects_Users.objects.filter(project__pk__in=projectsIds).values_list('project__id', 'user__username', 'user__pk'))

    projectUserDict = {}

    # Create a dictionary to return to the client in the following format: {projectId: [[username, userId],[username, userId]...], projectId...}
    for relation in projectUserList:
        if relation[0] not in projectUserDict:
            projectUserDict[relation[0]] = []
        projectUserDict[relation[0]].append([relation[1], relation[2]])

    return projectUserDict

def getAnnotatorsForAllProjects():
    # Admin gets all of the users for all of the projects.
    projectUserList = list(Projects_Users.objects.values_list('project__id', 'user__username', 'user__pk'))

    projectUserDict = {}

    # Create a dictionary to return to the client in the following format: {projectId: [[username, userId],[username, userId]...], projectId...}
    for relation in projectUserList:
        if relation[0] not in projectUserDict:
            projectUserDict[relation[0]] = []
        projectUserDict[relation[0]].append([relation[1], relation[2]])

    return projectUserDict

def getProjectHasScore(projectName):
    has_score = list(Projects.objects.filter(name=projectName).values_list('has_score'))

    # values list returns a tuple in the format of (x, y, z, ...) so even one value is a tuple, hence has_score[0](for the tuple)[0](for the real value)
    return has_score[0][0]

def getProjectHasObjectStorage(projectId):
    return Projects_ObjectStorages.objects.filter(project__id=projectId).exists()

def doesTaskNameExist(projectId, taskName):
    return Task.objects.filter(project__id=projectId, name=taskName).exists()