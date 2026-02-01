/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global angular,consts */

var managementApp = angular.module('managementApp');

managementApp.controller('nicDisplayController', function($scope, $http, $context, $confirm, $utils, $filter) {
	var controller = this;
	$scope.user = $context.user;
	$scope.nicMtuThreshold = consts.NIC_MTU_THRESHOLD;

	$scope.removeNic = function(nic) {
		const { nodeID: targetID, nodeUUID: targetUUID, nicID } = nic;

		$confirm({ text: 'You\'re going to delete NIC: ' + $filter('guidToIP')(nic) + '. Are you sure?' }).then(function() {
			$http.post('/servers/deleteNic', [{ targetID, targetUUID, nicID }]).success(function(data) {
				if (data) {
					$utils.handleResultsFadingAlerts('remove', 'NIC', data);

					if (data.success)
						$scope.server.nics = $scope.server.nics.filter(function(e) { return e.nicID !== nicID; });
				}
			});
		});
	};

	controller.getNicProtocols = function(nic) {
		return (nic.protocol !== consts.nicProtocol.MULTI) ? [nic.protocol] : [consts.nicProtocol.ROCE, consts.nicProtocol.TCP];
	};

	return controller;
});

managementApp.filter('guidToIP', function() {
	return function(nic) {
		if (nic) {
			if (nic.protocol !== consts.nicProtocol.IB) {
				if (nic.guid.substring(0, 26) == '0x00000000000000000000ffff') {
					var ipPortion = nic.guid.substring(nic.guid.length - 8);
					return [
						parseInt(ipPortion.substr(0, 2), 16),
						parseInt(ipPortion.substr(2, 2), 16),
						parseInt(ipPortion.substr(4, 2), 16),
						parseInt(ipPortion.substr(6, 2), 16)
					].join('.');
				} else {
					var subnet = [], addr = [];
					var found = false;
					var i;
					var x;
					for (i = 14; i >= 2; i -= 4) {
						x = nic.guid.substr(i, 4);

						if (x != '0000' || found) {
							found = true;
							x = parseInt(x, 16).toString(16);
							subnet.unshift(x);
						}
					}
					found = false;
					for (i = 18; i <= 30; i += 4) {
						x = nic.guid.substr(i, 4);

						if (x != '0000' || found) {
							found = true;
							x = parseInt(x, 16).toString(16);
							addr.push(x);
						}
					}
					return '[' + subnet.join(':') + '::' + addr.join(':') + ']';
				}
			} else
				return nic.nicID;
		}
	};
});

managementApp.filter('nicToHealth', function() {
	return function(nic) {
		if (nic) {
			return nic.status === 'Ok' ? '' : 'fa fa-exclamation-circle red';
		}
	};
});

managementApp.filter('nicToHealthMessage', function() {
	return function(nic) {
		if (nic) {
			var displayStatus;

			switch (nic.status) {
				case consts.nicStatus.LINK_DOWN:
					displayStatus = 'Link is down';

					break;
				case consts.nicStatus.MISSING:
					displayStatus = 'NIC is missing';

					break;
				case consts.nicStatus.ERROR:
					displayStatus = 'NIC reported error';

					break;
				default:
					displayStatus = nic.status;
			}

			return nic.status === 'Ok' ? '' : displayStatus;
		}
	};
});

managementApp.filter('nicToBackground', function() {
	return function(nic) {
		if (nic) {
			return nic.status === 'Ok' ? 'green' : 'red';
		}
	};
});

managementApp.directive('nicdisplay', function() {
	return {
		restrict: 'E',
		replace: false,
		templateUrl: '/javascripts/directives/nicDisplay.html',
		scope: {
			nic: '=',
			user: '='
		}
	};
});
