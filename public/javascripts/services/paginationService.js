/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


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
