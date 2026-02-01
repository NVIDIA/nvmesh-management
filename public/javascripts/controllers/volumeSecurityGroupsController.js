/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global angular,CookieManager,consts,$,jQuery */

var managementApp = angular.module('managementApp');

managementApp.controller('volumeSecurityGroupsController', function($http, $rootScope, $scope,
	$timeout, $utils, multiSelectService, paginationService) {
	var controller = this;
	var originalData;
	var objectToEdit = [];
	var objectToCreate = [];
	controller.editMode = false;
	controller.isDirty = false;
	controller.currentPage = 0;
	controller.pages = 0;
	controller.count = CookieManager.getJSON('nvmesh-pagination').keysPagination || consts.defaultItemsPerPage;
	controller.queryStringObj = $utils.getQueryStringObj();
	var paginationServiceInstance = paginationService.getNewInstance();

	controller.getNumberOfChanges = function() {
		return objectToEdit.length + objectToCreate.length;
	};

	controller.save = function() {
		if (objectToCreate.length)
			$http.post('/volumeSecurityGroups/save', objectToCreate).success(function(data) {
				objectToCreate = [];
				$utils.handleResultsFadingAlerts('create', 'VolumeSecurityGroup', data);
				loadVSGs();
			});

		if (objectToEdit.length)
			$http.post('/volumeSecurityGroups/update', objectToEdit).success(function(data) {
				objectToEdit = [];
				$utils.handleResultsFadingAlerts('update', 'VolumeSecurityGroup', data);
				loadVSGs();
			});

		controller.isDirty = false;
	};

	controller.cancel = function() {
		controller.VSGs = originalData && originalData.length ? originalData.slice(0) : [];
		objectToEdit = [];
		objectToCreate = [];

		controller.isDirty = false;
	};

	function getVSGForEdit(index) {
		var VSG;

		//Check if the object is yet to be created and already edited.
		objectToCreate.forEach(function(e) {
			if (e._id === controller.keys[index]._id) {
				VSG = e;
				controller.keys.splice(index, 1);
				objectToCreate.splice(objectToCreate.indexOf(e), 1);
				controller.editMode = false;
			}
		});

		if (!VSG) {
			//clone the obj
			VSG = jQuery.extend({}, controller.VSGs[index]);
			controller.editMode = true;
		}

		return VSG;
	}

	controller.editVSG = function(index) {
		var selectedKeys = {};
		controller.VSG = getVSGForEdit(index);
		controller.VSG.index = index;

		controller.reloadKeysList();
		controller.VSG.keys.forEach(function(id) { selectedKeys[id] = id; });
		controller.selectedKeys = selectedKeys;
	};

	controller.getPages = function() {
		$http.get('/volumeSecurityGroups/count/', { params: { filter: controller.queryStringObj.filter || {} } }).success(function(data) {
			controller.totalVSGs = data;
			controller.pages = Math.ceil(data / controller.count) || 1;
			initPaging();
		});
	};

	function initPaging() {
		paginationServiceInstance.createPagination($('#VSGsPagination'), {
			totalPages: controller.pages,
			onPageClick: function(event, page) {
				controller.currentPage = page - 1;
				loadVSGs(controller.queryStringObj.filter, controller.queryStringObj.sort, true);
			}
		});
	}

	function loadVSGs(filter, sort, getPages) {
		controller.count = CookieManager.getJSON('nvmesh-pagination').VSGsPagination || consts.defaultItemsPerPage;
		controller.queryStringObj.filter = filter;
		controller.queryStringObj.sort = sort;

		if (!getPages) {
			controller.currentPage = 0;
			controller.getPages(controller.queryStringObj.filter);
		}

		$http.get('/volumeSecurityGroups/all/' + controller.currentPage + '/' + controller.count,
			{ params: { filter: filter || {}, sort: sort || {} } }).success(function(data) {
			controller.VSGs = data.slice(0);
			controller.lastItemIndex = controller.currentPage * controller.count + controller.VSGs.length;
			originalData = data;
		});
	}

	controller.deleteVSGs = function() {
		const VSGsToRemove = controller.selected.getValues().map(({ _id, uuid }) => ({ _id, uuid }));

		$http.post('/volumeSecurityGroups/delete', VSGsToRemove).success(function(data) {
			loadVSGs();
			if (data)
				multiSelectService.handleResponse('VSGs', controller, data);
		});
	};

	controller.actions = [{
		text: 'Delete',
		click: controller.deleteVSGs,
		isDisabled: function() {
			return false;
		}
	}];

	controller.newVSG = () => {
		controller.editMode = false;
		controller.VSG = {};

		controller.reloadKeysList();
		controller.selectedKeys = {};
	};

	controller.cancelEdit = function() {
		controller.editMode = false;
		$('#editVSGModal').find('input').val('').trigger('input');
	};

	controller.invalidName = function(name, element) {
		var isInvalid = name && (name.match(/^[\w-]+$/) === null || name.length > 1024);
		element.$setValidity('name', !isInvalid);
		return isInvalid;
	};

	controller.addVSG = function() {
		var VSG = jQuery.extend({}, controller.VSG);
		VSG.keys = controller.selectedKeys.getValues().map(k => typeof k === 'string' ? k : k._id);

		if (controller.editMode) {
			controller.VSGs[VSG.index] = VSG;
			delete VSG.index;
			objectToEdit.push(VSG);
		} else {
			objectToCreate.push(VSG);
			controller.VSGs.push(VSG);
		}

		controller.isDirty = true;
		controller.VSG = {};

		$('#editVSGModal').modal('hide');
		setTimeout(function() { $('#saveChangesAnchor').focus(); }, 0);

		controller.editMode = false;
	};

	$timeout(function() {
		$('#VSGs-table').filtSort({
			load: loadVSGs,
			filter: controller.queryStringObj.filter || {},
			sort: controller.queryStringObj.sort || {},
			scope: $scope
		});
	});

	loadVSGs(controller.queryStringObj.filter, controller.queryStringObj.sort, false);

	return controller;
});

