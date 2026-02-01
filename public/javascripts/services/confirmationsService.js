/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global angular,$ */

var managementApp = angular.module('managementApp');

managementApp.controller('ConfirmModalController', ['$scope', '$modalInstance', '$http', '$rootScope', 'data',
	function($scope, $modalInstance, $http, $rootScope, data) {
		$scope.data = angular.copy(data);
		$scope.authenticationMsg;

		$scope.ok = function(confirmationPhrase) {
			if (confirmationPhrase) {
				var validationRoute = $rootScope.isMTLS ? '/isEmailValid' : '/isAdminPassword';
				var payload = { [$rootScope.isMTLS ? 'email' : 'password']: confirmationPhrase };

				$http.post(validationRoute, payload).success(function(user) {
					if (!$.isEmptyObject(user)) {
						$modalInstance.close();
						$scope.authenticationMsg = '';
					} else
						$scope.authenticationMsg = 'Authentication Failed!';
				});
			} else {
				$modalInstance.close();
				$scope.authenticationMsg = '';
			}
		};

		$scope.cancel = function() {
			$modalInstance.dismiss('cancel');
		};

		setTimeout(function() { $('#submitConfirmation').focus(); }, 0);
	}]);


managementApp.factory('$confirm', ['$modal', '$rootScope', function($modal, $rootScope) {
	var confirmModalDefaults = {
		templateUrl: '/templates/confirmTemplate.html',
		controller: 'ConfirmModalController',
		defaultLabels: {
			ok: 'OK',
			cancel: 'Cancel',
			title: 'Confirm Operation',
			text: 'You are about to execute a major procedure.',
			requireUserInput: true
		}
	};
	return function(data, settings) {
		settings = angular.extend(confirmModalDefaults, (settings || {}));

		data = angular.extend({}, settings.defaultLabels, data || {});

		if (data.requireUserInput)
			data.text += `\nPlease enter your ${$rootScope.isMTLS ? 'email' : 'password'} to continue:`;

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
