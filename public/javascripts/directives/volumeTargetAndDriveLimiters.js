/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global angular,consts,$,WATCHERS*/
var managementApp = angular.module('managementApp');

managementApp.directive('volumeTargetAndDriveLimiters', function($http, $rootScope, $q) {
	return {
		restrict: 'E',
		templateUrl: '/javascripts/directives/volumeTargetAndDriveLimiters.html',
		require: ['volumeTargetAndDriveLimiters', '^form'],
		scope: {
			volume: '=',
			volumeCtrl: '=',
			disabled: '=?',
			clear: '=?'
		},
		controller: function($scope) {
			var ctrl = this;

			ctrl.serversSelectize = null;
			ctrl.disksSelectize = null;
			ctrl.originalServers = [];

			$scope.templateUrl = 'popoverTemplate.html';

			ctrl.enable = function() {
				ctrl.serversSelectize && ctrl.serversSelectize.enable();
				ctrl.disksSelectize && ctrl.disksSelectize.disable();
			};

			ctrl.disable = function() {
				ctrl.serversSelectize && ctrl.serversSelectize.disable();
				ctrl.disksSelectize && ctrl.disksSelectize.disable();
			};

			ctrl.clear = function() {
				//Clear old remains of servers from the selectize if exists.
				ctrl.serversSelectize && ctrl.serversSelectize.clear();
				ctrl.disksSelectize && ctrl.disksSelectize.clear();
				return true;
			};

			WATCHERS.push($scope.$watch('disabled', function() {
				if ($scope.disabled)
					ctrl.disable();
				else
					ctrl.enable();
			}));

			$scope.matchingServers = [];

			$scope.serversRegexChanged = function() {
				ctrl.serversRegexValid = true;

				try {
					new RegExp(ctrl.volume.serversFilterRegex);
				/* eslint-disable-next-line no-unused-vars */
				} catch (e) {
					ctrl.serversRegexValid = false;
				}

				if (!ctrl.volume.serversFilterRegex)
					ctrl.serversRegexValid = false;

				if (ctrl.serversRegexValid)
					$http.post('/servers/byRegex', { regex: ctrl.volume.serversFilterRegex }).success(function(data) {
						ctrl.matchingServers = data;
					});
			};

			$scope.closeServersRegexPopover = function() {
				$('.popover').hide();
				ctrl.matchingServers = [];
				ctrl.serversRegexValid = false;
				ctrl.volume.serversFilterRegex = '';
			};

			$scope.applyServersRegex = function() {
				var optionsToSelect = ctrl.matchingServers.map(function(d) { return d.node_id; });
				ctrl.serversSelectize.addItems(optionsToSelect);
				$('.popover').hide();
				ctrl.volume.serversFilterRegex = '';
			};

			WATCHERS.push($scope.$watch('volume', function(newValue) {
				if (newValue) {
					if (ctrl.serversSelectize && ctrl.disksSelectize) {
						ctrl.clear();
						ctrl.addItems();
					}
				}
			}));

			ctrl.addItems = function() {
				if (!$scope.volume)
					return;
				ctrl.serversSelectize.addItems($scope.volume.limitByNodes);
				ctrl.disksSelectize.addItems($scope.volume.limitByDisks);
			};
		},
		link: function($scope, $element, attr, ctrls) {
			var ctrl = ctrls[0];
			$scope.form = ctrls[2];

			$scope.initSelectizes = function() {
				$scope.initServerSelectize().then(() => {
					ctrl.addItems();
				});
			};

			$scope.initServerSelectize = function() {
				return new Promise(function(resolve, reject) {
					$http.get('/serverClasses/servers').error(reject).success(function(data) {
						ctrl.disksSelectize = $element.find('#disksSelect').selectize()[0].selectize;
						ctrl.serversSelectize = $element.find('#serversSelect').selectize({
							create: false,
							onChange: function(e) {
								$rootScope.$evalAsync(function() {
									$scope.volume.limitByNodes = e;

									if (!$scope.volume.limitByNodes || !$scope.volume.limitByNodes.length)
										ctrl.disksSelectize.disable();
									else
										ctrl.disksSelectize.enable();

									$scope.volumeCtrl.getTotalAndAllocatedSpace();

									if ($scope.volume.limitByNodes && $scope.volume.limitByNodes.length) {

										if (ctrl.cancelerForDisksSelectize)
											ctrl.cancelerForDisksSelectize.resolve();

										// create a canceler for the request, so we can cancel it before sending another request
										ctrl.cancelerForDisksSelectize = $q.defer();
										var serverIDs = $scope.volume.limitByNodes.map(function(e) { return { serverID: e }; });
										var opts = { timeout: ctrl.cancelerForDisksSelectize.promise };
										$http.post('/disks/disksByNodes', serverIDs, opts).success(function(data) {
											data = data.filter(function(d) {
												return d.largestSegmentAvailable > consts.BLOCK_SET_SIZE && d.status !== consts.diskStatus.NOT_INITIALIZED;
											});
											initDiskSelectize(data);
										});
									} else {
										initDiskSelectize([]);
									}
								});
							}
						})[0].selectize;

						ctrl.originalServers = data.map(function(d) { return { text: d.node_id, value: d.node_id }; });
						//Add available options
						ctrl.serversSelectize.addOption(ctrl.originalServers);
					});
				});
			};

			function initDiskSelectize(data) {
				if (!data)
					return false;

				data = data.map(function(d) { return { value: d._id, text: d.node_id + ': ' + d._id }; });
				//Removes the old select from the dom.
				var $select = $element.find('#disksSelect').detach().clone();
				// Clear the old selectize from the table and reinsert the clone.
				$element.find('#disksSelectContainer').children(':not(".control-label")').empty().append($select);

				ctrl.disksSelectize = $element.find('#disksSelect').selectize({
					create: false,
					onChange: function(e) {
						$rootScope.$evalAsync(function() {
							$scope.volume.limitByDisks = e;
							$scope.volumeCtrl.getTotalAndAllocatedSpace();
						});
					}
				})[0].selectize;

				ctrl.disksSelectize.addOption(data);
				ctrl.disksSelectize.addItems($scope.volume.limitByDisks);
			}

			$scope.initSelectizes();
		}
	};
});
