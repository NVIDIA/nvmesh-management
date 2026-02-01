/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global angular,CookieManager,consts,$ */
var managementApp = angular.module('managementApp');

managementApp.component('multiSelectClients', {
	bindings: {
		selected: '=',
		staticFilter: '=',
		reloadData: '='
	},
	controller: ['$http', 'paginationService', '$utils', function($http, paginationService, $utils) {
		var controller = this;
		var paginationServiceInstance = paginationService.getNewInstance();
		controller.queryStringObj = $utils.getQueryStringObj();
		controller.queryStringObj.filter = controller.staticFilter;

		controller.reloadData = function() {
			controller.loadClients(controller.queryStringObj.filter, controller.queryStringObj.sort, false);
		};

		controller.getPages = function() {
			$http.get('/clients/count/', { params: { filter: controller.filter || {} } }).success(function(data) {
				controller.pages = Math.ceil(data / controller.count) || 1;
				controller.totalClients = data;
				initPaging();
			});
		};

		controller.loadClients = function(filter, sort, getPages) {
			controller.count = CookieManager.getJSON('nvmesh-pagination').clientsMultiSelectPagination || consts.defaultItemsPerPage;
			controller.queryStringObj.filter = filter;
			controller.queryStringObj.sort = sort;

			if (!getPages) {
				controller.currentPage = 0;
				controller.getPages(controller.filter);
			}

			$http.get('/clients/all/' + controller.currentPage + '/' + controller.count, {
				params: { filter: filter || {}, sort: sort || {} }
			}).success(function(data) {
				controller.clients = data.slice(0);
				controller.lastItemIndex = controller.currentPage * controller.count + controller.clients.length;

			});
		};

		function initPaging() {

			paginationServiceInstance.createPagination($('#clientsMultiSelectPagination'), {
				totalPages: controller.pages,
				onPageClick: function(event, page) {
					controller.currentPage = page - 1;
					controller.loadClients(controller.queryStringObj.filter, controller.queryStringObj.sort, true);
				}
			});
		}

		$(function() {
			$('#clients-multi-select').filtSort({
				load: controller.loadClients,
				filter: controller.queryStringObj.filter || {},
				sort: controller.queryStringObj.sort || {}
			});
		});

		controller.$onChanges = function(changes) {
			if (changes.filter) {
				controller.queryStringObj.filter = controller.filter;
				controller.reloadData();
			}
		};
	}],
	controllerAs: 'multiSelectClientsCtrl',
	templateUrl: '../javascripts/directives/multiSelectComponents/multiSelectClients.html'
});