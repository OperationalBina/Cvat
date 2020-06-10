/*
 * Copyright (C) 2018 Intel Corporation
 *
 * SPDX-License-Identifier: MIT
 */

/* exported PlayerModel PlayerController PlayerView */
"use strict";

class FrameProvider extends Listener {
    constructor(stop, tid) {
        super('onFrameLoad', () => this._loaded);
        this._MAX_LOAD = 2000;
        this._FRAME_BUFFER = 250;

        this._stack = [];
        this._loadInterval = null;
        this._required = null;
        this._loaded = null;
        this._loadAllowed = true;
        this._preloadRunned = false;
        this._loadCounter = this._MAX_LOAD;
        this._frameCollection = {};
        this._stop = stop;
        this._tid = tid;
    }

    require(frame) {
        if (frame in this._frameCollection) {
            this._preload(frame);
            return this._frameCollection[frame];
        }
        this._required = frame;
        this._loadCounter = this._MAX_LOAD;
        this._load();
        return null;
    }

    _getLatestLodedFrame(frame) {
        let lastLodedFrame = frame;
        let frameCollection = Object.keys(this._frameCollection).map(x => parseInt(x)).filter(x => x >= lastLodedFrame).sort(function(x, y) { return x - y; });
        for (let key = 0; key < frameCollection.length - 1; key++) {
            if (frameCollection[key] + 1 < frameCollection[key + 1]) {
                lastLodedFrame = frameCollection[key];
                break;
            }
            lastLodedFrame = frameCollection[key + 1];
        }

        return lastLodedFrame;
    }

    _onImageLoad(image, frame) {
        let next = frame + 1;
        if (next <= this._stop && this._loadCounter > 0) {
            this._stack.push(next);
        }
        this._loadCounter--;
        this._loaded = frame;
        this._frameCollection[frame] = image;
        let lodedFrame = this._getLatestLodedFrame(frame);
        $("#progress").css('width', ((lodedFrame / this._stop) * 100) + "%");
        this._loadAllowed = true;
        image.onload = null;
        image.onerror = null;
        this.notify();
    }

    _preload(frame) {
        if (this._preloadRunned) {
            return;
        }

        let last = Math.min(this._stop, frame + Math.ceil(this._FRAME_BUFFER));
        if (!(last in this._frameCollection)) {
            for (let idx = frame + 1; idx <= last; idx ++) {
                if (!(idx in this._frameCollection)) {
                    this._loadCounter = this._MAX_LOAD - (idx - frame);
                    this._stack.push(idx);
                    this._preloadRunned = true;
                    this._load();
                    return;
                }
            }
        }
    }

    _load() {
        if (!this._loadInterval) {
            this._loadInterval = setInterval(function() {
                if (!this._loadAllowed) {
                    return;
                }

                if (this._loadCounter <= 0) {
                    this._stack = [];
                }

                if (!this._stack.length && this._required == null) {
                    clearInterval(this._loadInterval);
                    this._preloadRunned = false;
                    this._loadInterval = null;
                    return;
                }

                if (this._required != null) {
                    this._stack.push(this._required);
                    this._required = null;
                }

                let frame = this._stack.pop();
                if (frame in this._frameCollection) {
                    this._loadCounter--;
                    let next = frame + 1;
                    if (next <= this._stop && this._loadCounter > 0) {
                        this._stack.push(frame + 1);
                    }
                    return;
                }

                // If load up to last frame, no need to load previous frames from stack
                if (frame === this._stop) {
                    this._stack = [];
                }

                this._loadAllowed = false;
                let image = new Image();
                image.onload = this._onImageLoad.bind(this, image, frame);
                image.onerror = () => {
                    image.onerror = null;
                    image.onload = null;
                    this._loadAllowed = true;
                };
                image.src = `get/task/${this._tid}/frame/${frame}`;
            }.bind(this), 25);
        }
    }
}


const MAX_PLAYER_SCALE = 10;
const MIN_PLAYER_SCALE = 0.1;
const CLEAR = "clear";

class PlayerModel extends Listener {
    constructor(job, playerSize) {
        super('onPlayerUpdate', () => this);

        this.offsetX = 0;
        this.offsetY = 0;
        this.currX = 0;
        this.currY = 0;
        this.labelTypeId = undefined;
        this.labelId = undefined;
        this.isPainting = false;
        this.paintings = [];
        this.currPainting = {}
        this.redoStack=[];
        this.changes = 0;
        this.context = document.getElementById('paintingCanvas').getContext('2d');
        this.cursorContext = document.getElementById('cursorCanvas').getContext('2d');
        this.context.lineJoin = "round"
        this.context.lineWidth = 40;
        this.cursorContext.lineJoin = this.context.lineJoin;
        this.cursorContext.lineWidth = this.context.lineWidth;
        this.brushColor = undefined;
        this.tool = $('.selectedTool')[0].id;

        this._frame = {
            start: job.start,
            stop: job.stop,
            current: job.current,
            previous: null
        };

        this._settings = {
            multipleStep: 10,
            fps: 12,
            resetZoom: job.mode === 'annotation'
        };

        this._playInterval = null;
        this._pauseFlag = null;
        this._frameProvider = new FrameProvider(this._frame.stop, job.taskid);
        this._continueAfterLoad = false;
        this._continueTimeout = null;

        this._geometry = {
            scale: 1,
            left: 0,
            top: 0,
            width: playerSize.width,
            height: playerSize.height,
            frameOffset: 0,
        };

        this._geometry.frameOffset = Math.floor(Math.max(
            (playerSize.height - MIN_PLAYER_SCALE) / MIN_PLAYER_SCALE,
            (playerSize.width - MIN_PLAYER_SCALE) / MIN_PLAYER_SCALE
        ));
        window.cvat.translate.playerOffset = this._geometry.frameOffset;

        this._frameProvider.subscribe(this);
    }

    get frames() {
        return {
            start: this._frame.start,
            stop: this._frame.stop,
            current: this._frame.current,
            previous: this._frame.previous
        };
    }

    get geometry() {
        return Object.assign({}, this._geometry);
    }

    get playing() {
        return this._playInterval != null;
    }

    get image() {
        return this._frameProvider.require(this._frame.current);
    }

    get resetZoom() {
        return this._settings.resetZoom;
    }

    get multipleStep() {
        return this._settings.multipleStep;
    }

    set fps(value) {
        this._settings.fps = value;
    }

    set multipleStep(value) {
        this._settings.multipleStep = value;
    }

    set resetZoom(value) {
        this._settings.resetZoom = value;
    }

    ready() {
        return this._frame.previous === this._frame.current;
    }

    onFrameLoad(last) {  // callback for FrameProvider instance
        if (last === this._frame.current) {
            if (this._continueTimeout) {
                clearTimeout(this._continueTimeout);
                this._continueTimeout = null;
            }

            // If need continue playing after load, set timeout for additional frame download
            if (this._continueAfterLoad) {
                this._continueTimeout = setTimeout(function() {
                    // If you still need to play, start it
                    this._continueTimeout = null;
                    if (this._continueAfterLoad) {
                        this._continueAfterLoad = false;
                        this.play();
                    }   // Else update the frame
                    else {
                        this.shift(0);
                    }
                }.bind(this), 5000);
            }
            else {  // Just update frame if no need to play
                this.shift(0);
            }
        }
    }

    play() {
        this._pauseFlag = false;
        this._playInterval = setInterval(function() {
            if (this._pauseFlag) {      // pause method without notify (for frame downloading)
                if (this._playInterval) {
                    clearInterval(this._playInterval);
                    this._playInterval = null;
                }
                return;
            }

            let skip = Math.max( Math.floor(this._settings.fps / 25), 1 );
            if (!this.shift(skip)) this.pause();   // if not changed, pause
        }.bind(this), 1000 / this._settings.fps);
    }

    pause() {
        if (this._playInterval) {
            clearInterval(this._playInterval);
            this._playInterval = null;
            this._pauseFlag = true;
            this.notify();
        }
    }

    updateGeometry(geometry) {
        this._geometry.width = geometry.width;
        this._geometry.height = geometry.height;
    }

    
    // Returns the previous frame with comments, -1 if not found.
    getPrevCommentedFrame() {
        let currFrame = this.frames.current;

        // Go from previous frame until the beginning
        for (var frame = currFrame - 1; frame >= 0; frame--) {
            if (cvat.frameComments[frame] != "") {
                return frame;
            }
        }

        return -1
    }

    // Returns the next frame with comments, -1 if not found.
    getNextCommentedFrame() {
        let currFrame = this.frames.current;
        let maxFrames = this.frames.stop;

        // Go from next frame until the end
        for (var frame = currFrame + 1; frame <= maxFrames; frame++) {
            if (cvat.frameComments[frame] != "") {
                return frame;
            }
        }

        return -1
    }

    shift(delta, absolute) {
        if (['resize', 'drag'].indexOf(window.cvat.mode) != -1) {
            return false;
        }

        this._continueAfterLoad = false;  // default reset continue
        this._frame.current = Math.clamp(
            absolute ? delta : this._frame.current + delta,
            this._frame.start,
            this._frame.stop
        );
        let frame = this._frameProvider.require(this._frame.current);
        if (!frame) {
            this._continueAfterLoad = this.playing;
            this._pauseFlag = true;
            this.notify();
            return false;
        }

        window.cvat.player.frames.current = this._frame.current;
        window.cvat.player.geometry.frameWidth = frame.width;
        window.cvat.player.geometry.frameHeight = frame.height;
        this.updatePropValuesUI();

        Logger.addEvent(Logger.EventType.changeFrame, {
            from: this._frame.previous,
            to: this._frame.current,
        });
        
        let changed = this._frame.previous != this._frame.current;
        if (this._settings.resetZoom || this._frame.previous === null) {  // fit in annotation mode or once in interpolation mode
            this._frame.previous = this._frame.current;
            this.fit();     // notify() inside the fit()
        }
        else {
            this._frame.previous = this._frame.current;
            this.notify();
        }

        window.addEvent

        // Update the comment textbox
        $("#commentTextArea").val(cvat.frameComments[this._frame.current]);

        let textareaContainer = $("#commentTooltipTextArea")

        // Show the comments textarea when reaching a frame with comments
        if (cvat.frameComments[this._frame.current] != "") {
            if (!textareaContainer.hasClass("commentAreaOpen")) {
                textareaContainer.addClass("commentAreaOpen");
            }
        } else {//if (!window.cvat.isStaff) {
            // If annotator (not staff), hide the comments textarea as it is useless if no comment is present
            textareaContainer.removeClass("commentAreaOpen");
        }

        // Disable the previous & next comment buttons if there are no further comments
        var prevFrameExists = this.getPrevCommentedFrame() != -1;
        var nextFrameExists = this.getNextCommentedFrame() != -1;
        $("#prevCommentButton").toggleClass("disabledPlayerButton", !prevFrameExists)
        $("#nextCommentButton").toggleClass("disabledPlayerButton", !nextFrameExists)

        if($("#menuHeader").html() == "Segmentation"){
            $.ajax({
                url: 'segmentation/frame/task/' + window.cvat.job.taskId + '/frame/' + window.cvat.player.frames.current,
                type: 'PUT',
                async: false
            });
        }

        return changed;
    }

    // Update the radio button for each property's value via the selected json under cvat.framePropertiesJSON
    updatePropValuesUI() {
        var propertiesDiv = $("#framePropsContent").children()
        // For each property:
        for (var divIndex = 0; divIndex < propertiesDiv.length; divIndex++) {
            var propertyForm = propertiesDiv[divIndex].children[1]
            var currFrameJSON = cvat.framePropertiesJSON[this._frame.current]

            // Checks there is a value existing for the current property
            if (currFrameJSON[propertyForm.id].propValId) {
                for (var valueIndex = 0; valueIndex < propertyForm.length; valueIndex++) {
                    // Find the matching value between the JSON and the actual form & select it.
                    if (propertyForm[valueIndex].value == currFrameJSON[propertyForm.id].propValId) {
                        $(propertyForm[valueIndex]).prop("checked", true)
                    }
                }
            } else { // No value was selected at this frame, deselect the radio button.
                $('input:radio:checked', propertyForm).prop("checked", false)
            }
        }
    }

    fit() {
        let img = this._frameProvider.require(this._frame.current);
        if (!img) return;
        this._geometry.scale = Math.min(this._geometry.width / img.width, this._geometry.height / img.height);
        this._geometry.top = (this._geometry.height - img.height * this._geometry.scale) / 2;
        this._geometry.left = (this._geometry.width - img.width * this._geometry.scale ) / 2;

        window.cvat.player.geometry.scale = this._geometry.scale;
        this.notify();
    }

    focus(xtl, xbr, ytl, ybr) {
        let img = this._frameProvider.require(this._frame.current);
        if (!img) return;
        let fittedScale = Math.min(this._geometry.width / img.width, this._geometry.height / img.height);

        let boxWidth = xbr - xtl;
        let boxHeight = ybr - ytl;
        let wScale = this._geometry.width / boxWidth;
        let hScale = this._geometry.height / boxHeight;
        this._geometry.scale = Math.min(wScale, hScale);
        this._geometry.scale = Math.min(this._geometry.scale, MAX_PLAYER_SCALE);
        this._geometry.scale = Math.max(this._geometry.scale, MIN_PLAYER_SCALE);

        if (this._geometry.scale < fittedScale) {
            this._geometry.scale = fittedScale;
            this._geometry.top = (this._geometry.height - img.height * this._geometry.scale) / 2;
            this._geometry.left = (this._geometry.width - img.width * this._geometry.scale ) / 2;
        }
        else {
            this._geometry.left = (this._geometry.width / this._geometry.scale - xtl * 2 - boxWidth) * this._geometry.scale / 2;
            this._geometry.top = (this._geometry.height / this._geometry.scale - ytl * 2 - boxHeight) * this._geometry.scale / 2;
        }
        window.cvat.player.geometry.scale = this._geometry.scale;
        this._frame.previous = this._frame.current;     // fix infinite loop via playerUpdate->collectionUpdate*->AAMUpdate->playerUpdate->...
        this.notify();

    }

    scale(x, y, value) {
        if (!this._frameProvider.require(this._frame.current)) return;

        let currentCenter = {
            x: (x - this._geometry.left) / this._geometry.scale,
            y: (y - this._geometry.top) / this._geometry.scale
        };

        this._geometry.scale = value > 0 ? this._geometry.scale * 6/5 : this._geometry.scale * 5/6;
        this._geometry.scale = Math.min(this._geometry.scale, MAX_PLAYER_SCALE);
        this._geometry.scale = Math.max(this._geometry.scale, MIN_PLAYER_SCALE);

        let newCenter = {
            x: (x - this._geometry.left) / this._geometry.scale,
            y: (y - this._geometry.top) / this._geometry.scale
        };

        this._geometry.left += (newCenter.x - currentCenter.x) * this._geometry.scale;
        this._geometry.top += (newCenter.y - currentCenter.y) * this._geometry.scale;

        window.cvat.player.geometry.scale = this._geometry.scale;
        this.notify();
    }

    move(topOffset, leftOffset) {
        this._geometry.top += topOffset;
        this._geometry.left += leftOffset;
        this.notify();
    }

    changeBrushColor(color) {
        this.brushColor = color;
    }

    changeColor(color) {
        this.context.strokeStyle = color;
        this.context.fillStyle = color;
        this.cursorContext.fillStyle = color;
    }

    setLabelTypeId(labelTypeId) {
        this.labelTypeId = labelTypeId;
    }

    setLabelId(labelId) {
        this.labelId = labelId;
    }


    refreshPaintingCursor(e) {
        this.removePaintingCursor();
        this.cursorContext.beginPath();        
        this.cursorContext.arc((e.pageX-this.offsetX)/this._geometry.scale, (e.pageY-this.offsetY)/this._geometry.scale, this.cursorContext.lineWidth/2, 0, Math.PI*2, true);
        this.cursorContext.fill();
    }

    removePaintingCursor() {
        this.cursorContext.clearRect(0, 0, this.cursorContext.canvas.width, this.cursorContext.canvas.height);
    }

    clearCanvas() {
        this.context.clearRect(0, 0, this.context.canvas.width, this.context.canvas.height);
    }
    
    getStartPaintingIndex() {
        let startPaintingIndex = 0;
        for (let i = this.paintings.length - 1; i >= 0; i--) {
            if (this.paintings[i] == CLEAR) {
                startPaintingIndex = i + 1;
                break;
            }
        }

        return startPaintingIndex;
    }

    repaint() {
        let currlineWidth = this.cursorContext.lineWidth;
        let currColor = this.cursorContext.fillStyle;
        let currTool = this.context.globalCompositeOperation;
        
        this.clearCanvas();

        let startPaintingIndex = this.getStartPaintingIndex();

        for (let i = startPaintingIndex; i < this.paintings.length; i++) {
            let painting = this.paintings[i];

            // In older versions, there was not 'tool' for a painting. Tool was added when adding an eraser. 
            // Therefore, we check if the tool is eraser and don't check if it is a brush.
            this.context.globalCompositeOperation = 
                painting.tool == 'eraser' ? 'destination-out' : 'source-over';

            this.context.lineWidth = painting.width;
            this.context.strokeStyle = painting.color;
            this.context.fillStyle = painting.color;
            this.cursorContext.lineWidth = painting.width;
            this.cursorContext.fillStyle = painting.color;

            this.context.beginPath();

            let points = painting.points;
            
            if(painting.points.length == 1 ||
               (painting.points.length == 2 && points[0].x == points[1].x && points[0].y == points[1].y)) { // Rare case  
                this.context.arc(points[0].x, points[0].y, painting.width/2, 0, Math.PI*2, true);
                this.context.fill();
            } else {
                for (let i=1; i < points.length; i++) {
                    this.context.moveTo(points[i-1].x, points[i-1].y);
                    this.context.lineTo(points[i].x, points[i].y);
                    this.context.closePath();   
                }
                
                this.context.stroke();
            }
        }

        this.context.lineWidth = currlineWidth;
        this.context.strokeStyle = currColor;
        this.context.fillStyle = currColor;
        this.cursorContext.lineWidth = currlineWidth;
        this.cursorContext.fillStyle = currColor;
        this.context.globalCompositeOperation = currTool;
    }

    disableClear() {
        let disableClear = false;

        if (this.paintings.length == 0) {
            disableClear = true;
        } else {
            let lastPainting = this.paintings.pop();
            if (lastPainting == CLEAR) {
                disableClear = true;
            }
            this.paintings.push(lastPainting);
        }
    
        return disableClear;
    }

    getDisableURC(disableUndo, disableRedo, disableClear) {
        return {undo: disableUndo, redo: disableRedo, clear: disableClear};
    }

    setNewChanges() {
        if (this.changes < 0) {
            this.changes = 1;
        } else {
            this.changes++;
        }
    }

    canvasZoom(e) {
        let speed =  Math.max(1, Math.round(2 / this._geometry.scale));

        if(!this.isPainting) {
            if(e.originalEvent.deltaY < 0 && this.cursorContext.lineWidth < 1000) {
                this.context.lineWidth += speed;
                this.cursorContext.lineWidth += speed;
            } else if (e.originalEvent.deltaY > 0 && this.cursorContext.lineWidth > 1) {
                let width = Math.max(1, this.context.lineWidth - speed);
                this.context.lineWidth = width;
                this.cursorContext.lineWidth = width;
            }
        
            this.refreshPaintingCursor(e);
        }
    }

    canvasDown(e) {
        this.context.beginPath();
        this.currX=(e.pageX-this.offsetX)/this._geometry.scale;
        this.currY=(e.pageY-this.offsetY)/this._geometry.scale;

        this.currPainting = {};
        this.currPainting.points = [];
        this.currPainting.points.push({x: this.currX,y: this.currY});
        this.currPainting.labelTypeId = this.labelTypeId;
        this.currPainting.labelId = this.labelId;
        this.currPainting.color = this.cursorContext.fillStyle;
        this.currPainting.width = this.cursorContext.lineWidth;
        this.currPainting.tool = this.tool;

        this.context.moveTo(this.currX,this.currY);
        this.isPainting = true
    }
    
    canvasMove(e) {
        if (this.isPainting) {
            let currX = (e.pageX-this.offsetX)/this._geometry.scale;
            let currY = (e.pageY-this.offsetY)/this._geometry.scale;

            // Sometimes when clicking (mousedown and mouseup), mousemove is also triggered. So, we prevent its action
            if (this.currX != currX || this.currY != currY) {
                this.context.moveTo(this.currX, this.currY);
                this.currX = currX;
                this.currY = currY;
                this.currPainting.points.push({x: this.currX, y: this.currY});
                this.context.lineTo(this.currX, this.currY);
                this.context.closePath();
                this.context.stroke();
            }
        }
        
        this.refreshPaintingCursor(e);
    }

    canvasUp(e) {
        if(this.isPainting) {
            if (this.currX==(e.pageX-this.offsetX)/this._geometry.scale && this.currY==(e.pageY-this.offsetY)/this._geometry.scale) {
                this.context.arc((e.pageX-this.offsetX)/this._geometry.scale, (e.pageY-this.offsetY)/this._geometry.scale, this.cursorContext.lineWidth/2, 0, Math.PI*2, true);
                this.context.fill();
            } else {
                this.context.stroke();
            }
            
            this.setNewChanges();
            this.isPainting = false;
            this.paintings.push(this.currPainting);
            this.redoStack = [];
            return this.getDisableURC(false, true, false);
        }

        return null;
    }

    canvasLeave(e) {
        this.removePaintingCursor();

        if(this.isPainting) {
            this.setNewChanges();
            this.isPainting = false;
            this.paintings.push(this.currPainting);
            this.redoStack = [];
            return this.getDisableURC(false, true, false);
        }

        return null;
    }

    undo() {
        this.changes--;
        this.redoStack.push(this.paintings.pop());
        this.repaint();
        return this.getDisableURC(this.paintings.length == 0, false, this.disableClear());
    }

    redo() {
        this.changes++;
        this.paintings.push(this.redoStack.pop());
        this.repaint();
        return this.getDisableURC(false, this.redoStack.length == 0, this.disableClear());
    }

    clear() {
        this.setNewChanges()
        this.clearCanvas();
        this.paintings.push(CLEAR);
        this.redoStack = [];
        return this.getDisableURC(false, true, true);
    }

    getCorrectPaintings() {
        let currPaintings = [];
        let startPaintingIndex = this.getStartPaintingIndex();

        for (let i=startPaintingIndex; i < this.paintings.length; i++) {
            let fixedPainting = JSON.parse(JSON.stringify(this.paintings[i]));
            fixedPainting.points = fixedPainting.points.map(point => 
                { 
                    return {x: Math.max(Math.round(point.x),0),
                          y: Math.max(Math.round(point.y),0)} 
                });
            currPaintings.push(fixedPainting);
        }

        return currPaintings;
    }

    getPaintings() {
        return this.paintings.slice(this.getStartPaintingIndex(), this.paintings.length);
    }

    isCanvasCleared() {
        return this.paintings == [] || this.paintings[this.paintings.length-1] == CLEAR;
    }

    hasChanges() {
        /* change > 0 when making new changes (adding paintings or clearing),
           change < 0 when deleting old paintings */
        return this.changes != 0;
    }

    setTool(tool) {
        this.tool = tool;

        if (tool == 'brush') {
            this.context.globalCompositeOperation = 'source-over';
            this.changeColor(this.brushColor);
        } else { // tool == 'eraser'
            this.context.globalCompositeOperation = 'destination-out';
            this.changeColor('#ffffff');
        }
    }
}

class PlayerController {
    constructor(playerModel, activeTrack, find, playerOffset) {
        this._model = playerModel;
        this._find = find;
        this._rewinding = false;
        this._moving = false;
        this._leftOffset = playerOffset.left;
        this._topOffset = playerOffset.top;
        this._lastClickX = 0;
        this._lastClickY = 0;
        this._moveFrameEvent = null;
        this._events = {
            jump: null,
            move: null,
        };

        setupPlayerShortcuts.call(this, playerModel);

        function shouldKeysBeEnabled() {
            // Whenever you want to enable keyboard shortcuts, add another OR condition to the following 'if' statement.
            let textareaContainer = $("#commentTooltipTextArea")

            // If one condition applies, keys will be ENABLED for that action.
            // Conditions: 1. Text is disabled (which means its annotator)
            //             2. Text area is closed
            return ((!cvat.isStaff) || (!textareaContainer.hasClass("commentAreaOpen"))) ? true : false
        }

        this.shouldKeysBeEnabled = shouldKeysBeEnabled;

        function setupPlayerShortcuts(playerModel) {
            let nextHandler = Logger.shortkeyLogDecorator(function(e) {
                if (shouldKeysBeEnabled()) {
                    this.next();
                    e.preventDefault();
                }
            }.bind(this));

            let prevHandler = Logger.shortkeyLogDecorator(function(e) {
                if (shouldKeysBeEnabled()) {
                    this.previous();
                    e.preventDefault();
                }
            }.bind(this));

            let nextKeyFrameHandler = Logger.shortkeyLogDecorator(function() {
                if (shouldKeysBeEnabled()) {
                    let active = activeTrack();
                    if (active && active.type.split('_')[0] === 'interpolation') {
                        let nextKeyFrame = active.nextKeyFrame();
                        if (nextKeyFrame != null) {
                            this._model.shift(nextKeyFrame, true);
                        }
                    }
                }
            }.bind(this));

            let prevKeyFrameHandler = Logger.shortkeyLogDecorator(function() {
                if (shouldKeysBeEnabled()) {
                    let active = activeTrack();
                    if (active && active.type.split('_')[0] === 'interpolation') {
                        let prevKeyFrame = active.prevKeyFrame();
                        if (prevKeyFrame != null) {
                            this._model.shift(prevKeyFrame, true);
                        }
                    }
                }
            }.bind(this));


            let nextFilterFrameHandler = Logger.shortkeyLogDecorator(function(e) {
                if (shouldKeysBeEnabled()) {
                    let frame = this._find(1);
                    if (frame != null) {
                        this._model.shift(frame, true);
                    }
                    e.preventDefault();
                }
            }.bind(this));

            let prevFilterFrameHandler = Logger.shortkeyLogDecorator(function(e) {
                if (shouldKeysBeEnabled()) {
                    let frame = this._find(-1);
                    if (frame != null) {
                        this._model.shift(frame, true);
                    }
                    e.preventDefault();
                }
            }.bind(this));

            let forwardHandler = Logger.shortkeyLogDecorator(function() {
                if (shouldKeysBeEnabled()) {
                    this.forward();
                }
            }.bind(this));

            let backwardHandler = Logger.shortkeyLogDecorator(function() {
                if (shouldKeysBeEnabled()) {
                    this.backward();
                }
            }.bind(this));

            let playPauseHandler = Logger.shortkeyLogDecorator(function() {
                if (shouldKeysBeEnabled()) {
                    if (playerModel.playing) {
                        this.pause();
                    }
                    else {
                        this.play();
                    }
                    return false;
                }
            }.bind(this));

            let shortkeys = window.cvat.config.shortkeys;

            Mousetrap.bind(shortkeys["next_frame"].value, nextHandler, 'keydown');
            Mousetrap.bind(shortkeys["prev_frame"].value, prevHandler, 'keydown');
            Mousetrap.bind(shortkeys["next_filter_frame"].value, nextFilterFrameHandler, 'keydown');
            Mousetrap.bind(shortkeys["prev_filter_frame"].value, prevFilterFrameHandler, 'keydown');
            Mousetrap.bind(shortkeys["next_key_frame"].value, nextKeyFrameHandler, 'keydown');
            Mousetrap.bind(shortkeys["prev_key_frame"].value, prevKeyFrameHandler, 'keydown');
            Mousetrap.bind(shortkeys["forward_frame"].value, forwardHandler, 'keydown');
            Mousetrap.bind(shortkeys["backward_frame"].value, backwardHandler, 'keydown');
            Mousetrap.bind(shortkeys["play_pause"].value, playPauseHandler, 'keydown');
        }
    }

    zoom(e) {
        let x = e.originalEvent.pageX - this._leftOffset;
        let y = e.originalEvent.pageY - this._topOffset;

        let zoomImageEvent = Logger.addContinuedEvent(Logger.EventType.zoomImage);
        if (e.originalEvent.deltaY < 0) {
            this._model.scale(x, y, 1);
        }
        else {
            this._model.scale(x, y, -1);
        }
        zoomImageEvent.close();
        e.preventDefault();
    }

    fit() {
        this._model.fit();
    }

    frameMouseDown(e) {
        if ((e.which === 1 && !window.cvat.mode) || (e.which === 2)) {
            this._moving = true;
            this._lastClickX = e.clientX;
            this._lastClickY = e.clientY;
        }
    }

    frameMouseUp() {
        this._moving = false;
        if (this._events.move) {
            this._events.move.close();
            this._events.move = null;
        }
    }

    frameMouseMove(e) {
        if (this._moving) {
            if (!this._events.move) {
                this._events.move = Logger.addContinuedEvent(Logger.EventType.moveImage);
            }

            let topOffset = e.clientY - this._lastClickY;
            let leftOffset = e.clientX - this._lastClickX;
            this._lastClickX = e.clientX;
            this._lastClickY = e.clientY;

            this._model.move(topOffset, leftOffset);
        }
    }

    progressMouseDown(e) {
        this._rewinding = true;
        this._rewind(e);
    }

    progressMouseUp() {
        this._rewinding = false;
        if (this._events.jump) {
            this._events.jump.close();
            this._events.jump = null;
        }
    }

    progressMouseMove(e) {
        this._rewind(e);
    }

    _rewind(e) {
        if (this._rewinding) {
            if (!this._events.jump) {
                this._events.jump = Logger.addContinuedEvent(Logger.EventType.jumpFrame);
            }

            let frames = this._model.frames;
            let progressWidth = e.target.clientWidth;
            let x = e.clientX + window.pageXOffset - e.target.offsetLeft;
            let percent = x / progressWidth;
            let targetFrame = Math.round((frames.stop - frames.start) * percent);
            this._model.pause();
            this._model.shift(targetFrame + frames.start, true);
        }
    }

    changeStep(e) {
        let value = Math.clamp(+e.target.value, +e.target.min, +e.target.max);
        e.target.value = value;
        this._model.multipleStep = value;
    }

    changeFPS(e) {
        let fpsMap = {
            1: 1,
            2: 5,
            3: 12,
            4: 25,
            5: 50,
            6: 100,
        };
        let value = Math.clamp(+e.target.value, 1, 6);
        this._model.fps = fpsMap[value];
    }

    changeResetZoom(e) {
        this._model.resetZoom = e.target.checked;
    }

    play() {
        this._model.play();
    }

    pause() {
        this._model.pause();
    }

    next() {
        this._model.shift(1);
        this._model.pause();
    }

    previous() {
        this._model.shift(-1);
        this._model.pause();
    }

    first() {
        this._model.shift(this._model.frames.start, true);
        this._model.pause();
    }

    last() {
        this._model.shift(this._model.frames.stop, true);
        this._model.pause();
    }

    forward() {
        this._model.shift(this._model.multipleStep);
        this._model.pause();
    }

    backward() {
        this._model.shift(-this._model.multipleStep);
        this._model.pause();
    }

    seek(frame) {
        this._model.shift(frame, true);
    }

    changeBrushColor(color) {
        this._model.changeBrushColor(color);
    }

    setLabelTypeId(labelTypeId) {
        this._model.setLabelTypeId(labelTypeId);
    }
    
    setLabelId(labelId) {
        this._model.setLabelId(labelId);
    }

    canvasZoom(e) {
        this._model.canvasZoom(e);
    }

    canvasDown(e) {
        this._model.canvasDown(e);
    }
    
    canvasMove(e) {
        this._model.canvasMove(e);
    }

    canvasUp(e) {
        return this._model.canvasUp(e);
    }

    canvasLeave(e) {
        return this._model.canvasLeave(e);
    }

    undo() {
        return this._model.undo();
    }

    redo() {
        return this._model.redo();
    }

    clear() {
        return this._model.clear();
    }

    watershed() {
        this._model.watershed();
    }

    isCanvasCleared() {
        return this._model.isCanvasCleared();
    }

    hasChanges() {
        return this._model.hasChanges();
    }

    setTool(tool) {
        this._model.setTool(tool);
    }
}

class PlayerView {
    constructor(playerModel, playerController) {
        this._controller = playerController;
        this._playerUI = $('#playerFrame');
        this._playerBackgroundUI = $('#frameBackground');
        this._frameWatershed = $('#frameWatershed');
        this._playerContentUI = $('#frameContent');
        this._playerGridUI = $('#frameGrid');
        this._progressUI = $('#playerProgress');
        this._loadingUI = $('#frameLoadingAnim');
        this._playButtonUI = $('#playButton');
        this._pauseButtonUI = $('#pauseButton');
        this._nextButtonUI = $('#nextButton');
        this._prevButtonUI = $('#prevButton');
        this._multipleNextButtonUI = $('#multipleNextButton');
        this._multiplePrevButtonUI = $('#multiplePrevButton');
        this._firstButtonUI = $('#firstButton');
        this._lastButtonUI = $('#lastButton');
        this._playerStepUI = $('#playerStep');
        this._playerSpeedUI = $('#speedSelect');
        this._resetZoomUI = $('#resetZoomBox');
        this._frameNumber = $('#frameNumber');
        this._totalFrames = $("#totalFramesLabel")
        this._playerGridPattern = $('#playerGridPattern');
        this._playerGridPath = $('#playerGridPath');
        this._contextMenuUI = $('#playerContextMenu');
        this._paintingCanvas = $('#paintingCanvas');
        this._cursorCanvas = $('#cursorCanvas');
        this._undoBtn = $('#undoCanvas');
        this._redoBtn = $('#redoCanvas');
        this._clearBtn = $('#clearCanvas');
        this._sidePanelSegmentationBtn = $('#sidePanelSegmentationButton');
        this._commentBtn = $("#commentButton");
        this._commentTextArea = $("#commentTextArea");
        this._prevCommentButton = $("#prevCommentButton")
        this._nextCommentButton = $("#nextCommentButton")
        this._showCanvasCheckbox = $('#showCanvasCheckbox')
        this._showWatershedCheckbox = $('#showWatershedCheckbox')
        this._watershedBtn = $('#watershed')
        this._loadSpecificFrameTags = $('#loadSpecificFrameTags');
        this._pointerMode = $('#pointerMode');

        this._tmpSelectedTool = undefined;

        $('*').on('mouseup.player', () => this._controller.frameMouseUp());
        $('#painterContainer').on('mousedown', (e) => {
            if (this._controller.shouldKeysBeEnabled()) {
                let pos = window.cvat.translate.point.clientToCanvas(this._playerBackgroundUI[0], e.clientX, e.clientY);
                let frameWidth = window.cvat.player.geometry.frameWidth;
                let frameHeight = window.cvat.player.geometry.frameHeight;
                if (pos.x >= 0 && pos.y >= 0 && pos.x <= frameWidth && pos.y <= frameHeight) {
                    this._controller.frameMouseDown(e);
                }
                e.preventDefault();
            }
        });

        let showAndRefreshCanvas = () => {
            $('#paintingCanvas').removeClass('hidden');
    
            let choseColor = $('div.color-picker.selected-color').length == 1;
            let tool = $('.selectedTool')[0].id;

            if ((tool == 'brush' && choseColor) || tool == 'eraser') {
                $('#cursorCanvas').removeClass('hidden');
            } else {
                $('#cursorCanvas').addClass('hidden');
            }
        }

        let hideCanvas = () => {
            $('#paintingCanvas').addClass('hidden');
            $('#cursorCanvas').addClass('hidden');
        }

        $(document).on('click', '#showCanvasCheckbox', e => {
            if (e.target.checked) {
                showAndRefreshCanvas();
            } else {
                hideCanvas();
            }
        });
        
        $(document).on('click', '#showWatershedCheckbox', e => {
            if (e.target.checked) {
                $('#frameWatershed').removeClass('hidden');
            } else {
                $('#frameWatershed').addClass('hidden');
            }
        });

        $(document).on('click', 'div.color-picker', e => {
            $('.selected-color').removeClass('selected-color');
            $(e.target).addClass('selected-color');
            let color = $(e.target).data('color');
            let labelTypeId = $(e.target).data('typeid');
            let labelId = $(e.target).data('labelid');

            this._controller.changeBrushColor(color);
            this._controller.setLabelTypeId(labelTypeId);
            this._controller.setLabelId(labelId);

            if ($('#brush').hasClass('nonSelectedTool')) {
                $('#brush').click();
            } else {
                this._controller.setTool("brush");
            }

            if ($('#showCanvasCheckbox').prop('checked')) {
                showAndRefreshCanvas();
            }
        });

        $(document).on('click', 'svg.nonSelectedTool', e => {
            $('.selectedTool').addClass('nonSelectedTool');
            $('.selectedTool').removeClass('selectedTool');
    
            e.currentTarget.classList.remove('nonSelectedTool');
            e.currentTarget.classList.add('selectedTool');

            let tool = e.currentTarget.id;
            this._controller.setTool(tool);
            
            if ($('#showCanvasCheckbox').prop('checked')) {
                showAndRefreshCanvas();
            }
        });
        
        this._cursorCanvas.on('wheel', (e) => this._controller.canvasZoom(e));
        this._cursorCanvas.on('mousedown', (e) => this._controller.canvasDown(e));
        this._cursorCanvas.on('mousemove', (e) => this._controller.canvasMove(e));
        this._cursorCanvas.on('mouseup', (e) => {
            let disableStates = this._controller.canvasUp(e);
            if(disableStates) {
                this._undoBtn.attr('disabled', disableStates.undo);
                this._redoBtn.attr('disabled', disableStates.redo);
                this._clearBtn.attr('disabled', disableStates.clear);
            }
        });
        this._cursorCanvas.on('mouseleave', (e) => {
            let disableStates = this._controller.canvasLeave(e); 
            if(disableStates) {
                this._undoBtn.attr('disabled', disableStates.undo);
                this._redoBtn.attr('disabled', disableStates.redo);
                this._clearBtn.attr('disabled', disableStates.clear);
            }
        });
        this._undoBtn.on('click', () => {
            this._undoBtn.attr('disabled', true);
            let disableStates = this._controller.undo();
            if(disableStates) {
                this._undoBtn.attr('disabled', disableStates.undo);
                this._redoBtn.attr('disabled', disableStates.redo);
                this._clearBtn.attr('disabled', disableStates.clear);
            }
        });
        this._redoBtn.on('click', () => {
            this._redoBtn.attr('disabled', true);
            let disableStates = this._controller.redo(); 
            if(disableStates) {
                this._undoBtn.attr('disabled', disableStates.undo);
                this._redoBtn.attr('disabled', disableStates.redo);
                this._clearBtn.attr('disabled', disableStates.clear);
            }
        });
        this._clearBtn.on('click', () => {
            this._clearBtn.attr('disabled', true);
            let disableStates = this._controller.clear(); 
            if(disableStates) {
                this._undoBtn.attr('disabled', disableStates.undo);
                this._redoBtn.attr('disabled', disableStates.redo);
                this._clearBtn.attr('disabled', disableStates.clear);
            }
        });

        let saveChanges = () => {
            if (this._controller.hasChanges() &&
                !this._controller.isCanvasCleared()) {
                $('#saveButton').click();
            }
        }

        this._playerUI.on('segmentationmode', () => {saveChanges(); this._controller.fit();});
        this._playerUI.on('wheel', (e) => {
            if (!this._sidePanelSegmentationBtn.hasClass('activeTabButton') || this._pointerMode.hasClass('selectedTool')) {
                saveChanges();
                this._controller.zoom(e);
            }
        });
        this._playerUI.on('dblclick', () => {
            if (!this._sidePanelSegmentationBtn.hasClass('activeTabButton') || this._pointerMode.hasClass('selectedTool')) {
                saveChanges();
                this._controller.fit();
            }
        });
        this._playerUI.on('mousemove', (e) => {
            if (!this._sidePanelSegmentationBtn.hasClass('activeTabButton') || this._pointerMode.hasClass('selectedTool')) {
                saveChanges();
                this._controller.frameMouseMove(e);
            }
        });       

        let startCursorMode = () =>  {
            if (this._tmpSelectedTool === undefined) {
                this._tmpSelectedTool = $('.selectedTool');
                $('#pointerMode').click();
            }
        }

        let endCursorMode = () =>  {
            if (this._tmpSelectedTool != undefined) {
                this._tmpSelectedTool.click();
                this._tmpSelectedTool = undefined;
            }
        }
        
        this._progressUI.on('mousedown', (e) => {endCursorMode(); saveChanges(); this._controller.progressMouseDown(e);});
        this._progressUI.on('mouseup', () => {endCursorMode(); saveChanges(); this._controller.progressMouseUp();});
        this._progressUI.on('mousemove', (e) => {endCursorMode(); saveChanges(); this._controller.progressMouseMove(e);});
        this._playButtonUI.on('click', () => {endCursorMode(); saveChanges(); this._controller.play();});
        this._pauseButtonUI.on('click', () => {endCursorMode(); saveChanges(); this._controller.pause();});
        this._nextButtonUI.on('click', () => {endCursorMode(); saveChanges(); this._controller.next();});
        this._prevButtonUI.on('click', () => {endCursorMode(); saveChanges(); this._controller.previous();});
        this._multipleNextButtonUI.on('click', () => {endCursorMode(); saveChanges(); this._controller.forward();});
        this._multiplePrevButtonUI.on('click', () => {endCursorMode(); saveChanges(); this._controller.backward();});
        this._firstButtonUI.on('click', () => {endCursorMode(); saveChanges(); this._controller.first();});
        this._lastButtonUI.on('click', () => {endCursorMode(); saveChanges(); this._controller.last();});
        this._playerSpeedUI.on('change', (e) => this._controller.changeFPS(e));
        this._resetZoomUI.on('change', (e) => this._controller.changeResetZoom(e));
        this._playerStepUI.on('change', (e) => this._controller.changeStep(e));
        this._frameNumber.on('change', (e) =>
        {
            if (Number.isInteger(+e.target.value)) {
                saveChanges();
                this._controller.seek(+e.target.value);
                blurAllElements();
            }
        });
        this._loadSpecificFrameTags.on('change', (e) =>
        {
            if (Number.isInteger(+e.target.value)) {
                $('#loadTags').click();
            }
        });
        
        // Move to the previous frame with comments
        this._prevCommentButton.on('click', function() {
            let frame = this._controller._model.getPrevCommentedFrame()

            if (frame != -1) {
                $('#frameNumber').prop('value', frame).trigger('change');
            }
        }.bind(this))

        // Move to the next frame with comments
        this._nextCommentButton.on('click', function() {
            let frame = this._controller._model.getNextCommentedFrame()

            if (frame != -1) {
                $('#frameNumber').prop('value', frame).trigger('change');
            }
        }.bind(this))

        this._commentBtn.on('click', () => {
            let textareaContainer = $("#commentTooltipTextArea")
            if (textareaContainer.hasClass("commentAreaOpen")) {
                textareaContainer.removeClass("commentAreaOpen");
            } else {
                textareaContainer.addClass("commentAreaOpen");
            }
        });

        this._commentTextArea.on("click", e => e.stopPropagation());
        this._commentTextArea.bind("input propertychange", () => {
            cvat.frameComments[cvat.player.frames.current] = this._commentTextArea.val()
        });

        let shortkeys = window.cvat.config.shortkeys;
        let playerGridOpacityInput = $('#playerGridOpacityInput');
        playerGridOpacityInput.on('input', (e) => {
            let value = Math.clamp(+e.target.value, +e.target.min, +e.target.max);
            e.target.value = value;
            this._playerGridPath.attr({
                'opacity': value / +e.target.max,
            });
        });
        
        playerGridOpacityInput.attr('title', `
            ${shortkeys['change_grid_opacity'].view_value} - ${shortkeys['change_grid_opacity'].description}`);

        let playerGridStrokeInput = $('#playerGridStrokeInput');
        playerGridStrokeInput.on('change', (e) => {
            this._playerGridPath.attr({
                'stroke': e.target.value,
            });
        });

        playerGridStrokeInput.attr('title', `
            ${shortkeys['change_grid_color'].view_value} - ${shortkeys['change_grid_color'].description}`);

        $('#playerGridSizeInput').on('change', (e) => {
            let value = Math.clamp(+e.target.value, +e.target.min, +e.target.max);
            e.target.value = value;
            this._playerGridPattern.attr({
                width: value,
                height: value,
            });
        });

        Mousetrap.bind(shortkeys['focus_to_frame'].value, () => this._frameNumber.focus(), 'keydown');
        Mousetrap.bind(shortkeys["change_grid_opacity"].value,
            Logger.shortkeyLogDecorator(function(e) {
                let ui = playerGridOpacityInput;
                let value = +ui.prop('value');
                value += e.key === '=' ? 1 : -1;
                value = Math.clamp(value, 0, 5);
                ui.prop('value', value);
                this._playerGridPath.attr({
                    'opacity': value / +ui.prop('max'),
                });
            }.bind(this)),
            'keydown');

        Mousetrap.bind(shortkeys["change_grid_color"].value,
            Logger.shortkeyLogDecorator(function() {
                let ui = playerGridStrokeInput;
                let colors = [];
                for (let opt of ui.find('option')) {
                    colors.push(opt.value);
                }
                let idx = colors.indexOf(this._playerGridPath.attr('stroke')) + 1;
                let value = colors[idx] || colors[0];
                this._playerGridPath.attr('stroke', value);
                ui.prop('value', value);
            }.bind(this)),
            'keydown');
    
        let segmentShortkeyLogDecorator = (element) => {
            return Logger.shortkeyLogDecorator(function(e) {
                if (this._sidePanelSegmentationBtn.hasClass('activeTabButton') &&
                    !element.prop('disabled')) {
                        element.click();
                }
                
                e.preventDefault();
            }.bind(this));
        }

        Mousetrap.bind(shortkeys["watershed"].value, segmentShortkeyLogDecorator(this._watershedBtn), 'keydown');
        Mousetrap.bind(shortkeys["clear_canvas"].value, segmentShortkeyLogDecorator(this._clearBtn), 'keydown');
        Mousetrap.bind(shortkeys["toggle_canvas"].value, segmentShortkeyLogDecorator(this._showCanvasCheckbox), 'keydown');
        Mousetrap.bind(shortkeys["toggle_watershed"].value, segmentShortkeyLogDecorator(this._showWatershedCheckbox), 'keydown');
        Mousetrap.bind(shortkeys["cursor_mode"].value, startCursorMode, 'keydown');
        Mousetrap.bind(shortkeys["cursor_mode"].value, endCursorMode, 'keyup');

        this._progressUI['0'].max = playerModel.frames.stop - playerModel.frames.start;
        this._progressUI['0'].value = 0;

        this._resetZoomUI.prop('checked', playerModel.resetZoom);
        this._playerStepUI.prop('value', playerModel.multipleStep);
        this._playerSpeedUI.prop('value', '3');

        this._frameNumber.attr('title', `
            ${shortkeys['focus_to_frame'].view_value} - ${shortkeys['focus_to_frame'].description}`);

        this._nextButtonUI.find('polygon').append($(document.createElementNS('http://www.w3.org/2000/svg', 'title'))
            .html(`${shortkeys['next_frame'].view_value} - ${shortkeys['next_frame'].description}`));

        this._prevButtonUI.find('polygon').append($(document.createElementNS('http://www.w3.org/2000/svg', 'title'))
            .html(`${shortkeys['prev_frame'].view_value} - ${shortkeys['prev_frame'].description}`));

        this._playButtonUI.find('polygon').append($(document.createElementNS('http://www.w3.org/2000/svg', 'title'))
            .html(`${shortkeys['play_pause'].view_value} - ${shortkeys['play_pause'].description}`));

        this._pauseButtonUI.find('polygon').append($(document.createElementNS('http://www.w3.org/2000/svg', 'title'))
            .html(`${shortkeys['play_pause'].view_value} - ${shortkeys['play_pause'].description}`));

        this._multipleNextButtonUI.find('polygon').append($(document.createElementNS('http://www.w3.org/2000/svg', 'title'))
            .html(`${shortkeys['forward_frame'].view_value} - ${shortkeys['forward_frame'].description}`));

        this._multiplePrevButtonUI.find('polygon').append($(document.createElementNS('http://www.w3.org/2000/svg', 'title'))
            .html(`${shortkeys['backward_frame'].view_value} - ${shortkeys['backward_frame'].description}`));


        this._contextMenuUI.click((e) => {
            $('.custom-menu').hide(100);
            switch($(e.target).attr("action")) {
            case "job_url": {
                window.cvat.search.set('frame', null);
                window.cvat.search.set('filter', null);
                copyToClipboard(window.cvat.search.toString());
                break;
            }
            case "frame_url":
                window.cvat.search.set('frame', window.cvat.player.frames.current);
                window.cvat.search.set('filter', null);
                copyToClipboard(window.cvat.search.toString());
                window.cvat.search.set('frame', null);
                break;
            }
        });

        this._playerUI.on('contextmenu.playerContextMenu', (e) => {
            if (!window.cvat.mode) {
                $('.custom-menu').hide(100);
                this._contextMenuUI.finish().show(100);
                let x = Math.min(e.pageX, this._playerUI[0].offsetWidth -
                    this._contextMenuUI[0].scrollWidth);
                let y = Math.min(e.pageY, this._playerUI[0].offsetHeight -
                    this._contextMenuUI[0].scrollHeight);
                this._contextMenuUI.offset({
                    left: x,
                    top: y,
                });
                e.preventDefault();
            }
        });

        this._playerContentUI.on('mousedown.playerContextMenu', () => {
            $('.custom-menu').hide(100);
        });

        playerModel.subscribe(this);
    }

    onPlayerUpdate(model) {
        let image = model.image;
        let frames = model.frames;
        let geometry = model.geometry;

        if (!image) {
            this._loadingUI.removeClass('hidden');
            this._playerBackgroundUI.css('background-image', '');
            this._frameWatershed.css('background-image', '');
            return;
        }

        let isSegmentationMode = this._sidePanelSegmentationBtn.hasClass('activeTabButton');
        let changedFrame = $('#loadSpecificFrameTags').val() === "" || frames.current != $('#loadSpecificFrameTags').val();

        this._loadingUI.addClass('hidden');
        if (this._playerBackgroundUI.css('background-image').slice(5,-2) != image.src) {
            this._playerBackgroundUI.css('background-image', 'url(' + '"' + image.src + '"' + ')');
        }

        if(isSegmentationMode) {
            this._frameWatershed.css('background-image',
                                     `url("${image.src.replace('/frame/','/frame_watershed/')}")`);
        }

        if (model.playing) {
            this._playButtonUI.addClass('hidden');
            this._pauseButtonUI.removeClass('hidden');
        }
        else {
            this._pauseButtonUI.addClass('hidden');
            this._playButtonUI.removeClass('hidden');
        }

        if (frames.current === frames.start) {
            this._firstButtonUI.addClass('disabledPlayerButton');
            this._prevButtonUI.addClass('disabledPlayerButton');
            this._multiplePrevButtonUI.addClass('disabledPlayerButton');
        }
        else {
            this._firstButtonUI.removeClass('disabledPlayerButton');
            this._prevButtonUI.removeClass('disabledPlayerButton');
            this._multiplePrevButtonUI.removeClass('disabledPlayerButton');
        }

        if (frames.current === frames.stop) {
            this._lastButtonUI.addClass('disabledPlayerButton');
            this._nextButtonUI.addClass('disabledPlayerButton');
            this._playButtonUI.addClass('disabledPlayerButton');
            this._multipleNextButtonUI.addClass('disabledPlayerButton');
        }
        else {
            this._lastButtonUI.removeClass('disabledPlayerButton');
            this._nextButtonUI.removeClass('disabledPlayerButton');
            this._playButtonUI.removeClass('disabledPlayerButton');
            this._multipleNextButtonUI.removeClass('disabledPlayerButton');
        }

        this._progressUI['0'].value = frames.current - frames.start;

        for (let obj of [this._playerBackgroundUI, this._playerGridUI, this._frameWatershed]) {
            obj.css('width', image.width);
            obj.css('height', image.height);
            obj.css('top', geometry.top);
            obj.css('left', geometry.left);
            obj.css('transform', 'scale(' + geometry.scale + ')');
        }
        
        model.offsetX = Math.round(geometry.left + 8);
        model.offsetY = Math.round(geometry.top + 9);

        for (let obj of [this._paintingCanvas, this._cursorCanvas]) {
            let currContext = obj[0].getContext('2d');
            
            let contextState = {
                lineJoin: currContext.lineJoin,
                lineWidth: currContext.lineWidth,
                strokeStyle: currContext.strokeStyle,
                fillStyle: currContext.fillStyle,
                globalCompositeOperation: currContext.globalCompositeOperation
            };

            if (changedFrame) {
                obj.attr('width', image.width);
                obj.attr('height', image.height);
            }
          
            obj.css('top', geometry.top);
            obj.css('left', geometry.left);
            obj.css('transform', 'scale(' + geometry.scale + ')');
            
            currContext.lineJoin = contextState.lineJoin;
            currContext.lineWidth = contextState.lineWidth;
            currContext.strokeStyle = contextState.strokeStyle;
            currContext.fillStyle = contextState.fillStyle;
            currContext.globalCompositeOperation = contextState.globalCompositeOperation;
        }

        if(isSegmentationMode && changedFrame) {
            if(frames.current == 0){
                $('#loadSpecificFrameTags').val(frames.current);
            }
            else{
                $('#loadSpecificFrameTags').val(frames.current - 1);
            }
            
            $('#loadTags').click();
        }

        this._playerContentUI.css('width', image.width + geometry.frameOffset * 2);
        this._playerContentUI.css('height', image.height + geometry.frameOffset * 2);
        this._playerContentUI.css('top', geometry.top - geometry.frameOffset * geometry.scale);
        this._playerContentUI.css('left', geometry.left - geometry.frameOffset * geometry.scale);
        this._playerContentUI.css('transform', 'scale(' + geometry.scale + ')');

        this._playerGridPath.attr('stroke-width', 2 / geometry.scale);
        this._frameNumber.prop('value', frames.current);
        this._totalFrames.text(" / " + frames.stop);
        $('#loadedFrames').html(" ");
        $('#loadSpecificFrameTags').attr('placeholder', frames.current);
    }
}
