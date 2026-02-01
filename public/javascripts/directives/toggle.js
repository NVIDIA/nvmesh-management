/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global angular */
var managementApp = angular.module('managementApp');

managementApp.directive('toggle', function($timeout) {
	return {
		restrict: 'E',
		template: '<label class="toggle-label">{{label}}</label><span class="negative">{{negative}}</span>'
				+ '<label class="switch"><input type="checkbox" ng-model="value" ng-disabled="disabled" ng-change="InvokeOnChangeOnNextDigest()">'
					+ '<span class="slider round"></span>'
				+ '</label>'
                + '<span class="positive">{{positive}}</span>',
		scope: {
			value: '=',
			disabled: '=?',
			label: '@',
			positive: '@',
			negative: '@',
			onChange: '&'
		},
		link: function($scope) {
			$scope.InvokeOnChangeOnNextDigest = function() {
				$timeout(function() {
					$scope.onChange($scope);
				});
			};
		}
	};
});
