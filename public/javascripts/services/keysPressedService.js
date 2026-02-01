/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global angular */

var managementApp = angular.module('managementApp');

managementApp.service('keysPressedService', function(){

	var isShiftDown = false;
	this.shiftDown = function() {
		isShiftDown = true;
	};

	this.shiftUp = function() {
		isShiftDown = false;
	};

	this.isShiftDown = function() {
		return isShiftDown;
	};
});
