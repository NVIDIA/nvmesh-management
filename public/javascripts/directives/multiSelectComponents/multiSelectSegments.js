/* global angular,CookieManager,consts,$, jqId */
var managementApp = angular.module('managementApp');

managementApp.component('multiSelectSegments', {
	bindings: {
		staticFilter: '=',
		reloadData: '=',
		diskId: '@',
		serverId: '@?'
	},
	controller: ['$http', 'paginationService', '$utils', '$timeout', '$scope', 'nextPageService',
		function($http, paginationService, $utils, $timeout, $scope, nextPageService) {
			var controller = this;
			var paginationServiceInstance = paginationService.getNewInstance();
			controller.queryStringObj = $utils.getQueryStringObj();
			controller.queryStringObj.filter = controller.staticFilter;

			controller.reloadData = function() {
				controller.loadSegments(controller.queryStringObj.filter, controller.queryStringObj.sort, false);
			};

			$scope.$watch(function(){
				return controller.staticFilter;
			}, function(){
				controller.queryStringObj.filter = controller.staticFilter;
			});

			var createModel = function(disk) {
				return {
					diskID: disk.diskID,
					node_id: disk.nodeID,
					model: disk.Model
				};
			};

			controller.sendVolumeToVolumeScreen = function(volumeName) {
				nextPageService.setData({
					'volumeToShow': volumeName
				});
			};

			controller.closeModal = function() {
				$('#segmentsModal_' + controller.diskUUID).modal('hide');
				$('body').removeClass('modal-open');
				$('.modal-backdrop').remove();
			};

			controller.loadSegments = function(filter, sort, getPages) {
				controller.queryStringObj.filter = filter;
				controller.queryStringObj.sort = sort;
				controller.count = CookieManager.getJSON('nvmesh-pagination')['segmentsPagination-' + controller.diskId] || consts.defaultItemsPerPage;

				if (!getPages)
					controller.currentPage = 0;

				$http.get('/disks/segments/' + controller.currentPage + '/' + controller.count, {
					params: { filter: filter || {}, sort: sort || {}, diskID: controller.diskId, serverID: controller.serverId }
				}).success(function(data) {
					controller.servers = data.edges.slice(0);
					controller.servers.forEach(function(server) {
						server.disks._model = createModel(server.disks);
					});
					controller.lastItemIndex = controller.currentPage * controller.count + controller.servers.length;

					controller.pages = data.pageInfo[0] ? Math.ceil(data.pageInfo[0].count / controller.count) : 1;
					controller.totalSegments = data.pageInfo[0] ? data.pageInfo[0].count : 0;

					if (!controller.loadedOnce){
						initPaging();
						controller.loadedOnce = true;
					} else if (!getPages) {
						controller.currentPage = 0;
						initPaging();
					}

					controller.isDirty = false;
					if (!controller.diskUUID && controller.servers[0])
						controller.diskUUID = controller.servers[0].disks.diskSegments.diskUUID;
				});

			};

			function initPaging() {

				paginationServiceInstance.createPagination($('#segmentsPagination-' + jqId(controller.diskId)), {
					totalPages: controller.pages,
					onPageClick: function(event, page) {
						controller.currentPage = page - 1;
						controller.loadSegments(controller.queryStringObj.filter, controller.queryStringObj.sort, true);
					}
				});
			}

			$timeout(function() {
				$(function() {
					$('#segmentstable-' + jqId(controller.diskId)).filtSort({
						load: controller.loadSegments,
						filter: controller.queryStringObj.filter || {},
						sort: controller.queryStringObj.sort || {}
					});
				});
			}, 0);
		}],
	controllerAs: 'multiSelectSegmentsCtrl',
	templateUrl: '/javascripts/directives/multiSelectComponents/multiSelectSegments.html'
});

managementApp.filter('bytesToUnit', function($rootScope) {
	function getUnitType(multiplier) {
		var unitType;

		switch (multiplier) {
			case 1:
				unitType = ['KB', 'KiB'];
				break;
			case 2:
				unitType = ['MB', 'MiB'];
				break;
			case 3:
				unitType = ['GB', 'GiB'];
				break;
			default:
				unitType = ['TB', 'TiB'];
		}

		return $rootScope.UNIT_VALUE === 1000 ? unitType[0] : unitType[1];
	}

	$rootScope.bytesToUnit = function(bytes, power) {
		if (isNaN(bytes))
			return bytes;

		var division = bytes / Math.pow($rootScope.UNIT_VALUE, power);
		var unit = getUnitType(power);
		return (Math.round(division * 100) / 100) + unit;
	};

	return $rootScope.bytesToUnit;
});