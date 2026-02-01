/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global angular*/
var managementApp = angular.module('managementApp');

managementApp.directive('volumeDiagramLayout', function() {
	return {
		restrict: 'E',
		templateUrl: '/javascripts/directives/volumeDiagramLayout.html',
		scope: {
			data: '='
		},
		controller: function($scope) {
			$scope.volumeDiagramChunksShown = true;

			$scope.toggleChunksView = function(chunk, show) {
				var toggle = (arguments.length != 2);

				if (toggle)
					show = chunk.pRaidView == 'hide';

				chunk.pRaidView = show ? 'show' : 'hide';
				$scope.volumeDiagramChunksShown = $scope.data.chunks.every(function(chunk) { return chunk.pRaidView == 'show'; });
			};

			$scope.toggleAllChunksView = function() {
				var show = !$scope.volumeDiagramChunksShown;

				$scope.data.chunks.forEach(function(chunk) {
					$scope.toggleChunksView(chunk, show);
				});
			};
		}
	};
});
