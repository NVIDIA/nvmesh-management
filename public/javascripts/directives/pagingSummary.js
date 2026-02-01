/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global angular */
var managementApp = angular.module('managementApp');

managementApp.directive('pagingSummary', function() {
	return {
		restrict: 'E',
		templateUrl: '/javascripts/directives/pagingSummary.html',
		scope: {
			lastItemIndex: '=',
			currentPage: '=',
			count: '=',
			total: '='
		}
	};
});
