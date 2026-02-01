/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global angular */

var managementApp = angular.module('managementApp');

managementApp.service('nextPageService', function(){
	this.setData = function(data) {
		this.data = data;
	};

	this.getData = function() {
		var data = this.data;
		this.data = null;
		return data;
	};
});
