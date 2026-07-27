/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* global angular,CookieManager,SOCKET,EVENTS,WATCHERS,consts,jQuery,$ */

var managementApp = angular.module('managementApp');

managementApp.controller('volumesController', function($scope, $http, $q, $rootScope, $confirm,
	$context, $timeout, $interval, $filter, $utils, paginationService, multiSelectService, nextPageService) {
	var controller = this;
	controller.user = $context.user;
	controller.consts = consts;
	controller.RAIDLevels = getRAIDLevelsForDisplay();
	controller.serversRegexValid = false;
	controller.isDirty = false;
	controller.isPendingAction = false;
	controller.obj = { unitType: null };
	controller.volumes = [];
	controller.pages = 1;
	controller.count = CookieManager.getJSON('nvmesh-pagination').volumesPagination || consts.defaultItemsPerPage;
	controller.currentPage = 0;
	controller.volume = getFreshVolume();
	controller.allocatedSpace = 0;
	controller.totalSpace = 0;
	controller.editMode = false;
	controller.volumeID = 'placeholder';
	controller.virtualCapacity;
	controller.editCapacity = 0;
	controller.filter = {};
	controller.sort = {};
	controller.capacityAllocationType = 'custom';
	controller.volumeDiagram = {};
	controller.raidOptionsControl = {};
	controller.volumeLimitersEmpty = true;
	controller.mdvLimitersEmpty = true;
	var paginationServiceInstance = paginationService.getNewInstance();
	controller.active = {
		VPG: true
	};
	controller.showSubTab = {
		layout: true,
		security: true,
		export: true,
		advanced: true
	};
	controller.activeSubTab = 'layout';

	controller.passphraseCommandToName = {
		[consts.volumeEncryptionCommands.ADD_PASSPHRASE]: 'Add',
		[consts.volumeEncryptionCommands.DELETE_PASSPHRASE]: 'Delete',
		[consts.volumeEncryptionCommands.ROTATE_PASSPHRASE]: 'Rotate',
	};

	$http.get('/volumes/nvmfDefault/').success(function(data) {
		controller.nvmfDefault = data;
		controller.volume.enableNVMf = controller.nvmfDefault;
	});

	controller.isElectDisabled = true;
	$http.get('/generalSettings/isElectDisabled').success(res => {
		controller.isElectDisabled = res.isElectDisabled;
	});

	controller.statusUpdateTimerID;

	controller.queryStringObj = $utils.getQueryStringObj();

	var RAIDLevelValues = [];

	for (var key in consts.RAIDLevel) {
		if (Object.prototype.hasOwnProperty.call(consts.RAIDLevel, key))
			RAIDLevelValues.push(consts.RAIDLevel[key]);
	}

	controller.RAIDLevels = RAIDLevelValues.filter(function(rLevel) { return rLevel != consts.RAIDLevel.JBOD; });

	function loadInitEncryptionDefaults() {
		controller.initEncryptionDetails = {
			slot: 1,
			keySize: consts.XTS_KEY_SIZES.XTS_AES_256,
			command: consts.volumeEncryptionCommands.INIT_ENCRYPTION
		};
	}

	function isPassphraseCmdDisabled() {
		return controller.selected.getValues().some(v =>
			!v.isEncrypted ||
			!v.encryption.isInitialized ||
			v.encryption.command?.status && v.encryption.command?.status !== consts.encryptionCommandStatuses.EXECUTED);
	}

	function openPassphraseModal(passphraseCommand) {
		controller.passphraseDetails = {
			slot: 1,
			command: passphraseCommand
		};

		$('#passphraseModal').modal('show');
	}

	var BLOCKSET_TO_BYTES = 32 * 4000; // 32 * 4k Converting from blockset to bytes
	var MIN_VOLUME_SIZE = 1;
	var objectToEdit = [];
	var objectToCreate = [];
	var encryptionCommand = [];
	var pendingUpdateVolumes = {};
	var originalData = [];
	var VSGsSelectize;
	var VPGSelectize;
	var mdVPGSelectize;
	var sourceVolumeSelectize;
	var VPGTab = true;

	function getMultiplier(unitType) {
		switch (unitType) {
			case 'GB':
			case 'GiB':
				return 0;
			case 'TB':
			case 'TiB':
				return 1;
			case 'PB':
			case 'PiB':
				return 2;
		}
	}

	function getRAIDLevelsForDisplay() {
		var allTypes = Object.values(consts.RAIDLevel);
		var indexOfJbod = allTypes.indexOf(consts.RAIDLevel.JBOD);
		allTypes.splice(indexOfJbod, 1);
		return allTypes;
	}

	$http.get('/servers/count', { params: { filter: { node_status: { $ne: 1 } } } }).success(function(data) {
		controller.offlineServers = data;
	});

	SOCKET.addHandler(EVENTS.newVolumeEvent.name, function() {
		controller.loadVolumes(controller.queryStringObj.filter, controller.queryStringObj.sort, false);

		if (controller.statusUpdateTimerID) {
			clearTimeout(controller.statusUpdateTimerID);
		}
		controller.statusUpdateTimerID = setTimeout(function() {
			controller.updateVolumesStatuses(controller.filter, controller.sort, true);
		}, 5000);
	});

	SOCKET.addHandler(EVENTS.serversCountChangeEvent.name, function(data) {
		$rootScope.$evalAsync(function() {
			getTotalAndAllocatedSpace();
			controller.offlineServers = data.payload.withBadStatus;
		});
	});

	function getFactorForGUnitConversion() {
		return $rootScope.UNIT_VALUE === 1000 ? 1 : consts.DECIMAL_BINARY_G_FACTOR;
	}

	function convertToGigabytesIfNeeded(capacity) {
		var gigabytes = capacity / getFactorForGUnitConversion();
		return gigabytes * Math.pow($rootScope.UNIT_VALUE, getMultiplier(controller.obj.unitType));
	}

	controller.convertToUnits = function(gBytes) {
		var units = gBytes * getFactorForGUnitConversion();
		return precisionFloor(units / Math.pow($rootScope.UNIT_VALUE, getMultiplier(controller.obj.unitType)), 6);
	};

	controller.minCapacity = controller.convertToUnits(MIN_VOLUME_SIZE);

	function getFreshVolume() {
		return {
			RAIDLevel: consts.RAIDLevel.CONCATENATED,
			numberOfMirrors: 1,
			capacity: 0,
			stripeSize: 32,
			stripeWidth: 2,
			dataBlocks: 8,
			parityBlocks: 2,
			protectionLevel: consts.ecSeparationTypes.FULL,
			limitByNodes: [],
			limitByDisks: [],
			serverClasses: [],
			diskClasses: [],
			relativeRebuildPriority: 10,
			enableNVMf: controller.nvmfDefault || false
		};
	}

	controller.getNumberOfChanges = function() {
		return objectToEdit.length + objectToCreate.length + encryptionCommand.length;
	};

	controller.getPages = function() {
		var defaultFilter = {
			'isReserved': {
				'$not':	{
					'$eq': true
				}
			}
		};
		var filter = jQuery.isEmptyObject(controller.queryStringObj.filter) ? defaultFilter : controller.queryStringObj.filter;

		$http.get('/volumes/count/', { params: { filter: filter } }).success(function(data) {
			controller.pages = Math.ceil(data / controller.count) || 1;
			controller.totalVolumes = data;
			if (controller.currentPage >= controller.pages) {
				controller.currentPage = controller.pages - 1;
				controller.loadVolumes(controller.queryStringObj.filter, controller.queryStringObj.sort, true);
			}
			initPaging();
		});
	};

	controller.updateVolumesStatuses = function(filter, sort, getPages) {
		controller.filter = filter;
		controller.sort = sort;

		if (!getPages) {
			controller.currentPage = 0;
			controller.getPages(controller.filter);
		}

		$http.get('/volumes/all/' + controller.currentPage + '/' + controller.count, { params: { filter: filter || {}, sort: sort || {} } })
			.success(function(data) {
				var latestVolumes = data.slice(0);
				var lastStatuses = latestVolumes.map(function(v) { return { name: v.name, status: v.status, action: v.action }; });

				controller.volumes.forEach(function(vol) {
					var latestVol = lastStatuses.filter(function(v){ return v.name == vol.name; })[0];
					if (latestVol && latestVol.status)
						vol.status = latestVol.status;

					if (latestVol && latestVol.action)
						vol.action = latestVol.action;
				});
			});
	};


	function getSumOfDirtyBitsPerVolume(volume) {
		var totalDirtyBits = 0;

		//Sum all the dirty bits in the volume.
		var chunks = volume.chunks;
		if (volume.mdv && volume.mdv.chunks)
			chunks = chunks.concat(volume.mdv.chunks);

		chunks.forEach((chunk) => {
			chunk.pRaids.forEach((pRaid) => {
				pRaid.diskSegments.forEach((segment) => {
					totalDirtyBits += segment.remainingDirtyBits || 0;
				});
			});
		});

		return totalDirtyBits;
	}

	function calculateDirtyBitsPercentage(volume, totalDirtyBits) {
		var dirtyBitsPercentage = 0;
		var dirtyBytes = totalDirtyBits * (BLOCKSET_TO_BYTES / consts.GB);

		function getDataCapacity(volume) {
			var dataCapacity = volume.capacity;

			if (volume.RAIDLevel === consts.RAIDLevel.ERASURE_CODING || volume.RAIDLevel === consts.RAIDLevel.STRIPED_ERASURE_CODING)
				dataCapacity *= (volume.dataBlocks + volume.parityBlocks - 1) / volume.dataBlocks;

			return dataCapacity;
		}

		var dataCapacity = getDataCapacity(volume);
		dirtyBitsPercentage = 100 - Math.floor(dirtyBytes / dataCapacity * 100);


		return dirtyBitsPercentage;
	}

	controller.loadVolumes = function(filter, sort, getPages) {
		controller.queryStringObj.filter = filter;
		controller.queryStringObj.sort = sort;
		controller.count = CookieManager.getJSON('nvmesh-pagination').volumesPagination || consts.defaultItemsPerPage;

		if (!getPages) {
			controller.currentPage = 0;
			controller.getPages(controller.filter);
		}
		if (!controller.isPendingAction) {
			$http.get('/volumes/all/' + controller.currentPage + '/' + controller.count, { params: { filter: filter || {}, sort: sort || {} } })
				.success(function(data) {
					//This will clone the data array.
					var lastStatuses = controller.volumes.map(function(v) { return { name: v.name, status: v.status, action: v.action }; });
					controller.volumes = data.slice(0);

					var pageInitData = nextPageService.getData();
					if (pageInitData && pageInitData.volumeToShow) {
						controller.volumeDiagram.show(pageInitData.volumeToShow);
					}

					originalData = data;
					controller.lastItemIndex = controller.currentPage * controller.count + controller.volumes.length;

					lastStatuses.forEach(function(lastStatus) {
						var vol = controller.volumes.filter(function(v){ return v.name == lastStatus.name; })[0];
						if (vol && lastStatus.status)
							vol.status = lastStatus.status;

						if (vol && lastStatus.action)
							vol.action = lastStatus.action;
					});

					controller.volumes.forEach(function(volume) {
						// in case zeroing progress on deletion is running
						if (volume.deletionZeroingStarted && volume.action === consts.volumeActions.MARKED_FOR_DELETION)
							volume.action = consts.volumeActions.DELETING;

						if (volume.status === consts.volumeStatuses.DEGRADED) {
							var totalDirtyBits = getSumOfDirtyBitsPerVolume(volume);
							if (!totalDirtyBits)
								return;
							volume.dirtyBitsPercentage = calculateDirtyBitsPercentage(volume, totalDirtyBits);
						}

						SOCKET.addHandler($context.getVolumeID(volume._id) + EVENTS.volumeRemovedEvent.name, function() {
							$rootScope.$evalAsync(function() {
								controller.isPendingAction = false;
								controller.volumes = controller.volumes.filter(function(e) { return e.uuid !== volume.uuid; });
								controller.loadVolumes(controller.queryStringObj.filter, controller.queryStringObj.sort, false);
							});
						});

						SOCKET.addHandler($context.getVolumeID(volume._id) + EVENTS.volumeStatusChangeEvent.name, function(eventArgs) {
							$rootScope.$evalAsync(function() {
								if (eventArgs.payload) {
									var controllerVolumeToUpdate = getControllerVolumeByID(volume._id);
									controllerVolumeToUpdate.status = eventArgs.payload.status;

									if (controllerVolumeToUpdate.status === consts.volumeStatuses.ONLINE)
										controllerVolumeToUpdate.dirtyBitsPercentage = 0;
								}
							});
							controller.loadVolumes(controller.queryStringObj.filter, controller.queryStringObj.sort);
						});

						SOCKET.addHandler($context.getVolumeID(volume._id) + EVENTS.volumeActionChangeEvent.name, function(eventArgs) {
							$rootScope.$evalAsync(function() {
								if (eventArgs.payload) {
									var controllerVolumeToUpdate = getControllerVolumeByID(volume._id);
									controllerVolumeToUpdate.action = eventArgs.payload.action;
								}
							});
							controller.loadVolumes(controller.queryStringObj.filter, controller.queryStringObj.sort);
						});

						SOCKET.addHandler($context.getVolumeID(volume._id) + EVENTS.dirtyBitsChangeEvent.name, function(eventArgs) {
							$rootScope.$evalAsync(function() {
								if ((eventArgs.payload || !eventArgs.payload && eventArgs.payload === 0) && eventArgs.payload > -1 && volume.capacity > 0) {
									var controllerVolumeToUpdate = getControllerVolumeByID(volume._id);
									var totalDirtyBits = eventArgs.payload;
									controllerVolumeToUpdate.dirtyBitsPercentage = calculateDirtyBitsPercentage(volume, totalDirtyBits);
								}
							});
						});

						SOCKET.addHandler($context.getVolumeID(volume._id) + EVENTS.volumeDeletionZeroingProgressChangeEvent.name, function(eventArgs) {
							$rootScope.$evalAsync(function() {
								if (eventArgs.payload && parseInt(eventArgs.payload.totalZeroedPercentage) >= 0) {
									var controllerVolumeToUpdate = getControllerVolumeByID(volume._id);
									controllerVolumeToUpdate.deletionZeroingStarted = true;
									controllerVolumeToUpdate.deletionZeroProgressPercentage = eventArgs.payload.totalZeroedPercentage;

									// in case zeroing progress on deletion is running
									if (controllerVolumeToUpdate.action === consts.volumeActions.MARKED_FOR_DELETION)
										controllerVolumeToUpdate.action = consts.volumeActions.DELETING;
								}
							});
						});
					});

					if (!controller.isPendingAction)
						controller.isDirty = false;
				});
		}
		getTotalAndAllocatedSpace();

		if (!controller.isPendingAction)
			controller.isDirty = false;
	};

	WATCHERS.push($scope.$watchGroup([
		'volumesCtrl.volume.enableCrcCheck',
		'volumesCtrl.volume.RAIDLevel',
		'volumesCtrl.volume.capacity',
		'volumesCtrl.volume.numberOfMirrors',
	], function() {
		getTotalAndAllocatedSpace();
	}));

	WATCHERS.push($rootScope.$watch('UNIT_VALUE', function() {
		controller.obj = { unitType: $rootScope.UNIT_G };
	}));

	function getControllerVolumeByID(volumeID) {
		var volume = null;
		if (controller.volumes && controller.volumes.length)
			controller.volumes.forEach((vol) => {
				if (vol._id == volumeID)
					volume = vol;
			});

		return volume;
	}

	function getTotalAndAllocatedSpace() {
		if (!controller.volume.limitByDisks)
			controller.volume.limitByDisks = [];

		if (controller.availableDisks && !controller.availableDisks.length) {
			controller.totalSpace = 0;
			controller.allocatedSpace = 0;
			controller.availableMirrors = 0;
		} else {
			var limitByDisks = controller.volume.limitByDisks
				? controller.volume.limitByDisks
				: controller.availableDisks;

			var postData = {
				nodes: controller.volume.limitByNodes,
				disks: limitByDisks,
				vpg: controller.volume.VPG,
				onlyEC: controller.raidOptionsControl.requiresMetaDataDrives && controller.raidOptionsControl.requiresMetaDataDrives()
			};

			$http.post('/servers/totalSpace', postData).success(function(data) {
				controller.totalSpace = data;
			});

			$http.post('/servers/allocatedSpace', postData).success(function(data) {
				controller.allocatedSpace = data;
			});

			var allocationCapacity = controller.editCapacity ? controller.volume.capacity - controller.editCapacity : controller.volume.capacity;
			if (controller.capacityAllocationType === 'max')
				allocationCapacity = 0;

			var divisor = 1;

			if (controller.volume.RAIDLevel === consts.RAIDLevel.ERASURE_CODING ||
				controller.volume.RAIDLevel === consts.RAIDLevel.STRIPED_ERASURE_CODING)
				divisor = controller.volume.dataBlocks;

			if (controller.volume.VPG) {
				const filter = JSON.stringify({ _id: controller.volume.VPG });
				const projection = JSON.stringify({ dataBlocks: 1, RAIDLevel: 1 });
				$http.get('/volumeProvisioningGroups/all/0/0?filter=' + filter + '&projection=' + projection).then(function(data) {
					const vpg = data.data[0];
					if (vpg.RAIDLevel === consts.RAIDLevel.ERASURE_CODING ||
						vpg.RAIDLevel === consts.RAIDLevel.STRIPED_ERASURE_CODING)
						divisor = vpg.dataBlocks;
				});
			}

			$http.post('/servers/availableMirrors/' + (allocationCapacity / divisor), postData).then(function(data) {
				controller.availableMirrors = data.data;
			});
		}
	}

	controller.getTotalAndAllocatedSpace = getTotalAndAllocatedSpace;

	//Get disks should works only when disk/server classes is used.
	controller.getDisks = function() {
		$http.post('/diskClasses/getDisksByServerAndDiskClasses', {
			diskClasses: controller.volume.diskClasses,
			serverClasses: controller.volume.serverClasses
		}).success(function(data) {
			controller.availableDisks = data.map(function(obj) { return obj._id; });

			getTotalAndAllocatedSpace();
		});
	};

	controller.getDisksByVPG = function() {
		if (controller.volume.VPG)
			$http.get('/volumeProvisioningGroups/getDisksByID/' + controller.volume.VPG).success(function(data) {
				controller.availableDisks = data.map(function(obj) { return obj._id; });

				getTotalAndAllocatedSpace();
			});
	};

	controller.setCapacity = function(vc) {
		if (!vc && vc !== 0)
			return false;

		controller.volume.capacity = convertToGigabytesIfNeeded(vc);
	};

	controller.getVolumeSpace = function() {
		// Check if the volume is already created
		const volumeCreated = !objectToCreate.find(e => e.name === controller.volume.name);

		return controller.editMode && volumeCreated
			? controller.convertToUnits((controller.volume.blocks * (controller.volume.blockSize / consts.GB)))
			: 0;
	};

	controller.getAvailableSpace = function() {
		const availableSpace = controller.totalSpace - controller.allocatedSpace;
		return controller.getSpaceWithoutRedundancy(availableSpace < 0 ? 0 : availableSpace);
	};

	controller.getMaxSpace = function() {
		return controller.getAvailableSpace() + controller.getVolumeSpace();
	};


	function precisionFloor(number, precision) {
		var factor = Math.pow(10, precision);
		return Math.floor(number * factor) / factor;
	}

	controller.resetCapacity = function() {
		controller.editCapacity = controller.volume.capacity;
		controller.virtualCapacity = precisionFloor(controller.convertToUnits(controller.editCapacity), 4);
	};

	controller.clearCapacity = function() {
		controller.virtualCapacity = null;
		delete controller.volume.capacity;
	};

	controller.unitTypeChanged = function() {
		controller.resetCapacity();

		if (controller.editMode)
			controller.minCapacity = controller.convertToUnits(controller.editCapacity);
		else
			controller.minCapacity = controller.convertToUnits(MIN_VOLUME_SIZE);
	};

	controller.getSpaceWithoutRedundancy = (space) => {
		const redundancyRatio = $scope.getRedundancyRatio(controller.volume);
		return space / (1 + redundancyRatio);
	};

	controller.getCapacity = function() {
		switch (controller.capacityAllocationType) {
			case 'max':
				return controller.totalSpace;
			case 'nochange':
				return controller.volume.blocks * controller.volume.blockSize;
			default:
				return controller.volume.capacity;
		}
	};

	controller.getCapacityStatus = function() {
		var total = controller.getSpaceWithoutRedundancy(controller.totalSpace);
		var capacity = controller.getCapacity();
		var colorString = capacity < total / 2 ? 'green' : capacity < 0.8 * total ? 'yellow' : 'red';

		return colorString;
	};

	controller.getVolumeCurrentCapacity = function() {
		return controller.convertToUnits((controller.volume.blocks * (controller.volume.blockSize / consts.GB)));
	};

	controller.getCapacityString = function() {
		var s = '';
		if (controller.editMode) {
			s = 'Current: ' + controller.convertToUnits((controller.volume.blocks * (controller.volume.blockSize / consts.GB))) + ', ';
		}

		const availableSpace = controller.getAvailableSpace();
		s += 'Maximum Available: ' + $filter('gigabytesToBiggestUnits')(availableSpace);
		return s;
	};

	controller.removeMirrors = function() {
		if (controller.volume.RAIDLevel === 'Mirrored RAID-1' || controller.volume.RAIDLevel === 'Striped & Mirrored RAID-10')
			controller.volume.numberOfMirrors = 1;
		else
			controller.volume.numberOfMirrors = 0;
	};

	controller.isRebuildActionDisabled = function(volume) {
		var disabled = true;

		var chunks = volume.chunks || [];

		chunks.forEach(function(chunk) {
			chunk.pRaids.forEach(function(pRaid) {
				var remappedVolumes = pRaid.diskSegments.filter(function(ds) { return ds.status === 'remap'; });
				if (remappedVolumes.length)
					disabled = false;
			});
		});

		return disabled;
	};

	controller.rebuildVolumes = function() {
		var volumes = controller.selected.getValues();
		var payload = volumes.map(v => ({ _id: v._id, uuid: v.uuid }));

		//Don't confirm just rebuild.
		if (volumes.every(function(volume) {
			return (volume.diskClasses && volume.diskClasses.length) || (volume.serverClasses && volume.serverClasses.length);
		}))
			return rebuild();

		function rebuild() {
			$http.post('/volumes/rebuildVolumes', payload).success(function(data) {
				controller.loadVolumes(controller.queryStringObj.filter, controller.queryStringObj.sort, true);
				controller.failed = [];
				if (data)
					multiSelectService.handleResponse('Volumes', controller, data);
			});
		}

		$confirm({
			text: 'Attention! The volume doesn\'t have any classes defined. Confirming will ' +
			'start the rebuild process using any available space. If this is not acceptable, click cancel below ' +
				'and then edit the volume in order to define a class.'
		}).then(function() {
			rebuild();
		});
	};

	controller.toggledVolumeAction = function() {
		var interval = 5;
		var tick = 1.0 / interval;
		controller.progressColor = 'red';
		controller.progressText = interval;
		controller.removeVolumeEnabled = false;
		controller.progress = 0.0;

		if (angular.isDefined(controller.volumeActionInterval)) {
			$interval.cancel(controller.volumeActionInterval);
		}

		controller.volumeActionInterval = $interval(function(){
			controller.progress += tick;
			controller.progressText = controller.progressText - 1;
		}, 1000, interval);

		controller.volumeActionInterval.then(function() {
			controller.progress = 0.0;
			controller.progressText = '';
			controller.removeVolumeEnabled = true;
		});
	};

	controller.addVolume = function() {
		controller.raidOptionsControl.removeRedundantFields();
		if (controller.volume.enableNVMf)
			controller.volume.selectedClientsForNvmf = controller.selectedClientsForNvmf.getValues();
		else
			controller.volume.selectedClientsForNvmf = [];

		if (controller.capacityAllocationType === 'max')
			controller.volume.capacity = consts.volumeCapacity.MAX;
		else if (controller.capacityAllocationType === 'nochange')
			controller.volume.capacity = consts.volumeCapacity.NO_CHANGE;

		var volume = jQuery.extend({}, controller.volume);
		const pendingUpdateVolume = jQuery.extend({}, controller.volumes[volume.index]);

		if (volume.VPG && volume.VPG.length !== 0) {
			const irrelevantKeys = ['diskClasses', 'serverClasses', 'limitByNodes', 'limitByDisks', 'dataBlocks', 'parityBlocks'];
			irrelevantKeys.forEach(k => {
				delete volume[k];
				delete pendingUpdateVolume[k];
			});
		}

		function addVolume(volume) {
			objectToCreate.push(volume);
			//Add to the table.
			controller.volumes.push(volume);
			setDirty();
		}

		function setDirty() {
			controller.isDirty = true;
			controller.isPendingAction = true;
			delete controller.virtualCapacity;
			controller.volume = getFreshVolume();

			$('#editVolumeModal').modal('hide');
			setTimeout(function() { $('#saveChangesAnchor').focus(); }, 0);

			controller.editMode = false;
		}

		if (controller.editMode) {
			pendingUpdateVolumes[volume.name] = pendingUpdateVolume;
			controller.volumes[volume.index] = volume;

			//Check if the volume already presented in objectToCreate or objectToEdit.
			if (!getVolumeForEdit(volume.index))
				objectToEdit.push(volume);
			else
				delete pendingUpdateVolumes[volume.name];

			delete volume.index;

			setDirty();
		} else
			addVolume(volume);
	};

	//Checks if the current volume(index) is yet to be save, and already someone tries to update it,  or it already being updated without saving.
	function getVolumeForEdit(index) {
		let volume;
		let isVolumeFound = false;

		//Check if the object is yet to be created and already edited.
		objectToCreate.forEach(function(e) {
			if (e.name === controller.volumes[index].name) {
				controller.editMode = false;
				controller.capacityAllocationType = 'custom';
				volume = e;
				controller.volumes.splice(index, 1);
				objectToCreate.splice(objectToCreate.indexOf(e), 1);
				isVolumeFound = true;
			}
		});

		if (!isVolumeFound) {
			//Check if the object is updated
			objectToEdit.forEach(function(e) {
				if (e.name === controller.volumes[index].name) {
					volume = e;
				}
			});
		}

		return volume;
	}

	controller.editVolume = function(index) {
		controller.editMode = true;
		controller.volume = getVolumeForEdit(index);

		// If the object is already created and hasn't been edited (without saving), then clone it.
		if (!controller.volume) {
			controller.volume = jQuery.extend({}, controller.volumes[index]);
		}

		controller.clearSelectizes(true);
		var selectedClientsForNvmf = {};
		controller.volume.selectedClientsForNvmf.forEach(function(id) { selectedClientsForNvmf[id] = id; });
		controller.selectedClientsForNvmf = selectedClientsForNvmf;

		controller.volume.index = index;

		if (controller.volume.VPG && controller.volume.VPG.length != 0) {
			controller.activateTab('VPG');
			controller.allocateByVPG();
			VPGSelectize.disable();
		} else {
			controller.activateTab('custom');
			controller.allocateWithoutVPG();
		}

		if (controller.volume.sourceID)
			sourceVolumeSelectize.disable();

		if (controller.volume?.mdvSpec?.VPG)
			mdVPGSelectize.disable();

		controller.resetCapacity();

		if (controller.volume.capacity == consts.volumeCapacity.MAX)
			controller.capacityAllocationType = 'max';
		else if (controller.editMode)
			controller.capacityAllocationType = 'nochange';

		controller.minCapacity = controller.virtualCapacity;

		VSGsSelectize.addItems(controller.volume.VSGs);
		VPGSelectize.addItems(controller.volume.VPG);
		sourceVolumeSelectize.addItems(controller.volume.sourceID);

		if (controller.volume?.mdvSpec?.VPG)
			mdVPGSelectize.addItems(controller.volume.mdvSpec.VPG);
	};

	controller.activateTab = function(tab) {
		controller.active = {};
		controller.active[tab] = true;
	};

	function enableSelectizes() {
		VSGsSelectize.enable();
		VPGSelectize.enable();
		mdVPGSelectize.enable();
		sourceVolumeSelectize.enable();
	}

	controller.newVolume = function() {
		delete controller.virtualCapacity;
		controller.volume = getFreshVolume();
		controller.clearSelectizes(true);

		controller.getDisks();

		controller.minCapacity = controller.convertToUnits(MIN_VOLUME_SIZE);
		controller.capacityAllocationType = 'custom';
		controller.virtualCapacity = '';
		controller.editMode = false;

		controller.allocateByVPG();
	};

	function calculateSubTabsActiveStatuses() {
		controller.activeSubTabsStatuses = {
			LAYOUT: (controller.activeSubTab === 'layout'),
			SECURITY: (controller.activeSubTab === 'security'),
			EXPORT: (controller.activeSubTab === 'export'),
			ADVANCED: (controller.activeSubTab === 'advanced'),
		};
	}

	calculateSubTabsActiveStatuses();

	controller.changeSubTab = function(tab) {
		controller.activeSubTab = tab;

		calculateSubTabsActiveStatuses();
	};	  

	function prepareVolumesForUpdate(objectToEdit) {
		const updatableVolumeProperties = ['description', 'limitByNodes', 'limitByDisks', 'VSGs', 'diskClasses', 'serverClasses', 'relativeRebuildPriority',
			'enableNVMf', 'enableCrcCheck', 'selectedClientsForNvmf', 'isReadOnly'];
			
		// chunks should not be part of the volume payload
		// eslint-disable-next-line no-unused-vars
		const volumes = objectToEdit.map(({ chunks, ...volumeWithoutChunks }) => volumeWithoutChunks);

		const volumesToExtend = volumes
			.filter(({ capacity }) => capacity !== consts.volumeCapacity.NO_CHANGE)
			.map(({ _id, uuid, name, capacity }) => ({ _id, uuid, name, capacity }));

		const volumesToUpdate = volumes
			.filter(volume => $utils.isEntityUpdated(pendingUpdateVolumes[volume.name], volume, updatableVolumeProperties))
			.map(volume => ({ ...volume, capacity: consts.volumeCapacity.NO_CHANGE }));

		pendingUpdateVolumes = {};
		return { volumesToExtend, volumesToUpdate };
	}

	controller.save = function() {
		// start listening to future volumes events
		objectToCreate.forEach(function(v){
			SOCKET.addHandler($context.getVolumeID(v.name) + EVENTS.volumeStatusChangeEvent.name, function(eventArgs) {
				$rootScope.$evalAsync(function() {
					var volume = controller.volumes.filter(function(e) { return e.name == v.name; })[0];
					if (volume)
						volume.status = eventArgs.payload.status;
				});
			});

			SOCKET.addHandler($context.getVolumeID(v.name) + EVENTS.volumeActionChangeEvent.name, function(eventArgs) {
				$rootScope.$evalAsync(function() {
					var volume = controller.volumes.filter(function(e) { return e.name == v.name; })[0];
					if (volume)
						volume.action = eventArgs.payload.action;
				});
			});

		});

		if (objectToCreate.length) {
			// preventing a situation when there is a volume payload with a VPG and classes in the validator
			clearVpgClasses();
			$http.post('/volumes/save', objectToCreate).success(function(data) {
				objectToCreate = [];
				setErrorIfMissing(data);
				$utils.handleResultsFadingAlerts('create', 'Volume', data);
				controller.getPages(controller.filter);
				controller.loadVolumes(controller.queryStringObj.filter, controller.queryStringObj.sort, true);
			});
		}

		if (objectToEdit.length) {
			const { volumesToExtend, volumesToUpdate } = prepareVolumesForUpdate(objectToEdit);

			if (volumesToExtend.length)
				callExtendVolumes(volumesToExtend);

			if (volumesToUpdate.length)
				callUpdateVolumes(volumesToUpdate);
		}

		if (encryptionCommand.length) {
			switch (encryptionCommand[0].command) {
				case consts.volumeEncryptionCommands.INIT_ENCRYPTION:
					$http.post('/volumes/initEncryption', encryptionCommand).success((data) => {
						encryptionCommand = [];
						setErrorIfMissing(data);
						$utils.handleResultsFadingAlerts('Encryption Initiate', 'Volume', data);
					});

					break;
				case consts.volumeEncryptionCommands.ADD_PASSPHRASE:
					$http.post('/volumes/addPassphrase', encryptionCommand).success((data) => {
						encryptionCommand = [];
						setErrorIfMissing(data);
						$utils.handleResultsFadingAlerts('Passphrase Add', 'Volume', data);
					});
					break;
				case consts.volumeEncryptionCommands.DELETE_PASSPHRASE:
					$http.post('/volumes/deletePassphrase', encryptionCommand).success((data) => {
						encryptionCommand = [];
						setErrorIfMissing(data);
						$utils.handleResultsFadingAlerts('Passphrase Delete', 'Volume', data);
					});
					break;
				case consts.volumeEncryptionCommands.ROTATE_PASSPHRASE:
					$http.post('/volumes/rotatePassphrase', encryptionCommand).success((data) => {
						encryptionCommand = [];
						setErrorIfMissing(data);
						$utils.handleResultsFadingAlerts('Passphrase Rotate', 'Volume', data);
					});
					break;
				case 'acknowledgeResponse':
					$http.post('/volumes/acknowledgeResponse', encryptionCommand).success((data) => {
						encryptionCommand = [];
						setErrorIfMissing(data);
						$utils.handleResultsFadingAlerts('Acknowledge Error', 'Volume', data);
						controller.selected.getValues().forEach(v=> v.encryption.command.response.acknowledged = true);
					});
					break;
			}
		}

		controller.isDirty = false;
		controller.isPendingAction = false;
	};

	function callUpdateVolumes(volumesToUpdate) {
		$http.post('/volumes/update', volumesToUpdate).success(function(data) {
			objectToEdit = [];
			setErrorIfMissing(data);
			$utils.handleResultsFadingAlerts('update', 'Volume', data);
			controller.getPages(controller.filter);
			controller.loadVolumes(controller.queryStringObj.filter, controller.queryStringObj.sort, true);
		});
	}

	function callExtendVolumes(volumesToExtend) {
		$http.post('/volumes/extend', volumesToExtend).success(function(data) {
			objectToEdit = [];
			setErrorIfMissing(data);
			$utils.handleResultsFadingAlerts('extend', 'Volume', data);
			controller.getPages(controller.filter);
			controller.loadVolumes(controller.queryStringObj.filter, controller.queryStringObj.sort, true);
		});
	}

	function setErrorIfMissing(data) {
		data.forEach(function(e) {
			if (!e.success)
				e.error = e.error ? e.error : 'not enough eligible space';
		});
	}

	function clearVpgClasses() {
		objectToCreate.forEach(function(volume) {
			if (volume.VPG && volume.VPG !== '') {
				volume.serverClasses = volume.diskClasses = [];
			}
		});
	}

	controller.cancel = function() {
		controller.volumes = originalData.slice(0) || [];
		objectToEdit = [];
		objectToCreate = [];
		encryptionCommand = [];

		controller.isDirty = false;
		controller.isPendingAction = false;
	};

	controller.clearSelectizes = function(enable) {
		controller.selectedClientsForNvmf = {};
		controller.reloadClients();

		if (VSGsSelectize)
			VSGsSelectize.clear();

		VPGSelectize.clear();
		mdVPGSelectize.clear();

		if (sourceVolumeSelectize)
			sourceVolumeSelectize.clear();

		if (enable)
			enableSelectizes();
	};

	controller.closeEditModal = function() {
		controller.editMode = false;
		controller.clearSelectizes(false);
	};

	controller.onSetEncryption = (isEncrypted) => {
		if (isEncrypted) {
			controller.volume.encryption = {
				headerSize: 16
			};
		} else {
			delete controller.volume.encryption;
		}
	};

	controller.handleSnapshot = function() {
		$rootScope.$evalAsync(function() {
			if (!controller.volume.mdvSpec)
				controller.volume.mdvSpec = {};

			if (controller.volume.isUsedAsSnapshot)
				controller.volume.isReadOnly = false;
		});
	};

	controller.allocateByVPG = function() {
		if (!controller.canAllocateByVPG())
			return false;

		controller.showSubTab.layout = false;
		controller.showSubTab.security = false;
		controller.showSubTab.export = true;
		controller.showSubTab.advanced = true;
		controller.changeSubTab('export');

		controller.active.VPG = true;
		VPGTab = true;
		return true;
	};

	controller.canAllocateByVPG = function() {
		if (controller.volume.VPG && controller.volume.VPG.length != 0)
			return true;

		return !controller.editMode && controller.volumeLimitersEmpty && controller.mdvLimitersEmpty;
	};

	controller.allocateWithoutVPG = function() {
		if (!controller.canAllocateWithoutVPG())
			return false;

		VPGTab = false;

		controller.showSubTab.layout = true;
		controller.showSubTab.security = true;
		controller.showSubTab.export = true;
		controller.showSubTab.advanced = true;
		controller.changeSubTab('layout');

		if (!controller.editMode) {
			// Clear fields set by VPG selection
			var cleanedVolume = getFreshVolume();
			delete cleanedVolume.capacity;
		}

		for (var field in cleanedVolume) {
			if (!(field in controller.volume && controller.volume[field] !== null && controller.volume[field] !== undefined))
				controller.volume[field] = cleanedVolume[field];
		}

		return true;
	};

	controller.canAllocateWithoutVPG = function() {
		return !controller.volume.VPG || (controller.volume.isUsedAsSnapshot && !controller.volume.mdvSpec.VPG);
	};

	controller.VPGInvalid = function() {
		return VPGTab && !controller.volume.VPG;
	};

	controller.mdVPGInvalid = function() {
		return VPGTab && controller.volume.mdvSpec && !controller.volume.mdvSpec.VPG;
	};

	controller.sourceVolumeInvalid = function() {
		return controller.volume.isUsedAsSnapshot && !controller.volume.sourceID;
	};

	//Check if the specified name already exists in cache(not in the DB)
	controller.nameAlreadyExists = function(name) {
		var gotVolumeWithTheSameName;
		controller.volumes.forEach(function(volume) {
			if (gotVolumeWithTheSameName) return;

			gotVolumeWithTheSameName = volume.name === name;
		});

		return gotVolumeWithTheSameName;
	};

	$scope.isValidVolumeNameForExport = function(name) {
		return name.indexOf('_') == -1;
	};

	controller.invalidName = function(name) {
		controller.isNameInvalid = name && name.match(/^[a-zA-Z0-9_\-+=]+$/) === null;
		controller.isNameInvalidForExport = controller.volume.enableNVMf && name && name.indexOf('_') != -1;
		controller.hasIllegalEnding = name.endsWith(consts.MetadataVolumeEnding);
		return controller.isNameInvalid || controller.isNameInvalidForExport || controller.hasIllegalEnding;
	};

	WATCHERS.push($scope.$watch('volumesCtrl.volume.name', function(newVal) {
		if (!newVal)
			return;
		var isNameInvalid = controller.invalidName(controller.volume.name);
		$scope.volumesCtrl.editVolumeForm.name.$setValidity('invalidName', !isNameInvalid);

		controller.isNameAlreadyExists = controller.nameAlreadyExists(controller.volume.name);
		$scope.volumesCtrl.editVolumeForm.name.$setValidity('nameAlreadyExists', controller.editMode || !controller.isNameAlreadyExists);

		$('#editVolumeName').prop('title', getEditNameTitle());
	}));

	function getEditNameTitle() {
		var nameTitle = [];

		if (controller.isNameInvalid)
			nameTitle.push('Name can only contain alphanumeric characters (letters A-Z, a-z, numbers 0-9) and the following characters: _-+=');
		if (!controller.editMode && controller.isNameAlreadyExists)
			nameTitle.push('Name already exists');
		if (controller.isNameInvalidForExport)
			nameTitle.push('Name cannot contain an underscore if enable access via NVMf is turned on');

		return nameTitle.join('.\n');
	}

	WATCHERS.push($scope.$watch('volumesCtrl.volume.VPG', function(newVal) {
		if (!newVal)
			return;

		var invalidVPG = controller.VPGInvalid();
		$scope.volumesCtrl.editVolumeForm.name.$setValidity('invalidVPG', !invalidVPG);
	}));

	WATCHERS.push($scope.$watchGroup([
		'volumesCtrl.initEncryptionDetails.slot',
	], function() {
		let isValid = $scope.volumesCtrl.initEncryptionDetails?.slot > 0;
		$scope.volumesCtrl.initEncryptionForm.slot.$setValidity('invalidSlot', isValid);
	}));

	function initPaging() {
		paginationServiceInstance.createPagination($('#volumesPagination'), {
			totalPages: controller.pages,
			onPageClick: function(event, page) {
				controller.currentPage = page - 1;
				controller.loadVolumes(controller.queryStringObj.filter, controller.queryStringObj.sort, true);
			}
		});
	}

	// Init servers selectize
	$timeout(function() {
		$('#volumes-table').filtSort({
			load: controller.loadVolumes,
			filter: controller.queryStringObj.filter || {},
			sort: controller.queryStringObj.sort || {},
			scope: $scope
		});

		//Init source volume selectize
		var $filter = {
			isReadOnly: true,
			status: { $nin: [consts.volumeStatuses.PENDING, consts.volumeStatuses.TO_BE_DELETED] },
			action: { $nin: [consts.volumeActions.DELETING, consts.volumeActions.MARKED_FOR_DELETION] }
		};
		var url = '/volumes/all/0/0?filter=' + JSON.stringify($filter) + '&projection={"name": 1, "uuid": 1}';
		$http.get(url).success(function(data) {
			sourceVolumeSelectize = $('#SourceVolumeSelect').selectize({
				create: false,
				onChange: function(e) {
					$rootScope.$evalAsync(function() {
						controller.volume.sourceID = e;
						controller.volume.sourceUUID = controller.sourceVolumes[e];

					});
				}
			})[0].selectize;

			sourceVolumeSelectize.addOption(data.map(function(d) { return { text: d._id, value: d._id }; }));
			controller.sourceVolumes = data.reduce(function(acc, curr) { acc[curr.name] = curr.uuid; return acc; }, {});
		});

		$http.get('/volumeSecurityGroups/all/0/0').success(function(data) {
			VSGsSelectize = $('#VSGsSelect').selectize({
				create: false,
				onChange: function(e) {
					$rootScope.$evalAsync(function() {
						controller.volume.VSGs = e || [];
					});
				}
			})[0].selectize;

			VSGsSelectize.addOption(data.map(function(d) { return { text: d._id, value: d._id }; }));
		});

		//Init VPG selectize
		$http.get('/volumeProvisioningGroups/all/0/0').success(function(data) {
			VPGSelectize = $('#VPGSelect').selectize({
				create: false,
				onChange: function(e) {
					$rootScope.$evalAsync(function() {
						controller.volume.VPG = e;
						delete controller.volume.isEncrypted;
						delete controller.volume.encryption;

						getTotalAndAllocatedSpace();
						//Clone the vpg RAID properties to the volume (so the UI could calculate available space etc.)
						$http.post('volumes/cloneVPGProperties', controller.volume).success(function(data) {
							controller.volume = data;
							controller.getDisksByVPG();
						});
					});
				}
			})[0].selectize;

			mdVPGSelectize = $('#MDVPGSelect').selectize({
				create: false,
				onChange: function(e) {
					$rootScope.$evalAsync(function() {
						controller.volume.mdvSpec.VPG = e;
					});
				}
			})[0].selectize;

			var VPGs = data.reduce(
				function(acc, currVPG) {
					acc[currVPG.type === consts.volumeTypes.METADATA_VOLUME ? 'metadata' : 'normal'].push(currVPG);
					return acc;
				},
				{ normal: [], metadata: [] }
			);
			//Add available options
			VPGSelectize.addOption(VPGs.normal.map(function(d) { return { text: d._id, value: d._id }; }));
			mdVPGSelectize.addOption(VPGs.metadata.map(function(d) { return { text: d._id, value: d._id }; }));
		});
	});

	controller.addEncryptionCommand = function(commandDetails) {
		if (commandDetails.command === consts.volumeEncryptionCommands.DELETE_PASSPHRASE)
			delete commandDetails.slot;

		if (commandDetails.command === consts.volumeEncryptionCommands.INIT_ENCRYPTION)
			commandDetails.keySize = parseInt(commandDetails.keySize);

		encryptionCommand = encryptionCommand
			.concat(controller.selected.getValues().map(v => ({ _id: v._id, uuid: v.uuid, ...commandDetails })));

		controller.isDirty = true;
	};

	controller.addEncryptionAck = function() {
		const commandDetails = {
			command: 'acknowledgeResponse'
		};

		encryptionCommand = encryptionCommand
			.concat(controller.selected.getValues().map(v => ({ ...v, ...commandDetails })));

		controller.isDirty = true;
	};

	controller.removeVolumes = function() {
		var deleteMsg = 'Warning: You are about to delete logical volumes and any '
			+ 'associated drive allocations to such volumes will be zeroed, '
			+ 'making recovery of these volumes impossible. Are you sure you want to continue?';

		$confirm({
			text: deleteMsg,
			ok: 'OK',
			requireUserInput: true
		}).then(
			function() {
				controller.deleteVolumes();
			}
		);
	};

	controller.deleteVolumes = function() {
		var volumesToRemove = controller.selected.getValues().map(v => ({ _id: v._id, uuid: v.uuid }));

		$http.post('/volumes/delete', volumesToRemove).success(function(data) {
			controller.getPages(controller.filter);
			controller.loadVolumes(controller.queryStringObj.filter, controller.queryStringObj.sort, true);
			controller.failed = [];
			if (data)
				multiSelectService.handleResponse('Volumes', controller, data);
		});
	};

	function cancelActions() {
		controller.isPendingAction = false;
		controller.loadVolumes(controller.queryStringObj.filter, controller.queryStringObj.sort, true);
	}

	controller.actions = [{
		text: 'Delete',
		click: controller.removeVolumes,
		isDisabled: function() {
			return !controller.user.isAdmin || controller.selected.getValues().some(v => v.type == consts.volumeTypes.METADATA_VOLUME);
		},
		preSave: function(callback) {
			// hack for the scale poc, should do it thru the multiselect table
			controller.isPendingAction = true;
			callback();
		},
		actionCanceled: cancelActions
	}, {
		text: 'Rebuild',
		click: controller.rebuildVolumes,
		isDisabled: function() {
			return controller.selected.getValues().some(controller.isRebuildActionDisabled);
		},
		preSave: function(callback) {
			// hack for the scale poc, should do it thru the multiselect table
			controller.isPendingAction = true;
			callback();
		},
		actionCanceled: cancelActions
	}, {
		text: 'Encryption',
		isButtonGroup: true,
		isDisabled: () => !controller.user.isAdmin || controller.selected.getValues().some(v => !v.isEncrypted),
		actions: [
			{
				text: 'Init Encryption',
				skipVerification: true,
				click: () => { loadInitEncryptionDefaults(); $('#initEncryptionModal').modal('show'); },
				isDisabled: function() {
					return controller.selected.getValues().some(v =>
						!v.isEncrypted ||
						v.encryption.isInitialized ||
						v.encryption.command?.status &&
							[consts.encryptionCommandStatuses.SENT, consts.encryptionCommandStatuses.PENDING_SEND].includes(v.encryption.command?.status)
					);
				},
				actionCanceled: cancelActions
			}, {
				text: 'Add Passphrase',
				skipVerification: true,
				click: () => { openPassphraseModal(consts.volumeEncryptionCommands.ADD_PASSPHRASE); },
				isDisabled: isPassphraseCmdDisabled,
				actionCanceled: cancelActions
			}, {
				text: 'Rotate Passphrase',
				skipVerification: true,
				click: () => { openPassphraseModal(consts.volumeEncryptionCommands.ROTATE_PASSPHRASE); },
				isDisabled: isPassphraseCmdDisabled,
				actionCanceled: cancelActions
			}, {
				text: 'Delete Passphrase',
				skipVerification: true,
				click: () => { openPassphraseModal(consts.volumeEncryptionCommands.DELETE_PASSPHRASE); },
				isDisabled: isPassphraseCmdDisabled,
				actionCanceled: cancelActions
			}, {
				text: 'Acknowledge Error',
				skipVerification: true,
				click: () => { controller.addEncryptionAck(); },
				isDisabled: () => controller.selected.getValues().some(v =>
					!v.isEncrypted ||
					!v.encryption.command?.response?.error ||
					!!v.encryption.command?.response?.acknowledged),
				actionCanceled: cancelActions
			}
		],
	}];

	return controller;
});

managementApp.filter('statusToCaption', function() {
	return function(status) {
		var caption;

		switch (status) {
			case 'online':
				caption = 'Online';
				break;
			case 'rebuildFailed':
				caption = 'Rebuild Failed';
				break;
			case 'offline':
				caption = 'Offline';
				break;
			case 'degraded':
				caption = 'Degraded';
				break;
			case 'pendingDeletion':
				caption = 'Pending Deletion';
				break;
			case 'unavailable':
				caption = 'Unavailable';
				break;
			default:
				caption = status;
		}

		return caption;
	};
});

managementApp.filter('segStatusToCaption', function() {
	return function(status) {
		var caption;
		switch (status) {
			case consts.diskSegmentStatuses.NORMAL:
				caption = 'Normal';
				break;
			case consts.diskSegmentStatuses.INITIALIZING:
				caption = 'Initializing';
				break;
			case consts.diskSegmentStatuses.ZEROING:
				caption = 'Zeroing';
				break;
			case consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD:
				caption = 'Marked For Rebuild Old';
				break;
			case consts.diskSegmentStatuses.MARKED_FOR_REBUILD:
				caption = 'Marked For Rebuild';
				break;
			case consts.diskSegmentStatuses.REMAP:
				caption = 'Remap';
				break;
			case consts.diskSegmentStatuses.UNDER_RECOVERY_TOMA:
				caption = 'Under Recovery';
				break;
			case consts.diskSegmentStatuses.REPLACEMENT:
				caption = 'Replacement';
				break;
			case consts.diskSegmentStatuses.DEPRECATED:
				caption = 'Deprecated';
				break;
			case consts.diskSegmentStatuses.DEAD:
				caption = 'Dead';
				break;
			case consts.diskSegmentStatuses.BOOTING:
				caption = 'Booting';
				break;
			default:
				caption = status;
		}

		return caption;
	};
});

managementApp.filter('segStatusToDefinition', function() {
	return function(status) {
		var definition;
		switch (status) {
			case consts.diskSegmentStatuses.NORMAL:
				definition = 'Fully functional.';
				break;
			case consts.diskSegmentStatuses.INITIALIZING:
				definition = 'Being prepared for first usage.';
				break;
			case consts.diskSegmentStatuses.ZEROING:
				definition = 'Undergoing writing zeroes to prepare for volume usage.';
				break;
			case consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD:
				definition = 'The drive holding this data has been evicted. It will be relocated when the alternative space being synchronized is ready.';
				break;
			case consts.diskSegmentStatuses.MARKED_FOR_REBUILD:
				definition = 'Is undergoing synchronization so it can be used to hold data that was on an evicted drive.';
				break;
			case consts.diskSegmentStatuses.REMAP:
				definition = 'The drive holding this data has been evicted. It will be relocated when an alternative space becomes available.';
				break;
			case consts.diskSegmentStatuses.UNDER_RECOVERY_TOMA:
				definition = 'Needs to be recovered to ensure its data is up-to-date.';
				break;
			case consts.diskSegmentStatuses.REPLACEMENT:
				definition = 'Will undergo synchronization so it can be used to hold data that was on an evicted drive.';
				break;
			case consts.diskSegmentStatuses.DEAD:
				definition = 'System is unable to access.';
				break;
			case consts.diskSegmentStatuses.BOOTING:
				definition = 'The volume is booting, i.e. coming up.';
				break;
			default:
				definition = status;
		}

		return definition;
	};
});


managementApp.filter('actionToCaption', function() {
	return function(action) {
		var caption;

		switch (action) {
			case consts.volumeActions.EXTENDING:
				caption = 'Extending';
				break;
			case consts.volumeActions.MARKED_FOR_DELETION:
				caption = 'Marked For Deletion';
				break;
			case consts.volumeActions.DELETING:
				caption = 'Deleting';
				break;
			case consts.volumeActions.MARKED_FOR_REBUILD:
				caption = 'Marked For Rebuild';
				break;
			case consts.volumeActions.BOOTING:
				caption = 'Booting';
				break;
			case consts.volumeActions.REBUILD_REQUIRED:
				caption = 'Rebuild Required';
				break;
			case consts.volumeActions.REBUILDING:
				caption = 'Rebuilding';
				break;
			case consts.volumeActions.INITIALIZING:
				caption = 'Initializing';
				break;
			case consts.volumeActions.INIT_ENCRYPTION_REQUIRED:
				caption = 'Init Encryption Required';
				break;
			case consts.volumeActions.INITIALIZING_ENCRYPTION:
				caption = 'Initializing Encryption';
				break;
			case consts.volumeActions.ADDING_PASSPHRASE:
				caption = 'Adding Passphrase';
				break;
			case consts.volumeActions.DELETING_PASSPHRASE:
				caption = 'Deleting Passphrase';
				break;
			case consts.volumeActions.ROTATING_PASSPHRASE:
				caption = 'Rotating Passphrase';
				break;
			default:
				caption = status;
		}

		return caption;
	};
});


managementApp.filter('statusToHealth', function() {
	return function(status) {
		switch (status) {
			case 'online':
				return 'green';
			case 'pendingDeletion':
				return 'primary';
			case 'degraded':
				return 'yellow';
			case 'unavailable':
			case 'offline':
				return 'red';
		}
	};
});

managementApp.filter('segmentStatusToHealth', function() {
	return function(status) {
		switch (status) {
			case consts.diskSegmentStatuses.NORMAL:
				return 'green';
			case consts.diskSegmentStatuses.INITIALIZING:
			case consts.diskSegmentStatuses.ZEROING:
			case consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD:
			case consts.diskSegmentStatuses.MARKED_FOR_REBUILD:
				return 'primary';
			case consts.diskSegmentStatuses.REMAP:
			case consts.diskSegmentStatuses.UNDER_RECOVERY_TOMA:
			case consts.diskSegmentStatuses.REPLACEMENT:
				return 'yellow';
			case consts.diskSegmentStatuses.DEPRECATED:
			case consts.diskSegmentStatuses.DEAD:
			case consts.diskSegmentStatuses.BOOTING:
				return 'red';
		}
	};
});


managementApp.filter('actionToHealth', function() {
	return function(action) {
		switch (action) {
			case consts.volumeActions.EXTENDING:
			case consts.volumeActions.INITIALIZING:
			case consts.volumeActions.MARKED_FOR_DELETION:
			case consts.volumeActions.DELETING:
			case consts.volumeActions.MARKED_FOR_REBUILD:
			case consts.volumeActions.REBUILD_REQUIRED:
			case consts.volumeActions.INIT_ENCRYPTION_REQUIRED:
			case consts.volumeActions.INITIALIZING_ENCRYPTION:
			case consts.volumeActions.ADDING_PASSPHRASE:
			case consts.volumeActions.DELETING_PASSPHRASE:
			case consts.volumeActions.ROTATING_PASSPHRASE:
				return 'primary';
			case consts.volumeActions.REBUILDING:
				return 'yellow';
			case consts.volumeActions.BOOTING:
				return 'red';


		}
	};
});

managementApp.filter('anyInvalidDirtyFields', function(){
	return function(form) {
		for (var prop in form) {
			if (Object.prototype.hasOwnProperty.call(form, prop)) {
				if (form[prop].$invalid && form[prop].$dirty) {
					return true;
				}
			}
		}

		return false;
	};
});

managementApp.filter('volumeToDataBlocks', function() {
	return function(volume) {
		return volume.dataBlocks || '1';
	};
});

managementApp.filter('volumeToParityBlocks', function() {
	return function(volume) {
		switch (volume.RAIDLevel) {
			case consts.RAIDLevel.CONCATENATED:
			case consts.RAIDLevel.JBOD:
			case consts.RAIDLevel.STRIPED_RAID_0:
				return '0';
			case consts.RAIDLevel.MIRRORED_RAID_1:
			case consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10:
				return '1';
			case consts.RAIDLevel.ERASURE_CODING:
			case consts.RAIDLevel.STRIPED_ERASURE_CODING:
				return volume.parityBlocks;
		}
	};
});
