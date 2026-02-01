/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global angular */

var managementApp = angular.module('managementApp');

managementApp.directive('isIndeterminate', function() {
	return {
		restrict: 'A',
		link: function(scope, element, attributes) {
			scope.$watch(attributes['isIndeterminate'], function(value) {
				element[0].indeterminate = Boolean(value);
			});
		}
	};
});