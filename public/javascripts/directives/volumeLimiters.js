/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global angular,WATCHERS*/
var managementApp = angular.module('managementApp');

managementApp.directive('volumeLimiters', function() {
	return {
		restrict: 'E',
		templateUrl: '/javascripts/directives/volumeLimiters.html',
		require: ['^form', 'volumeLimiters'],
		scope: {
			volume: '=',
			disabled: '=?',
			onChange: '&?',
			editMode: '=',
			volumeCtrl: '=',
			clear: '=',
			isEmpty: '='
		},
		controller: function($scope) {
			var ctrl = this;

			$scope.classLimitersControl = {};
			$scope.targetAndDriveLimitersControl = {};
			$scope.canLimitByClasses = true;
			$scope.canLimitByNodes = true;
			$scope.clearClassLimiters = false;
			$scope.clearTargetAndDrivesLimiters = false;

			$scope.activeLimit = {
				limitByClasses: true,
				limitByNodes: false
			};

			$scope.activateLimitTab = function(tab) {
				$scope.activeLimit = {};
				$scope.activeLimit[tab] = true;
			};

			ctrl.updateIsEmpty = function() {
				// If both are true, it means all are empty
				$scope.isEmpty = $scope.canLimitByClasses && $scope.canLimitByNodes;
			};

			ctrl.clear = function() {
				$scope.classLimitersControl.clear();
				$scope.targetAndDriveLimitersControl.clear();
			};

			ctrl.onEdit = function() {
				if ($scope.canLimitByClasses) {
					$scope.activateLimitTab('limitByClasses');
				} else {
					$scope.activateLimitTab('limitByNodes');
				}
			};

			ctrl.updateCanLimitByClasses = function() {
				if (!$scope.volume) {
					$scope.canLimitByClasses = false;
					return;
				}

				var isUpdatingVolWithClasses = $scope.editMode && ($scope.volume.serverClasses || $scope.volume.diskClasses);
				var isLimitByNodes = $scope.volume.limitByNodes && $scope.volume.limitByNodes.length !== 0;
				var isLimitByDisks = $scope.volume.limitByDisks && $scope.volume.limitByDisks.length !== 0;
				$scope.canLimitByClasses = isUpdatingVolWithClasses || (!isLimitByNodes && !isLimitByDisks);
			};

			ctrl.updateCanLimitByNodes = function() {
				if (!$scope.volume) {
					$scope.canLimitByNodes = false;
					return;
				}

				var serverClassesEmpty = !$scope.volume.serverClasses || $scope.volume.serverClasses.length == 0;
				var diskClassesEmpty = !$scope.volume.diskClasses || $scope.volume.diskClasses.length == 0;
				$scope.canLimitByNodes = serverClassesEmpty && diskClassesEmpty;
			};

			WATCHERS.push($scope.$watchGroup([
				'volume.serverClasses',
				'volume.diskClasses',
				'volume.limitByNodes',
				'volume.limitByDisks'
			],
			function() {
				ctrl.updateCanLimitByClasses();
				ctrl.updateCanLimitByNodes();
			}));

			WATCHERS.push($scope.$watch('volume', function(newValue) {
				if (newValue) {
					ctrl.onEdit();
					ctrl.updateCanLimitByClasses();
					ctrl.updateCanLimitByNodes();
				}
			}));
		}
	};
});
