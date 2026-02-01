/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global angular, SOCKET, EVENTS, c3, STATUS_COLORS */
var managementApp = angular.module('managementApp');

managementApp.directive('allocationChart', function($rootScope, $filter) {
	return {
		restrict: 'E',
		templateUrl: '/javascripts/directives/allocationChart.html',
		scope: {
			hideHeader: '='
		},
		controller: function($scope, $http) {
			var capacityChart;

			function isFloat(value) {
				return !isNaN(value) &&
                        parseFloat(Number(value)) == value &&
                        !isNaN(parseFloat(value, 10));
			}

			SOCKET.addHandler(EVENTS.allocatedSpaceChangeEvent.name, function(data) {
				$rootScope.$evalAsync(function() {
					var payload = data.payload;
					if (isFloat(payload.availableSpace) && isFloat(payload.totalCapacity)) {
						handleSpaceAllocationData(payload);

						if (capacityChart == undefined) {
							initGraph();
						} else {
							updateGraph();
						}
					}
				});
			});

			function handleSpaceAllocationData(data) {
				$scope.spaceAllocation = data || {};
				return true;
			}

			$http.get('/getSpaceAllocation').success(function(data) {
				if (handleSpaceAllocationData(data))
					initGraph();
			});

			function updateValuesForView() {
				$scope.volumeSpace = $scope.spaceAllocation.data;
				$scope.totalSpace = $scope.spaceAllocation.totalCapacity;
				$scope.freeSpace = $scope.spaceAllocation.availableSpace;
				$scope.redundancySpace = $scope.spaceAllocation.redundancy;
				$scope.reservedSpace = $scope.spaceAllocation.reservedLeft;

				// we don't have a reserved counter in the UI for now, so we count reserved as volumes allocation
				$scope.volumeSpace += $scope.reservedSpace;
			}

			function getColumns() {
				return [
					['Volume Space', $scope.volumeSpace],
					['Redundancy Space', $scope.redundancySpace],
					['Free Space', $scope.freeSpace]
				];
			}

			function updateGraph() {
				updateValuesForView();

				if (capacityChart) {
					capacityChart.load({ columns: getColumns() });
				} else {
					initGraph();
				}
			}

			function initGraph() {
				updateValuesForView();

				capacityChart = c3.generate({
					bindto: $scope.graphSelector,
					data: {
						columns: getColumns(),
						type: 'donut',
						colors: {
							'Volume Space': STATUS_COLORS.NORMAL,
							'Redundancy Space': STATUS_COLORS.ACTION,
							'Free Space': STATUS_COLORS.PLACEHOLDER,
						},
						order: null
					},
					donut: {
						width: 7,
						label: {
							show: false
						}
					},
					tooltip: {
						format: {
							value: function(value) {
								return $filter('gigabytesToBiggestUnits')(value);
							}
						}
					}
				});
			}

			$scope.$on('$destroy', function() {
				SOCKET.removeHandler(EVENTS.allocatedSpaceChangeEvent.name);
			});
		},
		link: function($scope, $element) {
			$scope.graphSelector = $element.find('.capacity-chart')[0];
		}
	};
});
