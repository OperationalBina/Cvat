/*
 * Copyright (C) 2018 Intel Corporation
 *
 * SPDX-License-Identifier: MIT
 */

"use strict";

window.addEventListener('DOMContentLoaded', () => {
    $(`<button class="menuButton semiBold h2"> Open Task </button>`).on('click', () => {
        let win = window.open(`${window.location.origin }/dashboard/?jid=${window.cvat.job.id}`, '_blank');
        win.focus();
    }).prependTo('#engineMenuButtons');

    $(`<button class="menuButton semiBold h2"> Back To Dashboard </button>`).on('click', () => {
        window.location = `${ window.location.origin }/dashboard/`;
    }).prependTo('#engineMenuButtons');
});

