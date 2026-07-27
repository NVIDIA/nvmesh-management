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

managementApp.directive('onFinishRender', function($timeout) {
	return {
		restrict: 'A',
		link: function(scope, element, attr) {
			if (scope.$last === true) {
				$timeout(function() {
					scope.$emit(attr.onFinishRender);
				});
			}
		}
	};
});
