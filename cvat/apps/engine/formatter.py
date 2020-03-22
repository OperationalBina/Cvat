import os
import sys
import re
import xml.etree.ElementTree as ET
import numpy as np
#import pandas as pd
from enum import Enum



DARKLABEL_FORMAT_OLD_LEN = 2 + 1*5 # [frame, # of objects, xmin, ymin, xmax, ymax, label]
DARKLABEL_FORMAT_NEW_LEN = 2 + 1*6 # [frame, # of objects, id, xmin, ymin, xmax, ymax, label]
YOLO_FORMAT_LEN = 5                # [label_id, x, y, width, height]
YOLO_LABELS_PATH = os.path.join(os.getcwd(), 'cvat/9k.names')

def parse_format(fileData, frame_0_url, width, height):

    # Getting file data from path
    if (type(fileData) == str):
        format_filename = os.path.splitext(fileData)[0]
        for filename in os.listdir(fileData):
            if re.match(".+\.txt", filename):
                with open(os.path.join(fileData, filename), 'r') as f:
                    fileData = f.readlines()
                    unsorted_data = fileData
            elif re.match(".+\.csv", filename):
                dataframe = pd.read_csv(os.path.join(fileData, filename))
    else:
        format_file = fileData.name.split(".") # [filename, extension]
        if (format_file[1] == "txt"):
            fileUploaded = fileData
            fileData = ''
            #with open(os.path.join('', fileData.temporary_file_path())) as f:
            for line in fileUploaded:
                fileData = fileData + line.decode()
            fileData = fileData.split('\n')
            unsorted_data = fileData
        elif (format_file[1] == "csv"):
            dataframe = pd.read_csv(fileUploaded)

    # Check the format by the first line
    data_format = getFormat(splitLine(unsorted_data[0]))

    if ((data_format == -1) and (dataframe)):
        annotations = parse_ssd(dataframe, width, height)
    elif (data_format == YOLO_FORMAT_LEN):
        # Read the 9k.names file containing all the labels
        with open(YOLO_LABELS_PATH, 'r') as f:
            labels = f.readlines()

        # Create an array with each label in its' matching index.
        labels = [ line.replace('\n', '') for line in labels]
        frame = str(format_file[0])
        annotations = parse_yolo(frame, labels, fileData, width, height)
    elif (data_format == DARKLABEL_FORMAT_OLD_LEN):
        annotations = parse_old_darklabel(fileData, width, height)
    else: # DARKLABEL_FORMAT_NEW_LEN case
        tags_dict = {}
        labels_dict = {}
        labels_count = {}
        unique_labels_counter = 0

        # Build the dictionary by id
        for line in unsorted_data:
            tags = splitLine(line)
            if (len(tags) > 1):
                frame = tags[0]
                objects = int(tags[1])
                for i in range(objects):
                    id    = tags[(2 + i*6)]
                    xtl   = setValue(width,  tags[2 + i*6 + 1])
                    ytl   = setValue(height, tags[2 + i*6 + 2])
                    xbr   = setValue(width,  tags[2 + i*6 + 3])
                    ybr   = setValue(height, tags[2 + i*6 + 4])
                    label = tags[(2 + i*6 + 5)]

                    if (label not in labels_count):
                        labels_count[label] = unique_labels_counter
                        unique_labels_counter += 1
                
                    # If different label then start at another 1000+ (because fuck darklabel, thats why)
                    id = str(int(id) + int(1000 * int(labels_count[label])))
                        
                    # Create the key if the id is yet in dictionary
                    if (id not in tags_dict):
                        tags_dict[id] = []
                        labels_dict[id] = label

                    # If id was already found in this frame, set it to 1,000,000+
                    counter = 0
                    while ((len(tags_dict[id]) > 0) and (tags_dict[id][-1][0] == frame)):
                        counter += 1
                        id = str((int(id)* counter) + int(1000000))
                        if (id not in tags_dict):
                            tags_dict[id] = []
                            labels_dict[id] = label
                            
                    tags_dict[id].append([frame, xtl, ytl, xbr, ybr])

        annotations = parse_new_darklabel(fileData, tags_dict, labels_dict)    

    return ET.tostring(annotations).decode('utf-8')

def parse_ssd(dataframe, width, height):
    xml_annotations = ET.Element('annotations')

    # Go over the dataframe rows
    for index, rows in dataframe.iterrows():

        frame = dataframe["filename"][index].split(".")[0]
        xml_track = ET.SubElement(xml_annotations, "track")
        xml_track.set('label', dataframe["class"][index])

        box1 = ET.SubElement(xml_track, "box")
        box1.set('frame', str(int(frame)))
        
        # SSD coordinates are xy_min=bottom-left, xy_max=top-right | switching them to top-left and bottom-right
        xtl   = setValue(width,  dataframe["xmin"][index])
        ytl   = setValue(height, dataframe["ymax"][index])
        xbr   = setValue(width,  dataframe["xmax"][index])
        ybr   = setValue(height, dataframe["ymin"][index])

        box1.set('xtl', xtl)
        box1.set('ytl', ytl)
        box1.set('xbr', xbr)
        box1.set('ybr', ybr)
        box1.set('outside', '0')
        box1.set('occluded', '0')
        box1.set('keyframe', '1')

        # Create the "ending" frame (outside = 1)
        box2 = ET.SubElement(xml_track, "box")
        box2.set('frame', str(int(frame) + 1))
        box2.set('xtl', xtl)
        box2.set('ytl', ytl)
        box2.set('xbr', xbr)
        box2.set('ybr', ybr)
        box2.set('outside', '1')
        box2.set('occluded', '0')
        box2.set('keyframe', '1')

    return (xml_annotations)

def parse_yolo(frame, all_labels, data, width, height):
    xml_annotations = ET.Element('annotations')

    for line in data:
        line = line.replace(' ', '')
        tags = splitLine(line)

        if (len(tags) > 1):
            xml_track = ET.SubElement(xml_annotations, "track")
            xml_track.set('label', all_labels[int(tags[0])])

            box1 = ET.SubElement(xml_track, "box")
            box1.set('frame', str(int(frame)))
            
            # Convert from the box center (x,y) to (xtl, ytl), (xbr, ybr)
            box_width  = float(tags[3]) * width
            box_height = float(tags[4]) * height
            xtl   = setValue(width,  float(tags[1]) - box_width/2)
            ytl   = setValue(height, float(tags[2]) - box_height/2)
            xbr   = setValue(width,  float(tags[1]) + box_width/2)
            ybr   = setValue(height, float(tags[2]) + box_height/2)

            box1.set('xtl', xtl)
            box1.set('ytl', ytl)
            box1.set('xbr', xbr)
            box1.set('ybr', ybr)
            box1.set('outside', '0')
            box1.set('occluded', '0')
            box1.set('keyframe', '1')

            # Create the "ending" frame (outside = 1)
            box2 = ET.SubElement(xml_track, "box")
            box2.set('frame', str(int(frame) + 1))
            box2.set('xtl', xtl)
            box2.set('ytl', ytl)
            box2.set('xbr', xbr)
            box2.set('ybr', ybr)
            box2.set('outside', '1')
            box2.set('occluded', '0')
            box2.set('keyframe', '1')

    return (xml_annotations)

def parse_old_darklabel(data, width, height):
    xml_annotations = ET.Element('annotations')

    # Go over each row and get its parameters
    for line in data:
        tags = splitLine(line)
        if (len(tags) > 1):
            frame = tags[0]
            objects = int(tags[1])

            # For each tag in that row, create a box
            for i in range(objects):
                xml_track = ET.SubElement(xml_annotations, "track")
                xml_track.set('label', tags[2 + i*5 + 4])

                box1 = ET.SubElement(xml_track, "box")
                box1.set('frame', str(int(frame)))
                
                xtl   = setValue(width,  tags[2 + i*5 + 0])
                ytl   = setValue(height, tags[2 + i*5 + 1])
                xbr   = setValue(width,  tags[2 + i*5 + 2])
                ybr   = setValue(height, tags[2 + i*5 + 3])

                box1.set('xtl', xtl)
                box1.set('ytl', ytl)
                box1.set('xbr', xbr)
                box1.set('ybr', ybr)
                box1.set('outside', '0')
                box1.set('occluded', '0')
                box1.set('keyframe', '1')

                # Create the "ending" frame (outside = 1)
                box2 = ET.SubElement(xml_track, "box")
                box2.set('frame', str(int(frame) + 1))
                box2.set('xtl', xtl)
                box2.set('ytl', ytl)
                box2.set('xbr', xbr)
                box2.set('ybr', ybr)
                box2.set('outside', '1')
                box2.set('occluded', '0')
                box2.set('keyframe', '1')

    return (xml_annotations)

def parse_new_darklabel(data, ids_dict, labels_dict):
    # Creating root element for xml file
    xml_annotations = ET.Element('annotations')

    for track_id in ids_dict:
        xml_track = ET.SubElement(xml_annotations, "track")
        xml_track.set('id', track_id)
        xml_track.set('label', labels_dict[track_id])

        # Parse to XML
        for i in range(len(ids_dict[track_id])):
            track = ids_dict[track_id][i]
            box1 = ET.SubElement(xml_track, "box")
            box1.set('frame', str(int(track[0])))
            
            box1.set('xtl', track[1])
            box1.set('ytl', track[2])
            box1.set('xbr', track[3])
            box1.set('ybr', track[4])
            box1.set('outside', '0')
            box1.set('occluded', '0')
            box1.set('keyframe', '1')

            # Create the "ending" frame (outside = 1)
            if ((i == len(ids_dict[track_id]) - 1) or (int(ids_dict[track_id][i+1][0]) != int(track[0])+1)):
                box2 = ET.SubElement(xml_track, "box")
                box2.set('frame', str(int(track[0]) + 1))
                box2.set('xtl', track[1])
                box2.set('ytl', track[2])
                box2.set('xbr', track[3])
                box2.set('ybr', track[4])
                box2.set('outside', '1')
                box2.set('occluded', '0')
                box2.set('keyframe', '1')
    
    return (xml_annotations)

def splitLine(line):
    tags = []
    if type(line) is str:
        tags = line.rstrip('\n').rstrip('\r').split(',')
    else:
        tags = line.decode().rstrip('\n').rstrip('\r').split(',')
    
    return tags

def getFormat(splitted_line):
    data_format = -1

    if ((len(splitted_line)-2) % (DARKLABEL_FORMAT_NEW_LEN - 2) == 0):
        data_format = DARKLABEL_FORMAT_NEW_LEN
    elif ((len(splitted_line)-2) % (DARKLABEL_FORMAT_OLD_LEN - 2) == 0):
        data_format = DARKLABEL_FORMAT_OLD_LEN
    else:
        data_format = YOLO_FORMAT_LEN

    return data_format

def setValue(max, val):
    val = int(val)
    if val > max:
        val = max
    elif val < 0:
        val = 0
    return str(val)