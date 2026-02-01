/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global angular */

var managementApp = angular.module('managementApp');

managementApp.controller('alertModalController', ['$scope', '$modalInstance', 'data', function($scope, $modalInstance, data) {
	$scope.data = angular.copy(data);
	$scope.ok = () => { $modalInstance.close(); };
}]);

managementApp.value('$alertModalDefaults', {
	templateUrl: '/templates/alertTemplate.html',
	controller: 'alertModalController',
	defaultLabels: {
		ok: 'OK',
		title: 'Confirm Operation',
		text: 'You are excecuting a major procedure.'
	}
});

managementApp.factory('$alert', ['$modal', '$alertModalDefaults', function($modal, $alertModalDefaults) {
	return function(data, settings) {
		settings = angular.extend($alertModalDefaults, (settings || {}));

		data = angular.extend({}, settings.defaultLabels, data || {});

		if ('templateUrl' in settings && 'template' in settings) {
			delete settings.template;
		}

		settings.resolve = {
			data: function() {
				return data;
			}
		};

		return $modal.open(settings).result;
	};
}]);
