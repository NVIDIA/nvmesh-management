/* global angular,CookieManager,consts,$ */
var managementApp = angular.module('managementApp');

managementApp.component('multiSelectKeys', {
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
			controller.loadKeys(controller.queryStringObj.filter, controller.queryStringObj.sort, false);
		};

		controller.getPages = function() {
			$http.get('/keys/count/', { params: { filter: controller.filter || {} } }).success(function(data) {
				controller.pages = Math.ceil(data / controller.count) || 1;
				controller.totalKeys = data;
				initPaging();
			});
		};

		controller.loadKeys = function(filter, sort, getPages) {
			controller.count = CookieManager.getJSON('nvmesh-pagination').keysMultiSelectPagination || consts.defaultItemsPerPage;
			controller.queryStringObj.filter = filter;
			controller.queryStringObj.sort = sort;

			if (!getPages) {
				controller.currentPage = 0;
				controller.getPages(controller.filter);
			}

			$http.get('/keys/all/' + controller.currentPage + '/' + controller.count, {
				params: { filter: filter || {}, sort: sort || {} }
			}).success(function(data) {
				controller.keys = data.slice(0);
				controller.lastItemIndex = controller.currentPage * controller.count + controller.keys.length;

			});
		};

		function initPaging() {
			paginationServiceInstance.createPagination($('#keysMultiSelectPagination'), {
				totalPages: controller.pages,
				onPageClick: function(event, page) {
					controller.currentPage = page - 1;
					controller.loadKeys(controller.queryStringObj.filter, controller.queryStringObj.sort, true);
				}
			});
		}

		$(function() {
			$('#keys-multi-select').filtSort({
				load: controller.loadKeys,
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
	controllerAs: 'multiSelectKeysCtrl',
	templateUrl: 'javascripts/directives/multiSelectComponents/multiSelectKeys.html'
});