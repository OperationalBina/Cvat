/*
 * Copyright (C) 2018 Intel Corporation
 *
 * SPDX-License-Identifier: MIT
 */

"use strict";

/* Dashboard entrypoint */
window.cvat = window.cvat || {};
window.cvat.dashboard = window.cvat.dashboard || {};
window.cvat.dashboard.uiCallbacks = window.cvat.dashboard.uiCallbacks || [];
window.cvat.config = new Config();

function uiCallBackButtons() {
    window.cvat.dashboard.uiCallbacks.push(function(elements) {
        elements.each(function(idx) {
            let elem = $(elements[idx]);
            let taskID = +elem.attr('id').split('_')[1];
            let taskName = $.trim($( elem.find('label.dashboardTaskNameLabel')[0] ).text());
            let buttonsUI = elem.find('div.dashboardButtonsUI')[0];
            let ValidationUI = elem.find('div.dashboardValidationUI')[0];

            let dumpButton = $( $(buttonsUI).find('button.dashboardDumpAnnotation')[0] );
            let uploadButton = $( $(buttonsUI).find('button.dashboardUploadAnnotation')[0] );
            let updateButton = $( $(buttonsUI).find('button.dashboardUpdateTask')[0] );
            let deleteButton = $( $(buttonsUI).find('button.dashboardDeleteTask')[0] );

            let bugTrackerButton =  $(buttonsUI).find('.dashboardOpenTrackerButton');
            if (bugTrackerButton.length) {
                bugTrackerButton = $(bugTrackerButton[0]);
                bugTrackerButton.off('click');
                bugTrackerButton.on('click', function() {
                    window.open($(buttonsUI).find('a.dashboardBugTrackerLink').attr('href'));
                });
            }

            let updateStatus = function(newStatus) {
                $.ajax({
                    url: 'update/status/' + newStatus + '/' + taskID,
                    success: function() {
                        window.location.reload();
                    },
                    error: function(response) {
                        showMessage('Task update error. ' + response.responseText);
                    }
                });
            }
            
            // If the request validation button exists bind on click to update the status of
            // task to validation.
            let RequestValidationButton =  $(ValidationUI).find('.dashboardRequestValidation');
            if (RequestValidationButton.length) {
                RequestValidationButton = $(RequestValidationButton[0]);
                RequestValidationButton.off('click');
                RequestValidationButton.on('click', function() {
                    updateStatus('validation');
                });
            }
            
            // If the finish task button it means that reject button must also be present.
            // bind both on click to update the status to the relevent one per button.
            let AcceptValidationButton =  $(ValidationUI).find('.dashboardAcceptValidation');
            if (AcceptValidationButton.length) {
                AcceptValidationButton = $(AcceptValidationButton[0]);
                AcceptValidationButton.off('click');
                AcceptValidationButton.on('click', function() {
                    updateStatus('completed');
                });
            }
            
            let RejectValidationButton = $(ValidationUI).find('button.dashboardRejectValidation');
            if (RejectValidationButton.length) {
                RejectValidationButton = $(RejectValidationButton[0]);
                RejectValidationButton.off('click');
                RejectValidationButton.on('click', function(){ 
                    updateStatus('annotation');
                });
            }

            dumpButton.off('click');
            dumpButton.on('click', function() {
                window.cvat.dashboard.taskID = taskID;
                window.cvat.dashboard.taskName = taskName;
                $('#dumpAnnotationWindow').removeClass('hidden');
            });

            $('#dumpObjectsButton').off('click');
            $('#dumpObjectsButton').on('click', function() {
                dumpAnnotationRequest(dumpButton, window.cvat.dashboard.taskID, window.cvat.dashboard.taskName);
            });

            $('#dumpSegmentationButton').off('click');
            $('#dumpSegmentationButton').on('click', function() {
                dumpSegmentationRequest(window.cvat.dashboard.taskID);
            });

            uploadButton.off('click');
            uploadButton.on('click', function() {
                window.cvat.dashboard.taskID = taskID;
                window.cvat.dashboard.taskName = taskName;
                confirm('The current annotation will be lost. Are you sure?', uploadAnnotationRequest);
            });

            updateButton.off('click');
            updateButton.on('click', function() {
                window.cvat.dashboard.taskID = taskID;
                window.cvat.dashboard.taskName = taskName;

                // Select the annotator that's related to the task chosen to update.
                $("#updateSelectAnnotator").val($("#dashboardTask_" + taskID + " label").attr("value"));
                $('#dashboardUpdateModal').removeClass('hidden');
                $('#dashboardUpdateModal')[0].loadCurrentLabels();
                projectHasScore = projects[projectIndex].has_score;
                $('#priority_button').toggleClass("hiddenClass", projectHasScore);
                $('#priority_tab').toggleClass("hiddenClass", projectHasScore);
            });

            deleteButton.off('click');
            deleteButton.on('click', function() {
                window.cvat.dashboard.taskID = taskID;
                window.cvat.dashboard.taskName = taskName;
                RemoveTaskRequest();
            });
        });
    });
}

uiCallBackButtons();
document.addEventListener("DOMContentLoaded", buildDashboard);

let projects = {}
let projectIndex = 0

// Get all the projects and handle the cycling in the dashboard
function projectHandler() {
    let projectName = $('#dashboardProjectsName');
    let prevProject = $('#dashboardProjectSelectorPrev');
    let nextProject = $('#dashboardProjectSelectorNext');
    let selectAnnotator = $('#dashboardSelectAnnotator');
    let updateAnnotator = $('#updateSelectAnnotator');
    let userFilterDropdown = $("#userFilterDropdown");
    let sortTaskDropdown = $("#sortTasksDropdown");

    sortTasksContainer();

    // Sending a request to the server to get all of the projects that are associated
    // with the current user (projectName currently holds the username)
    $.ajax({
        url: 'get/projects',
        type: 'GET',
        async: false,
        success: function(data) {
            // Save the projects returned to a local dictionary and show the related tasks for the first
            // project
            projects = data;
            if (projects[projectIndex] !== undefined) {
                projectName.html(projects[projectIndex].name);
                viewRelatedTasks();
            }
        },
        complete: function() {
            $.ajax({
                url: 'get/userProjectRelation',
                type: 'GET',
                success: function(data) {
                    for (let i = 0; i < Object.keys(projects).length; i++) {
                        projects[i].users = data[projects[i].id];
                    }
                },
                complete: function() {
                    // After the request to get all of the users related to each project is returned,
                    // append all of the users to all of the different dropdown selectors for the current project.
                    fillDropdowns();

                    userFilterDropdown.find('option:first').attr("selected","selected");
                    setTimeout(showUserTasks, 50);
                }
            });
        }
    });

    // If the user has no projects he's related to hide the arrows and show the user a message
    if (projects[projectIndex] === undefined || Object.keys(projects).length == 0) {
        prevProject.hide();
        nextProject.hide();
        projectName.html("No project associated");
    // If the user only has one project hide the scroll arrows
    } else if (Object.keys(projects).length == 1) {
        prevProject.hide();
        nextProject.hide();
        projectName.html(projects[projectIndex].name);
    // If the user has more than one associated project bind the scrolling arrows to scroll between the
    // related projects
    } else {
        // Each time the previous arrow is pressed scroll to the previous project in the queue and show
        // the related tasks to that project
        prevProject.on('click', function() {
            if (projectIndex > 0) {
                projectName.html(projects[--projectIndex].name);
            } else {
                projectIndex = Object.keys(projects).length - 1;
                projectName.html(projects[projectIndex].name);
            }

            // Clear out all of the selects each time a different project is selected.
            selectAnnotator.find('option').remove();
            updateAnnotator.find('option').remove();
            userFilterDropdown.find('option').remove();

            // Create the default option for the filter which is all users.
            userFilterDropdown.append($("<option></option>").text("All Users").val("All Users"));
            
            // Fill all of the different dropdown according to the current project.
            fillDropdowns();
            
            userFilterDropdown.find('option:first').attr("selected","selected");

            setTimeout(showUserTasks, 50);
            setTimeout(viewRelatedTasks, 50);
        });

        // Each time the next arrow is pressed scroll to the next project in the queue and show
        // the related tasks to that project
        nextProject.on('click', function() {
            if (projectIndex < Object.keys(projects).length - 1) {
                projectName.html(projects[++projectIndex].name);
            } else {
                projectIndex = 0;
                projectName.html(projects[projectIndex].name);
            }

            // Clear out all of the selects each time a different project is selected.
            selectAnnotator.find('option').remove();
            updateAnnotator.find('option').remove();
            userFilterDropdown.find('option').remove();
            
            // Create the default option for the filter which is all users.
            userFilterDropdown.append($("<option></option>").text("All Users").val("All Users"));
            
            // Fill all of the different dropdown according to the current project.
            fillDropdowns();

            userFilterDropdown.find('option:first').attr("selected","selected");
            
            setTimeout(showUserTasks, 50);
            setTimeout(viewRelatedTasks, 50);
        });
    }

    // Each time a different user is selected on the filter, show only the tasks related to that user.
    userFilterDropdown.on("change", showUserTasks);
    sortTaskDropdown.on("change", sortTasksContainer);

    function viewRelatedTasks() {
        let taskIds = "";
        // Set up the string to get the ids of the tasks related to the selected project
        for (index in projects[projectIndex].tasks) {
            taskIds += "#dashboardTask_" + projects[projectIndex].tasks[index] + ",";
        }
        taskIds = taskIds.slice(0, -1);
        // Hide every task on the screen and show only the related tasks
        $('.dashboardTaskUI').hide();
        $(taskIds).show();

        if (projects[projectIndex].has_score) {
            $("#sortby_score").text("Score")
        } else {
            $("#sortby_score").text("Priority")
        }

        // Get the number of each child elements (to update for upon project changed)
        var open_count = $("#status_open > div").filter(function() {return $(this).css("display") != 'none'}).length;
        var pending_count = $("#status_pending > div").filter(function() {return $(this).css("display") != 'none'}).length;
        var closed_count = $("#status_closed > div").filter(function() {return $(this).css("display") != 'none'}).length;

        // Edit the text in the tabs buttons.
        $("#open_tasks_button").html("Open (" + open_count + ")");
        $("#pending_tasks_button").html("Pending (" + pending_count + ")");
        $("#closed_tasks_button").html("Closed (" + closed_count + ")");
    }

    function showUserTasks() {
        // Hide every task for the current project.
        $(".dashboardTaskUI").each(function() {
            if ($(this).css("display") !== "none") {
                $(this).addClass("hidden");
            }
        });

        let selectedUser = $("#userFilterDropdown option:selected").val();

        // If the selected user isn't all users, filter out only the tasks that are assigned to the selected user.
        if (selectedUser !== "All Users" && $("#userFilterDropdown").length) {
            $(".dashboardTaskUI label[value=" + selectedUser + "]").parents(".dashboardTaskUI").removeClass("hidden");
        } else {
            $(".dashboardTaskUI").removeClass("hidden");
        }

        // Get the number of each task in each tab for the selected user/all users.
        let open_count = $("#status_open .dashboardTaskUI:not(.hidden)").filter(function() {return $(this).css("display") != 'none'}).length;
        let pending_count = $("#status_pending .dashboardTaskUI:not(.hidden)").filter(function() {return $(this).css("display") != 'none'}).length;
        let closed_count = $("#status_closed .dashboardTaskUI:not(.hidden)").filter(function() {return $(this).css("display") != 'none'}).length;
        
        // Edit the text in the tabs buttons.
        $("#open_tasks_button").html("Open (" + open_count + ")");
        $("#pending_tasks_button").html("Pending (" + pending_count + ")");
        $("#closed_tasks_button").html("Closed (" + closed_count + ")");
    }

    // Sort each tasks by their matching tab (status mode)
    function sortTasksContainer() {
        var sortedOpenTasks = $("#status_open .dashboardTaskUI").sort(sortTasks);
        $("#status_open").html(sortedOpenTasks);

        var sortedPendingTasks = $("#status_pending .dashboardTaskUI").sort(sortTasks);
        $("#status_pending").html(sortedPendingTasks);

        var sortedClosedTasks = $("#status_closed .dashboardTaskUI").sort(sortTasks);
        $("#status_closed").html(sortedClosedTasks);

        uiCallBackButtons();
        for (let callback of window.cvat.dashboard.uiCallbacks) {
            callback( $('.dashboardTaskUI') );
        }
    }

    function sortTasks(a, b) {
        let sortValue = $("#sortTasksDropdown option:selected").val();

        // Get each id in order to later extract the right value
        var aId = $(a)[0].id.split('_')[1]
        var bId = $(b)[0].id.split('_')[1]

        var valA = $("#" + sortValue + "_" + aId).val();
        var valB = $("#" + sortValue + "_" + bId).val();

        // Parse to the correct type of object in order to sort
        if (sortValue == "score") {
            valA = parseFloat(valA)
            valB = parseFloat(valB)
        } else if (sortValue == "date") {
            valA = new Date(valA)
            valB = new Date(valB);
        }
        
        // Return the bigger values first
        return (valA < valB) ? 1 : -1
    }

    function fillDropdowns() {
        // For each related user to the current project append it to all of the dropdown selects.
        if (projects[projectIndex].users) {
            projects[projectIndex].users.forEach(username => {
                let option = $("<option></option>").text(username[0]).val(username[1]);
                $('#dashboardSelectAnnotator').append(option.clone());
                $('#updateSelectAnnotator').append(option.clone());
                $("#userFilterDropdown").append(option.clone());
            });
        }
    }
}

function buildDashboard() {
    projectHandler();

    /* Setup static content */
    setupSettings();
    setupTaskCreator();
    setupTaskUpdater();
    setupSearch();
    setupProjectManager();

    $(window).on('click', function(e) {
        let target = $(e.target);
        if (target[0].id === "dashboardLabelAddModal") {
            window.location.reload();
        }
        if ( target.hasClass('modal') ) {
            target.addClass('hidden');
        }
    });

    /* Setup task UIs */
    for (let callback of window.cvat.dashboard.uiCallbacks) {
        callback( $('.dashboardTaskUI') );
    }

    $('#loadingOverlay').remove();
}

function getFramePropertiesFromTree(tree) {
    if (tree.jstree(true)) {
        return tree.jstree(true).get_selected(true);
    } else {
        return "";
    }
}

// TODO: Check if sort works with ids like: 1/ and 13. Write function better with less i--,i++. Insert docs.
function getLabelsFromTree(tree) {
    if (tree.jstree(true)) {
        let selectedNodes = tree.jstree(true).get_selected(true).sort((a,b)=>(a.id.localeCompare(b.id)));

        // Remove the 'all labels' node.
        for (var index = 0; index < selectedNodes.length; index++) {
            if (selectedNodes[index].id == '$$$') {
                selectedNodes.splice(index, 1)
                break;
            }
        }

        let i=0;
        let labelString ="";
        for(;i < selectedNodes.length && selectedNodes[i].parents.length == 2; i++) {
            labelString += selectedNodes[i].text;

            i++;
            for (;i < selectedNodes.length && selectedNodes[i].parents.length == 3; i++) {
                let canChangeChar = selectedNodes[i].original.path[0];

                labelString += " " + canChangeChar + "select=" + selectedNodes[i].text + ":";

                i++
                for(;i < selectedNodes.length && selectedNodes[i].parents.length == 4; i++) {
                    labelString += selectedNodes[i].text + ","
                }
                
                labelString = labelString.slice(0,-1);
                i--;
            }

            labelString += " ";
            i--;
        }

        return labelString;
    } else {
        return "";
    }
}

function openFramePropertiesTree(framePropertiesSelector, framePropertiesBrowseTree, okBtn) {
    framePropertiesSelector.removeClass('hidden');
    framePropertiesTree = framePropertiesBrowseTree.jstree({
        core: {
            themes: {
                icons: false
            }
        },
        checkbox: {
            keep_selected_style: false,
            two_state: true
        },
        plugins: ['checkbox', 'wholerow'],
    });

    framePropertiesBrowseTree.jstree(true).settings.core.data = projects[projectIndex]["dashboardEditFrameProeperties"];
    framePropertiesBrowseTree.jstree(true).refresh();

    okBtn.on('click', () => framePropertiesSelector.addClass('hidden'));
}

function openLabelsTree(labelSelector, labelTree, okBtn) {
    labelSelector.removeClass('hidden');
    labelJsTree = labelTree.jstree({
        core: {
            themes: {
                icons: false
            }
        },
        checkbox: {
            keep_selected_style: false,
            two_state: true
        },
        plugins: ['checkbox', 'wholerow'],
    });

    labelTree.jstree(true).settings.core.data = projects[projectIndex]["dashboardEditLabels"];
    labelTree.jstree(true).refresh();

    labelJsTree.on('ready.jstree', function(e, data) {
        data.instance.select_node('$$$')
    })
    
    // Listening to selecting/deselecting events nodes in the tree
    labelJsTree.on('changed.jstree', function(e, data) {
        // When selecting a node
        if (data.instance.is_selected(data.node)) {
            // Selects all its parents
            for (var i = 0; i < data.node.parents.length; i++) {
                if (data.node.parents[i] != '$$$') {
                    data.instance.select_node(data.instance.get_node(data.node.parents[i]),true);
                }
            }
            
            // In addition, if we select an attribute, we also check all its values by default
            if (data.node.parents.length == 3) {
                for (var i = 0; i < data.node.children.length; i++) {
                    data.instance.select_node(data.instance.get_node(data.node.children[i]),true);
                }
            }
        } else if (data.node) { // When unselecting a node
            // If it is a value of an attribute
            if (data.node.parents.length == 4) {
                // We check if all the values of this attribute are unselected and then unselects the attribute too
                if (data.instance.get_checked_descendants(data.node.parent).length == 0) {
                    data.instance.deselect_node(data.instance.get_node(data.node.parent),true);
                }
            } else { // Handling unselecting of an attribute or unselecting a label
                for (var i = 0; i < data.node.children_d.length; i++) {
                    data.instance.deselect_node(data.instance.get_node(data.node.children_d[i]),true);
                }
            }
        }
    });

    okBtn.on('click', () => labelSelector.addClass('hidden'));
}

function switchTask(evt, status) {
    var i, statustab_content, statustab_links;

    // Get all elements with class="statustab_content" and hide them
    statustab_content = document.getElementsByClassName("statustab_content");
    for (i = 0; i < statustab_content.length; i++) {
        statustab_content[i].style.display = "none";
    }

    // Get all elements with class="statustab_link" and remove the class "active"
    statustab_links = document.getElementsByClassName("statustab_link");
    for (i = 0; i < statustab_links.length; i++) {
        statustab_links[i].className = statustab_links[i].className.replace(" active", "");
    }

    // Show the current tab, and add an "active" class to the button that opened the tab
    document.getElementById(status).style.display = "block";
    evt.currentTarget.className += " active";
}

function switchSetting(evt, setting) {
    var i, settingstab_content, settingstab_links;

    // Get all elements with class="settingstab_content" and hide them
    settingstab_content = document.getElementsByClassName("settingstab_content");
    for (i = 0; i < settingstab_content.length; i++) {
        settingstab_content[i].style.display = "none";
    }

    // Get all elements with class="settingstab_link" and remove the class "active"
    settingstab_links = document.getElementsByClassName("settingstab_link");
    for (i = 0; i < settingstab_links.length; i++) {
        settingstab_links[i].className = settingstab_links[i].className.replace(" active", "");
    }

    // Show the current tab, and add an "active" class to the button that opened the tab
    document.getElementById(setting).style.display = "block";
    evt.currentTarget.className += " active";
}

function switchUpdateTab(evt, updatetab) {
    var i, updatetab_content, updatetab_links;

    // Get all elements with class="updatetab_content" and hide them
    updatetab_content = document.getElementsByClassName("updatetab_content");
    for (i = 0; i < updatetab_content.length; i++) {
        updatetab_content[i].style.display = "none";
    }

    // Get all elements with class="updatestab_link" and remove the class "active"
    updatetab_links = document.getElementsByClassName("updatetab_link");
    for (i = 0; i < updatetab_links.length; i++) {
        updatetab_links[i].className = updatetab_links[i].className.replace(" active", "");
    }

    // Show the current tab, and add an "active" class to the button that opened the tab
    document.getElementById(updatetab).style.display = "block";
    evt.currentTarget.className += " active";
}

function setupTaskCreator() {
    let dashboardCreateTaskButton = $('#dashboardCreateTaskButton');
    let createModal = $('#dashboardCreateModal');
    let nameInput = $('#dashboardNameInput');
    let bugTrackerInput = $('#dashboardBugTrackerInput');
    let localSourceRadio = $('#dashboardLocalSource');
    let shareSourceRadio = $('#dashboardShareSource');
    let sortedSourceRadio = $('#dashboardSortedSource');
    let selectAnnotator = $('#dashboardSelectAnnotator');
    let selectFiles = $('#dashboardSelectFiles');
    let filesLabel = $('#dashboardFilesLabel');
    let localFileSelector = $('#dashboardLocalFileSelector');
    let shareFileSelector = $('#dashboardShareBrowseModal');
    let sortedFileSelector = $('#dashboardSortedBrowseModal');
    let shareBrowseTree = $('#dashboardShareBrowser');
    let sortedBrowseTree = $('#dashboardSortedBrowser');
    let cancelBrowseServer = $('#dashboardCancelBrowseServer');
    let submitBrowseServer = $('#dashboardSubmitBrowseServer');
    let cancelSortedBrowseServer = $('#dashboardSortedCancelBrowseServer');
    let submitSortedBrowseServer = $('#dashboardSortedSubmitBrowseServer');
    let selectLabels = $('#dashboardSelectLabels');
    let selectFrameProperties = $('#dashboardSelectFrameProperties');
    let labelSelector = $('#dashboardLabelBrowseModal');
    let framePropertiesSelector = $('#dashboardFramePropertiesBrowseModal');
    let labelBrowseTree = $('#dashboardLabelBrowser');
    let framePropertiesBrowseTree = $('#dashboardFramePropertiesBrowser');
    let okBrowseLabel = $('#dashboardOkBrowseLabel');
    let okBrowseFrameProperties = $('#dashboardOkBrowseFrameProperties');
    let flipImagesBox = $('#dashboardFlipImages');
    let zOrderBox = $('#dashboardZOrder');
    let overlapSizeInput = $('#dashboardOverlap');
    let customOverlapSize = $('#dashboardCustomOverlap');
    let imageQualityInput = $('#dashboardImageQuality');
    let customCompressQuality = $('#dashboardCustomQuality');

    let taskMessage = $('#dashboardCreateTaskMessage');
    let submitCreate = $('#dashboardSubmitTask');
    let cancelCreate = $('#dashboardCancelTask');
    
    let name = nameInput.prop('value');
    let labels = ""
    let bugTrackerLink = bugTrackerInput.prop('value');
    let source = 'local';
    let flipImages = false;
    let zOrder = false;
    let overlapSize = 0;
    let compressQuality = 50;
    let files = [];
    let score = 0;

    dashboardCreateTaskButton.on('click', function() {
        $('#dashboardCreateModal').removeClass('hidden');
        projectHasScore = projects[projectIndex].has_score;

        // Show / hide the priority form by the project's has_score attribute's value
        $("#priorityInput").toggleClass("hiddenClass", projectHasScore);

        // Show / hide the Sorted form by the project's has_score attribute's value
        $("#dashboardSortedSourceId").toggleClass("hiddenClass", !projectHasScore);
        sortedSourceRadio.toggleClass("hiddenClass", !projectHasScore);


        // Show / hide the object storage form by the project's has object storage
        $.ajax({
            url: "has_object_storage/" + projects[projectIndex].id,
            type: 'GET',
            success: function (hasObjectStorageString) {
                var hasObjectStorage = (hasObjectStorageString === "True");
                shareSourceRadio.toggleClass("hiddenClass", !hasObjectStorage)
                $('#dashboardShareSourceId').toggleClass('hiddenClass', !hasObjectStorage);

                $("#dashboardLocalSource").toggleClass("nudgeDown", !hasObjectStorage);
                $("#dashboardLocalSourceId").toggleClass("nudgeDown", !hasObjectStorage);
                
            }
        });
    });
    
    nameInput.on('change', (e) => {name = e.target.value;});
    bugTrackerInput.on('change', (e) => {bugTrackerLink = e.target.value;});

    localSourceRadio.on('click', function() {
        if (source == 'local') return;
        source = 'local';
        files = [];
        updateSelectedFiles();
    });

    shareSourceRadio.on('click', function() {
        if (source == 'share') return;
        source = 'share';
        files = [];
        updateSelectedFiles();
    });

    sortedSourceRadio.on('click', function() {
        if (source == 'sorted') return;
        source = 'sorted';
        files = [];
        updateSelectedFiles();
    });

    selectFiles.on('click', function() {
        if (source == 'local') {
            localFileSelector.click();
        }
        else if (source == 'share') {
            shareFileSelector.removeClass('hidden');
            shareBrowseTree.jstree({
                core: {
                    multiple: true,
                    data: {
                        url: 'get_os_nodes',
                        data: (node) => { return {'project_id' : projects[projectIndex].id}; }
                    }
                },
                plugins: ['unique', 'sort'],
            });
        }
    });

    selectLabels.on('click', () => openLabelsTree(labelSelector, labelBrowseTree, okBrowseLabel));
    selectFrameProperties.on('click', () => openFramePropertiesTree(framePropertiesSelector, framePropertiesBrowseTree, okBrowseFrameProperties));

    localFileSelector.on('change', function(e) {
        files = e.target.files;
        updateSelectedFiles();
    });


    cancelBrowseServer.on('click', () => shareFileSelector.addClass('hidden'));
    submitBrowseServer.on('click', function() {
        files = shareBrowseTree.jstree(true).get_selected(full=true);
        cancelBrowseServer.click();
        updateSelectedFiles();
    });

    cancelSortedBrowseServer.on('click', () => sortedFileSelector.addClass('hidden'));
    submitSortedBrowseServer.on('click', function() {
        files = sortedBrowseTree.jstree(true).get_selected(full=true);
        cancelSortedBrowseServer.click();
        updateSelectedFiles();
    });

    flipImagesBox.on('click', (e) => {
        flipImages = e.target.checked;
    });

    zOrderBox.on('click', (e) => {
        zOrder = e.target.checked;
    });
    customOverlapSize.on('change', (e) => overlapSizeInput.prop('disabled', !e.target.checked));
    customCompressQuality.on('change', (e) => imageQualityInput.prop('disabled', !e.target.checked));

    overlapSizeInput.on('change', function() {
        let value = Math.clamp(
            +overlapSizeInput.prop('value'),
            +overlapSizeInput.prop('min'),
            +overlapSizeInput.prop('max')
        );

        overlapSizeInput.prop('value', value);
        overlapSize = value;
    });

    imageQualityInput.on('change', function() {
        let value = Math.clamp(
            +imageQualityInput.prop('value'),
            +imageQualityInput.prop('min'),
            +imageQualityInput.prop('max')
        );

        imageQualityInput.prop('value', value);
        compressQuality = value;
    });

    submitCreate.on('click', function() {
        if (!validateName(name)) {
            taskMessage.css('color', 'red');
            taskMessage.text('Invalid task name');
            return;
        }

        labels = getLabelsFromTree(labelBrowseTree);
        frameProperties = getFramePropertiesFromTree(framePropertiesBrowseTree);

        if (!validateLabels(labelBrowseTree) || labels == "") {
            taskMessage.css('color', 'red');
            taskMessage.text('No labels selected');
            return;
        }

        if (!validateOverlapSize(overlapSize)) {
            taskMessage.css('color', 'red');
            taskMessage.text('Overlap size must be positive and not more then segment size');
            return;
        }

        if (files.length <= 0) {
            taskMessage.css('color', 'red');
            taskMessage.text('Need specify files for task');
            return;
        }
        else if (files.length > maxUploadCount && source == 'local') {
            taskMessage.css('color', 'red');
            taskMessage.text('Too many files. Please use share functionality');
            return;
        }
        else if (source == 'local') {
            let commonSize = 0;
            for (let file of files) {
                commonSize += file.size;
            }
            if (commonSize > maxUploadSize) {
                taskMessage.css('color', 'red');
                taskMessage.text('Too big size. Please use share functionality');
                return;
            }
        }
        
        if (!validateFileType(files[0])) {
            taskMessage.css('color', 'red');
            taskMessage.text('No files selected');
            return;
        }

        $.ajax({
            url: `does_task_exist/project/${projects[projectIndex].id}/task/${name}`,
            type: 'GET',
            success: function (taskExists) {
                if (taskExists.result) {
                    taskMessage.css('color', 'red');
                    taskMessage.text('This project already has a task with this name. Please choose a different one.');
                } else {
                    let taskData = new FormData();
                    taskData.append('task_name', name);
                    taskData.append('bug_tracker_link', bugTrackerLink);
                    taskData.append('labels', labels);
                    taskData.append('frame_properties', JSON.stringify(frameProperties));
                    taskData.append('flip_flag', flipImages);
                    taskData.append('z_order', zOrder);
                    taskData.append('storage', source);
                    taskData.append('project', projects[projectIndex].id);
                    taskData.append('assignee', selectAnnotator.find("option:selected").val());

                    if (customOverlapSize.prop('checked')) {
                        taskData.append('overlap_size', overlapSize);
                    }
                    if (customCompressQuality.prop('checked')) {
                        taskData.append('compress_quality', compressQuality);
                    }

                    // Default score value, will be changed by the the task's parameters (priority / file.original.score / etc..)
                    score = 0

                    for (let file of files) {
                        if (source == 'share' || source == 'sorted') {
                            taskData.append('data', file.original.path);   
                            taskData.append('os_id', file.original.os_id);   
                            
                            if (source == 'sorted') {
                                score = file.original.score
                                taskData.append('video_id', file.original.video_id)
                            }
                        } else {
                            taskData.append('data', file);
                        }
                    }

                    if (!projects[projectIndex].has_score) {
                        var priority = Number($("input[name='priorityRadio']:checked").val())
                        score = priority;
                    }

                    taskData.append('score', score)
                    submitCreate.prop('disabled', true);

                    createTaskRequest(taskData,
                        () => {
                            taskMessage.css('color', 'green');
                            taskMessage.text('Successful request! Creating..');
                        },
                        () => window.location.reload(),
                        (response) => {
                            taskMessage.css('color', 'red');
                            taskMessage.text(response);
                        },
                        () => submitCreate.prop('disabled', false),
                        (status) => {
                            taskMessage.css('color', 'blue');
                            taskMessage.text(status);
                        });  
                }
            }
        });    
    });

    function updateSelectedFiles() {
        switch (files.length) {
        case 0:
            filesLabel.text('No Files');
            break;
        case 1:
            if(typeof(files[0]) == 'string'){
                filesLabel.text(files[0]);
                if (files[0].includes('.avi') || files[0].includes('.mp4')) {
                    name = files[0].split('.')[0];
                    nameInput.val(name)
                }
            }
            else{
                filesLabel.text(files[0].name == undefined ? files[0].text : files[0].name);
                name = files[0].name == undefined ? files[0].text.split('.')[0] : files[0].name.split('.')[0];
                nameInput.val(name)
            }
            break;
        default:
            filesLabel.text(files.length + ' files');
        }
    }

    function validateLabels(labels) {
        try {
            return labels.jstree(true).get_selected(true).length > 0
        } catch {
            return false
        }
    }

    function validateName(name) {
        let math = name.match('[a-zA-Z0-9()_ ]+');
        return math != null;
    }

    function validateOverlapSize(overlapSize) {
        return (overlapSize >= 0);
    }

    function validateFileType(file) {
        if (file.original != undefined) {
            return file.original.text.includes('.mp4') || file.original.text.includes('.avi');
        } else {
            return true;
        }
    }
    cancelCreate.on('click', () => createModal.addClass('hidden'));
}

function setupTaskUpdater() {
    let updateModal = $('#dashboardUpdateModal');
    let oldLabels = $('#dashboardOldLabels');
    let newLabels = $('#dashboardNewLabelsBtn');
    let submitUpdate = $('#dashboardSubmitUpdate');
    let cancelUpdate = $('#dashboardCancelUpdate');
    let newLabelSelector = $('#dashboardUpdateLabelBrowseModal');
    let newLabelBrowseTree = $('#dashboardUpdateLabelBrowser');
    let okBrowseNewLabel = $('#dashboardOkBrowseUpdateLabel');
    let newProperties = $('#dashboardNewPropertiesBtn');
    let newPropertiesSelector = $('#dashboardUpdatePropertiesBrowseModal');
    let newPropertiesBrowseTree = $('#dashboardUpdatePropertiesBrowser');
    let okBrowseNewProperties = $('#dashboardOkBrowseUpdateProperties');
    let allUpdateButtons = $(".dashboardUpdateTask");
    let updateAnnotator = $("#updateSelectAnnotator");

    let taskScore = 0;
    newLabels.on('click', () => openLabelsTree(newLabelSelector, newLabelBrowseTree, okBrowseNewLabel)); 
    newProperties.on('click', () => openFramePropertiesTree(newPropertiesSelector, newPropertiesBrowseTree, okBrowseNewProperties));    

    updateModal[0].loadCurrentLabels = function() {
        $.ajax({
            url: '/get/task/' + window.cvat.dashboard.taskID,
            success: function(data) {
                let labels = new LabelsInfo(data.spec);
                oldLabels.attr('value', labels.normalize());

                taskScore = data.score;
                selectPriorityRadioByScore(taskScore)
            },
            error: function(response) {
                oldLabels.attr('value', 'Bad request');
                let message = 'Bad task request: ' + response.responseText;
                throw Error(message);
            }
        });
    };
    
    allUpdateButtons.on('click', function() {
        if (projects[projectIndex].has_score) {
            $('#priority_button').addClass('hidden');
        } else {
            $('#priority_button').removeClass('hidden');
        }
    })

    cancelUpdate.on('click', function() {
        updateModal.addClass('hidden');
    });

    submitUpdate.on('click', function() {
        let annotator = updateAnnotator.find("option:selected").val();

        // -1 if project has score
        let score = taskScore;
        if (!projects[projectIndex].has_score) {
            score =  $("input[name='updatePriorityRadio']:checked").val();
        }
        let labelsString = getLabelsFromTree(newLabelBrowseTree);

        let propertiesString = getFramePropertiesFromTree(newPropertiesBrowseTree);
        if (propertiesString !== "") {
            UpdateTaskPropertiesRequest(propertiesString);
        }

        UpdateTaskRequest(labelsString, score, annotator);
    });
}

function selectPriorityRadioByScore(score) {
    $("input[name='updatePriorityRadio'][value='" + score + "']").prop("checked", true);
}

function setupSearch() {
    let searchInput = $("#dashboardSearchInput");
    let searchSubmit = $("#dashboardSearchSubmit");

    let line = getUrlParameter('search') || "";
    searchInput.val(line);

    searchSubmit.on('click', function() {
        let e = $.Event('keypress');
        e.keyCode = 13;
        searchInput.trigger(e);
    });

    searchInput.on('keypress', function(e) {
        if (e.keyCode != 13) return;
        let filter = e.target.value;
        if (!filter) window.location.search = "";
        else window.location.search = `search=${filter}`;
    });

    function getUrlParameter(name) {
        let regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
        let results = regex.exec(window.location.search);
        return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
    }
}

/* Server requests */
function createTaskRequest(oData, onSuccessRequest, onSuccessCreate, onError, onComplete, onUpdateStatus) {
    $('#dashboardCreateTaskMessage').css('color', 'blue');
    $('#dashboardCreateTaskMessage').text('Downloading...');
    $.ajax({
        url: '/create/task',
        type: 'POST',
        data: oData,
        contentType: false,
        processData: false,
        success: function(data) {
            onSuccessRequest();
            requestCreatingStatus(data);
        },
        error: function(data) {
            onComplete();
            onError(data.responseText);
        }
    });

    function requestCreatingStatus(data) {
        let tid = data.tid;
        let annotationFile = data.annotationFile;
        let request_frequency_ms = 1000;
        let done = false;

        let requestInterval = setInterval(function() {
            $.ajax({
                url: '/check/task/' + tid,
                success: function(res){
                    receiveStatus(res, annotationFile, tid);
                },
                error: function(data) {
                    clearInterval(requestInterval);
                    onComplete();
                    onError(data.responseText);
                }
            });
        }, request_frequency_ms);

        function receiveStatus(data, annotationFile, tid) {
            if (done) return;
            if (data['state'] == 'created') {
                done = true;
                clearInterval(requestInterval);
                onComplete();
                if(data.annotationFile != undefined){
                    parseFile(undefined, data.annotationFile, showOverlay("Loading annotations.."), data.tid, onSuccessCreate);
                    $.ajax({
                        url: '/delete/txt/annotation/task/' + tid,
                        success: function(res){
                        },
                        error: function(data) {
                        }
                    });
                }
                else{
                    onSuccessCreate();
                }
            }
            else if (data['state'] == 'error') {
                done = true;
                clearInterval(requestInterval);
                onComplete();
                onError(data.stderr);
            }
            else if (data['state'] == 'started' && 'status' in data) {
                onUpdateStatus(data['status']);
            }
        }
    }
}

function UpdateTaskRequest(labels, score, annotator) {
    let oData = new FormData();
    
    oData.append('score', score);
    oData.append('labels', labels);
    oData.append('assignee', annotator);

    $.ajax({
        url: '/update/task/' + window.cvat.dashboard.taskID,
        type: 'POST',
        data: oData,
        contentType: false,
        processData: false,
        success: function() {
            window.location.reload();
        },
        error: function(data) {
            showMessage('Task update error. ' + data.responseText);
        },
        complete: () => { $('#dashboardUpdateModal').addClass('hidden'); }
    });
}

function UpdateTaskPropertiesRequest(properties) {
    $.ajax({
        url: '/update/properties/task/' + window.cvat.dashboard.taskID,
        type: 'POST',
        data: JSON.stringify(properties),
        contentType: 'application/json',
        success: function() {
            showMessage('Task successfully updated.');
        },
        error: function(data) {
            showMessage('Task update error. ' + data.responseText);
        },
        complete: () => $('#dashboardUpdateModal').addClass('hidden')
    });
}


function RemoveTaskRequest() {
    confirm('The action can not be undone. Are you sure?', confirmCallback);

    function confirmCallback() {
        $.ajax ({
            url: '/delete/task/' + window.cvat.dashboard.taskID,
            success: function() {
                $(`#dashboardTask_${window.cvat.dashboard.taskID}`).remove();
                
                // Update status task's count
                let status = $(".statustab_link.active").html().split('(')[0]
                let status_count = $(".statustab_link.active").html().split('(')[1].split(')')[0] - 1
                $(".statustab_link.active").html(status + "(" + status_count + ")")
                showMessage('Task removed.');
            },
            error: function(response) {
                let message = 'Abort. Reason: ' + response.responseText;
                showMessage(message);
                throw Error(message);
            }
        });
    }
}

function uploadAnnotationRequest() {
    let input = $('<input>').attr({
        type: 'file',
        accept: 'text/plain, text/xml'
    }).on('change', loadXML).click();

    function loadXML(e) {
        input.remove();
        let overlay = showOverlay("File is being uploaded..");
        let file = e.target.files[0];
        console.log(file);
        let fileReader = new FileReader();
        fileReader.onload = (e) => parseFile(e, file, overlay, window.cvat.dashboard.taskID);
        fileReader.readAsText(file);
    }
}

function parseFile(e, file, overlay, tid, callback) {
    let xmlText;
    if (file.type === "text/plain") {
        let annotationFile = new FormData();
        annotationFile.append('data', file)
        $.ajax({
            url: '/parse/annotation/task/' + tid,
            type: 'POST',
            data: annotationFile,
            contentType: false,
            processData: false,
            success: function(data) {
                xmlText = data;
                saveParsedFile(overlay, tid, callback, xmlText)
            },
            error: function(response) {
                overlay.remove();
                let message = 'Bad task request: ' + response.responseText;
                showMessage(message);
                throw Error(message);
            }
        });
    } else if(e === undefined){
        xmlText = file
        saveParsedFile(overlay, tid, callback, xmlText)
    } else {
        xmlText = e.target.result;
        saveParsedFile(overlay, tid, callback, xmlText)
        console.log(xmlText)
    }
}

function saveParsedFile(overlay, tid, callback, xmlText) {
    overlay.setMessage('Request task data from server..');
    $.ajax({
        url: '/get/task/' + tid,
        success: function(data) {
            let annotationParser = new AnnotationParser(
                {
                    start: 0,
                    stop: data.size,
                    image_meta_data: data.image_meta_data,
                    flipped: data.flipped
                },
                new LabelsInfo(data.spec),
                new ConstIdGenerator(-1)
            );

            let asyncParse = function() {
                let parsed = null;
                try {
                    parsed = annotationParser.parse(xmlText);
                }
                catch(error) {
                    overlay.remove();
                    showMessage("Parsing errors was occurred. " + error);
                    return;
                }

                let asyncSave = function() {
                    $.ajax({
                        url: '/delete/annotation/task/' + tid,
                        type: 'DELETE',
                        success: function() {
                            asyncSaveChunk(0);
                        },
                        error: function(response) {
                            let message = 'Previous annotations cannot be deleted: ' +
                                response.responseText;
                            showMessage(message);
                            overlay.remove();
                        },
                    });
                };

                let asyncSaveChunk = function(start) {
                    const CHUNK_SIZE = 100000;
                    let end = start + CHUNK_SIZE;
                    let chunk = {};
                    let next = false;
                    for (let prop in parsed) {
                        if (parsed.hasOwnProperty(prop)) {
                            chunk[prop] = parsed[prop].slice(start, end);
                            next |= chunk[prop].length > 0;
                        }
                    }

                    if (next) {
                        let exportData = createExportContainer();
                        exportData.create = chunk;

                        $.ajax({
                            url: '/save/annotation/task/' + tid,
                            type: 'POST',
                            data: JSON.stringify(exportData),
                            contentType: 'application/json',
                            success: function() {
                                asyncSaveChunk(end);
                            },
                            error: function(response) {
                                let message = 'Annotations uploading errors were occurred: ' +
                                    response.responseText;
                                showMessage(message);
                                overlay.remove();
                            },
                        });
                    } else {
                        let message = 'Annotations were uploaded successfully';
                        showMessage(message);
                        overlay.remove();
                        if(callback != undefined){
                            setTimeout(callback, 2500);
                        }
                    }
                };

                overlay.setMessage('Annotation is being saved..');
                setTimeout(asyncSave);
            };

            overlay.setMessage('File is being parsed..');
            setTimeout(asyncParse);
        },
        error: function(response) {
            overlay.remove();
            let message = 'Bad task request: ' + response.responseText;
            showMessage(message);
            throw Error(message);
        }
    });
}