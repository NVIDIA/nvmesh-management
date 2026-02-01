/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global angular $ */

var managementApp = angular.module('managementApp');

managementApp.directive('bootstrapModalAutofocus', function() {
	return {
		restrict: 'A',
		link: function(scope, elm, attrs) {
			if (!attrs['id'])
				throw 'element must have an id in order to use bootstrapModalAutofocus';

			var modalSelector = attrs['bootstrapModalAutofocus'];
			$(modalSelector).on('shown.bs.modal', function() {
				$('#' + attrs['id']).trigger('focus');
			});
		}
	};
});
