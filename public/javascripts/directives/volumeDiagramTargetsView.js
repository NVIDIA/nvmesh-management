/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global angular*/
var managementApp = angular.module('managementApp');

managementApp.directive('volumeDiagramTargetsView', function() {
	return {
		restrict: 'E',
		templateUrl: '/javascripts/directives/volumeDiagramTargetsView.html',
		scope: {
			targets: '='
		},
		controller: function($scope) {
			$scope.targetsShown = true;

			$scope.toggleDisksView = function(target, show) {
				var toggle = (arguments.length != 2);

				if (toggle)
					show = target.disksView == 'hide';

				target.disksView = show ? 'show' : 'hide';
				$scope.targetsShown = $scope.targets.every(function(target) { return target.disksView == 'show'; });
			};

			$scope.toggleAllTargetsView = function() {
				var show = !$scope.targetsShown;

				$scope.targets.forEach(function(target) {
					$scope.toggleDisksView(target, show);
				});
			};

			$scope.toggleAllTargetsState = function(setCollapse) {
				$scope.targets.forEach(function(target) {
					$scope.toggleAllDisksState(target, setCollapse);
				});
			};

			$scope.toggleAllDisksState = function(target, setCollapse) {
				//target.allDisksState = target.allDisksState  == 'expand' ? 'collapse' : 'expand';
				var toggle = (arguments.length != 2);

				target.disks.forEach(function(disk){
					if (!toggle) {
						disk.diagramSize = setCollapse ? '' : 'small';
					} else {
						disk.diagramSize = disk.diagramSize == 'small' ? '' : 'small';
					}
				});
			};

			$scope.toggleDiagramSize = function(target) {
				target.diagramSize = target.diagramSize == 'small' ? '' : 'small';
			};

		}
	};
});
