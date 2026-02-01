/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global angular,consts*/
var managementApp = angular.module('managementApp');

managementApp.directive('volumeDiagram', function($http, $rootScope) {
	return {
		restrict: 'E',
		templateUrl: '/javascripts/directives/volumeDiagram.html',
		scope: {
			control: '='
		},
		controller: function($scope) {
			var ctrl = this;
			$scope.diagrams = [{ targets: [], layout: {} }];

			ctrl.getVolumeDiagramData = function() {
				ctrl.fetchDataFromServer()
					.success(function(data) {
						$rootScope.$evalAsync(function() {
							$scope.diagrams = data;
							$scope.diagrams.forEach(ctrl.prepareData);
						});
					});
			};

			ctrl.fetchDataFromServer = function() {
				return $http.get('/volumes/getVolumeDiagram/' + $scope.volumeID);
			};

			ctrl.prepareData = function(diagramData) {
				diagramData.targets.forEach(function(d){
					d.disksView = 'show';
					d.disks = d.disks.map(function(v) {
						v.diagramSize = 'small';
						return v;
					});
				});

				diagramData.layout.chunks.forEach(chunk => {
					chunk.name = 'Virtual LBA: ' + chunk.vlbs + ' - ' + chunk.vlbe;
					chunk.capacity = (consts.BLOCK_SIZE / consts.GB) * ((chunk.vlbe - chunk.vlbs));
					chunk.pRaidView = 'show';

					chunk.pRaids.forEach(pRaid => {
						pRaid.diskSegments.forEach(diskSegment => {
							if (diskSegment.isDead)
								diskSegment.status = consts.diskSegmentStatuses.DEAD;
						});
					});
				});
			};

			//When closing volume modal by pressing x - remove the binded collection (final exit)
			$scope.closeModal = function() {
				$scope.diagrams = { targets: [], layout: {} };
			};

		},
		link: function($scope, $element, attr, ctrl) {
			var modalElement = $element.find('#displayVolumeDiagram');

			// $scope.control allows an external controller to call this function
			$scope.control.show = function(volumeID) {
				$scope.volumeID = volumeID;

				// remove event registrations from an old opening of the modal (avoid multipule registrations)
				modalElement.off('shown.bs.modal');

				ctrl.getVolumeDiagramData();

				modalElement.modal('show');
			};
		}
	};
});
