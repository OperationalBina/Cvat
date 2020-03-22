from ..engine.models import FrameProperties, LabelTypes, AttributeDetails, LabelDetails, Label
from ..engine.models import TaskFrameSpec, AttributeSpec, Projects_Users, Projects, Task, Projects_ObjectStorages

def getLabelsFromDb(username):
    project_ids = []
    # Filter out projects not associated with the user
    projectsUsersQuerySet = Projects_Users.objects.filter(user__username=username).select_related('project')

    for project in projectsUsersQuerySet:
        project_ids.append(project.project.pk)

    labels = LabelDetails.objects.filter(labelType__project__pk__in=project_ids).select_related("labelType")

    resultJson = {}

    for label in labels:
        resultJson[label.labelType.label] = label.color

    # Return a dictionary with every label and its color
    return resultJson
    
def getAdminLabelsFromDb():
    allLabels = LabelDetails.objects.all().select_related("labelType")

    resultJson = {}

    for label in allLabels:
        resultJson[label.labelType.label] = label.color

    # Return a dictionary with every label and its color
    return resultJson

def updateLabelInDb(oldName, newName, projectId):
    doesLabelExist = LabelTypes.objects.filter(label=newName, project__pk=projectId).exists()

    # If the new label name doesn't exist change the name of the label.
    if doesLabelExist:
        return "Label already Exists"
    else:
        LabelTypes.objects.filter(label=oldName, project__pk=projectId).update(label=newName)
    
    Label.objects.filter(name=oldName, task__project__pk=projectId).update(name=newName)
    return "Success"

def updateLabelColorInDb(labelName, newColor, projectId):
    # Update the color of the requested label.
    LabelDetails.objects.filter(labelType__label=labelName, labelType__project__pk=projectId).update(color=newColor)
    
    return "Success"

def updateAttributeInDb(oldName, newName, parentName, projectId):
    doesAttributeExist = LabelTypes.objects.filter(label=parentName, attribute=newName, project__pk=projectId).exists()

    # If the new attribute name doesn't exist change the name of the attribute.
    if doesAttributeExist:
        return "Attribute already exists"
    else:
        LabelTypes.objects.filter(label=parentName, attribute=oldName, project__pk=projectId).update(attribute=newName)
    return "Success"

def updateValueInDb(oldName, newName, attributeName, labelName, projectId):
    doesValueExist = LabelTypes.objects.filter(label=labelName, attribute=attributeName, value=newName, project__pk=projectId).exists()
    
    # If the new value name doesn't exist change the name of the value.
    if doesValueExist:
        return "Value already exists"
    else:
        LabelTypes.objects.filter(label=labelName, attribute=attributeName, value=oldName, project__pk=projectId).update(value=newName)
    return "Success"

def deleteLabelInDb(labelName, projectId):
    try:
        isLabelUsed = Label.objects.filter(name=labelName, task__project__pk=projectId).exists()
        # If a label doesn't have any tasks associated with it, it can be deleted.
        if not isLabelUsed:
            LabelTypes.objects.filter(label=labelName, project__pk=projectId).delete()
        else:
            return "Label is associated with tasks"
    except:
        return "Error"

    return "Success"

def deleteAttributeInDb(labelName, attributeName, projectId):
    try:
        isAttributeUsed = AttributeSpec.objects.filter(text__icontains=attributeName, label__task__project__pk=projectId).exists()

        # If the attribute isn't associated with any task, delete it.
        if not isAttributeUsed:
            LabelTypes.objects.filter(label=labelName, attribute=attributeName, project__pk=projectId).delete()
        else:
            return "Attribute is associated with tasks"
    except:
        return "Error"
    return "Success"

def deleteValueInDb(labelName, attributeName, valueName, projectId):
    try:
        isValueUsed = AttributeSpec.objects.filter(text__icontains=valueName, label__task__project__pk=projectId).exists()
        # If the value isn't associated with any task, delete it.
        if not isValueUsed:
            LabelTypes.objects.filter(label=labelName, attribute=attributeName, value=valueName, project__pk=projectId).delete()
        else:
            return "Value is associated with tasks"
    except:
        return "Error"
    return "Success"

def updateProjectNameInDb(oldName, newName):
    doesProjectExist = Projects.objects.filter(name=newName).exists()

    # If the new project name doesn't exist change the name of the project.
    if doesProjectExist:
        return "Project name already Exists"
    else:
        Projects.objects.filter(name=oldName).update(name=newName)
    
    return "Success"


def updateProjectScoreInDb(projectName, hasScore):
    doesProjectExist = Projects.objects.filter(name=projectName).exists()

    # If project exists change the value of its score to the opposite.
    if not doesProjectExist:
        return "Projet doesn't exist"
    else:
        if hasScore == "true":
            hasScore = True
        else:
            hasScore = False
        Projects.objects.filter(name=projectName).update(has_score=hasScore)
    
    return "Success"

def deleteProjectInDb(projectName):
    try:
        projectToDelete = Projects.objects.get(name=projectName)
        projectHasTasks = Task.objects.filter(project=projectToDelete).exists()

        # If the project doesn't have any tasks associated with it, delete it.
        if not projectHasTasks:
            # Delete the relation between the project and all of the associated users.
            Projects_Users.objects.filter(project=projectToDelete).delete()

            # Delete the projects relation to the object storages.
            Projects_ObjectStorages.objects.filter(project=projectToDelete).delete()

            # Finally delete the project itself.
            projectToDelete.delete()

            return "Success"
        else:
            return "Project has tasks"
    except:
        return "Error"


def updateFramePropInDb(oldName, newName, projectId):
    doesFramePropertyExist = FrameProperties.objects.filter(prop=newName, project__pk=projectId).exists()

    # If the new frame property name doesn't exist change the name of the frame property.
    if doesFramePropertyExist:
        return "Frame property name already Exists"
    else:
        FrameProperties.objects.filter(prop=oldName, project__pk=projectId).update(prop=newName)
    
    return "Success"


def updateFrameValueInDb(oldName, newName, propertyName, projectId):
    doesFrameValueExist = FrameProperties.objects.filter(prop=propertyName, value=newName, project__pk=projectId).exists()

    # If the new frame property value name doesn't exist change the name of the frame property value.
    if doesFrameValueExist:
        return "Value already Exists"
    else:
        FrameProperties.objects.filter(prop=propertyName, value=oldName, project__pk=projectId).update(value=newName)
    
    return "Success"

def deleteFramePropInDb(framePropName, projectId):
    try:
        isFramePropertyUsed = TaskFrameSpec.objects.filter(propVal__prop=framePropName, task__project__pk=projectId).exists()

        # If the given frame prop isn't associated with any task, delete it.
        if not isFramePropertyUsed:
            FrameProperties.objects.filter(prop=framePropName, project__pk=projectId).delete()
        else:
            return "Frame prop is associated with tasks"
    except:
        return "Error"
    return "Success"

def deleteFramePropValueInDb(framePropName, valueName, projectId):
    try:
        isFrameValueUsed = TaskFrameSpec.objects.filter(propVal__prop=framePropName, propVal__value=valueName, task__project__pk=projectId).exists()
        
        # If the given frame prop isn't associated with any task, delete it.
        if not isFrameValueUsed:
            FrameProperties.objects.filter(prop=framePropName, value=valueName, project__pk=projectId).delete()
        else:
            return "Frame prop is associated with tasks"
    except:
        return "Error"
    return "Success"