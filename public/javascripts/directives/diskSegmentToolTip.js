/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global angular */
var managementApp = angular.module('managementApp');

managementApp.component('diskSegmentToolTip', {
	bindings: {
		model: '='
	},
	bindToController: true,
	restrict: 'E',
	controller: function() {
		var controller = this;
		controller.numOfNormal = 0;
		controller.numOfDead = 0;
		controller.numOfUnderRecovery = 0;
		controller.numOfReserved = 0;
		controller.numOfSegments = 0;

		for (var id in controller.model) {
			var segment = controller.model[id];

			if (segment.isPlaceHolder)
				continue;

			controller.numOfSegments++;
			if (segment.isDead)
				controller.numOfDead++;
			else if (segment.status === 'normal')
				controller.numOfNormal++;
			else if (segment.isReserved)
				controller.numOfReserved++;
			else
				controller.numOfUnderRecovery++;
		}
	},
	controllerAs: 'diskSegmentToolTipCtrl',
	templateUrl: '../../../javascripts/directives/diskSegmentToolTip.html'
});