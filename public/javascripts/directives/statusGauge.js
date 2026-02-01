/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global angular,STATUS_COLORS,c3,WATCHERS */

var managementApp = angular.module('managementApp');

managementApp.directive('statusgauge', function() {
	return {
		restrict: 'E',
		replace: false,
		templateUrl: '/javascripts/directives/statusGauge.html',
		scope: {
			linkedGauge: '@',
			mainLink: '@',
			firstElementName: '@',
			firstElementValue: '=',
			firstElementLink: '@',
			secondElementName: '@',
			secondElementValue: '=',
			secondElementLink: '@',
			thirdElementName: '@',
			thirdElementValue: '=',
			thirdElementLink: '@',
			iconClass: '@',
			header: '@'
		},
		controller: function($scope) {
			var chart;
			var ctrl = this;
			var colors = {};
			colors[$scope.firstElementName] = STATUS_COLORS.NORMAL;
			colors[$scope.secondElementName] = STATUS_COLORS.ERROR;
			colors[$scope.thirdElementName] = STATUS_COLORS.WARNING;

			ctrl.initGraph = function() {
				chart = c3.generate({
					bindto: ctrl.graphSelector,
					data: {
						columns: [
							[$scope.secondElementName, $scope.secondElementValue],
							[$scope.thirdElementName, $scope.thirdElementValue],
							[$scope.firstElementName, $scope.firstElementValue]
						],
						type: 'donut',
						order: null,
						colors: colors
					},
					donut: {
						width: 5,
						label: {
							show: false
						}
					}
				});
			};

			WATCHERS.push($scope.$watchGroup(['firstElementValue', 'secondElementValue', 'thirdElementValue'], function(valArray) {
				if (chart)
					chart.load({
						columns: [
							[$scope.secondElementName, valArray[1]],
							[$scope.thirdElementName, valArray[2]],
							[$scope.firstElementName, valArray[0]]
						]
					});
				else if (!valArray.filter(function(e) { return e !== 0 && !e; }).length)
					ctrl.initGraph();
			}));
		},
		link: function($scope, $element, attrs, controller) {
			controller.graphSelector = $element.find('.status-gauge')[0];
		}
	};
});

managementApp.filter('numToKRoundNumber', function() {
	return function(num) {
		var value;
		var appendK;

		if (Math.abs(num) > 999) {
			value = Math.sign(num) * ((Math.abs(num) / 1000).toFixed(1));
			appendK = true;
		} else
			value = Math.sign(num) * Math.abs(num);

		value = value > 0 ? value : 0;
		return appendK ? value + 'K' : value;
	};
});
