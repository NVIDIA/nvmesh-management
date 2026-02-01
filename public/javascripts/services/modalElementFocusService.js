/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global angular,$ */

var managementApp = angular.module('managementApp');

managementApp.service('modalElementFocusService', function(){
	this.focus = function(modalName, elementID) {
		$('#' + modalName).on('shown.bs.modal', function() { $('#' + elementID).focus(); });
	};
});