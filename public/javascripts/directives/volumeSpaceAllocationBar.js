/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global angular,consts*/
var managementApp = angular.module('managementApp');

managementApp.directive('volumeSpaceAllocationBar', function() {
	return {
		restrict: 'E',
		templateUrl: '/javascripts/directives/volumeSpaceAllocationBar.html',
		scope: {
			volume: '=',
			totalSpace: '=',
			allocatedSpace: '=',
			editMode: '=',
			currentCapacity: '='
		},
		controller: function($scope) {
			$scope.getRedundancyUnitsCount = function() {
				switch ($scope.volume.RAIDLevel) {
					case 'Mirrored RAID-1':
					case 'Striped & Mirrored RAID-10':
						// Each Mirror Unit is the same size as the Data
						return $scope.volume.numberOfMirrors;
					case 'Erasure Coding':
					case 'Striped Erasure Coding':
						return $scope.volume.parityBlocks;
					case 'Striped RAID-0':
					case consts.RAIDLevel.CONCATENATED:
						// No Redundancy Required
						return 0;
				}
			};

			$scope.getRedundancyUnitSpace = function() {
				switch ($scope.volume.RAIDLevel) {
					case 'Mirrored RAID-1':
					case 'Striped & Mirrored RAID-10':
						// Each Mirror Unit is the same size as the Data
						return $scope.getSpaceToAllocate();
					case 'Erasure Coding':
					case 'Striped Erasure Coding':
						var dataSize = $scope.getSpaceToAllocate();
						var parityUnitSize = Math.round(dataSize / $scope.volume.dataBlocks * 100) / 100;
						return parityUnitSize;
					case 'Striped RAID-0':
					case consts.RAIDLevel.CONCATENATED:
						// No Redundancy Required
						return 0;
				}
			};

			$scope.getRedundancyUnitTruncatedSpace = function() {
				var space = $scope.getRedundancyUnitSpace();
				return space > 100 ? 100 : space;
			};

			$scope.getRemainingSpace = function() {
				var redundantSpace = $scope.getRedundancyUnitSpace() * $scope.getRedundancyUnitsCount();
				var dataSpace = $scope.getTrimmedSpaceToAllocate() + $scope.getAllocatedSpace();
				return Math.round((100 - (redundantSpace + dataSpace)) * 100) / 100;
			};

			$scope.getAllocatedSpace = function() {
				return Math.round($scope.allocatedSpace / $scope.totalSpace * 100 * 100) / 100;
			};

			$scope.generateRedundancyUnitsIterator = function() {
				var numOfRedundancyUnits = $scope.getRedundancyUnitsCount();
				return new Array(numOfRedundancyUnits);
			};

			//Get percentage of total space to allocate.
			$scope.getSpaceToAllocate = function() {
				var spaceToAllocate = Math.round(($scope.volume.capacity - ($scope.editMode ? $scope.currentCapacity || 0 : 0))
					/ $scope.totalSpace * 100 * 100) / 100;

				return spaceToAllocate || 0;
			};

			$scope.getTrimmedSpaceToAllocate = function() {
				var space = $scope.getSpaceToAllocate();

				return space > 100 ? 100 : space;
			};

		}
	};
});
