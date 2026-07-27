/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

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