function setupProjectManager() {
    let dashboardProjectManagerModal = $('#dashboardProjectManagerModal');
    let showProjectManagerModalButton = $('#showProjectManagerModalButton');
    let dashboardProjectManagerMessage = $('#dashboardProjectManagerMessage');

    let availableUsers = $('#availableUsers');
    let assignedUsers = $('#assignedUsers');
    let addSelectedUsers = $('#addSelectedUsers');
    let removeSelectedUsers = $('#removeSelectedUsers');

    let projectsFilterInput = $('#projectsFilterInput');
    let usersFilterInput = $('#usersFilterInput');
    let assignedUsersFilterInput = $('#assignedUsersFilterInput');
    
    let submitProjectManager = $('#dashboardSubmitProjectManager');
    let cancelProjectManager = $('#dashboardCancelProjectManager');

    let availableProjects = $('#availableProjects');

    let usersAndProjectsLoaded = false;
    
    let getAllUsers = function() {
        // Gets every username in the system except for the current one and the superuser
        $.ajax({
            url: 'get/allUsers',
            type: 'GET',
            async: false,
            success: function(data) {
                let usernames = []

                usernames = data['usernames'];
                // Iterate over all of the usernames and add them to the select box, mark manager usernames in bold.
                for (username in usernames) {
                    let option = $("<option></option>").text(usernames[username]).val(usernames[username]);
                    option.css("font-size", "15px");
                    if (data['managers'].includes(usernames[username])) {
                        option.css("font-weight", "bold");
                    }
                    availableUsers.append(option);
                }
            }
        });
    }

    let getAllProjects = function() {
        // Get all projects related to the current user
        $.ajax({
            url: 'get/projects',
            type: 'GET',
            async: false,
            success: function(data) {
                // Add all of the projects related to the user to the projects select box
                for (let i = 0; i < Object.keys(data).length; i++) {
                    let option = $("<option></option>").text(data[i].name).val(data[i].name);
                    option.css("font-size", "15px");
                    availableProjects.append(option);
                }
            }
        });
        
        // Sort all of the projects and select the first one.
        sortOptions(availableProjects);
        availableProjects.val($('#availableProjects option:first').val());
        availableProjects.trigger('change');
    }

    // Sends a request to the server to check if the current user is a manager.
    // If the user is a manager replace all of the request validation buttons with finish task in order to instantly close a task with annotation status.
    $.ajax({
        url: "is_manager",
        error: function() {
            $("#dashboardCreateTaskButton").replaceWith('<text class="semiBold" style="font-size:50px; color:#09c;"> CVAT </text>');
            $(".isManager").remove();
        }
    });
    
    showProjectManagerModalButton.on('click', function() {
        if (!usersAndProjectsLoaded) {
            getAllUsers();
            getAllProjects();
            usersAndProjectsLoaded = true;
        }
        dashboardProjectManagerModal.removeClass('hidden');
    });

    // Sorts the options in a select element
    let sortOptions = function(selectElement) {
        selectElement.html(selectElement.find('option').sort(function(x, y) {
            return $(x).text() > $(y).text() ? 1 : -1;
        }));
    };

    let getUsersForProject = function(projectName) {
        $.ajax({
            url: 'get/userForProject/' + projectName,
            type: 'GET',
            success: function(data) {
                // Remove every user from assigned users box
                $.each($("#assignedUsers option"), function() {
                    $(this).appendTo("#availableUsers");
                    $(this).prop("selected", false);
                });

                // Add every user related to the project to assigned users
                $.each($("#availableUsers option"), function() {
                    if (data.includes($(this).val())){
                        $(this).appendTo("#assignedUsers");
                        $(this).prop("selected", false);
                    }
                });
                availableUsers.trigger('change');
                assignedUsers.trigger('change');
                sortOptions(availableUsers);
                sortOptions(assignedUsers);
            }
        });
    }

    // Every time a new project is selected get all of the related users to that project and put them
    // in the assigned users select box
    availableProjects.on('change', function() {
        let projectName = $('#availableProjects option:selected').val();
        getUsersForProject(projectName);
    });

    // If more than one user is selected highlight the arrow to move the user to the other select box
    availableUsers.on('change', function() {
        if ($("#availableUsers option:selected").length > 0) {
            addSelectedUsers.addClass("active");
        } else {
            addSelectedUsers.removeClass("active");
        }
    });
    
    assignedUsers.on('change', function() {
        if ($("#assignedUsers option:selected").length > 0) {
            removeSelectedUsers.addClass("active");
        } else {
            removeSelectedUsers.removeClass("active");
        }
    });

    // After the arrow is clicked move all of the selected usernames to the other select box
    addSelectedUsers.on('click', function() {
        if (addSelectedUsers.hasClass('active')) {
            $.each($("#availableUsers option:selected"), function() {
                $(this).appendTo("#assignedUsers");
                $(this).prop("selected", false);
            });
            filterByText(assignedUsers, assignedUsersFilterInput);
            sortOptions(assignedUsers);
            availableUsers.trigger('change');
            assignedUsers.trigger('change');
        }
    });

    removeSelectedUsers.on('click', function() {
        if (removeSelectedUsers.hasClass('active')) {
            $.each($("#assignedUsers option:selected"), function() {
                $(this).appendTo("#availableUsers");
                $(this).prop("selected", false);
            });
            filterByText(availableUsers, usersFilterInput);
            sortOptions(availableUsers);
            assignedUsers.trigger('change');
            availableUsers.trigger('change');
        }
    });

    projectsFilterInput.on('input', function() {
        filterByText(availableProjects, projectsFilterInput);
        if ( $("#availableProjects option:visible").length === 0) {
            availableUsers.prop('disabled', true);
        } else {
            availableUsers.prop('disabled', false);
        }
    });

    usersFilterInput.on('input', function() {
        filterByText(availableUsers, usersFilterInput);
    });

    assignedUsersFilterInput.on('input', function() {
        filterByText(assignedUsers, assignedUsersFilterInput);
    });

    let filterByText = function(selectBox, textBox) {
        // Go over each option in the given select box, deselect every selected option.
        $(selectBox).find('option').each(function() {
            $(this).prop("selected", false);

            // Create a regular expression to look for every matching option, hide the ones that don't match.
            var search = $.trim($(textBox).val());
            var regex = new RegExp(search, "gi");
            if ($(this).val().match(regex) === null) {
                $(this).hide();
            } else {
                $(this).show();
            }
        });
        // If the given select box was the available projects one, select the first matching option and get all of the related users for it.
        if ($(selectBox)[0].id === "availableProjects") {
            sortOptions(availableProjects);
            // If the search box is empty select the first option, otherwise select the first non hidden option.
            if ($.trim($(textBox).val()) == "") {
                availableProjects.val($('#availableProjects option:first').val());
            } else {
                $('#' + $(selectBox)[0].id + ' option').each(function() {
                    if ($(this).css('display') != 'none') {
                        $(this).prop("selected", true);
                        return;
                    }
                });
            }
            availableProjects.trigger('change');
        } else {
            $('#' + $(selectBox)[0].id).trigger('change');
        }
    }

    submitProjectManager.on('click', function() {
        // Get every username in the assigned users table
        let assignedUsersToSave = [];
        $.each($("#assignedUsers option"), function() {
            assignedUsersToSave.push($(this).text());
        });

        // Get the selected project name
        let projectName = $('#availableProjects option:selected').val();

        let dataToSave = {
            usernames: assignedUsersToSave,
            projectName: projectName,
        }

        // Send a request to the server to create relations with all of the selected users
        $.ajax({
            type: "POST",
            url: "save_users_to_projects",
            contentType: "application/json",
            data: JSON.stringify(dataToSave),
            success: function() {
                window.location.reload()
            },
            error: function(response) {
                dashboardProjectManagerMessage.css('color', 'red');
                if (response.status == 403) {
                    dashboardProjectManagerMessage.text('Error: You do not have permission to do that');
                } else {
                    dashboardProjectManagerMessage.text('Error: ' + response.responseText);
                }
            }
        });
    });

    cancelProjectManager.on('click', function() {
        dashboardProjectManagerModal.addClass('hidden');
    });
}