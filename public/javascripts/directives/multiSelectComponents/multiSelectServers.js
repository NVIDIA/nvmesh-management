/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global angular,CookieManager,consts,$ */
var managementApp = angular.module('managementApp');

managementApp.component('multiSelectServers', {
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
			controller.loadServers(controller.queryStringObj.filter, controller.queryStringObj.sort, false);
		};

		controller.getPages = function() {
			$http.get('/servers/count/', { params: { filter: controller.filter || {} } }).success(function(data) {
				controller.pages = Math.ceil(data / controller.count) || 1;
				controller.totalServers = data;
				initPaging();
			});
		};

		controller.loadServers = function(filter, sort, getPages) {
			controller.count = CookieManager.getJSON('nvmesh-pagination').serversMultiSelectPagination || consts.defaultItemsPerPage;
			controller.queryStringObj.filter = filter;
			controller.queryStringObj.sort = sort;

			if (!getPages) {
				controller.currentPage = 0;
				controller.getPages(controller.filter);
			}

			$http.get('/servers/all/' + controller.currentPage + '/' + controller.count, {
				params: { filter: filter || {}, sort: sort || {} }
			}).success(function(data) {
				controller.servers = data.slice(0);
				controller.lastItemIndex = controller.currentPage * controller.count + controller.servers.length;

			});
		};

		controller.closeModal = function() {
			$('.daterangepicker').remove();
			$('.modal-backdrop').remove();
		};

		function initPaging() {

			paginationServiceInstance.createPagination($('#serversMultiSelectPagination'), {
				totalPages: controller.pages,
				onPageClick: function(event, page) {
					controller.currentPage = page - 1;
					controller.loadServers(controller.queryStringObj.filter, controller.queryStringObj.sort, true);
				}
			});
		}

		$(function() {
			$('#servers-multi-select').filtSort({
				load: controller.loadServers,
				filter: controller.queryStringObj.filter || {},
				sort: controller.queryStringObj.sort || {}
			});
		});
	}],
	controllerAs: 'multiSelectServersCtrl',
	templateUrl: 'javascripts/directives/multiSelectComponents/multiSelectServers.html'
});