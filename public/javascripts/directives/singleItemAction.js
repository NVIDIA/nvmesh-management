/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global angular */

var managementApp = angular.module('managementApp');
managementApp.directive('singleItemAction', [function() {
	return { require:
		{
			multiSelectCtrl: '^^multiSelect'
		},
	restrict: 'A',
	bindToController: true,
	controllerAs: 'singleItemActionCtrl',
	link: function(scope, element, attrs, required) {

		scope.$watch(function() {
			return required.multiSelectCtrl.isDirty &&
					required.multiSelectCtrl.pendingAction
			;
		},
		function(newValue) {
			if (newValue)
				attrs.$set('disabled', 'disabled');
			else
				element.removeAttr('disabled');
		});
	} };
}]);
