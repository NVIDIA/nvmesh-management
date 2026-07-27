/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

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
