from django.db import connection
from ..engine.models import Projects_Users, Projects
import re

def dictfetchall(cursor):
	columns = [col[0] for col in cursor.description]
	return [
		dict(zip(columns, row))
		for row in cursor.fetchall()
	]

def getFramePropertiesTree(username):
	project_ids = "("
	projectsUsersQuerySet = Projects_Users.objects.filter(user__username=username).select_related('project')

	# Create a string containing all of the projects the user is associated with as (1,2,3,...)
	for project in projectsUsersQuerySet:
		project_ids += str(project.project.pk) + ","
	project_ids = project_ids[:-1] + ")"

	with connection.cursor() as cursor:
		# Gets the data needed for building the tree of frame properties and their attributes and values
		query = "SELECT coalesce(parent_id || '/' || id, text(id)) as id, \
				coalesce(text(parent_id), '$$$') as parent, \
				coalesce(prop || '/' || value, prop) as path, \
				coalesce(value, prop) as text, \
				project_id \
				FROM public.engine_frameproperties \
				WHERE project_id IN " + project_ids

		cursor.execute(query)
		resultAsJson = dictfetchall(cursor)
	
	finalResult = {}

	for element in resultAsJson:
		if element["project_id"] not in finalResult:
			finalResult[element["project_id"]] = []
			finalResult[element["project_id"]].append({
				"id": '$$$',
				"parent": '#',
				"path": 'All properties',
				"text": 'All properties'
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
				"path": 'All properties',
				"text": 'All properties'
			})

	return finalResult

def getAdminFramePropertiesTree():
	with connection.cursor() as cursor:
		# Gets the data needed for building the tree of frame properties and their attributes and values
		query = "SELECT coalesce(parent_id || '/' || id, text(id)) as id, \
				coalesce(text(parent_id), '$$$') as parent, \
				coalesce(prop || '/' || value, prop) as path, \
				coalesce(value, prop) as text, \
				project_id \
				FROM public.engine_frameproperties"

		cursor.execute(query)
		resultAsJson = dictfetchall(cursor)
	
	finalResult = {}

	for element in resultAsJson:
		if element["project_id"] not in finalResult:
			finalResult[element["project_id"]] = []
			finalResult[element["project_id"]].append({
				"id": '$$$',
				"parent": '#',
				"path": 'All properties',
				"text": 'All properties'
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
				"path": 'All properties',
				"text": 'All properties'
			})

	return finalResult