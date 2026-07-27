/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

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
