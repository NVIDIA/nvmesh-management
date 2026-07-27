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
