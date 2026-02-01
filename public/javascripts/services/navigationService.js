/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global angular,$ */

var managementApp = angular.module('managementApp');

managementApp.service('navigationService', function(){
	this.navigate = function(url) {
		$.pjax({ url: url, container: '.content', timeout: 5000 });
	};
});
