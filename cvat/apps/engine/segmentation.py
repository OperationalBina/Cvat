import numpy as np
import json
import cv2

from .models import Label

def hex_to_rgba(hex):
    return list([int(hex.lstrip('#')[i:i+2],16) for i in (0,2,4)])

def marker_by_label(draws, h, w):
    markers = np.zeros((h,w), np.int32)
    for draw in draws:
        points = draw['points']
        width = draw['width']
        tool = 'brush'
        labelTypeId = 0

        if 'tool' in draw: # Older versions does not have tool in draws (default to brush)
            tool = draw['tool']

        if tool == 'brush':
            labelTypeId = draw['labelId']

        if(len(points) == 1):
            cv2.line(markers, tuple([points[0]['x'],points[0]['y']]), tuple([points[0]['x'],points[0]['y']]), labelTypeId , width)
        else:
            for i in range(len(points) - 1):
                cv2.line(markers, tuple([points[i]['x'],points[i]['y']]), tuple([points[i+1]['x'],points[i+1]['y']]), labelTypeId, width)

    return markers

def remove_borders(markers, labelTypes):
    # Remove border for each label
    for labelTypeId in labelTypes:
        mask = (markers == labelTypeId).astype(np.uint8)
        polygons, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(mask, polygons, -1, 1, 2)
        markers[(mask == 1) & (markers == -1)] = labelTypeId

    # Sometimes corners of borders are not removed - here we eliminate them
    corners = np.where(markers==-1)
    for cornerIndex in range(len(corners[0])):
        x = corners[0][cornerIndex]
        y = corners[1][cornerIndex]
        labelsAround = []
        
        for i in [x-1, x, x+1]:
            for j in [y-1, y, y+1]:
                if i >= 0 and j >= 0 and i < markers.shape[0] and j < markers.shape[1] and (i,j) != (x,y):
                    labelsAround.append(markers[i][j])
            
        labelsAround = np.array([x for x in labelsAround if x >= 0])
        counts = np.bincount(labelsAround)
        markers[x][y] = np.argmax(counts)

    return markers

def process_watershed(originalImg, draws, tid, frame):
    h, w = originalImg.shape[:2]
    
    #contour_lst = []
    overlay = np.zeros((h,w,3), dtype=np.uint8)

    # Prepering markers for watershed
    markers = marker_by_label(draws, h, w)

    if np.count_nonzero(markers) != 0:
        # Watersheding and getting the result inside markers itself
        cv2.watershed(originalImg, markers)
        
        labelTypes = {draw['labelId']: {'color': hex_to_rgba(draw['color']), 'labelId': draw['labelId']}
                      for draw in draws 
                      if 'tool' not in draw or draw['tool'] == 'brush'}
        markers = remove_borders(markers, labelTypes)
        for labelTypeId in labelTypes:
            label = labelTypes[labelTypeId]
            labelMask = (markers == labelTypeId)

            # polygons, _ = cv2.findContours(labelMask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            # for polygon in polygons:
            #     contour_lst.append({'label': label['labelId'], 'polygon': np.reshape(polygon,(-1,2)).tolist()})

            overlay[labelMask] = label['color']

    return overlay