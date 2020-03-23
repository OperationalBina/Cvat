/*
 * Copyright (C) 2018 Intel Corporation
 *
 * SPDX-License-Identifier: MIT
 */

/* exported callAnnotationUI blurAllElements drawBoxSize copyToClipboard */
"use strict";

var fired = false;
var timer = null;

$(window).on("unload", function() {
    updateTargetFrame();
    $.ajax({
        url: 'exit/task/' + cvat.job.taskId,
        async: false
    });
});

function updateTargetFrame() {
    let taskId = window.cvat.job.taskId;
    let currentFrame = window.cvat.player.frames.current;
    $.ajax({
        type: "POST",
        url: "update/task/" + taskId + "/frame/" + currentFrame,
        async: false
    });
}

function callAnnotationUI(jid) {
    initLogger(jid);
    let loadJobEvent = Logger.addContinuedEvent(Logger.EventType.loadJob);
    serverRequest("/get/job/" + jid, function(job) {
        serverRequest("get/annotation/job/" + jid, function(data) {
            $('#loadingOverlay').remove();
            setTimeout(() => {
                buildAnnotationUI(job, data, loadJobEvent);
            }, 0);
        });
    });
}

function initLogger(jobID) {
    if (!Logger.initializeLogger('CVAT', jobID))
    {
        let message = 'Could not initialize Logger. Please immediately report the problem to support team';
        console.error(message);
        showMessage(message);
        return;
    }

    Logger.setTimeThreshold(Logger.EventType.zoomImage);

    serverRequest('/get/username', function(response) {
        Logger.setUsername(response.username);
    });
}

let buildFrameCommentsJSON = function(numOfFrames, existingComments) {
    var finalJSON = {};

    // Go over each frame to create the json
    for (var i = 0; i <= numOfFrames; i++) {
        finalJSON[i] = ""
        
        // If there is already a comment in this frame, add it.
        if (existingComments[i]) {
            finalJSON[i] += existingComments[i]
        }
    }

    return finalJSON;
}

let buildEmptyPropertiesJSON = function(numOfFrames) {
    var result = {}

    for (var frame = 0; frame <= numOfFrames; frame++) {
        result[frame] = {}
    }

    return (result)
}

let buildFramesPropertiesJSON = function(numOfFrames, frameProperties, specificFrameProperties) {
    var finalJSON = buildEmptyPropertiesJSON(numOfFrames, frameProperties, specificFrameProperties);

    // For each frame create an empty json containing each property
    for (var i = 0; i <= numOfFrames; i++) {
        // Check if it is a starting frame for a property
        if (specificFrameProperties[i]) {
            // For each property in the current frame
            for (var property in frameProperties) {
                if (!specificFrameProperties[i][property]) {
                    finalJSON[i][property] = {}
                } else {
                    // Set the current frame as the starting point
                    finalJSON[i][property] = { "propValId": specificFrameProperties[i][property],
                                                "isStartingFrame": true }
                    
                    // Go over the other frames and create the object for them
                    for (var nextFrame = i+1; nextFrame <= numOfFrames; nextFrame++) {
                        finalJSON[nextFrame][property] = { "propValId": specificFrameProperties[i][property],
                                                           "isStartingFrame": false }
                    }
                }
            }
        } else {
            for (var property in frameProperties) {
                // Make sure no object is already set on this frame
                if (!finalJSON[i][property]) {
                    finalJSON[i][property] = {}
                }
            }
        }
    }

    return finalJSON;
}
    
function removeAllShapes(shapeCreatorModel) {
    for (var index in shapeCreatorModel._shapeCollection.shapes) {
        var shape = shapeCreatorModel._shapeCollection.shapes[index];

        if (shape._frame == cvat.player.frames.current) {
            shape.remove();
        }    
    }
}

function drawWatershadedShapes(shapesFound, shapeCreatorModel) {
    removeAllShapes(shapeCreatorModel);

    // Drawing each watershaded shape returned from the server.
    for (let shape of shapesFound) {
        // Make sure there there is more than 1 point in the shape returned
        if (shape.polygon.length > 1) {
            let tmpCreateEvent = shapeCreatorModel._createEvent
            let tmpDefaultLabel = shapeCreatorModel._defaultLabel
            let tmpDefaultMode = shapeCreatorModel._defaultMode
            let tmpDefaultType = shapeCreatorModel._defaultType

            // Set the "create event" mode for the logs and set the label for the current shape
            shapeCreatorModel._createEvent = Logger.addContinuedEvent(Logger.EventType.drawObject);
            shapeCreatorModel._defaultLabel = shape.label;
            shapeCreatorModel._defaultMode = "annotation"
            shapeCreatorModel._defaultType = shape.polygon.length >= 3 ? "polygon" : "polyline"

            // Create a new array where each cell contains the string "x,y"
            var polyPoints = shape.polygon.map(point => point.join(',')).join(' ');

            // Draw the points (creating a space between each pair, format is: "x,y x,y x,y")
            shapeCreatorModel.finish({"points": polyPoints})

            // Close the "create event" mode
            shapeCreatorModel._createEvent.close();
            shapeCreatorModel._defaultType = tmpDefaultType
            shapeCreatorModel._defaultMode = tmpDefaultMode;
            shapeCreatorModel._defaultLabel = tmpDefaultLabel
            shapeCreatorModel._createEvent = tmpCreateEvent;
        }
    }

    $('#saveButton').click();
}

function savePaintings(playerModel) {
    playerModel.changes = 0;
    
    $.ajax({
        async: false,
        type: 'POST',
        url: `segmentation/task/${playerModel._frameProvider._tid}/frame/${playerModel.frames.current}`,
        data: JSON.stringify({
            status: playerModel.getPaintings()
        }),
        contentType: "application/json; charset=utf-8",
        success: (data) => {
        },
        error: (data) => {
            showMessage(`Could not save paintings`);
        }
    });
}


function watershed(event) {
    _paq.push(['trackEvent', 'Watershed', 'Watershed', cvat.project.name])
    let playerModel = event.data.playerModel;
    let shapeCreatorModel = event.data.shapeCreatorModel;

    let watershedBtn = $(event.target)
    watershedBtn.text('Watersheding...');
    watershedBtn.prop('disabled', true);

    $.ajax({
        type: 'POST',
        url: `segmentation/watershed/task/${playerModel._frameProvider._tid}/frame/${playerModel.frames.current}`,
        data: JSON.stringify({
            status: playerModel.getCorrectPaintings()
        }),
        contentType: "application/json; charset=utf-8",
        success: () => {
            // Must first set to nothing in order to force refresh of the result
            $('#frameWatershed').css('background-image','');
            $('#frameWatershed').css('background-image', `url("get/task/${playerModel._frameProvider._tid}/frame_watershed/${playerModel.frames.current}")`);
            //drawWatershadedShapes(data.polygons, shapeCreatorModel);
            
            if (!$('#showWatershedCheckbox').prop('checked')) {
                $('#showWatershedCheckbox').trigger('click');
            }

            watershedBtn.text('Watershed');
            watershedBtn.prop('disabled', false);
        },
        error: (data) => {
            showMessage(`Error during watershed`);
            watershedBtn.text('Watershed');
            watershedBtn.prop('disabled', false);
        }
    });
}

// Get a stringified project JSON and parse only the important fields to JSON
function parseProject(project_string) {
    project_json = JSON.parse(project_string)[0];
    project = {'id': project_json.pk, 'name': project_json.fields.name, 'has_score': project_json.fields.has_score}

    return (project)
}

function toggleSidenav(name) {
    if ($("#sidenavMenu").css("height") != "0px") {
        closeSidenav(name);
    } else {
        openSidenav();
    }
}

function openSidenav() {
    $("#sidenavMenu").css("height", "85%");
    $("#sidenavMenu").css("padding-top", "20px");

    $("#sidenavOpener").css("transform", "rotate(90deg) rotateX(180deg)");
    $("#menuHeader").text("Main Menu");
}

function closeSidenav(name) {
    $("#sidenavMenu").css("height", "0%");
    $("#sidenavMenu").css("padding-top", "0px");

    $("#sidenavOpener").css("transform", "rotate(-90deg)");
    $("#menuHeader").text(name);
}

// Handles all actions that should happen if the user is_staff=true
function isStaffHandler() {
    $.ajax({
        url: "is_staff",
        success: function(data) {
            window.cvat.isStaff = data.is_staff;

            // Update the comments textarea to be enabled/disabled by role.
            $("#commentTextArea").attr("disabled", !data.is_staff);
        }
    });
}

function loadCanvas(event) {
    let playerModel = event.data.playerModel;
    let playerView = event.data.playerView;
    let frameInput = $('#loadSpecificFrameTags');
    let chosenFrame = frameInput.val();

    if (chosenFrame == "") {
        chosenFrame = frameInput.attr('placeholder')
    }

    let isLoadedFromCurrFrame = chosenFrame == playerModel._frame.current;

    $.ajax({
        type: 'POST',
        url: `get/segmentation/task/${playerModel._frameProvider._tid}/frame/${chosenFrame}`,
        success: (data) => {
            playerModel.paintings = data;
            playerModel.redoStack = [];
            // When loaded from different frame, changes will get a value like all the paintings were painted in a clear canvas.
            playerModel.changes = isLoadedFromCurrFrame ? 0 : data.length;
            playerView._undoBtn.attr('disabled', data.length == 0 ? true : false);
            playerView._redoBtn.attr('disabled', true);
            playerView._clearBtn.attr('disabled', data.length == 0 ? true : false);
            playerModel.repaint();
        }
    });
}

function doesVideoExist() {
    $.ajax({
        url: 'does_video_file_exist/' + window.cvat.job.taskId,
        async: false,
        success: function(response) {
            if (response === "Video file exists") {
                window.cvat.job.video = true;
            } else {
                window.cvat.job.video = false;
                $("#trackAllShapes").remove();
            }
        }
    });
}

function buildAnnotationUI(job, shapeData, loadJobEvent) {
    // Setup some API
    window.cvat = {
        labelsInfo: new LabelsInfo(job),
        frameProperties: job.frameProperties["allProperties"],
        framePropertiesJSON: buildFramesPropertiesJSON(job.stop, job.frameProperties["allProperties"], job.frameProperties["keyframeSpec"]),
        frameComments: buildFrameCommentsJSON(job.stop, job.comments),
        originalFrameComments: buildFrameCommentsJSON(job.stop, job.comments),
        project: parseProject(job.project),
        translate: new CoordinateTranslator(),
        player: {
            geometry: {
                scale: 1,
            },
            frames: {
                current: job.current,
                start: job.start,
                stop: job.stop,
            }
        },
        mode: null,
        job: {
            z_order: job.z_order,
            id: job.jobid,
            images: job.image_meta_data,
            taskId: job.taskid,
            video: false
        },
        search: {
            value: window.location.search,

            set: function(name, value) {
                let searchParams = new URLSearchParams(this.value);

                if (typeof value === 'undefined' || value === null) {
                    if (searchParams.has(name)) {
                        searchParams.delete(name);
                    }
                }
                else searchParams.set(name, value);
                this.value = `${searchParams.toString()}`;
            },

            get: function(name) {
                try {
                    let decodedURI = decodeURIComponent(this.value);
                    let urlSearchParams = new URLSearchParams(decodedURI);
                    if (urlSearchParams.has(name)) {
                        return urlSearchParams.get(name);
                    }
                    else return null;
                }
                catch (error) {
                    showMessage('Bad URL has been found');
                    this.value = window.location.href;
                    return null;
                }
            },

            toString: function() {
                return `${window.location.origin}/?${this.value}`;
            }
        }
    };

    // Check if video file exists for the current task
    doesVideoExist();

    // Handle all "is_staff" requests
    isStaffHandler();

    // Remove external search parameters from url
    window.history.replaceState(null, null, `${window.location.origin}/?id=${job.jobid}`);

    window.cvat.config = new Config();

    // Setup components
    let idGenerator = new IncrementIdGenerator(job.max_shape_id + 1);
    let annotationParser = new AnnotationParser(job, window.cvat.labelsInfo, idGenerator);

    let shapeCollectionModel = new ShapeCollectionModel(idGenerator).import(shapeData, true);
    let shapeCollectionController = new ShapeCollectionController(shapeCollectionModel);
    let shapeCollectionView = new ShapeCollectionView(shapeCollectionModel, shapeCollectionController);

    // In case of old tasks that dont provide max saved shape id properly
    if (job.max_shape_id === -1) {
        idGenerator.reset(shapeCollectionModel.maxId + 1);
    }

    window.cvat.data = {
        get: () => shapeCollectionModel.exportAll(),
        set: (data) => {
            shapeCollectionModel.empty();
            shapeCollectionModel.import(data, false);
            shapeCollectionModel.update();
        },
        clear: () => shapeCollectionModel.empty(),
    };

    let shapeBufferModel = new ShapeBufferModel(shapeCollectionModel);
    let shapeBufferController = new ShapeBufferController(shapeBufferModel);
    let shapeBufferView = new ShapeBufferView(shapeBufferModel, shapeBufferController);

    $('#shapeModeSelector').prop('value', job.mode);
    let shapeCreatorModel = new ShapeCreatorModel(shapeCollectionModel, job);
    let shapeCreatorController = new ShapeCreatorController(shapeCreatorModel);
    let shapeCreatorView = new ShapeCreatorView(shapeCreatorModel, shapeCreatorController);

    let polyshapeEditorModel = new PolyshapeEditorModel();
    let polyshapeEditorController = new PolyshapeEditorController(polyshapeEditorModel);
    let polyshapeEditorView = new PolyshapeEditorView(polyshapeEditorModel, polyshapeEditorController);

    // Add static member for class. It will be used by all polyshapes.
    PolyShapeView.editor = polyshapeEditorModel;

    let shapeMergerModel = new ShapeMergerModel(shapeCollectionModel);
    let shapeMergerController = new ShapeMergerController(shapeMergerModel);
    new ShapeMergerView(shapeMergerModel, shapeMergerController);

    let shapeGrouperModel = new ShapeGrouperModel(shapeCollectionModel);
    let shapeGrouperController = new ShapeGrouperController(shapeGrouperModel);
    let shapeGrouperView = new ShapeGrouperView(shapeGrouperModel, shapeGrouperController);

    let aamModel = new AAMModel(shapeCollectionModel, (xtl, xbr, ytl, ybr) => {
        playerModel.focus(xtl, xbr, ytl, ybr);
    }, () => {
        playerModel.fit();
    });
    let aamController = new AAMController(aamModel);
    new AAMView(aamModel, aamController);

    shapeCreatorModel.subscribe(shapeCollectionModel);
    shapeGrouperModel.subscribe(shapeCollectionView);
    shapeCollectionModel.subscribe(shapeGrouperModel);

    $('#playerProgress').css('width', $('#player')["0"].clientWidth - 420);
    $("#wrapper").css('width', $('#player')["0"].clientWidth - 420);

    let playerGeometry = {
        width: $('#playerFrame').width(),
        height: $('#playerFrame').height(),
    };

    let playerModel = new PlayerModel(job, playerGeometry);
    let playerController = new PlayerController(playerModel,
        () => shapeCollectionModel.activeShape,
        (direction) => shapeCollectionModel.find(direction),
        Object.assign({}, playerGeometry, {
            left: $('#playerFrame').offset().left,
            top: $('#playerFrame').offset().top,
        }), job);
    let playerView = new PlayerView(playerModel, playerController, job);

    let historyModel = new HistoryModel(playerModel, idGenerator);
    let historyController = new HistoryController(historyModel);
    new HistoryView(historyController, historyModel);

    playerModel.subscribe(shapeCollectionModel);
    playerModel.subscribe(shapeCollectionView);
    playerModel.subscribe(shapeCreatorView);
    playerModel.subscribe(shapeBufferView);
    playerModel.subscribe(shapeGrouperView);
    playerModel.subscribe(polyshapeEditorView);
    playerModel.shift(window.cvat.search.get('frame') || playerModel._frame.current, true);

    let shortkeys = window.cvat.config.shortkeys;
    
    $('#startTrackingButton').attr('title', `
        ${shortkeys['start_tracking_shapes'].view_value} - ${shortkeys['start_tracking_shapes'].description}`);

    setupHelpWindow(shortkeys);
    setupSettingsWindow();
    setupDumpAnnotationWindow(job);
    setupMenu(job, shapeCollectionModel, annotationParser, aamModel, playerModel, historyModel);
    setupFrameFilters();
    setupShortkeys(shortkeys, {
        aam: aamModel,
        shapeCreator: shapeCreatorModel,
        shapeMerger: shapeMergerModel,
        shapeGrouper: shapeGrouperModel,
        shapeBuffer: shapeBufferModel,
        shapeEditor: polyshapeEditorModel
    });

    $(window).on('click', function(event) {
        Logger.updateUserActivityTimer();
        if (['helpWindow', 'settingsWindow', 'dumpAnnotationWindow'].indexOf(event.target.id) != -1) {
            event.target.classList.add('hidden');
        }
    });

    let totalStat = shapeCollectionModel.collectStatistic()[1];
    loadJobEvent.addValues({
        'track count': totalStat.boxes.annotation + totalStat.boxes.interpolation +
            totalStat.polygons.annotation + totalStat.polygons.interpolation +
            totalStat.polylines.annotation + totalStat.polylines.interpolation +
            totalStat.points.annotation + totalStat.points.interpolation,
        'frame count': job.stop - job.start + 1,
        'object count': totalStat.total,
        'box count': totalStat.boxes.annotation + totalStat.boxes.interpolation,
        'polygon count': totalStat.polygons.annotation + totalStat.polygons.interpolation,
        'polyline count': totalStat.polylines.annotation + totalStat.polylines.interpolation,
        'points count': totalStat.points.annotation + totalStat.points.interpolation,
    });
    loadJobEvent.close();

    window.onbeforeunload = function(e) {
        if ((shapeCollectionModel.hasUnsavedChanges()) || 
            (JSON.stringify(cvat.frameComments) !== JSON.stringify(cvat.originalFrameComments)) || 
            playerController.hasChanges()) {
            let message = "You have unsaved changes. Leave this page?";
            e.returnValue = message;
            return message;
        }
        return;
    };

    $('#player').on('click', (e) => {
        if (e.target.tagName.toLowerCase() != 'input') {
            blurAllElements();
        }
    });


    // Check if the input in the box which specifies from what frame to load the tags is
    // valid or not, if it is'nt disable the load button.
    $('#loadSpecificFrameTags').on('input', () => {
        if ($('#loadSpecificFrameTags')[0].checkValidity()) {
            $('#loadTags').prop('disabled', false);
        } else {
            $('#loadTags').prop('disabled', true);
        }
    });
    
    $("#playerFrame").data("predictions", {});
    $("#playerFrame").data("trackingStatus", {});
    $("#playerFrame").data("finishedDownloading", false);
    $('#watershed').on('click', {"playerModel": playerModel, "shapeCreatorModel": shapeCreatorModel}, watershed);
    $('#loadTags').on('click', {"playerModel": playerModel, "playerView": playerView}, loadCanvas);
}


function copyToClipboard(text) {
    let tempInput = $("<input>");
    $("body").append(tempInput);
    tempInput.prop('value', text).select();
    document.execCommand("copy");
    tempInput.remove();
}


function setupFrameFilters() {
    let brightnessRange = $('#playerBrightnessRange');
    let contrastRange = $('#playerContrastRange');
    let saturationRange = $('#playerSaturationRange');
    let frameBackground = $('#frameBackground');
    let reset = $('#resetPlayerFilterButton');
    let brightness = 100;
    let contrast = 100;
    let saturation = 100;

    let shortkeys = window.cvat.config.shortkeys;
    brightnessRange.attr('title', `
        ${shortkeys['change_player_brightness'].view_value} - ${shortkeys['change_player_brightness'].description}`);
    contrastRange.attr('title', `
        ${shortkeys['change_player_contrast'].view_value} - ${shortkeys['change_player_contrast'].description}`);
    saturationRange.attr('title', `
        ${shortkeys['change_player_saturation'].view_value} - ${shortkeys['change_player_saturation'].description}`);

    let changeBrightnessHandler = Logger.shortkeyLogDecorator(function(e) {
        if (e.shiftKey) brightnessRange.prop('value', brightness + 10).trigger('input');
        else brightnessRange.prop('value', brightness - 10).trigger('input');
    });

    let changeContrastHandler = Logger.shortkeyLogDecorator(function(e) {
        if (e.shiftKey) contrastRange.prop('value', contrast + 10).trigger('input');
        else contrastRange.prop('value', contrast - 10).trigger('input');
    });

    let changeSaturationHandler = Logger.shortkeyLogDecorator(function(e) {
        if (e.shiftKey) saturationRange.prop('value', saturation + 10).trigger('input');
        else saturationRange.prop('value', saturation - 10).trigger('input');
    });

    Mousetrap.bind(shortkeys["change_player_brightness"].value, changeBrightnessHandler, 'keydown');
    Mousetrap.bind(shortkeys["change_player_contrast"].value, changeContrastHandler, 'keydown');
    Mousetrap.bind(shortkeys["change_player_saturation"].value, changeSaturationHandler, 'keydown');

    reset.on('click', function() {
        brightness = 100;
        contrast = 100;
        saturation = 100;
        brightnessRange.prop('value', brightness);
        contrastRange.prop('value', contrast);
        saturationRange.prop('value', saturation);
        updateFilterParameters();
    });

    brightnessRange.on('input', function(e) {
        let value = Math.clamp(+e.target.value, +e.target.min, +e.target.max);
        brightness = e.target.value = value;
        updateFilterParameters();
    });

    contrastRange.on('input', function(e) {
        let value = Math.clamp(+e.target.value, +e.target.min, +e.target.max);
        contrast = e.target.value = value;
        updateFilterParameters();
    });

    saturationRange.on('input', function(e) {
        let value = Math.clamp(+e.target.value, +e.target.min, +e.target.max);
        saturation = e.target.value = value;
        updateFilterParameters();
    });

    function updateFilterParameters() {
        frameBackground.css('filter', `contrast(${contrast}%) brightness(${brightness}%) saturate(${saturation}%)`);
    }
}


function setupShortkeys(shortkeys, models) {
    let annotationMenu = $('#annotationMenu');
    let settingsWindow = $('#settingsWindow');
    let helpWindow = $('#helpWindow');

    Mousetrap.prototype.stopCallback = function() {
        return false;
    };

    let openHelpHandler = Logger.shortkeyLogDecorator(function() {
        let helpInvisible = helpWindow.hasClass('hidden');
        if (helpInvisible) {
            annotationMenu.addClass('hidden');
            settingsWindow.addClass('hidden');
            helpWindow.removeClass('hidden');
        }
        else {
            helpWindow.addClass('hidden');
        }
        return false;
    });

    let openSettingsHandler = Logger.shortkeyLogDecorator(function() {
        let settingsInvisible = settingsWindow.hasClass('hidden');
        if (settingsInvisible) {
            annotationMenu.addClass('hidden');
            helpWindow.addClass('hidden');
            settingsWindow.removeClass('hidden');
        }
        else {
            $('#settingsWindow').addClass('hidden');
        }
        return false;
    });

    let saveHandler = Logger.shortkeyLogDecorator(function() {
        let saveButtonLocked = $('#saveButton').prop('disabled');
        if (!saveButtonLocked) {
            $('#saveButton').click();
        }
        return false;
    });

    let cancelModeHandler = Logger.shortkeyLogDecorator(function() {
        switch (window.cvat.mode) {
        case 'aam':
            models.aam.switchAAMMode();
            break;
        case 'creation':
            models.shapeCreator.switchCreateMode(true);
            break;
        case 'merge':
            models.shapeMerger.cancel();
            break;
        case 'groupping':
            models.shapeGrouper.cancel();
            break;
        case 'paste':
            models.shapeBuffer.switchPaste();
            break;
        case 'poly_editing':
            models.shapeEditor.finish();
            break;
        }
        return false;
    });

    Mousetrap.bind(shortkeys["open_help"].value, openHelpHandler, 'keydown');
    Mousetrap.bind(shortkeys["open_settings"].value, openSettingsHandler, 'keydown');
    Mousetrap.bind(shortkeys["save_work"].value, saveHandler, 'keydown');
    Mousetrap.bind(shortkeys["cancel_mode"].value, cancelModeHandler, 'keydown');
}


function setupHelpWindow(shortkeys) {
    let closeHelpButton = $('#closeHelpButton');
    let helpTable = $('#shortkeyHelpTable');
    let segmentationHelpTable = $('#shortkeySegmentationHelpTable');

    closeHelpButton.on('click', function() {
        $('#helpWindow').addClass('hidden');
    });

    for (let key in shortkeys) {
        let shortkey = shortkeys[key];
        let htmlRow = $(`<tr> <td> ${shortkey.view_value} </td> <td> ${shortkey.description} </td> </tr>`);

        if (shortkey.mode === 'segmentation') {
            segmentationHelpTable.append(htmlRow);
        } else {
            helpTable.append(htmlRow);
        }
    }
}


function setupSettingsWindow() {
    let closeSettingsButton = $('#closeSettignsButton');
    let autoSaveBox = $('#autoSaveBox');
    let autoSaveTime = $('#autoSaveTime');

    closeSettingsButton.on('click', function() {
        $('#settingsWindow').addClass('hidden');
    });

    let saveInterval = null;
    autoSaveBox.on('change', function(e) {
        if (saveInterval) {
            clearInterval(saveInterval);
            saveInterval = null;
        }

        if (e.target.checked) {
            let time = +autoSaveTime.prop('value');
            saveInterval = setInterval(() => {
                let saveButton = $('#saveButton');
                if (!saveButton.prop('disabled')) {
                    saveButton.click();
                }
            }, time * 1000 * 60);
        }

        autoSaveTime.on('change', () => {
            let value = Math.clamp(+e.target.value, +e.target.min, +e.target.max);
            e.target.value = value;
            autoSaveBox.trigger('change');
        });
    });
}

function setupDumpAnnotationWindow(job) {
    let dumpObjectsButton = $('#dumpObjectsButton');
    let dumpSegmentationButton = $('#dumpSegmentationButton');

    dumpObjectsButton.on('click', (e) => {
        dumpAnnotationRequest(e.target, job.taskid, "objects");
        $('#dumpAnnotationWindow').addClass('hidden');
    });

    dumpSegmentationButton.on('click', (e) => {
        dumpSegmentationRequest(job.taskid);
        $('#dumpAnnotationWindow').addClass('hidden');
    });
}

function setupMenu(job, shapeCollectionModel, annotationParser, aamModel, playerModel, historyModel) {
    let annotationMenu = $('#annotationMenu');
    let menuButton = $('#menuButton');

    function hide() {
        annotationMenu.addClass('hidden');
    }

    (function setupVisibility() {
        let timer = null;
        menuButton.on('click', () => {
            let [byLabelsStat, totalStat] = shapeCollectionModel.collectStatistic();
            let table = $('#annotationStatisticTable');
            table.find('.temporaryStatisticRow').remove();

            for (let labelId in byLabelsStat) {
                $(`<tr>
                    <td class="semiBold"> ${window.cvat.labelsInfo.labels()[labelId].normalize()} </td>
                    <td> ${byLabelsStat[labelId].boxes.annotation} </td>
                    <td> ${byLabelsStat[labelId].boxes.interpolation} </td>
                    <td> ${byLabelsStat[labelId].polygons.annotation} </td>
                    <td> ${byLabelsStat[labelId].polygons.interpolation} </td>
                    <td> ${byLabelsStat[labelId].polylines.annotation} </td>
                    <td> ${byLabelsStat[labelId].polylines.interpolation} </td>
                    <td> ${byLabelsStat[labelId].points.annotation} </td>
                    <td> ${byLabelsStat[labelId].points.interpolation} </td>
                    <td> ${byLabelsStat[labelId].manually} </td>
                    <td> ${byLabelsStat[labelId].interpolated} </td>
                    <td class="semiBold"> ${byLabelsStat[labelId].total} </td>
                </tr>`).addClass('temporaryStatisticRow').appendTo(table);
            }

            $(`<tr class="semiBold">
                <td> Total: </td>
                <td> ${totalStat.boxes.annotation} </td>
                <td> ${totalStat.boxes.interpolation} </td>
                <td> ${totalStat.polygons.annotation} </td>
                <td> ${totalStat.polygons.interpolation} </td>
                <td> ${totalStat.polylines.annotation} </td>
                <td> ${totalStat.polylines.interpolation} </td>
                <td> ${totalStat.points.annotation} </td>
                <td> ${totalStat.points.interpolation} </td>
                <td> ${totalStat.manually} </td>
                <td> ${totalStat.interpolated} </td>
                <td> ${totalStat.total} </td>
            </tr>`).addClass('temporaryStatisticRow').appendTo(table);
        });

        menuButton.on('click', () => {
            annotationMenu.removeClass('hidden');
            annotationMenu.css('top', menuButton.offset().top - annotationMenu.height() - menuButton.height() + 'px');
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }

            timer = setTimeout(hide, 1000);
        });

        annotationMenu.on('mouseout', () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }

            timer = setTimeout(hide, 500);
        });

        annotationMenu.on('mouseover', function() {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        });
    })();

    $('#statTaskName').text(job.slug.substring(0,32) + "...");
    $('#statFrames').text(`[${job.start}-${job.stop}]`);
    $('#statOverlap').text(job.overlap);
    $('#statZOrder').text(job.z_order);
    $('#statFlipped').text(job.flipped);
    $('#statTaskStatus').html(job.status);
    
    if (job.status == "annotation" || job.status == "validation") {
        let updateStatusAndContinue = function(newStatus, currentStatus) {
            playerModel.shift(0, true);
            $.ajax({
                url: 'update/status/' + newStatus + '/' + window.cvat.job.taskId,
                success: function() {
                    $.ajax({
                        url: `get/next/task/${currentStatus}/${window.cvat.job.taskId}`,
                        success: function(response) {
                            if (response == "No task found") {
                                window.location = `${ window.location.origin }/dashboard/`;
                            } else {
                                window.location = `${ window.location.origin }/?id=${response}`;
                            }
                        },
                        error: function(response) {
                            showMessage('Next task error. ' + response.responseText);
                        }
                    });
                },
                error: function(response) {
                    showMessage('Task update error. ' + response.responseText);
                }
            });
        }

        if (job.status == "annotation") {
            $("#validationDiv").remove();
            $(`<button class="menuButton semiBold h2"> Request Validation </button>`).on('click', () => {
                updateStatusAndContinue("validation", "annotation")
            }).prependTo('#engineMenuButtons');
        } else {
            $.ajax({
                url: "is_manager",
                success: function() {
                    $("#acceptValidationRequest").on("click", () => updateStatusAndContinue("completed", "validation"));
                    $("#rejectValidationRequest").on("click", () => updateStatusAndContinue("annotation", "validation"));
                },
                error: function() {
                    $("#validationDiv").remove();
                }
            });
        }
    } else {
        $("#validationDiv").remove();
    }

    let shortkeys = window.cvat.config.shortkeys;
    $('#helpButton').on('click', () => {
        hide();
        $('#helpWindow').removeClass('hidden');
    });
    $('#helpButton').attr('title', `
        ${shortkeys['open_help'].view_value} - ${shortkeys['open_help'].description}`);

    $('#settingsButton').on('click', () => {
        hide();
        $('#settingsWindow').removeClass('hidden');
    });
    $('#settingsButton').attr('title', `
        ${shortkeys['open_settings'].view_value} - ${shortkeys['open_settings'].description}`);

    $('#downloadAnnotationButton').on('click', (e) => {
        hide();
        $('#dumpAnnotationWindow').removeClass('hidden');
    });

    $('#uploadAnnotationButton').on('click', () => {
        hide();
        confirm('Current annotation will be removed from the client. Continue?',
            () => {
                uploadAnnotation(shapeCollectionModel, historyModel, annotationParser, $('#uploadAnnotationButton'));
            }
        );
    });
    
    $('#removeAnnotationButton').on('click', () => {
        if (!window.cvat.mode) {
            hide();
            confirm('Do you want to remove all annotations? The action cannot be undone!',
                () => {
                    historyModel.empty();
                    shapeCollectionModel.empty();
                }
            );
        }
    });

    $(document).on('keydown', (event) => {
        // If the keys pressed are Ctrl+Enter trigger the click event for start tracking button.
        // If the keys weren't released don't trigger the function again.
        if ((event.keyCode == 10 || event.keyCode == 13) && event.ctrlKey) {
            if (!fired) {
                fired = true;
                $("#startTrackingButton").trigger('click');
            }
        }
    });

    $(document).on('keyup', function() {
        fired = false;
    });

    function placePredictions(currentShapes, data, currFrame) {
        let placedPredictions = true;

        let frameWidth = window.cvat.player.geometry.frameWidth;
        let frameHeight = window.cvat.player.geometry.frameHeight;

        // Go over all shapes in the current shapes and set the predicted values for each interpolation box.
        for (shape in currentShapes) {
            var model = currentShapes[shape].model;
            let outside = currentShapes[shape].interpolation.position.outside;

            if (data[model.id] !== undefined) {
                if (model.type === "interpolation_box" && !outside) {

                    // Gets the lates frame of the current box relative to the current frame.
                    let latestFrame = Object.keys(model._positions).map(x => +x).sort((a,b) => a - b).filter(x => x <= currFrame).slice(-1);

                    // If no data was predicted for even one box, break from the loop and start the tracker again.
                    if (data[model.id]['results'] === undefined) {
                        positions = undefined;
                    } else {
                        positions = data[model.id]['results'][currFrame + 1];
                    }

                    if (positions === undefined) {
                        if (model._positions[currFrame + 1] === undefined) {
                            placedPredictions = false;
                            break;
                        }
                    } else {

                        // If the predicted position is lower than 0 the box is out of bounds.
                        let xtl = positions['x'] > 0 ? positions['x'] : 0;
                        let ytl = positions['y'] > 0 ? positions['y'] : 0;

                        // If the predicted position is greater than either the frame width or height the box is out of bounds.
                        let xbr = (positions['x'] + positions['w']) > frameWidth ? frameWidth : (positions['x'] + positions['w']);
                        let ybr =  (positions['y'] + positions['h']) > frameHeight ? frameHeight : (positions['y'] + positions['h']);

                        // As long as the width and height are not 0 the tracker managed to predict the next location.
                        if (positions['w'] != 0 && positions['h'] != 0) {
                            // Place the predictions in the next frame.
                            model._positions[currFrame + 1] = ({
                                xtl: xtl,
                                ytl: ytl,
                                xbr: xbr,
                                ybr: ybr,
                                occluded: model._positions[latestFrame].occluded,
                                z_order: model._positions[latestFrame].z_order,
                                outside: model._positions[latestFrame].outside,
                            }); 
                        } else {
                            positions = data[model.id]['results'][currFrame];
                            model._positions[currFrame + 1] = ({
                                xtl: model._positions[latestFrame].xtl,
                                ytl: model._positions[latestFrame].ytl,
                                xbr: model._positions[latestFrame].xbr,
                                ybr: model._positions[latestFrame].ybr,
                                occluded: model._positions[latestFrame].occluded,
                                z_order: model._positions[latestFrame].z_order,
                                outside: true,
                            }); 
                        }
                    }
                }
            }
        }

        return placedPredictions;
    }

    const nextAndPredict = (event) => {
        _paq.push(['trackEvent', 'Tracker', 'Next & Predict', cvat.project.name])
        
        // Stop tracking and get all predictions from the server.
        stopTracking();
        
        let data = $("#playerFrame").data("predictions");

        let shapeCollectionModel = event.data.shapeCollectionModel;
        let currentShapes = shapeCollectionModel._currentShapes;
        let interpolationShapes = shapeCollectionModel._interpolationShapes;
        let currFrame = window.cvat.player.frames.current;

        let placedPredictions = placePredictions(currentShapes, data, currFrame)
        
        // Move one frame ahead if any predictions were placed on the next frame.
        if (placedPredictions) {
            playerModel.shift(++currFrame, true);
        }

        // If the current frame isn't the last frame of the video, check if the current shapes have any future predictions,
        // if any shape does'nt have start tracking it.
        if (currFrame < window.cvat.player.frames.stop) {
            for (shape in currentShapes) {
                if (interpolationShapes.some(el => el === currentShapes[shape].model)) {
                    let model = currentShapes[shape].model;
                    let latestFrame = Object.keys(model._positions).map(x => +x).sort((a,b) => a - b).filter(x => x <= currFrame).slice(-1)[0];
                    if (!model._positions[latestFrame].outside && 
                        ((data[model._id] === undefined) || (data[model._id]["results"] === undefined) ||
                         (data[model._id]["results"][latestFrame + 1] === undefined && model._positions[latestFrame + 1] === undefined))) {
                        startTracking(model);
                    }
                }
            }
        }
    }

    // Create a throttled wrapper for next and predict, with 0.4 seconds as the lock delay.
    const tNextAndPredict = throttled(400, nextAndPredict);

    $("#startTrackingButton").on("click", { "shapeCollectionModel":shapeCollectionModel }, tNextAndPredict);

    $("#trackAllShapes").on("click", function() {
        if($("#trackAllShapes").val() == "Track"){
            _paq.push(['trackEvent', 'Tracker', 'Track All video', cvat.project.name])
        }
        else{
            _paq.push(['trackEvent', 'Tracker', 'Stop tracking', cvat.project.name])
        }
        

        if ($("#playButton:visible").length) {
            if ($(this).val() === "Track" && $(".playButton:visible").length) {
                $(".playButton:visible").trigger("click");
                $(this).val("Stop").html(" Stop Tracking ");
            } else if ($(".stopButton:visible").length) {
                $(".stopButton:visible").trigger("click");
                $(this).val("Track").html(" Track All Shapes ");
            }
        }
    });

    $('#saveButton').on('click', () => {
        saveAnnotation(shapeCollectionModel, playerModel, job);
        savePaintings(playerModel);
    });

    $('#saveButton').attr('title', `
        ${shortkeys['save_work'].view_value} - ${shortkeys['save_work'].description}`);

    // JS function cancelFullScreen don't work after pressing
    // and it is famous problem.
    $('#fullScreenButton').on('click', () => {
        $('#playerFrame').toggleFullScreen();
    });

    $('#playerFrame').on('fullscreenchange webkitfullscreenchange mozfullscreenchange', () => {
        playerModel.updateGeometry({
            width: $('#playerFrame').width(),
            height: $('#playerFrame').height(),
        });
        playerModel.fit();
    });

    $('#switchAAMButton').on('click', () => {
        hide();
        aamModel.switchAAMMode();
    });

    $('#switchAAMButton').attr('title', `
        ${shortkeys['switch_aam_mode'].view_value} - ${shortkeys['switch_aam_mode'].description}`);
}

// delay: the amount of time desired to lock the function in milliseconds
// func: the wanted function to lock
function throttled(delay, func) {
    let lastCall = 0;
    return function(...args) {
        const now = (new Date).getTime();
        if (now - lastCall < delay) {
            return;
        }
        lastCall = now;
        return func(...args);
    }
}

function drawBoxSize(scene, box) {
    let scale = window.cvat.player.geometry.scale;
    let width = +box.getAttribute('width');
    let height = +box.getAttribute('height');
    let text = `${width.toFixed(1)}x${height.toFixed(1)}`;
    let obj = this && this.textUI && this.rm ? this : {
        textUI: scene.text('').font({
            weight: 'bolder'
        }).fill('white'),

        rm: function() {
            if (this.textUI) {
                this.textUI.remove();
            }
        }
    };

    obj.textUI.clear().plain(text);

    obj.textUI.font({
        size: 20 / scale,
    }).style({
        stroke: 'black',
        'stroke-width': 1 / scale
    });

    obj.textUI.move(+box.getAttribute('x'), +box.getAttribute('y'));

    return obj;
}

function startTracking(shapeToTrack) {
    let shapesToTrack = {'shapes': []};
    let latestFrame = Object.keys(shapeToTrack._positions).map(x => +x).sort((a,b) => a - b).filter(x => x <= window.cvat.player.frames.current).slice(-1);
    $("#playerFrame").data("predictions")[shapeToTrack.id] = {};

    // Make sure that the shape given to the function is an interpolation box and it isn't hidden.
    // If the shape given is ok, push it into shapes to track in the wanted format.
    if (shapeToTrack.type == "interpolation_box" && !shapeToTrack._positions[latestFrame].outside) {
        shapesToTrack['shapes'].push({
            'positions': {
                'x': shapeToTrack._positions[latestFrame]["xtl"],
                'y': shapeToTrack._positions[latestFrame]["ytl"],
                'w': shapeToTrack._positions[latestFrame]["xbr"] - shapeToTrack._positions[latestFrame]["xtl"],
                'h': shapeToTrack._positions[latestFrame]["ybr"] - shapeToTrack._positions[latestFrame]["ytl"],
            },
            'id': shapeToTrack.id,
            'frame':window.cvat.player.frames.current
        });
        
        $.ajax({
            type: 'POST',
            url: 'track/task/' + window.cvat.job.taskId,
            data: JSON.stringify(shapesToTrack),
            contentType: "application/json; charset=utf-8",
            success: (data) => {
                $("#playerFrame").data("predictions")[Object.keys(data)[0]] = Object.values(data)[0];
            },
            error: (data) => {
                showMessage(`Can not change job status. Code: ${data.status}. Message: ${data.responeText || data.statusText}`);
            }
        });
    }
}

function stopTracking() {
    $.ajax({
        type: 'GET',
        url: 'stop/track/task/' + window.cvat.job.taskId,
        async: false,
        error: (data) => {
            showMessage(`Can not change job status. Code: ${data.status}. Message: ${data.responeText || data.statusText}`);
        }
    });
}

function uploadAnnotation(shapeCollectionModel, historyModel, annotationParser, uploadAnnotationButton) {
    $('#annotationFileSelector').one('change', (e) => {
        let file = e.target.files['0'];
        e.target.value = "";
        if (!file || file.type != 'text/xml') return;
        uploadAnnotationButton.text('Preparing..');
        uploadAnnotationButton.prop('disabled', true);
        let overlay = showOverlay("File is being uploaded..");

        let fileReader = new FileReader();
        fileReader.onload = function(e) {
            let data = null;

            let asyncParse = function() {
                try {
                    data = annotationParser.parse(e.target.result);
                }
                catch (err) {
                    overlay.remove();
                    showMessage(err.message);
                    return;
                }
                finally {
                    uploadAnnotationButton.text('Upload Annotation');
                    uploadAnnotationButton.prop('disabled', false);
                }

                let asyncImport = function() {
                    try {
                        historyModel.empty();
                        shapeCollectionModel.empty();
                        shapeCollectionModel.import(data, false);
                        shapeCollectionModel.update();
                    }
                    finally {
                        overlay.remove();
                    }
                };

                overlay.setMessage('Data are being imported..');
                setTimeout(asyncImport);
            };

            overlay.setMessage('File is being parsed..');
            setTimeout(asyncParse);
        };
        fileReader.readAsText(file);
    }).click();
}

function trimFramePropertiesJSON() {
    let finalJSON = {}

    // Go over each frame & property inside the json
    for (var frame in cvat.framePropertiesJSON) {
        for (var frameProperty in cvat.framePropertiesJSON[frame]) {
            var currObject = cvat.framePropertiesJSON[frame][frameProperty]

            // Only take the frames where the starting frame is true
            if ((currObject) && (currObject.isStartingFrame)) {
                if (!finalJSON[frame]) {
                    finalJSON[frame] = [currObject.propValId]
                } else {
                    finalJSON[frame].push(currObject.propValId)
                }
            }
        }
    }

    return (finalJSON);
}

function saveComments(tid, comments) {
    $.ajax({
        type: 'POST',
        url: `save/framecomments/task/${tid}`,
        data: JSON.stringify({
            "comments": comments
        }),
        contentType: "application/json; charset=utf-8",
        success: () => {
            // Check if any changes were made
            if (JSON.stringify(cvat.frameComments) !== JSON.stringify(cvat.originalFrameComments)) {
                serverRequest('/get/username', function(response) {
                    _paq.push(['trackEvent', 'Comments', 'Comments', 'Manager: ' + response.username])
                });
            }

            cvat.originalFrameComments = JSON.parse(JSON.stringify(cvat.frameComments));
        },
        error: (error) => {
            alert("Error saving comments: " + error.statusText);
        }
    });
}

// Returns a json with only frames which contain real values (not empty ones)
function cleanCommentsJson(comments) {
    var commentsToSave = {}

    Object.keys(comments).forEach((key) => {
        if (comments[key] != "") {
            commentsToSave[key] = comments[key];
        }
    })

    return commentsToSave;
}

function saveAnnotation(shapeCollectionModel, playerModel, job) {

    let saveButton = $('#saveButton');

    Logger.addEvent(Logger.EventType.saveJob);
    let totalStat = shapeCollectionModel.collectStatistic()[1];
    Logger.addEvent(Logger.EventType.sendTaskInfo, {
        'track count': totalStat.boxes.annotation + totalStat.boxes.interpolation +
            totalStat.polygons.annotation + totalStat.polygons.interpolation +
            totalStat.polylines.annotation + totalStat.polylines.interpolation +
            totalStat.points.annotation + totalStat.points.interpolation,
        'frame count': job.stop - job.start + 1,
        'object count': totalStat.total,
        'box count': totalStat.boxes.annotation + totalStat.boxes.interpolation,
        'polygon count': totalStat.polygons.annotation + totalStat.polygons.interpolation,
        'polyline count': totalStat.polylines.annotation + totalStat.polylines.interpolation,
        'points count': totalStat.points.annotation + totalStat.points.interpolation,
    });

    const exportedData = shapeCollectionModel.export();
    shapeCollectionModel.updateExportedState();
    const annotationLogs = Logger.getLogs();

    const data = {
        annotation: JSON.stringify(exportedData),
        frameProperties: JSON.stringify(trimFramePropertiesJSON()),
        taskid: cvat.job.taskId,
        logs: JSON.stringify(annotationLogs.export()),
    };

    saveButton.prop('disabled', true);
    saveButton.text('Saving..');

    var commentsToSave = cleanCommentsJson(cvat.frameComments)
    saveComments(cvat.job.taskId, commentsToSave);
    saveJobRequest(job.jobid, data, () => {
        // success
        shapeCollectionModel.confirmExportedState();
        saveButton.text('Success!');
        setTimeout(() => {
            saveButton.prop('disabled', false);
            saveButton.text('Save Work');
        }, 3000);
    }, (response) => {
        // error
        saveButton.prop('disabled', false);
        saveButton.text('Save Work');
        let message = `Impossible to save job. Errors was occured. Status: ${response.status}`;
        showMessage(message + ' ' + 'Please immediately report the problem to support team');
        throw Error(message);
    });
}

//  Loads previously made tags from either the previous frame or a specific one.
//  parameters:
//      - shapeCollectionModel: The collection of shapes currently made on the task.
//      - playerModel: The current video player model.
//      - chosenFrame(Optional): Holds either the frame that was selected to load from or nothing.
function loadPreviousFrameTags(shapeCollectionModel, playerModel, chosenFrame) {
    // Convert the chosen frame into int
    chosenFrame = Number.parseInt(chosenFrame);

    shapeCollectionModel._loadedFrames[playerModel.frames.current] += " " + chosenFrame.toString();
    
    // Get the entire list of annotation tags existing on the chosen frame.
    shapesList = shapeCollectionModel._annotationShapes[chosenFrame]
    
    // If the current frame is 0 (the first frame of the video) or the existing annotation tags in the chosenFrame
    // is undefined, exit the function and do nothing.
    if (playerModel.frames.current == 0 || shapesList === undefined) {
        return;
    }
    
    // Iterate over each shape in the list and add it to the wanted frame/s.
    shapesList.forEach(function(shape) {

        if (shape._removed) {
            return; // If the shape was removed stop processing the current shape.
        }

        shapeCollectionModel.add(shape, 'previousFrame', playerModel.frames.current);
    });

    let addUndoRedoFunctionality = function(shapeCollectionModel, frame, amountAdded) {
        // Gets the latest shape added and makes it possible to undo it.
        let models = shapeCollectionModel.shapes.slice(-amountAdded);
        
        // Undo/redo code
        window.cvat.addAction('Draw Object', () => {
            models.forEach(function(model) {
                model.removed = true;
                model.unsubscribe(shapeCollectionModel);
            });
            shapeCollectionModel._loadedFrames[playerModel.frames.current] =
            shapeCollectionModel._loadedFrames[playerModel.frames.current].replace(' ' + (chosenFrame.toString()), '');
            shapeCollectionModel.update();
        }, () => {
            models.forEach(function(model) {
                model.subscribe(shapeCollectionModel);
                model.removed = false;
            });
            shapeCollectionModel._loadedFrames[playerModel.frames.current] += ' ' + chosenFrame;
            shapeCollectionModel.update();
        }, frame);
        // End of undo/redo code
    }

    addUndoRedoFunctionality(shapeCollectionModel, playerModel.frames.current, shapesList.length);

    // Get the current frame of the video player.
    let frame = shapeCollectionModel._frame;
    // Refreshes the current video player so the user may see the changes he made.
    playerModel.shift(window.cvat.search.get('frame') || frame - 1, true);
    playerModel.shift(window.cvat.search.get('frame') || frame, true);
}

function blurAllElements() {
    document.activeElement.blur();
}
