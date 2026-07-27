/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* global angular*/

var managementApp = angular.module('managementApp');

managementApp.service('paginationService', function(){
	this.getNewInstance = function(){
		var instance = {};
		instance.wasInitiated = false;
		instance.createPagination = function(pager, customConfig) {
			var config = {
				// maximum visible pages
				visiblePages: 0,
				initiateStartPageClick: true,

				// Text labels
				first: null,
				prev: '<',
				next: '>',
				last: null,

				// carousel-style pagination
				loop: false,

				// pagination Classes
				paginationClass: 'pagination',
				nextClass: 'next',
				prevClass: 'prev',
				lastClass: 'last',
				firstClass: 'first',
				pageClass: 'page',
				activeClass: 'active',
				disabledClass: 'disabled',
				anchorClass: 'page-link'
			};

			for (var key in customConfig) {
				config[key] = customConfig[key];
			}


			if (instance.wasInitiated && pager.data('twbs-pagination'))
				pager.twbsPagination('destroy');

			pager.twbsPagination(config);


			instance.wasInitiated = true;
		};

		return instance;
	};
});