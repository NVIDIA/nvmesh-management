/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* global angular,SOCKET,EVENTS,getTargetID,$,consts */

var managementApp = angular.module('managementApp');

managementApp.controller('serverController', function($rootScope, $http, $confirm, $context) {
	var controller = this;

	$(function() {
		$('.diskCollpase').click(function(){
			$(this).text(function(i, old){
				return old == 'hide' ? 'show' : 'hide';
			});
		});
	});

	function updateDisks(data) {
		controller.server.disks.forEach(function(disk) {
			if ((data.payload.diskID && disk.diskID == data.payload.diskID) || (disk.uuid && disk.uuid === data.payload.uuid)) {
				var keys = Object.keys(data.payload);
				keys.forEach(function(key) {
					if (key in disk)
						disk[key] = data.payload[key];
				});
			}
		});
		filterDisksIntoTypes(controller.server.disks);
	}

	function updateNics(data) {
		$rootScope.$evalAsync(function() {
			controller.server.nics.forEach(function(nic) {
				if (nic.nicID == data.payload.nicID) {
					var keys = Object.keys(data.payload);
					keys.forEach(function(key) {
						if (key in nic)
							nic[key] = data.payload[key];
					});
				}
			});
		});
	}

	function removeDisk(data) {
		$rootScope.$evalAsync(function() {
			var index = -1;
			controller.server.disks.forEach(function(disk, i){
				if (disk.diskID == data.payload.diskID){
					index = i;
				}
			});
			if (index > -1) {
				var removedArr = controller.server.disks.splice(index, 1);
				var removed = removedArr[0];

				updateCounter(
					controller.counters.diskCount,
					(removed && removed.health === 'alarm') ? -1 : 0,
					(removed && removed.health === 'critical') ? -1 : 0,
					-1
				);

				filterDisksIntoTypes(controller.server.disks);
			}
		});
	}

	function removeNic(data) {
		$rootScope.$evalAsync(function() {
			var index = -1;
			controller.server.nics.forEach(function(nic, i){
				if (nic.nicID == data.payload.nicID){
					index = i;
				}
			});
			if (index > -1) {
				var removedArr = controller.server.nics.splice(index, 1);
				var removed = removedArr[0];
				updateCounter(
					controller.counters.nicsCount,
					(removed && removed.health === 'alarm') ? -1 : 0,
					(removed && removed.health === 'critical') ? -1 : 0,
					-1
				);
			}
		});
	}

	function addDisk(data) {
		if (data && data.payload)
			$rootScope.$evalAsync(function() {
				controller.server.disks.push(data.payload);
				filterDisksIntoTypes(controller.server.disks);
			});
	}

	function addNic(data) {
		if (data && data.payload)
			$rootScope.$evalAsync(function() {
				controller.server.nics.push(data.payload);
			});
	}

	function updateCounter(counter, alarm, critical, total) {
		counter.alarm += alarm;
		counter.critical += critical;
		counter.total += total;
	}

	function resetCounter() {
		controller.counters.diskCount.total = controller.server.disks ? controller.server.disks.length : 0;
		controller.counters.diskCount.alarm = 0;
		controller.counters.diskCount.critical = 0;

		controller.counters.nicsCount.total = controller.server.nics.length;
		controller.counters.nicsCount.alarm = 0;
		controller.counters.nicsCount.critical = 0;

		controller.server.disks.forEach(function(e) {
			if (e.health && e.health !== 'healthy')
				if (e.health !== 'critical')
					controller.counters.diskCount.alarm++;
				else
					controller.counters.diskCount.critical++;
		});

		controller.server.nics.forEach(function(e) {
			if (e.health && e.health !== 'healthy')
				if (e.health !== 'critical')
					controller.counters.nicsCount.alarm++;
				else
					controller.counters.nicsCount.critical++;
		});
	}

	function updateNicsCounter(data) {
		$rootScope.$evalAsync(function() {
			updateCounter(controller.counters.nicsCount, data.payload.alarm, data.payload.critical, data.payload.total);
		});
	}

	function updateDisksCounter(data) {
		$rootScope.$evalAsync(function() {
			updateCounter(controller.counters.diskCount, data.payload.alarm, data.payload.critical, data.payload.total);
		});
	}

	function updateDiskFormatDetails(data) {
		if (data.payload.formatType) {
			controller.server.disks.forEach(function(disk) {
				if ((disk.uuid && disk.uuid === data.payload.uuid) ||
					(data.payload.diskID && disk.diskID === data.payload.diskID && data.payload.vendor && disk.Vendor === data.payload.vendor)) {

					disk.formatDetails = { 'formatType': data.payload.formatType };
					if (data.payload.formatType === consts.formatTypes.FORMAT_EC)
						disk.nZeroedBlks = 0;

					if (consts.driveFormatStatuses.indexOf(disk.status) === -1)
						disk.isPendingFormat = true;
				}
			});
			filterDisksIntoTypes(controller.server.disks);
		}
	}

	function filterDisksIntoTypes(disks) {
		var alreadyOrganizedDisks = [];

		if (disks && disks.length) {
			controller.excludedDisks = disks.filter(function(disk) { return disk.isExcluded; });
			alreadyOrganizedDisks = controller.excludedDisks.map(function(disk) { return disk.uuid; });

			controller.notInitializedDisks = disks.filter(function(disk) {
				return !disk.isPendingFormat && (disk.status === consts.diskStatus.NOT_INITIALIZED || disk.status === consts.diskStatus.FORMAT_ERROR)
					&& alreadyOrganizedDisks.indexOf(disk.uuid) === -1;
			});
			alreadyOrganizedDisks = alreadyOrganizedDisks.concat(controller.notInitializedDisks.map(function(disk) { return disk.uuid; }));

			controller.ecOptimizedDisks = disks.filter(function(disk) {
				return ((disk.formatDetails && disk.formatDetails.formatType === consts.formatTypes.FORMAT_EC) || (disk.metadata_size && !disk.formatDetails))
					&& alreadyOrganizedDisks.indexOf(disk.uuid) === -1;
			});
			alreadyOrganizedDisks = alreadyOrganizedDisks.concat(controller.ecOptimizedDisks.map(function(disk) { return disk.uuid; }));

			controller.raidOptimizedDisks = disks.filter(function(disk) {
				return ((disk.formatDetails && disk.formatDetails.formatType === consts.formatTypes.FORMAT_RAID) ||
					(!disk.metadata_size && !disk.formatDetails)) && alreadyOrganizedDisks.indexOf(disk.uuid) === -1;
			});
		} else {
			controller.ecOptimizedDisks = [];
			controller.raidOptimizedDisks = [];
			controller.notInitializedDisks = [];
			controller.excludedDisks = [];
		}
	}

	controller.init = function(serverID) {
		$http.get('/servers/' + serverID).success(function(data) {
			controller.server = data;
			filterDisksIntoTypes(controller.server.disks);

			controller.user = $context.user;
			controller.server;
			controller.counters = { diskCount: {}, nicsCount: {} };

			// event registration
			SOCKET.addHandler(getTargetID(controller.server.node_id) + '@' + EVENTS.diskFailureEvent.name, updateDisks);
			SOCKET.addHandler(getTargetID(controller.server.node_id) + '@' + EVENTS.diskReappearEvent.name, updateDisks);
			SOCKET.addHandler(getTargetID(controller.server.node_id) + '@' + EVENTS.diskWentOnlineEvent.name, updateDisks);
			SOCKET.addHandler(getTargetID(controller.server.node_id) + '@' + EVENTS.newDiskEvent.name, addDisk);
			SOCKET.addHandler(getTargetID(controller.server.node_id) + '@' + EVENTS.diskStatusChangeEvent.name, updateDisks);
			SOCKET.addHandler(getTargetID(controller.server.node_id) + '@' + EVENTS.DiskFinishedFormatEvent.name, updateDisks);
			SOCKET.addHandler(getTargetID(controller.server.node_id) + '@' + EVENTS.driveZeroingProgressChangeEvent.name, updateDisks);

			SOCKET.addHandler(getTargetID(controller.server.node_id) + '@' + EVENTS.nicFailureEvent.name, updateNics);
			SOCKET.addHandler(getTargetID(controller.server.node_id) + '@' + EVENTS.nicReappearEvent.name, updateNics);
			SOCKET.addHandler(getTargetID(controller.server.node_id) + '@' + EVENTS.nicWentOnlineEvent.name, updateNics);
			SOCKET.addHandler(getTargetID(controller.server.node_id) + '@' + EVENTS.newNicEvent.name, addNic);
			SOCKET.addHandler(getTargetID(controller.server.node_id) + '@' + EVENTS.nicChangeEvent.name, updateNics);

			SOCKET.addHandler(getTargetID(controller.server.node_id) + '@' + EVENTS.disksCountChangeEvent.name, updateDisksCounter);
			SOCKET.addHandler(getTargetID(controller.server.node_id) + '@' + EVENTS.nicsCountChangeEvent.name, updateNicsCounter);

			SOCKET.addHandler(getTargetID(controller.server.node_id) + '@' + EVENTS.diskRemovedEvent.name, removeDisk);
			SOCKET.addHandler(getTargetID(controller.server.node_id) + '@' + EVENTS.nicRemovedEvent.name, removeNic);

			SOCKET.addHandler(getTargetID(controller.server.node_id) + '@' + EVENTS.formatDiskEvent.name, updateDiskFormatDetails);

			resetCounter();
		});
	};

	controller.Math = window.Math;
	controller.diskSegment;

	controller.setDiskSegment = function(diskSegment) {
		controller.diskSegment = diskSegment;
	};

	controller.generateRows = function(numberOfDisks) {
		var iterations = Math.ceil(numberOfDisks / 3);

		//Needed if module is not yet loaded.
		if (iterations)
			return new Array(iterations);
	};

	controller.createComponentRow = function(index, array) {
		var result = [];
		for (var i = index * 4; i < 4 * (index + 1); i++) {
			if (array[i]) {
				array[i].index = index + i;
				result.push(array[i]);
			}
		}

		return result;
	};

	controller.templateUrl = 'popoverTemplate.html';
	controller.Math = window.Math;

	return controller;
});

managementApp.run(function() {
	setTimeout(function() {
		$('[data-toggle="popover"]').popover({ trigger: 'hover' });
	}, 1000);
});

managementApp.filter('celsius', function() {
	return function(kelvin) {
		return toCelsius(kelvin).toFixed(2);
	};
});

managementApp.filter('pingToStatus', function() {
	return function(dateModified, tomaStatus) {
		if (tomaStatus === consts.tomaStatuses.DOWN)
			return { class: 'fa fa-exclamation-circle red', msg: 'Toma is down' };
		else if (tomaStatus === consts.tomaStatuses.UNAVAILABLE)
			return { class: 'fa fa-exclamation-circle red', msg: 'Target status Unavailable' };

		if (dateModified) {
			var now = new Date();
			var delta = (now - new Date(dateModified)) / 1000;

			//More than 2 minutes since last communication
			if (delta > 10 * 60 && delta < 15 * 60)
				return { class: 'ion-alert-circled yellow', msg: 'More than 2 minutes since last communication' };
			else if (delta > 15 * 60)
				return { class: 'fa fa-exclamation-circle red', msg: 'More than 5 minutes since last communication' };

			return { class: 'ion-checkmark-circled green' };
		}
	};
});

managementApp.filter('segmentStatusToLabel', function() {
	return function(status) {
		switch (status) {
			case 'normal':
				return 'success';
			case 'dead':
				return 'danger';
			case 'under_recovery':
				return 'primary';
			default:
				return 'info';
		}
	};
});

managementApp.filter('segmentStatusToCaption', function() {
	return function(status) {
		switch (status) {
			case 'normal':
				return 'Normal';
			case 'dead':
				return 'Dead';
			case 'under_recovery':
				return 'Under Recovery';
			case 'remap':
				return 'Remap';
			case 'replacement':
				return 'Replacement';
			case 'markedForRebuild_old':
			case 'markedForRebuild':
				return 'Marked For Rebuild';
			case 'zeroing':
				return 'Zeroing';
			default:
				return 'Unknown status';
		}
	};
});

function toCelsius(kelvin) {
	return (parseInt(kelvin) - 272.15);
}
