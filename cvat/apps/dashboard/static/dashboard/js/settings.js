var clicked = false;

function setupSettings() {
    let dashboardLabelAddModal = $('#dashboardLabelAddModal');
    let showAddLabelModalButton = $('#showAddLabelModalButton');

    let labelsSettingstab = $('#labelsSettingstab');
    let framePropertiesSettingstab = $('#framePropertiesSettingstab');
    let projectsSettingstab = $('#projectsSettingstab');

    let colorDiv = $('#colorDiv');
    let settingsColorpicker = $('#label_colorpicker');
    let settingsColortext = $('#label_colortext');

    let EditLabelsBrowseTree = $('#dashboardEditLabels');
    let EditFrameProepertiesBrowseTree = $('#dashboardEditFrameProeperties');
    let EditProjectsBrowseTree = $('#dashboardEditProjects');

    let newLabelButton = $('#newLabelButton');
    let renameLabelButton = $('#renameLabelButton');
    let removeLabelButton = $('#removeLabelButton');

    let newFramePropertyButton = $('#newFramePropertyButton');
    let renameFramePropertyButton = $('#renameFramePropertyButton');
    let removeFramePropertyButton = $('#removeFramePropertyButton');

    let newProjectButton = $('#newProjectButton');
    let renameProjectButton = $('#renameProjectButton');
    let removeProjectButton = $('#removeProjectButton');

    let isProjectScored = $("#isProjectScored");
    
    let prevProject = $('#dashboardProjectSelectorPrev');
    let nextProject = $('#dashboardProjectSelectorNext');

    let labelsColors = {};

    document.getElementById("open_tasks_button").click();
    document.getElementById("attributes_button").click();

    $.ajax({
        url: "is_admin",
        error: function () {
            $(".isAdmin").remove();
            $("#projectsSettingstab").remove();
        }
    });

    function getLabelColors() {
        $.ajax({
            url: "get_labels_db",
            success: function (data) {
                for (let key in data) {
                    labelsColors[key] = data[key];
                }
            },
            error: function (response) {
                $('#dashboardLabelTaskMessage').css('color', 'red');
                if (response.status == 403) {
                    $('#dashboardLabelTaskMessage').text('Error: You do not have permission to do that');
                } else {
                    $('#dashboardLabelTaskMessage').text('Error: ' + response.responseText);
                }
            }
        });
    }

    getLabelColors();

    fillTreesForProjects(EditLabelsBrowseTree);
    fillTreesForProjects(EditFrameProepertiesBrowseTree);
    createJsTree(EditProjectsBrowseTree, 'get_projects_nodes');

    prevProject.on("click", function() {
        showJsTreeForProject(EditLabelsBrowseTree);
        showJsTreeForProject(EditFrameProepertiesBrowseTree);
    });
    
    nextProject.on("click", function() {
        showJsTreeForProject(EditLabelsBrowseTree);
        showJsTreeForProject(EditFrameProepertiesBrowseTree);
    });

    newLabelButton.on('click', () => createNode(EditLabelsBrowseTree));
    renameLabelButton.on('click', () => renameNode(EditLabelsBrowseTree));
    removeLabelButton.on('click', () => deleteNode(EditLabelsBrowseTree));

    newFramePropertyButton.on('click', () => createNode(EditFrameProepertiesBrowseTree));
    renameFramePropertyButton.on('click', () => renameNode(EditFrameProepertiesBrowseTree));
    removeFramePropertyButton.on('click', () => deleteNode(EditFrameProepertiesBrowseTree));

    newProjectButton.on('click', () => createNode(EditProjectsBrowseTree));
    renameProjectButton.on('click', () => renameNode(EditProjectsBrowseTree));
    removeProjectButton.on('click', () => deleteNode(EditProjectsBrowseTree));


    EditLabelsBrowseTree.on("loaded.jstree refresh.jstree", function () {
        EditLabelsBrowseTree.jstree("open_node", "$$$");
    });

    EditLabelsBrowseTree.on("changed.jstree", function (e, data) {
        // Each time a node is selected on the labels tree, change the colorPickers color to the relavent color of the
        // selected label.
        if (data.action === "select_node") {
            let color = "";
            // If the parent is '$$$' the selected node is a label and it holds a color in the labelColors list.
            if (data.node.parent === "$$$") {
                color = labelsColors[data.node.text];
            }
            // If the parent isn't '$$$' and also it is not '#' meaning it isn't 'All Labels' get the color according to
            // label node.
            if (data.node.parent !== "$$$" && data.node.parent !== "#") {
                color = labelsColors[EditLabelsBrowseTree.jstree()._model.data[data.node.parent.split("/")[0]].text];
            }
            settingsColorpicker.val(color);
            settingsColortext.val(color);
        }

        // Show the color div only if the selected node is a label.
        if (data.action === "select_node" && data.node.parent === "$$$") {
            colorDiv.show();
        } else {
            colorDiv.hide();
        }

        if (data.action === "delete_node") {
            let messageDiv = $('#dashboardLabelTaskMessage');
            let dataToSend = {};
            let url = "";

            if (data.node.parent === "$$$") {
                dataToSend = {
                    'labelName': data.node.text,
                    'project': projects[projectIndex].id
                }
                url = "delete_label";
            } else if (data.node.id.split("/").length == 2) {
                dataToSend = {
                    'labelName': EditLabelsBrowseTree.jstree()._model.data[data.node.parent].text,
                    'attributeName': data.node.text,
                    'project': projects[projectIndex].id
                }
                url = "delete_attribute";
            } else if (data.node.id.split("/").length == 3) {
                dataToSend = {
                    'labelName': EditLabelsBrowseTree.jstree()._model.data[data.node.parent.split("/")[0]].text,
                    'attributeName': EditLabelsBrowseTree.jstree()._model.data[data.node.parent].text,
                    'valueName': data.node.text,
                    'project': projects[projectIndex].id
                }
                url = "delete_value";
            }

            sendDeleteDataToServer(url, dataToSend, EditLabelsBrowseTree, messageDiv);
        }
    });

    EditLabelsBrowseTree.on("rename_node.jstree", function (e, targetNode) {
        if (targetNode.text !== targetNode.old) {
            let treeModel = EditLabelsBrowseTree.jstree()._model;
            let nodeLevel = 0;
            let data = {};
            let messageDiv = $('#dashboardLabelTaskMessage');

            // If the node was changed and isn't a new node, send a request to rename it in the db if it is valid.
            if (validateLabelNodeName(targetNode.text)) {
                if (targetNode.old !== "New node") {
                    data = {
                        oldName: targetNode.old,
                        newName: targetNode.text,
                        // Get the text for the parent node of the changed node.
                        parent: treeModel.data[targetNode.node.parent].text,
                        project: projects[projectIndex].id
                    }

                    // Get the node level in the tree hierarchy:
                    // 1 is a label, 2 is an attribute, 3 is a value
                    nodeLevel = targetNode.node.id.split('/').length

                    switch (nodeLevel) {
                        case 1:
                            sendUpdateDataToServer("update_label", data, targetNode, EditLabelsBrowseTree, messageDiv);
                            break;

                        case 2:
                            sendUpdateDataToServer("update_attribute", data, targetNode, EditLabelsBrowseTree, messageDiv);
                            break;

                        case 3:
                            data['attribute'] = data['parent'];
                            data['label'] = treeModel.data[targetNode.node.parent.split('/')[0]].text;
                            sendUpdateDataToServer("update_value", data, targetNode, EditLabelsBrowseTree, messageDiv);
                            break;

                        default:
                            break;
                    }
                } else {
                    let url = "save_label_type_db";
                    let parentId = targetNode.node.parent;

                    // If the parent contains "j" that means the parent node is a newly createad one,
                    // meaning the current node is the value for that new attribute node.
                    if (parentId.includes("j")) {
                        let attributeNode = treeModel.data[parentId];
                        let labelNode = treeModel.data[attributeNode.parent];
                        data = {
                            label: labelNode.text,
                            attribute: attributeNode.text,
                            change: true,
                            value: targetNode.text,
                            color: settingsColortext.val(),
                            project: projects[projectIndex].id
                        };
                        sendSaveDataToServer(url, data, EditLabelsBrowseTree, messageDiv);
                    } else {
                        // If the parent is not "All labels" the newly added node is either an attribute
                        // or a value. Otherwise the newly added node is a label.
                        if (parentId !== "$$$") {
                            let attributeNode;
                            let labelNode;

                            // Get the node level in the tree hierarchy:
                            // 1 is an attribute, 2 is a value
                            nodeLevel = parentId.split('/').length

                            switch (nodeLevel) {
                                // A new attribute can't be saved without a value
                                case 1:
                                    attributeNode = targetNode;
                                    labelNode = treeModel.data[parentId];
                                    data = {
                                        label: labelNode.text,
                                        attribute: attributeNode.text,
                                        change: true,
                                        value: "",
                                        color: settingsColortext.val(),
                                        project: projects[projectIndex].id
                                    };
                                    sendSaveDataToServer(url, data, EditLabelsBrowseTree, messageDiv);
                                    break;

                                case 2:
                                    attributeNode = treeModel.data[parentId];
                                    labelNode = treeModel.data[attributeNode.parent];
                                    data = {
                                        label: labelNode.text,
                                        attribute: attributeNode.text,
                                        change: "",
                                        value: targetNode.text,
                                        color: settingsColortext.val(),
                                        project: projects[projectIndex].id
                                    };
                                    sendSaveDataToServer(url, data, EditLabelsBrowseTree, messageDiv);
                                    break;
                            }
                        } else {
                            settingsColorpicker.trigger("change");
                        }
                    }
                }
            } else {
                messageDiv.css('color', 'red');
                messageDiv.text('Invalid name');

                // If an error occurred do not change the node text.
                targetNode.node.text = targetNode.old;
                EditLabelsBrowseTree.jstree("refresh");
            }
            // Update the color to what exists on the server after the saving proccess finishes.
            setTimeout(() => {
                getLabelColors();
            }, 100);
        } else {
            EditLabelsBrowseTree.jstree("refresh");
        }
    });

    // Each time the frame properties tree is loaded or refreshed, open the root node.
    EditFrameProepertiesBrowseTree.on("loaded.jstree refresh.jstree", function () {
        EditFrameProepertiesBrowseTree.jstree("open_node", "$$$");
    });

    EditFrameProepertiesBrowseTree.on("changed.jstree", function (e, data) {
        if (data.action === "delete_node") {
            if (data.node.id !== "$$$") {
                let messageDiv = $('#dashboardFramePropertyMessage');
                let dataToSend = {};
                let url = "";

                if (data.node.parent === "$$$") {
                    dataToSend = {
                        'frameProp': data.node.text,
                        'project': projects[projectIndex].id
                    }
                    url = "delete_frameProp";
                } else {
                    dataToSend = {
                        'frameProp': EditFrameProepertiesBrowseTree.jstree()._model.data[data.node.parent].text,
                        'value': data.node.text,
                        'project': projects[projectIndex].id
                    }
                    url = "delete_frameProp_value";
                }

                sendDeleteDataToServer(url, dataToSend, EditFrameProepertiesBrowseTree, messageDiv);
            }
        }
    });

    EditFrameProepertiesBrowseTree.on("rename_node.jstree", function (e, targetNode) {
        if (targetNode.text !== targetNode.old) {
            let messageDiv = $('#dashboardFramePropertyMessage');
            let url = "";
            let data = {};

            // If the node was changed and isn't a new node, send a request to rename it in the db if it is valid.
            if (targetNode.old !== "New node") {
                if (targetNode.node.parent === "$$$") {
                    url = "update_frameProperty";
                    data = {
                        oldName: targetNode.old,
                        newName: targetNode.text,
                        project: projects[projectIndex].id
                    }
                } else {
                    url = "update_frameValue";
                    data = {
                        oldName: targetNode.old,
                        newName: targetNode.text,
                        frameProp: EditFrameProepertiesBrowseTree.jstree()._model.data[targetNode.node.parent].text,
                        project: projects[projectIndex].id
                    }
                }

                sendUpdateDataToServer(url, data, targetNode, EditFrameProepertiesBrowseTree, messageDiv);
            } else {
                if (targetNode.node.parent !== "$$$") {
                    url = "save_frame_property_to_db";
                    data = {
                        property: EditFrameProepertiesBrowseTree.jstree()._model.data[targetNode.node.parent].text,
                        value: targetNode.node.text,
                        project: projects[projectIndex].id
                    }

                    sendSaveDataToServer(url, data, EditFrameProepertiesBrowseTree, messageDiv);
                }
            }
        } else {
            EditFrameProepertiesBrowseTree.jstree("refresh");
        }
    });

    EditProjectsBrowseTree.on("loaded.jstree refresh.jstree", function () {
        EditProjectsBrowseTree.jstree("open_node", "$$$");
    });

    EditProjectsBrowseTree.on("changed.jstree", function (e, data) {
        if (data.action === "select_node") {
            if (data.node.id !== "$$$") {
                $.ajax({
                    url: "project/" + data.node.text + "/has_score",
                    success: function (response) {
                        // Check or uncheck has_score according to the project value in the db.
                        if (response === "True") {
                            isProjectScored.prop("checked", true);
                        } else {
                            isProjectScored.prop("checked", false);
                        }
                    }
                });
            }
        } else if (data.action === "delete_node") {
            if (data.node.id !== "$$$") {
                let messageDiv = $('#dashboardProjectMessage');
                let dataToSend = {
                    "projectName": data.node.text
                };
                let url = "delete_project";

                sendDeleteDataToServer(url, dataToSend, EditProjectsBrowseTree, messageDiv);
            }
        }

        if (data.action === "select_node" && data.node.id === "$$$") {
            $("#hasScoreDiv").hide();
        } else {
            $("#hasScoreDiv").show();
        }
    });

    EditProjectsBrowseTree.on("rename_node.jstree", function (e, targetNode) {
        // If the node was changed and isn't a new node, send a request to rename it in the db if it is valid.
        if (targetNode.text !== targetNode.old) {
            let messageDiv = $('#dashboardProjectMessage');
            if (targetNode.old !== "New node") {

                if (validateProjectName(targetNode.text)) {
                    let data = {
                        oldName: targetNode.old,
                        newName: targetNode.text,
                    }

                    sendUpdateDataToServer("update_project_name", data, targetNode, EditProjectsBrowseTree, messageDiv);
                } else {
                    messageDiv.css('color', 'red');
                    messageDiv.text('Invalid project name');

                    // If an error occurred do not change the node text.
                    targetNode.node.text = targetNode.old;
                    EditProjectsBrowseTree.jstree("refresh");
                }
            } else {
                let url = "create_project";
                let dataToSave = {
                    projectName: targetNode.text,
                    isScored: $("#isProjectScored").prop("checked")
                }

                if (validateProjectName(targetNode.text)) {
                    sendSaveDataToServer(url, dataToSave, EditProjectsBrowseTree, messageDiv);
                    $("#isProjectScored").prop("checked", false);
                } else {
                    messageDiv.css('color', 'red');
                    messageDiv.text('Invalid project name');

                    // If an error occurred do not change the node text.
                    targetNode.node.text = targetNode.old;
                    EditProjectsBrowseTree.jstree("refresh");
                }
            }
        } else {
            EditProjectsBrowseTree.jstree("refresh");
        }
    });

    isProjectScored.on("click", function () {
        let messageDiv = $('#dashboardProjectMessage');
        let projectName = EditProjectsBrowseTree.jstree("get_selected", true)[0].text;
        let projectScore = isProjectScored.prop("checked").toString();
        $.ajax({
            url: "update/project/" + projectName + "/has_score/" + projectScore,
            error: function (response) {
                messageDiv.css('color', 'red');
                if (response.status == 403) {
                    messageDiv.text('Error: You do not have permission to do that');
                } else {
                    messageDiv.text('Error: ' + response.responseText);
                }
                EditProjectsBrowseTree.jstree("refresh");
            }
        });
    });

    showAddLabelModalButton.on('click', function () {
        dashboardLabelAddModal.removeClass('hidden');
    });

    $(window).on('keydown', (event) => {
        let currentBrowseTree = $($("#labelAddModalForm > div:visible > div > div")[0]);
        if (currentBrowseTree.length > 0) {
            if (event.keyCode == 46) {
                if (currentBrowseTree.jstree("get_selected").length) {
                    deleteNode(currentBrowseTree);
                }
            } else if (event.keyCode == 107) {
                if (clicked) {
                    clicked = false;
                    setTimeout(() => {currentBrowseTree.jstree("refresh");}, 50);
                } else {
                    if (currentBrowseTree.jstree("get_selected").length) {
                        clicked = true;
                        createNode(currentBrowseTree);
                    }
                }
            }
        }
    });

    function updateColorInputs(fromInput, toInput) {
        var checkHexColor = /^#[0-9A-F]{6}$/i.test(fromInput.val());

        // If text is in hex format then change the colorpicker's color.
        if (checkHexColor) {
            toInput.val(fromInput.val());
            color = fromInput.val();
        }
    }

    function colorPickerHandler() {
        updateColorInputs(settingsColorpicker, settingsColortext);
        let node = EditLabelsBrowseTree.jstree().get_node(EditLabelsBrowseTree.jstree().get_selected());
        let url = "";
        let messageDiv = $('#dashboardLabelTaskMessage');
        if (node.id !== "$$$") {
            url = "update_label_color";
            let label = node.text;
            let dataToSend = {
                "labelName": label,
                "newColor": settingsColorpicker.val(),
                "project": projects[projectIndex].id
            }
            sendUpdateDataToServer(url, dataToSend, node, EditLabelsBrowseTree, messageDiv);
        } else {
            url = "save_label_type_db";
            let targetNode;
            node.children.forEach(function (element) {
                if (element.includes("j")) {
                    targetNode = EditLabelsBrowseTree.jstree().get_node(element);
                }
            });
            data = {
                label: targetNode.text,
                attribute: "",
                change: "",
                value: "",
                color: settingsColortext.val(),
                project: projects[projectIndex].id
            };
            sendSaveDataToServer(url, data, EditLabelsBrowseTree, messageDiv);
        }
    }

    settingsColorpicker.on("change", colorPickerHandler);

    settingsColortext.on("input", function () {
        updateColorInputs(settingsColortext, settingsColorpicker);
    });

    settingsColortext.on("blur", () => { settingsColorpicker.trigger("change"); });

    labelsSettingstab.on('click', function (e) {
        switchSetting(e, 'labels_config');
    });

    framePropertiesSettingstab.on('click', function (e) {
        switchSetting(e, 'properties_config');
    });

    projectsSettingstab.on('click', function (e) {
        switchSetting(e, 'projects_config');
    });

    document.getElementById("labelsSettingstab").click();

    function fillTreesForProjects(browseTree) {
        url = ""
        if (browseTree === EditLabelsBrowseTree) {
            url = 'get_labels_nodes'
        } else if (browseTree === EditFrameProepertiesBrowseTree) {
            url = 'get_frameprops_nodes'
        } 

        $.ajax({
            url: url,
            type: 'GET',
            browseTreeName: browseTree[0].id,
            success: function(data) {
                for (let i = 0; i < Object.keys(projects).length; i++) {
                    projects[i][this.browseTreeName] = data[projects[i].id];
                }
            },
            complete: function() {
                showJsTreeForProject(browseTree);
            }
        });
    }

    function showJsTreeForProject(browseTree) {
        browseTree.jstree({
            core: {
                multiple: false,
                check_callback: true,
                themes: {
                    icons: false
                }
            },
            plugins: ['wholerow', 'sort'],
        });

        browseTree.jstree(true).settings.core.data = projects[projectIndex][browseTree[0].id];
        browseTree.jstree(true).refresh();
    }

    function createJsTree(browseTree, url) {
        browseTree.jstree({
            core: {
                multiple: false,
                check_callback: true,
                data: {
                    url: url,
                    data: (node) => { return {'id': node.id}; }
                },
                themes: {
                    icons: false
                }
            },
            plugins: ['wholerow', 'sort'],
        });
    }

    function createNode(browseTree) {
        var ref = browseTree.jstree(true);

        // Gets the selected nodes as a list.
        var sel = ref.get_selected();

        if (!sel.length) {
            return false;
        }

        // Gets the id as a string and not as list.
        sel = sel[0]

        // Get the parent node id if necessary.
        if ((sel.split("/").length == 3 && ref.element[0].id.includes("Labels")) ||
            (sel.split("/").length == 2 && ref.element[0].id.includes("FrameProeperties")) ||
            (sel !== "$$$" && ref.element[0].id.includes("Projects"))) {
            sel = ref.get_parent(sel);
        }

        if ((ref.element[0].id.includes("Projects") && sel === "$$$")  ||
            ref.element[0].id.includes("Labels") || ref.element[0].id.includes("FrameProeperties")) {
            sel = ref.create_node(sel);
        }

        // Wait for the node to be created before trying to edit it.
        setTimeout(() => {
            if (sel) {
                ref.edit(sel, "New node", function (node, status, is_canceled) {
                    if (is_canceled) {
                        if (node.parent.includes("j")) {
                            this.delete_node(node.parent);
                        }
                        this.delete_node(node);
                    }
                    if (this.element[0].id.includes("FrameProeperties")) {
                        if (node.parent === "$$$") {
                            this.deselect_all();
                            this.select_node(node);
                            createNode($(this.element[0]));
                        }
                    }
                });
            }
        }, 50);
    }

    function renameNode(browseTree) {
        var ref = browseTree.jstree(true);

        // Gets the selected nodes as a list
        var sel = ref.get_selected();

        if (!sel.length) {
            return false;
        }

        // Gets the id as a string and not as list
        sel = sel[0];

        if (ref._model.data[sel].id !== "$$$") {
            ref.edit(sel);
        }
    };

    function deleteNode(browseTree) {
        var ref = browseTree.jstree(true);

        // Gets the selected nodes as a list
        var sel = ref.get_selected();

        if (!sel.length) {
            return false;
        }

        if (ref._model.data[sel].id !== "$$$") {
            ref.delete_node(sel);
        }
    }

    function validateLabelNodeName(text) {
        // Makes sure the given text only contains characters, numbers or "_", "-" special characters.
        let re = /^[\d\w_-]+$/;
        if (re.test(text)) {
            return true;
        }
        return false;
    }

    function validateProjectName(text) {
        // Makes sure the given text contains at least one character or number.
        let re = /^(?=.*[\w\d]).+$/;
        if (re.test(text)) {
            return true;
        }
        return false;
    }

    function validateEventName(text) {
        // Makes sure the given text contains at least one character or number.
        let re = /^(?=.*[\w\d]).+$/;
        if (re.test(text)) {
            return true;
        }
        return false;
    }

    function sendSaveDataToServer(url, dataToSend, browseTree, messageDiv) {
        $.ajax({
            type: "POST",
            url: url,
            contentType: "application/json",
            data: JSON.stringify(dataToSend),
            success: function () {
                messageDiv.text('');
                settingsColorpicker.val("");
                settingsColortext.val("");
                getLabelColors();
                clicked = false;
                if (browseTree[0].id.includes("Projects")) {
                    browseTree.jstree("refresh");
                } else {
                    fillTreesForProjects(browseTree);
                }
            },
            error: function (response) {
                messageDiv.css('color', 'red');
                if (response.status == 403) {
                    messageDiv.text('Error: You do not have permission to do that');
                } else {
                    messageDiv.text('Error: ' + response.responseText);
                }
                clicked = false;
                browseTree.jstree("refresh");
            }
        });
    }

    function sendUpdateDataToServer(url, dataToSend, targetNode, browseTree, messageDiv) {
        $.ajax({
            url: url,
            type: "POST",
            contentType: "application/json",
            data: JSON.stringify(dataToSend),
            success: function () {
                messageDiv.text('');
                if (browseTree[0].id.includes("Projects")) {
                    browseTree.jstree("refresh");
                } else {
                    fillTreesForProjects(browseTree);
                }
                getLabelColors();
            },
            error: function (response) {
                messageDiv.css('color', 'red');
                if (response.status == 403) {
                    messageDiv.text('Error: You do not have permission to do that');
                } else {
                    messageDiv.text('Error: ' + response.responseText);
                }
                // If an error occurred do not change the node text.
                targetNode.node.text = targetNode.old;
                browseTree.jstree("refresh");
            }
        });
    }

    function sendDeleteDataToServer(url, dataToSend, browseTree, messageDiv) {
        $.ajax({
            type: "POST",
            url: url,
            contentType: "application/json",
            data: JSON.stringify(dataToSend),
            success: function () {
                messageDiv.text('');
                if (browseTree[0].id.includes("Projects")) {
                    browseTree.jstree("refresh");
                } else {
                    fillTreesForProjects(browseTree);
                }
            },
            error: function (response) {
                messageDiv.css('color', 'red');
                if (response.status == 403) {
                    messageDiv.text('Error: You do not have permission to do that');
                } else {
                    messageDiv.text('Error: ' + response.responseText);
                }
                browseTree.jstree("refresh");
            }
        });
    }
}