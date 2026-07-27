/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* global angular */

var managementApp = angular.module('managementApp');
var EMAIL_REGEXP = new RegExp('^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$');
var FIRST_EMAIL_PART_REGEXP = new RegExp('^[a-zA-Z0-9._%+-]+$');

managementApp.directive('textoremailvalidator', function() {
	return {
		require: 'ngModel',
		link: function(scope, elm, attrs, ctrl) {
			ctrl.$validators.textoremailvalidator = function(modelValue, viewValue) {
				if (ctrl.$isEmpty(modelValue)) {
					// consider empty models to be valid
					return true;
				}

				if (viewValue && viewValue.indexOf('@') != -1) {
					if (EMAIL_REGEXP.test(viewValue)) {
						// it is valid
						return true;
					}
				} else if (FIRST_EMAIL_PART_REGEXP.test(viewValue))
					return true;

				// it is invalid
				return false;
			};
		}
	};
});
