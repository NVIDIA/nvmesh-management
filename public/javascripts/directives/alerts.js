/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global angular,CookieManager,consts,SOCKET,EVENTS,$ */

var managementApp = angular.module('managementApp');

managementApp.controller('alertsController', function($scope, $rootScope, $http, $sce, $context, $confirm, $timeout) {
	$scope.user = $context.user;
	$scope.currentPage = 0;
	$scope.pages = 0;
	$scope.count = CookieManager.getJSON('nvmesh-pagination').alertsPagination || consts.defaultItemsPerPage;
	$scope.alerts = [];
	$scope.allLevels = ['WARNING', 'ERROR'];
	$scope.filter = { level: { $in: $scope.allLevels } };
	$scope.sort = {};

	var pagination = false;

	$scope.getPages = function() {
		$http.get('/logs/alerts/count/', { params: { filter: $scope.filter || {} } }).success(function(data) {
			$scope.pages = Math.ceil(data / $scope.count) || 1;
			initPaging();
		});
	};

	$scope.loadAlerts = function(filter, sort, getPages) {
		$scope.filter = filter;
		$scope.sort = sort;
		//update count from cookies
		$scope.count = CookieManager.getJSON('nvmesh-pagination').alertsPagination || consts.defaultItemsPerPage;

		if (!getPages) {
			$scope.currentPage = 0;
			$scope.getPages();
		}

		$http.get('/logs/alerts/' + $scope.currentPage + '/' + $scope.count, { params: { filter: filter || {}, sort: sort || {} } }).success(function(data) {
			$scope.alerts = data.slice(0);
			$scope.alerts.forEach(function(alert) {
				SOCKET.addHandler($context.getLogID(alert._id) + EVENTS.logChangedEvent.name, function(data) {
					var ackID = data.payload._id;
					$rootScope.$evalAsync(function() {
						//Remove the log from the alerts table.
						var loadTable = true;
						$('#' + ackID).fadeOut(100, function() {
							//Reload alerts.
							if (loadTable)
								$scope.loadAlerts($scope.filter, $scope.sort);
							loadTable = false;
						});
					});
				});
			});

			$scope.isDirty = false;
		});
	};

	$scope.createLinkMessage = function(log) {
		if (Object.keys(log.meta.links || {}).length) {
			let resolvedMsg = log.meta.rawMessage;
			
			for (const [key, value] of Object.entries(log.meta.links)) {
				const link = consts.getEntityLink(value);
				const htmlLink = $('<a>')
					.attr('href', link)
					.text(value.entityText).prop('outerHTML');
				resolvedMsg = resolvedMsg.replace(`{${key}}`, htmlLink);
			}
			
			return $sce.trustAsHtml(resolvedMsg);
		
		} else {
			return $sce.trustAsHtml(log.message);
		}
	};

	function initPaging() {
		var $alertsPagination = $('#alertsPagination');

		if (pagination && $alertsPagination.data('twbs-pagination'))
			$alertsPagination.twbsPagination('destroy');

		$alertsPagination.twbsPagination({
			totalPages: $scope.pages,
			visiblePages: 5,
			onPageClick: function(event, page) {
				$scope.currentPage = page - 1;
				$scope.loadAlerts($scope.filter, $scope.sort, true);
			}
		});

		pagination = true;
	}

	$timeout(function() {
		$('.table-filtSort').filtSort({ load: $scope.loadAlerts, filter: $scope.filter });

		var $pills = $('.alerts .nav-pills a');
		$pills.click(function() {
			$pills.removeClass('selected');
			$(this).addClass('selected');

			var value = $(this).attr('data-value');

			switch (value) {
				case 'ALL':
					$scope.filter['level'] = { $in: $scope.allLevels };

					break;
				case 'WARNING':
					$scope.filter['level'] = 'WARNING';

					break;
				case 'ERROR':
					$scope.filter['level'] = 'ERROR';

					break;
			}

			$scope.loadAlerts($scope.filter, $scope.sort);
		});

		$('.alerts-table').on('click', '.ack', function() {
			var $ackButton = $(this);
			//Acknowledge log
			$http.post('/logs/acknowledge/', { id: $ackButton.attr('data-id') });
		});

		$scope.ackAll = function() {
			$confirm({
				text: 'Warning: This operation is irreversible.'
			}).then(function() {
				$http.post('/logs/acknowledgeAll').success(function() {
					$scope.loadAlerts($scope.filter, $scope.sort);
				});
			});
		};
	});
});

managementApp.directive('alerts', function() {
	return {
		restrict: 'E',
		replace: true,
		templateUrl: 'javascripts/directives/alerts.html'
	};
});
