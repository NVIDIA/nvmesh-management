/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* global angular,$ */

var managementApp = angular.module('managementApp');

managementApp.service('multiSelectService', function(){
	this.handleResponse = function(entitiesName, controller, response) {
		if (!entitiesName)
			throw 'handleResponse must receive entitiesName';

		controller.hasFailed = false;
		controller.errors = {};

		for (var itemIndex in response) {
			var singleItemResponse = response[itemIndex];

			if (singleItemResponse.success)
				continue;

			controller.hasFailed = true;
			let singleItemError = typeof singleItemResponse.error === 'object' ? 
				`${singleItemResponse.error.message}${singleItemResponse.error.innerMessage ? 
					` - ${typeof singleItemResponse.error.innerMessage === 'object' ? 
						singleItemResponse.error.innerMessage.message : 
						singleItemResponse.error.innerMessage }` : 
					''}` : 
				singleItemResponse.error;
			if (!controller.errors[singleItemError])
				controller.errors[singleItemError] = [];

			controller.errors[singleItemError].push(singleItemResponse._id);
		}

		if (!controller.hasFailed) {
			alert(true, 'Action succeeded for all ' + entitiesName);
		} else {
			for (var error in controller.errors) {
				var itemsWithError = controller.errors[error];
				alert(false, 'For ' + itemsWithError.join(', ') + '. Error: ' + error);
			}
		}

		
		controller.selected = {};

		controller.clearFailed = function() {
			controller.errors = {};
			controller.hasFailed = false;
		};
	};

	function alert(isSuccess, message) {
		var $content = $('.content');
		$content.fadingAlert(isSuccess ? 'success' : 'danger', message);
	}
});