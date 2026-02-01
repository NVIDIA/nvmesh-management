/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global angular,$*/
var managementApp = angular.module('managementApp');

managementApp.directive('configProfilePickerModal', function(nodeConfigurationService, $http, $utils) {
	return {
		restrict: 'E',
		templateUrl: '/javascripts/directives/configProfilePickerModal.html',
		scope: {
			nodes: '=',
			show: '&'
		},
		controller: function($scope) {
			let profileSelectize;

			$scope.show = function() {
				$scope.fetchProfiles(profiles => {
					profileSelectize = $('#selectConfigProfiles').selectize()[0].selectize;
					profileSelectize.clearOptions();
					profiles.forEach(p => {
						profileSelectize.addOption({ text: p.name, value: p.uuid });
					});
				});

				$scope.nodeIDs = Object.keys($scope.nodes);
				$('#selectConfigProfileModal').modal('show');
			};

			$scope.fetchProfiles = function(callback) {
				$http.get('/configurationProfiles/all/0/0',
					{ params: { projection: { name: 1, uuid: 1 } } }).success(function(data) {
					callback(data);
				});
			};

			$scope.applySelectedProfileToNodes = function() {
				let nodes = Object.keys($scope.nodes || {});
				let selectedUUID = profileSelectize.getValue();
				let selectedName = profileSelectize.getItem(selectedUUID).text();
				let profile = { name: selectedName, uuid: selectedUUID };
				nodeConfigurationService.applyProfileToNodes(profile, nodes, result => {
					$utils.handleResultsFadingAlerts('apply', 'Configuration Profile', [result]);
				});

				$('#selectConfigProfileModal').modal('hide');
			};

			$scope.$on('openApplyProfileModal', function() {
				$scope.show();
			});
		}
	};
});
