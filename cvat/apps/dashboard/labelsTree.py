from django.db import connection
from ..engine.models import Projects_Users, Projects
import re

def dictfetchall(cursor):
	columns = [col[0] for col in cursor.description]
	return [
		dict(zip(columns, row))
		for row in cursor.fetchall()
	]

def getLabelsTree(username):
	project_ids = "("
	projectsUsersQuerySet = Projects_Users.objects.filter(user__username=username).select_related('project')
    
	# Create a string containing all of the projects the user is associated with as (1,2,3,...)
	for project in projectsUsersQuerySet:
		project_ids += str(project.project.pk) + ","
	project_ids = project_ids[:-1] + ")"
    
	with connection.cursor() as cursor:
		# Gets the data needed for building the tree of labels and their attributes and values
		query = "SELECT coalesce(p.parent_id || '/' || l.parent_id || '/' || l.id, l.parent_id || '/' || l.id, text(l.id)) as id, \
				coalesce(p.parent_id || '/' || l.parent_id, text(l.parent_id), '$$$') as parent, \
				coalesce('~' || l.label || '/' || l.attribute || '/' || l.value, '~' || l.label || '/' || l.attribute, l.label) as path, \
				coalesce(l.value, l.attribute, l.label) as text, \
				l.project_id FROM \
				public.engine_labeltypes l left outer join public.engine_labeltypes p on l.parent_id = p.id \
				WHERE l.project_id IN " + project_ids
    
		cursor.execute(query)
		resultAsJson = dictfetchall(cursor)
	
	finalResult = {}

	for element in resultAsJson:
		if element["project_id"] not in finalResult:
			finalResult[element["project_id"]] = []
			finalResult[element["project_id"]].append({
				"id": '$$$',
				"parent": '#',
				"path": 'All labels',
				"text": 'All labels'
			})
        
		finalResult[element["project_id"]].append({
			"id": element["id"],
			"parent": element["parent"],
			"path": element["path"],
			"text": element["text"]
		})

	project_ids = re.sub("[\(\)]", '', project_ids)
	
	for project in project_ids.split(","):
		if int(project) not in finalResult:
			finalResult[project] = []
			finalResult[project].append({
				"id": '$$$',
				"parent": '#',
				"path": 'All labels',
				"text": 'All labels'
			})
    
	return finalResult

def getAdminLabelsTree():
	with connection.cursor() as cursor:
		# Gets the data needed for building the tree of labels and their attributes and values
		query = "SELECT coalesce(p.parent_id || '/' || l.parent_id || '/' || l.id, l.parent_id || '/' || l.id, text(l.id)) as id, \
				coalesce(p.parent_id || '/' || l.parent_id, text(l.parent_id), '$$$') as parent, \
				coalesce('~' || l.label || '/' || l.attribute || '/' || l.value, '~' || l.label || '/' || l.attribute, l.label) as path, \
				coalesce(l.value, l.attribute, l.label) as text, \
				l.project_id FROM \
				public.engine_labeltypes l left outer join public.engine_labeltypes p on l.parent_id = p.id"
        
		cursor.execute(query)
		resultAsJson = dictfetchall(cursor)
	
	finalResult = {}

	for element in resultAsJson:
		if element["project_id"] not in finalResult:
			finalResult[element["project_id"]] = []
			finalResult[element["project_id"]].append({
				"id": '$$$',
				"parent": '#',
				"path": 'All labels',
				"text": 'All labels'
			})
        
		finalResult[element["project_id"]].append({
			"id": element["id"],
			"parent": element["parent"],
			"path": element["path"],
			"text": element["text"]
		})

	for project in Projects.objects.all().values_list('pk', flat=True):
		if int(project) not in finalResult:
			finalResult[project] = []
			finalResult[project].append({
				"id": '$$$',
				"parent": '#',
				"path": 'All labels',
				"text": 'All labels'
			})
    
	return finalResult