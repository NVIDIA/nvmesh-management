/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

var async = require('async');

var utils = require('../utils.js');
var logger = require('../logger.js');
var consts = require('../consts.js');
var events = require('../events.js');
var objectNotifier = require('../objectNotifier.js');
var uuid = require('uuid');
var volumeModule = require('./volume.js');
var diskClassModule = require('./diskClass.js');
var zoneModule = require('./zone.js');
var lockModule = require('./lock.js');
var kafkaModule = require('./kafka.js');
var { Entities, SystemMessage, MongoError, SystemAdminMessage, getDriveID } = require('./error.js');
var systemMessages = require('../systemMessages.js');
var { ExecutionTimer } = require('../models/executionTimer');
var { logWithRequestUUID } = require('./log.js');
var { FormatDrive } = require('../models/kafkaMessages/FormatDrive');
const { Backoff } = require('../models/backoff.js');

var MIN_DISK_SIZE = consts.systemLimitation.MIN_DISK_SIZE_GB * Math.pow(1024, 3);

var scope = {};

scope.afterModuleLoaded = () => {
	events = require('../events.js');
	logger = require('../logger.js');
	volumeModule = require('./volume.js');
	({ Entities, SystemMessage, MongoError, SystemAdminMessage, getDriveID } = require('./error.js'));
};

// checks if there is a segment that overlaps the GPT boundaries
scope.validateGPTDriveBoundaries = function(disk) {
	var segments = disk.diskSegments || [];
	var err = null;

	if (disk.GPT && segments.length) {
		segments.sort(function(a, b) { return a.lbs - b.lbs; });
		// make sure first segment on drive doesn't overlaps the firstUsableLba
		var firstSegment = segments[0];
		err = utils.isSegmentOutOfBound(disk, firstSegment);

		// make sure last segment on drive doesn't overlaps the lastUsableLba
		var lastSegment = segments[segments.length - 1];
		if (!err)
			err = utils.isSegmentOutOfBound(disk, lastSegment);
	}

	if (err)
		err = `At least 1 segment was "out of bound", err: ${err}`;

	return err;
};

scope.setDiskInfo = function(disk, isUpdate) {
	var diskUUID = uuid.v1();
	if (disk.GPT) {
		if (!isUpdate && !disk.uuid) {
			this.updateDisk(disk, diskUUID, 'uuid', diskUUID);
		}

		// calculating disk limitations
		var usableOrigSize = disk.GPT.lastUsableLba - disk.GPT.firstUsableLba + 1;
		var flooredAlignedFirstLba = scope.getFloorAlignedSegmentAddress(disk.GPT.firstUsableLba, disk.block_size);
		this.updateDiskSecondLevel(disk, disk.uuid, 'GPT', 'firstUsableLba',
			scope.getCeilAlignedSegmentAddress(disk.GPT.firstUsableLba, disk.block_size));
		this.updateDiskSecondLevel(disk, disk.uuid, 'GPT', 'lastUsableLba',
			flooredAlignedFirstLba + scope.getFloorAlignedSegmentAddress(usableOrigSize, disk.block_size) - 1);
		this.updateDisk(disk, disk.uuid, 'availableBlocks', disk.GPT.lastUsableLba - disk.GPT.firstUsableLba + 1);
	} else {
		//TODO: check the next line (maybe it is possible to remove the uuid assignment from here)
		this.updateDisk(disk, diskUUID, 'uuid', diskUUID);
		this.updateDisk(disk, diskUUID, 'availableBlocks', utils.getAvailableSpace(disk));
	}

	this.updateDisk(disk, disk.uuid, 'usableBlocks', disk.availableBlocks);

	if (isUpdate)
		this.updateDisk(disk, disk.uuid, 'availableBlocks', utils.calculateAvailableSpace(disk));

	this.updateDisk(disk, disk.uuid, 'largestSegmentAvailable', utils.getLargestSegment(disk));
};

scope.getFloorAlignedSegmentAddress = function(segmentAddress, diskBlockSize) {
	return Math.floor(Math.floor(segmentAddress * diskBlockSize /
		consts.BLOCK_SIZE) / consts.BLOCK_SET_SIZE) * consts.BLOCK_SET_SIZE;
};

scope.getCeilAlignedSegmentAddress = function(segmentAddress, diskBlockSize) {
	return Math.ceil(Math.ceil(segmentAddress * diskBlockSize /
		consts.BLOCK_SIZE) / consts.BLOCK_SET_SIZE) * consts.BLOCK_SET_SIZE;
};

function checkFormatRequestCounter(oldDisk, newDisk) {
	var currentDBUUID = app.get('dbUUID');
	if (!newDisk.GPT)
		return false;

	if (newDisk.GPT.mgmtDbUuid !== currentDBUUID)
		return false;

	if (newDisk.GPT.diskGuid !== oldDisk.uuid)
		return false;

	if ((oldDisk.formatRequestCounter || oldDisk.formatRequestCounter === 0) && newDisk.formatRequestCounter)
		return newDisk.formatRequestCounter === oldDisk.formatRequestCounter;
	else
		return false;
}

scope.isFormatFinished = function(oldDisk, newDisk, cb) {
	if (oldDisk.formatDetails && checkFormatRequestCounter(oldDisk, newDisk)) {
		// verify if format request details met
		return cb(true, oldDisk.formatDetails.blockSize === newDisk.block_size && oldDisk.formatDetails.metadataSize === newDisk.metadata_size);
	}

	return cb(false, false);
};

function deleteFormatRequestAttributesFromObj(disk) {
	// deleting format request and zeroing progress attributes
	this.unsetFromDisk(disk, disk.uuid, 'formatInProgress');
	this.unsetFromDisk(disk, disk.uuid, 'formatDetails');
	this.unsetFromDisk(disk, disk.uuid, 'nZeroedBlks');
}

scope.createFormatDriveEvent = function(updatedDisk, disk, nodeID, bootTime) {
	var formatEventPayload = disk.formatDetails;
	formatEventPayload.bootTime = bootTime || 0;

	var eventObj = {
		ids: [events.getTargetID(nodeID)],
		event: objectNotifier.events.formatDiskEvent,
		payload: formatEventPayload
	};

	// in case this is a new drive then it will be pushed into the disks collection
	if (updatedDisk)
		this.updateDisk(updatedDisk, updatedDisk.uuid, 'formatDetails', formatEventPayload);

	return eventObj;
};

scope.createDriveFinishedFormatEvent = function(disk, nodeID) {
	var formatEventPayload = {
		'diskID': disk.diskID,
		'uuid': disk.uuid,
		'vendor': disk.Vendor,
		'formatRequestCounter': disk.formatRequestCounter,
		'isPendingFormat': disk.isPendingFormat,
	};

	var eventObj = {
		ids: [events.getTargetID(nodeID), events.getDiskID(disk.diskID)],
		event: objectNotifier.events.DiskFinishedFormatEvent,
		payload: formatEventPayload
	};

	return eventObj;
};

function checkFormatDriveResult(oldDisk, newDisk, isReappearingDrive, eventsList, nodeID, bootTime, calcDelta, cb) {
	var updatedDisk = isReappearingDrive || !oldDisk ? newDisk : oldDisk;
	// the next line purpose is to avoid passing the calcDelta to the callback function of isFormatFinished to be able to run updateDisk
	var calcDeltaUpdateDisk = this.updateDisk;

	scope.isFormatFinished(oldDisk, newDisk, (formatFinished, formatDetailsMet) => {
		if (formatFinished) {
			deleteFormatRequestAttributesFromObj.bind(calcDelta)(updatedDisk);

			if (formatDetailsMet) {
				// drive format process finished successfully
				logger.sysDEBUG(`Drive SN ${newDisk.diskID} in target ${nodeID} initiator initiated format successful.`);
				return cb(true, true, false);
			} else {
				// drive format finished with wrong attributes - should auto evict
				logger.sysDEBUG(`Drive SN ${newDisk.diskID} in target ${nodeID} finish format with wrong attributes, auto evicting.`);
				calcDeltaUpdateDisk.bind(calcDelta)(updatedDisk, updatedDisk.uuid, 'autoEvictReason', consts.autoEvictReason.WRONG_ATTRIBUTES_AFTER_FORMAT);
				calcDeltaUpdateDisk.bind(calcDelta)(updatedDisk, updatedDisk.uuid, 'isOutOfService', true);
				return cb(true, false, true);
			}
		} else if (oldDisk.formatInProgress) { // check if the drive was in format process and we need to re-emit the format event
			// check if the format was triggered from the management
			if (oldDisk.formatDetails) {
				// emit the format event again if got an OK status that doesn't indicate of a successful format
				eventsList.push(scope.createFormatDriveEvent.bind(calcDelta)(updatedDisk, oldDisk, nodeID, bootTime));
				logger.sysDEBUG('Going to Re-emit format event again for drive: ' + oldDisk.diskID);
				return cb(false, false, false);
			} else
				deleteFormatRequestAttributesFromObj.bind(calcDelta)(updatedDisk);
		}

		cb(true, false, false);
	});
}

scope.shouldResendReport = function(newDrive, oldDrive) {
	return (newDrive.reappearingCounter || newDrive.reappearingCounter === 0)
		&& (!oldDrive.reappearingCounter || newDrive.reappearingCounter < oldDrive.reappearingCounter);
};

scope.isTOMAAwareOfFormat = function(newDrive, oldDrive) {
	return (newDrive.isExcluded) ||
		(newDrive.status === consts.diskStatus.ERROR) ||
		(newDrive.status === consts.diskStatus.FORMAT_ERROR) ||
		(!oldDrive.formatRequestCounter && oldDrive.formatRequestCounter !== 0) ||
		(newDrive.activeFormatRequestCounter === oldDrive.formatRequestCounter &&
		(newDrive.formatRequestCounter === oldDrive.formatRequestCounter || consts.driveFormatStatuses.indexOf(newDrive.status) !== -1));
};

// check format drive status transition format wise
function checkDriveStatusTransition(oldDisk, newDisk, isReappearingDrive, eventsList, nodeID, bootTime, calcDelta, cb) {
	var updatedDisk = isReappearingDrive || !oldDisk ? newDisk : oldDisk;

	// in case Toma is not aware of the format and the drive wasn't wiped
	// re-emit format event if formatDetails exists
	if (oldDisk && !scope.isTOMAAwareOfFormat(newDisk, oldDisk) && oldDisk.formatDetails) {
		eventsList.push(scope.createFormatDriveEvent.bind(calcDelta)(updatedDisk, oldDisk, nodeID, bootTime));
		logger.sysDEBUG('Going to Re-emit format event again for drive: ' + oldDisk.diskID + ', Got formatRequestCounter: '
			+ newDisk.formatRequestCounter + ' DB formatRequestCounter: ' + oldDisk.formatRequestCounter + ' and Got activeFormatRequestCounter: '
			+ newDisk.activeFormatRequestCounter + ' DB activeFormatRequestCounter: ' + oldDisk.activeFormatRequestCounter);
		return cb(false, false);
	} else if (oldDisk && (newDisk.status === consts.diskStatus.OK || newDisk.status === consts.diskStatus.INITIALIZING)) {
		checkFormatDriveResult.bind(calcDelta)(oldDisk, newDisk, isReappearingDrive, eventsList, nodeID, bootTime, calcDelta, cb);
		return;
	} else if (oldDisk && (oldDisk.isPendingFormat || consts.driveFormatStatuses.indexOf(oldDisk.status) !== -1) &&
		newDisk.status === consts.diskStatus.NOT_INITIALIZED && oldDisk.formatDetails) {
		// emit the format event again if got an NOT_INITIALIZED status that doesn't indicate that Toma received the format event
		eventsList.push(scope.createFormatDriveEvent.bind(calcDelta)(updatedDisk, oldDisk, nodeID, bootTime));
		logger.sysDEBUG('Going to Re-emit format event again for drive: ' + oldDisk.diskID);
		return cb(false, false);
	} else if (newDisk.status === consts.diskStatus.FORMAT_ERROR ||
		(newDisk.isExcluded && oldDisk.formatInProgress)) { // in case got format error or excluded and the drive was under format
		logger.sysDEBUG(`Drive SN ${newDisk.diskID} in target ${nodeID} format failed.`);
		deleteFormatRequestAttributesFromObj.bind(calcDelta)(updatedDisk);
	} else if (isReappearingDrive && oldDisk.formatInProgress && consts.driveFormatStatuses.indexOf(newDisk.status) === -1) {
		// on drive reappearing with format process
		checkFormatDriveResult.bind(calcDelta)(oldDisk, newDisk, isReappearingDrive, eventsList, nodeID, bootTime, calcDelta, cb);
		return;
	} else if (consts.driveFormatStatuses.indexOf(newDisk.status) !== -1) { // set format in progress if got one of the format statuses
		this.updateDisk(updatedDisk, updatedDisk.uuid, 'formatInProgress', true);
	}

	cb(true, false);
}

scope.handleDriveFormatProcessIfNeeded = function(oldDisk, newDisk, isReappearingDrive, eventsList, nodeID, bootTime, calcDelta, cb) {
	var diskToUpdate = isReappearingDrive || !oldDisk ? newDisk : oldDisk;
	// the next line purpose is to avoid passing the calcDelta to the callback function of
	// checkDriveStatusTransition or isFormatFinished to be able to run updateDisk
	var calcDeltaUpdateDisk = this.updateDisk;

	// handle drive status change/reappear or new report
	if (!oldDisk || (oldDisk && newDisk.status !== oldDisk.status)) {
		if (!oldDisk && (newDisk.status === consts.diskStatus.NOT_INITIALIZED || newDisk.isExcluded))
			return cb(false, false);

		// check format drive status transition
		checkDriveStatusTransition.bind(calcDelta)(oldDisk, newDisk, isReappearingDrive, eventsList, nodeID, bootTime, calcDelta,
			function(validTransition, formatDone, shouldAutoEvict) {
				if (!validTransition) {
					logger.sysDEBUG('Moving drive ' + newDisk.diskID + ' to pending format state');
					calcDeltaUpdateDisk.bind(calcDelta)(newDisk, diskToUpdate.uuid, 'isPendingFormat', true);
				} else if (oldDisk && oldDisk.isPendingFormat)
					calcDeltaUpdateDisk.bind(calcDelta)(newDisk, diskToUpdate.uuid, 'isPendingFormat', false);

				cb(formatDone, shouldAutoEvict);
			});
		return;
	} else if ((newDisk.status === consts.diskStatus.OK || newDisk.status === consts.diskStatus.INITIALIZING)) {
		scope.isFormatFinished(oldDisk, newDisk, (formatFinished, formatDetailsMet) => {
			if (formatFinished) {
				deleteFormatRequestAttributesFromObj.bind(calcDelta)(diskToUpdate);
				calcDeltaUpdateDisk.bind(calcDelta)(diskToUpdate, diskToUpdate.uuid, 'isPendingFormat', false);

				if (formatDetailsMet) {
					// no change in drive status but got OK or Initializing again and format occurred
					logger.sysDEBUG(`Drive SN ${newDisk.diskID} in target ${nodeID} initiator initiated format successful.`);
					var event = scope.createDriveFinishedFormatEvent(diskToUpdate, nodeID);
					eventsList.push(event);

					return cb(true, false);
				} else {
					// drive format finished with wrong attributes - should auto evict
					logger.sysDEBUG(`Drive SN ${newDisk.diskID} in target ${nodeID} finish format with wrong attributes, auto evicting.`);
					calcDeltaUpdateDisk.bind(calcDelta)(diskToUpdate, diskToUpdate.uuid, 'autoEvictReason',
						consts.autoEvictReason.WRONG_ATTRIBUTES_AFTER_FORMAT);
					calcDeltaUpdateDisk.bind(calcDelta)(diskToUpdate, diskToUpdate.uuid, 'isOutOfService', true);

					return cb(false, true);
				}
			} else
				return cb(false, false);
		});
	} else {
		return cb(false, false);
	}
};

function hasValidPartitionsAfterFormat(drive) {
	if (!drive.GPT) {
		this.updateDisk(drive, drive.uuid, 'autoEvictReason', consts.autoEvictReason.MISSING_GPT);
		return false;
	}

	var	gptEntries = drive.GPT.entries || [];

	var isMetadataExists = false;
	var isJournalExists = false;
	var isSejioDBExists = false;
	var isDataExists = false;

	gptEntries.forEach(function(gptEntry) {
		if (gptEntry.owner === consts.segmentOwners.NVMESH && gptEntry.partitionType === consts.segmentTypes.EXCELERO_METADATA) {
			if (gptEntry.partitionName === consts.metadataPartitionNames.METADATA)
				isMetadataExists = true;

			else if (drive.metadata_size && gptEntry.partitionName === consts.metadataPartitionNames.JOURNAL_DATA)
				isJournalExists = true;

			else if (drive.metadata_size && gptEntry.partitionName === consts.metadataPartitionNames.SERJIO_DB)
				isSejioDBExists = true;

		} else if (gptEntry.owner === consts.segmentOwners.NVMESH && gptEntry.partitionType === consts.segmentTypes.DATA)
			isDataExists = true;
	});

	// in case data partition was found right after format
	if (isDataExists) {
		this.updateDisk(drive, drive.uuid, 'autoEvictReason', consts.autoEvictReason.DATA_PARTITION_FOUND_AFTER_FORMAT);
		return false;
	}

	// in case of ec formatted drive and there are missing metadata/journal/serjiodb partitions else if metadata partition is missing
	if (!(drive.metadata_size && isMetadataExists && isJournalExists && isSejioDBExists || !drive.metadata_size && isMetadataExists)) {
		this.updateDisk(drive, drive.uuid, 'autoEvictReason', consts.autoEvictReason.MISSING_METADATA_PARTITIONS);
		return false;
	}

	return true;
}

// delete old disk segments on drive when format is done but evict the drive if it has old volume segments
scope.handleFormatDone = function(disk, newDisk, calcDelta, disksToResumeReinstate = []) {
	// recalculating the new drive GPT properties after format
	if (newDisk) {
		this.updateDisk(disk, disk.uuid, 'GPT', newDisk.GPT);
		this.updateDisk(disk, disk.uuid, 'metadata_size', newDisk.metadata_size);
		this.updateDisk(disk, disk.uuid, 'block_size', newDisk.block_size);
	}

	if (disk.isOutOfService)
		calcDelta.updateDisk(disk, disk.uuid, 'isOutOfService', false);
	if (disk.automaticallyEvicted)
		calcDelta.updateDisk(disk, disk.uuid, 'automaticallyEvicted', false);
	if (disk.autoEvictReason)
		calcDelta.updateDisk(disk, disk.uuid, 'autoEvictReason', null);

	const hasPendingReinstateSegments = disk?.diskSegments?.some(seg => seg.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING);

	if (disk.diskSegments && disk.diskSegments.length && !hasPendingReinstateSegments) {
		var volumeSegments = disk.diskSegments.filter(function(seg) {
			return !seg.owner || (seg.owner === consts.segmentOwners.NVMESH && seg.type !== consts.segmentTypes.EXCELERO_METADATA);
		});

		if (volumeSegments.length) {
			// evict drive - formatted but has volume segments
			logger.sysDEBUG(`Drive SN ${disk.diskID} was auto evicted since it was formatted when volume segments exists on it`);
			this.updateDisk(disk, disk.uuid, 'autoEvictReason', consts.autoEvictReason.DRIVE_FORMATTED_WITH_VOL_SEGMENTS);
			this.updateDisk(disk, disk.uuid, 'isOutOfService', true);
			return false;
		}
	}

	const newDiskSegments = (disk.diskSegments || []).filter(seg => seg.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING);
	this.updateDisk(disk, disk.uuid, 'diskSegments', newDiskSegments);

	scope.setDiskInfo.bind(calcDelta)(disk, hasPendingReinstateSegments);

	if (!hasValidPartitionsAfterFormat.bind(calcDelta)(disk)) {
		this.updateDisk(disk, disk.uuid, 'isOutOfService', true);
		return false;
	}

	if (hasPendingReinstateSegments)
		disksToResumeReinstate.push(disk);

	return true;
};

scope.resumeReinstateAfterFormat = (disk, callback = () => {}) => {
	logger.sysDEBUG(`Drive SN ${disk.diskID} format done with pending reinstate segments, resuming reinstate`);

	executeReinstateReplacement({
		drive: disk,
		newSegmentStatus: consts.diskSegmentStatuses.MARKED_FOR_REBUILD
	}, (err) => {
		if (err)
			new SystemMessage(systemMessages.DRIVE_REINSTATE_RESUME_AFTER_FORMAT_FAILED)
				.addInfo(Entities.Drive.ID, disk.diskID)
				.addInfo(Entities.Drive.UUID, disk.uuid)
				.addInfo(Entities.Error, err)
				.log();

		callback(err);
	});
};

// handles GPT partitions, for now allowing only metadata partitions (returns an error when system partition appears on gpt or partition size changed)
// this function assumes that every gpt entry (partition) was allocated aligned already
function tryHandleGptPartitionSegments(disk, node, eventsList, isAfterFormat, calcDelta) {
	var gptEntries = [];
	var gptEntriesToAdd = [];
	var gptEntriesToRemove = [];
	var dbUUID = app.get('dbUUID');

	if (disk.GPT) {
		logger.sysDEBUG('Processing GPT for drive: ' + disk.uuid);

		if (!disk.GPT.isValid) {
			logger.sysDEBUG(`GPT is not valid for drive: ${disk.uuid}`);
			this.updateDisk(disk, disk.uuid, 'autoEvictReason', consts.autoEvictReason.INVALID_GPT);
			return false;
		}

		if (disk.GPT.mgmtDbUuid && disk.GPT.mgmtDbUuid !== dbUUID) {
			logger.sysDEBUG(`Drive: ${disk.uuid} was imported from other NVMesh environment.
			 System mgmtDbUuid: ${dbUUID} and GPT contains mgmtDbUuid: ${disk.GPT.mgmtDbUuid}`);

			this.updateDisk(disk, disk.uuid, 'autoEvictReason', consts.autoEvictReason.IMPORTED_DRIVE);
			return false;
		}

		if (disk.GPT.diskGuid.match(consts.EMPTY_UUID_REGEX)) {
			logger.sysDEBUG(`Found an invalid uuid for drive: ${disk.diskID}, GPT contains uuid: ${disk.GPT.diskGuid}`);
			this.updateDisk(disk, disk.uuid, 'autoEvictReason', consts.autoEvictReason.DRIVE_INVALID_UUID);
			return false;
		}

		if (disk.GPT.diskGuid === consts.SKIP_DISK_UUID_MAGIC_UUID)
			logger.sysDEBUG(`Magic token detected, skipping uuid verification for drive ${disk.diskID} with uuid ${disk.uuid}`);
		else if (disk.uuid !== disk.GPT.diskGuid) {
			logger.sysDEBUG(`Found uuid mismatch for drive uuid: ${disk.uuid} GPT contains uuid: ${disk.GPT.diskGuid}`);
			this.updateDisk(disk, disk.uuid, 'autoEvictReason', consts.autoEvictReason.DRIVE_UUID_MISMATCH);
			return false;
		}

		gptEntries = disk.GPT.entries || [];
		var systemPartitions = gptEntries.filter(function(gptEntry) { return gptEntry.owner === consts.segmentOwners.SYSTEM; });
		var gptMetadataEntries = gptEntries.filter(function(gptEntry) { return gptEntry.partitionType === consts.segmentTypes.EXCELERO_METADATA; });
		var unknownNVMeshEntries = gptEntries.filter(function(gptEntry) {
			return gptEntry.owner === consts.segmentOwners.NVMESH &&
				gptEntry.partitionType !== consts.segmentTypes.EXCELERO_METADATA &&
				gptEntry.partitionType !== consts.segmentTypes.DATA;
		});

		// don't accept working with a disk that contains system partitions
		if (systemPartitions.length) {
			logger.sysDEBUG(`System partition was found in the GPT for drive: ${disk.uuid}`);
			this.updateDisk(disk, disk.uuid, 'autoEvictReason', consts.autoEvictReason.SYSTEM_PARTITION_FOUND);
			return false;
		}

		if (unknownNVMeshEntries.length) {
			logger.sysDEBUG(`Unknown NVMesh partition was found in the GPT for drive: ${disk.uuid}`);
			this.updateDisk(disk, disk.uuid, 'autoEvictReason', consts.autoEvictReason.UNKNOWN_NVMESH_PARTITION);
			return false;
		}

		if (disk && disk.diskSegments && disk.diskSegments.length) {
			// check if there was any change in the known metadata partitions from last reports
			gptMetadataEntries.forEach(function(gptEntry) {
				var entryExists = null;

				disk.diskSegments.forEach(function(seg) {
					if (gptEntry.partitionGuid === seg.uuid)
						entryExists = seg;
				});

				// check if the partition is new and add it to the segments to add list if so
				if (!entryExists)
					gptEntriesToAdd.push(gptEntry);
				else if (entryExists.gptStart !== gptEntry.start || entryExists.gptEnd !== gptEntry.end) { // if partition size has changed
					gptEntriesToRemove.push(entryExists);
					gptEntriesToAdd.push(gptEntry);
					logger.sysDEBUG('Partition ' + entryExists.uuid + ' changed it\'s original size in drive: ' + disk.uuid);
				}
			});

			// auto evict if metadata segments were deleted and not after format
			if (gptEntriesToRemove.length && !isAfterFormat) {
				logger.sysDEBUG(`Metadata partition was deleted from drive: ${disk.diskID}`);
				this.updateDisk(disk, disk.uuid, 'autoEvictReason', consts.autoEvictReason.METADATA_PARTITION_DELETED);
				return false;
			}
		} else
			gptEntriesToAdd = gptMetadataEntries;

		var hasError = false;

		if (gptEntriesToAdd && gptEntriesToAdd.length && !isAfterFormat) {
			logger.sysDEBUG(`Found extra metadata partition on drive: ${disk.diskID}`);
			this.updateDisk(disk, disk.uuid, 'autoEvictReason', consts.autoEvictReason.EXTRA_METADATA_PARTITION);
			return false;
		}

		gptEntriesToAdd.forEach(function(gptEntry) {
			if (hasError)
				return;

			// calculate aligned segment start and end addresses
			var segmentAlignedStartAddress = scope.getFloorAlignedSegmentAddress(gptEntry.start, disk.block_size);
			var segmentOrigSize = gptEntry.end - gptEntry.start + 1;
			var segmentAlignedEndAddress = segmentAlignedStartAddress +
				scope.getCeilAlignedSegmentAddress(segmentOrigSize, disk.block_size) - 1;

			// create system/metadata partitions as diskSegments
			var diskSegmentPartition = {
				_id: gptEntry.partitionGuid,
				uuid: gptEntry.partitionGuid,
				diskID: disk.diskID,
				diskUUID: disk.uuid,
				nodeUUID: node.uuid,
				node_id: node.node_id,
				partitionName: gptEntry.partitionName,
				type: gptEntry.partitionType,
				owner: gptEntry.owner,
				gptStart: gptEntry.start,
				gptEnd: gptEntry.end,
				lbs: segmentAlignedStartAddress,
				lbe: segmentAlignedEndAddress
			};

			utils.addSegmentToDisk.bind(calcDelta)(disk, diskSegmentPartition, true, calcDelta, function(updatedDisk, updateObj, err) {
				if (err) {
					err.log();
					hasError = true;
				}
			});
		});

		if (gptEntriesToAdd.length && !hasError)
			eventsList.push({
				ids: null,
				event: objectNotifier.events.allocatedSpaceDirtyEvent,
				payload: null
			});

		return !hasError;
	} else
		return true;
}

// checking if regular disk (not DUMMY) has changed it's size or didn't pass the minimum size
function isDiskSizeValid(disk, diskOldPresence, diskToUpdate) {
	if ((!disk.isOutOfService && ((disk.blocks * disk.block_size) < MIN_DISK_SIZE)) ||
		(diskOldPresence && !diskOldPresence.isOutOfService &&
		((diskOldPresence.blocks * diskOldPresence.block_size) != (disk.blocks * disk.block_size)))) {
		this.updateDisk(diskToUpdate, diskToUpdate.uuid, 'autoEvictReason', consts.autoEvictReason.DISK_SIZE_ERROR);
		return false;
	} else
		return true;
}

function isDiskSerialValid(disk) {
	if (disk.diskID && disk.diskID !== 'UNKNOWN') return true;

	this.updateDisk(disk, disk.uuid, 'autoEvictReason', consts.autoEvictReason.INVALID_SERIAL);
	return false;
}

function autoEvictAnEvictedDrive(drive, eventsList) {
	this.updateDisk(drive, drive.uuid, 'automaticallyEvicted', true);
	this.updateDisk(drive, drive.uuid, 'health', consts.targetHealth.CRITICAL);

	var driveToUpdateClone = utils.extend(true, driveToUpdateClone, drive);
	driveToUpdateClone.health_old = drive.health;

	eventsList.push({
		ids: [events.getTargetID(drive.nodeID), events.getDiskID(drive.diskID)],
		event: objectNotifier.events.diskEvictedEvent,
		payload: driveToUpdateClone
	});
}

scope.processAndValidateDrive = function(newDrive, oldDrive, isReappearingDrive, server, drivesToAutoEvict, isAfterFormat, eventsList, calcDelta) {
	var driveToUpdate = isReappearingDrive || !oldDrive ? newDrive : oldDrive;

	// check if err occurred while creating gpt partiotions or disk size is not valid (if changed or less than minmum)
	if (!driveToUpdate.automaticallyEvicted && !driveToUpdate.autoEvictReason
		&& newDrive.status !== consts.diskStatus.NOT_INITIALIZED && !newDrive.isExcluded) {
		if (((!isAfterFormat && newDrive.status !== consts.diskStatus.FORMATTING && !isDiskSizeValid.bind(calcDelta)(newDrive, oldDrive, driveToUpdate))
			|| (consts.driveFormatStatuses.indexOf(newDrive.status) === -1 && !driveToUpdate.formatInProgress &&
				!tryHandleGptPartitionSegments.bind(calcDelta)(driveToUpdate, server, eventsList, isAfterFormat, calcDelta)))
				|| !isDiskSerialValid.bind(calcDelta)(driveToUpdate)) {
			// in case we need to auto evict an evicted drive
			if (driveToUpdate.isOutOfService)
				autoEvictAnEvictedDrive.bind(calcDelta)(driveToUpdate, eventsList);
			else { // first time auto evicting
				this.updateDisk(driveToUpdate, driveToUpdate.uuid, 'isOutOfService', true);
				drivesToAutoEvict.push(driveToUpdate);
			}
		}
	}
};

scope.parseDriveVendor = function(drive) {
	//Parse Vendor.
	var vendorNum = parseInt(drive.Vendor);

	//Check if the vendor is already parsed.
	if (!isNaN(vendorNum)) {
		drive.vendorID = vendorNum;
		drive.Vendor = consts.diskVendorHexToName[vendorNum] || vendorNum;
	}
};

scope.updateDriveZeroingProgress = function(message) {
	let db = app.get('db');
	let serverCollection = db.collection('server');
	let executionTimer = new ExecutionTimer('updateDriveZeroingProgress');

	logger.sysDEBUG('Handling zeroing progress message for drive uuid: ' + message.payload.diskUUID);

	let query = {
		disks: {
			$elemMatch: {
				uuid: message.payload.diskUUID,
				$or: [{
					tomaToken: { $exists: false }
				}, {
					tomaToken: message.tomaToken,
					$or: [{
						kafkaMessageSequence: { $exists: false }
					}, {
						kafkaMessageSequence: { $lt: message.messageSequence }
					}]
				}]
			}
		}
	};

	let update = {
		$set: {
			'disks.$.zeroWriteCounter': message.payload.zeroWriteCounter,
			'disks.$.nZeroedBlks': message.payload.nZeroedBlks,
			'disks.$.kafkaMessageSequence': message.messageSequence
		}
	};

	serverCollection.updateOne(query, update, (err, res) => {
		if (err)
			new MongoError(err).log();

		else if (res.modifiedCount) {
			logger.sysDEBUG('Updating zero write counter for drive uuid: ' + message.payload.diskUUID + ' Total Zero Blocks: ' + message.payload.nZeroedBlks);

			events.emitEvent(
				[events.getTargetID(message.hostname), events.getDiskID(message.payload.diskUUID)],
				objectNotifier.events.driveZeroingProgressChangeEvent,
				{ 'uuid': message.payload.diskUUID, 'nZeroedBlks': message.payload.nZeroedBlks });
		}

		executionTimer.stop(!err);
	});
};

scope.formatDiskByIDsAndUUIDs = function(disks, requestedFormatType, isAutoFormat, cb) {
	const db = app.get('db');
	const serverCollection = db.collection('server');
	const messages = [];

	async.eachSeries(disks, function(disk, callback) {
		const { _id: diskID, uuid: diskUUID } = disk;

		serverCollection.aggregate([
			{ $unwind: '$disks' },
			{ $match: { 'disks.diskID': diskID, 'disks.uuid': diskUUID } },
			{ $project: { disks: 1, uuid: 1, node_id: 1, zone: 1, bootTime: 1, topics: 1, _id: 0 } }]).toArray(function(err, results) {
			const server = results.length && results[0];

			function logAndAddResult(error) {
				const message = new SystemAdminMessage(error ? systemMessages.DISK_FORMAT_FAILED : systemMessages.DISK_FORMATTED)
					.addInfo(Entities.Drive.ID, server?.node_id ? getDriveID(diskID, server.node_id) : diskID)
					.addInfo(Entities.Drive.UUID, error ? diskUUID : newDriveUUID);

				if (error)
					message.addInfo(Entities.Error, error);

				messages.push(message);
			}

			if (err || !server) {
				logAndAddResult(new SystemMessage(systemMessages.DRIVE_NOT_FOUND));
				return callback();
			}

			var serverDisk = server.disks;
			var isDiskECSupported = serverDisk.formatOptions && serverDisk.formatOptions.some(function(opt) {
				return opt.metaBS == consts.defaultFormat.FORMAT_EC.METADATA_SIZE &&
						opt.dataBS == consts.defaultFormat.FORMAT_EC.BLOCK_SIZE;
			});

			// driveMetadataSupport.NOT_SUPPORTED and found formatOptions of 8/4096 is not possible but exists for Toshiba drives
			// and therefore we only check not INLINE
			isDiskECSupported = isDiskECSupported && serverDisk.metadataCapabilities != consts.driveMetadataSupport.INLINE;

			var formatType = requestedFormatType || (isDiskECSupported ? consts.formatTypes.FORMAT_EC : consts.formatTypes.FORMAT_RAID);

			// in case the drive only support inline metadata format the drive to raid type
			if (!isDiskECSupported && formatType == consts.formatTypes.FORMAT_EC)
				formatType = consts.formatTypes.FORMAT_RAID;

			logger.sysDEBUG((isAutoFormat ? 'Auto formatting drive: ' : 'Got a request to format drive: ') + diskID + ' to: ' + formatType);

			// check if the target of the drive is missing a zone (not accepted yet)
			if (!server.zone) {
				logAndAddResult(new SystemMessage(systemMessages.DRIVE_FORMAT_CANCELLED_TARGET_NOT_APPROVED));
				return callback();
			}

			var GLOBAL_SETTINGS = app.get('globalSettings');

			// check if the drive is ec supported and requested to be raid formatted without enabling it in the conf file
			if (formatType === consts.formatTypes.FORMAT_RAID && isDiskECSupported && !GLOBAL_SETTINGS.enableLegacyFormatting) {
				logAndAddResult(new SystemMessage(systemMessages.DRIVE_FORMAT_CANT_RAID_FORMAT_WHILE_EC_FORMAT_REQUIRED));
				return callback();
			}

			// check if the drive status is suitable for format
			if (serverDisk.status === consts.diskStatus.MISSING || serverDisk.isExcluded) {
				logAndAddResult(new SystemMessage(systemMessages.DRIVE_FORMAT_CANCELLED_BAD_STATUS).addInfo(Entities.Drive.status, serverDisk.status));
				return callback();
			}

			// for now we only check for ec format that there are some metadata capabilities without getting into specifics
			if (formatType === consts.formatTypes.FORMAT_EC && !isDiskECSupported) {
				logAndAddResult(new SystemMessage(systemMessages.DRIVE_FORMAT_CANT_EC_FORMAT_WHILE_NONE_SUPPORTED));
				return callback();
			}

			if (serverDisk.diskSegments) {
				const activeVolumeSegments = serverDisk.diskSegments.filter(seg =>
					seg.type !== consts.segmentTypes.EXCELERO_METADATA && seg.status !== consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING);

				if (activeVolumeSegments.length) {
					const hasPendingReinstateSegments = serverDisk.diskSegments.some(seg =>
						seg.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING);

					if (hasPendingReinstateSegments)
						// there are still disk segments not cleaned up after reinstate - we should have only markedForRebuild_pending segments left
						logAndAddResult(new SystemMessage(systemMessages.DRIVE_REINSTATE_IN_PROGRESS));
					else
						logAndAddResult(new SystemMessage(systemMessages.DRIVE_FORMAT_CANT_FORMAT_DRIVE_WITH_VOLUMES));

					return callback();
				}
			}

			var hexVendor = consts.diskVendorNameToHex[serverDisk.Vendor] || serverDisk.Vendor;

			var formatOption;

			serverDisk.formatOptions.forEach(function(opt) {
				if (formatType == consts.formatTypes.FORMAT_EC &&
						opt.metaBS == consts.defaultFormat.FORMAT_EC.METADATA_SIZE &&
						opt.dataBS == consts.defaultFormat.FORMAT_EC.BLOCK_SIZE)
					formatOption = opt;
				else if (formatType == consts.formatTypes.FORMAT_RAID &&
						opt.metaBS == consts.defaultFormat.FORMAT_RAID.METADATA_SIZE &&
						opt.dataBS == consts.defaultFormat.FORMAT_RAID.BLOCK_SIZE)
					formatOption = opt;
			});

			//Quick n dirty patch, must fix the flow asap
			if (!formatOption) {
				logger.sysDEBUG('could not find correct format - formatType:' + formatType + ' options:' + serverDisk.formatOptions);

				formatOption = {
					metaBS: 0,
					dataBS: 512
				};
			}

			const newDriveUUID = uuid.v1();
			var update = {};
			var formatDetails = {
				'diskID': diskID,
				'uuid': newDriveUUID,
				'vendor': hexVendor,
				'formatType': formatType, // deprecated, remove after toma support for block size
				'formatRequestCounter': serverDisk.formatRequestCounter + 1,
				'blockSize': formatOption.dataBS,
				'metadataSize': formatOption.metaBS,
				'bootTime': server.bootTime || 0,
				'dbUUID': app.get('dbUUID')
			};

			update.$set = {
				'disks.$.uuid': newDriveUUID,
				'disks.$.isPendingFormat': true,
				'disks.$.formatDetails': formatDetails,
				'disks.$.formatInProgress': true,
				'disks.$.isOutOfService': false,
				'disks.$.automaticallyEvicted': false,
				'disks.$.autoEvictReason': ''
			};

			update.$inc = { 'disks.$.formatRequestCounter': 1 };

			serverCollection.updateOne(
				{ disks: { $elemMatch: { diskID: diskID, uuid: diskUUID, formatRequestCounter: serverDisk.formatRequestCounter } } },
				update,
				function(err, res) {
					if (err || !res.modifiedCount) {
						logAndAddResult(new SystemMessage(systemMessages.DRIVE_FORMAT_CANT_FORMAT).addInfo(Entities.Error, { err, res }));
						return callback();
					}

					logger.sysDEBUG('Formatting disk to ' + formatType);

					events.emitEvent([events.getTargetID(server.node_id), events.getDiskID(diskID)], objectNotifier.events.formatDiskEvent, formatDetails);

					kafkaModule.sendMessages(server.topics[consts.topicSuffix.TOMA_COMMANDS], [new FormatDrive(formatDetails)]);

					logAndAddResult();
					callback();
				}
			);
		}
		);
	}, () => cb(messages));

};

scope.printOutdatedDriveReportMsgToDEBUG = function(newDrive, oldDrive) {
	if (newDrive && oldDrive)
		logger.sysDEBUG('Ignoring outdated report of drive: ' + newDrive.diskID + ', report reappearingCounter: '
			+ newDrive.reappearingCounter + ' DB reappearingCounter: ' + oldDrive.reappearingCounter + ', report formatRequestCounter: '
			+ newDrive.formatRequestCounter + ' DB formatRequestCounter: ' + oldDrive.formatRequestCounter
			+ ' and report activeFormatRequestCounter: ' + newDrive.activeFormatRequestCounter + ' DB activeFormatRequestCounter: '
			+ oldDrive.activeFormatRequestCounter);
};

function handleDriveStatusChanged(oldDiskReport, newDiskReport, eventsList, node, shouldEmitEvents) {
	var diskToUpdate = oldDiskReport || newDiskReport;
	var diskToUpdateClone;
	var somethingWrong = false;

	if (oldDiskReport && oldDiskReport.isOutOfService)
		this.updateDisk(newDiskReport, diskToUpdate.uuid, 'isOutOfService', true);

	if (oldDiskReport && newDiskReport.status !== oldDiskReport.status)
		eventsList.push({
			ids: [events.getTargetID(node.node_id), events.getDiskID(newDiskReport.diskID)],
			event: objectNotifier.events.diskStatusChangeEvent,
			payload: newDiskReport
		});

	var isNewStatusHealthy = consts.driveHealthyStatuses.indexOf(newDiskReport.status) !== -1 && !newDiskReport.excludedByManagement;
	var isOldStatusHealthy = oldDiskReport ? oldDiskReport.health === consts.targetHealth.HEALTHY && !oldDiskReport.excludedByManagement : false;

	if (!diskToUpdate.automaticallyEvicted) {
		var health = consts.targetHealth.HEALTHY;
		var event = objectNotifier.events.diskWentOnlineEvent;

		if (!oldDiskReport || isNewStatusHealthy !== isOldStatusHealthy) {
			if (!isNewStatusHealthy) {
				somethingWrong = true;
				health = consts.targetHealth.CRITICAL;
				event = objectNotifier.events.diskFailureEvent;
			}

			diskToUpdateClone = utils.extend(true, diskToUpdateClone, diskToUpdate);

			if (oldDiskReport)
				diskToUpdateClone.health_old = oldDiskReport.health;

			this.updateDisk(diskToUpdate, diskToUpdate.uuid, 'health', health);
			diskToUpdateClone.health = health;
			diskToUpdateClone.status = newDiskReport.status;

			eventsList.push({
				ids: [events.getTargetID(node.node_id), events.getDiskID(newDiskReport.diskID)],
				event: event,
				payload: diskToUpdateClone
			});
		}
	}

	if (!diskToUpdateClone)
		diskToUpdateClone = utils.extend(true, diskToUpdateClone, diskToUpdate);

	diskToUpdateClone.isExcluded = newDiskReport.isExcluded;

	if (oldDiskReport) {
		var diskChangedPool = false;
		if (scope.isDriveWentIntoPool(newDiskReport, oldDiskReport)) {
			diskChangedPool = true;
			diskToUpdateClone.wentIntoPool = true;
		} else if (scope.isDriveWentOutOfPool(newDiskReport, oldDiskReport)) {
			diskChangedPool = true;
			diskToUpdateClone.wentIntoPool = false;
		}

		// emit drivePoolChange event if drive changed its pool
		if (diskChangedPool)
			eventsList.push({
				ids: [events.getTargetID(node.node_id), events.getDiskID(newDiskReport.diskID)],
				event: objectNotifier.events.drivePoolChangeEvent,
				payload: diskToUpdateClone
			});
	}

	if (shouldEmitEvents)
		eventsList.forEach(function(event) {
			events.emitEvent(event.ids, event.event, event.payload);
		});

	return somethingWrong;
}

scope.isDriveWentIntoPool = function(newDrive, oldDrive) {
	if ((oldDrive.isExcluded || oldDrive.status === consts.diskStatus.NOT_INITIALIZED)
		&& (!newDrive.isExcluded && newDrive.status !== consts.diskStatus.NOT_INITIALIZED))
		return true;

	return false;
};

scope.isDriveWentOutOfPool = function(newDrive, oldDrive) {
	if ((newDrive.isExcluded || newDrive.status === consts.diskStatus.NOT_INITIALIZED)
		&& (!oldDrive.isExcluded && oldDrive.status !== consts.diskStatus.NOT_INITIALIZED))
		return true;

	return false;
};

function deleteDiskByIDAndUUID(diskID, diskUUID, callback) {
	const db = app.get('db');
	const serverCollection = db.collection('server');
	let message;
	let zone;

	const $diskMatch = { 'disks.diskID': diskID, 'disks.uuid': diskUUID };

	async.series([
		//Find the zone
		(callback) => {
			serverCollection.findOne($diskMatch, { zone: 1 }, (err, server) => {
				if (err)
					message = new MongoError(err).log();
				else if (!server)
					message = new SystemMessage(systemMessages.DELETE_DISK_SERVER_NOT_FOUND);
				else
					zone = server.zone;

				callback(message);
			});
		},
		//Acquire the lock
		(callback) => {
			if (!zone)
				return callback();

			lockModule.acquireLockByZone(zone, () => {
				callback();
			});
		},
		//Handle the remove
		(callback) => {
			//Re fetch the drive as the previous fetch was outside the lock
			serverCollection.aggregate([
				{ $unwind: '$disks' },
				{ $match: $diskMatch },
				{
					$project: {
						diskID: '$disks.diskID',
						uuid: '$disks.uuid',
						diskSegments: '$disks.diskSegments',
						nodeID: '$node_id',
						status: '$disks.status',
						isExcluded: '$disks.isExcluded',
						isOutOfService: '$disks.isOutOfService',
						zone: 1
					}
				}
			]).toArray(function(err, disks) {
				if (err)
					message = new MongoError(err).log();
				else if (!disks?.length)
					message = new SystemMessage(systemMessages.DELETE_DISK_DISK_NOT_FOUND);

				if (message)
					return callback(message);

				const disk = disks[0];

				if (!diskCanBeDeleted(disk)) {
					if (disk.isExcluded)
						message = new SystemMessage(systemMessages.DRIVE_IS_EXCLUDED_CANNOT_DELETE);
					else
						message = new SystemMessage(systemMessages.DRIVE_IN_USE_CANNOT_DELETE);

					return callback(message);
				}

				serverCollection.updateMany({ _id: disk.nodeID }, { $pull: { disks: { diskID, uuid: diskUUID } } }, (err) => {
					if (err) {
						message = new MongoError(err).log();
						return callback(message);
					}

					events.emitEvent(
						[events.getDiskID(disk.diskID), events.getTargetID(disk.nodeID)],
						objectNotifier.events.diskRemovedEvent,
						{ diskID: disk.diskID, uuid: disk.uuid }
					);

					message = new SystemAdminMessage(systemMessages.DISK_DELETED);

					const zones = [disk.zone];
					utils.incZonesConfigurationVersion(zones, () => zoneModule.dispatchZonesHardwareConfigurationByZones(zones));
					callback();
				}
				);
			});
		}
	], error => lockModule.releaseLockByZone(zone, () =>
		callback((error ? new SystemAdminMessage(systemMessages.DRIVE_DELETE_FAILED).addInfo(Entities.Error, message) : message)
			.addInfo(Entities.Drive.ID, diskID).addInfo(Entities.Drive.UUID, diskUUID))));
}

scope.deleteDisks = (disks, callback) => {
	const messages = [];

	async.eachSeries(disks, (disk, callback) => {
		deleteDiskByIDAndUUID(disk._id, disk.uuid, message => {
			messages.push(message);
			callback();
		});
	}, () => callback(messages));
};

//Returns false if anything is wrong with the disk.
function checkDiskEndurance(oldDiskReport, newDiskReport, eventsList, nodeID) {
	var diskToUpdate = oldDiskReport || newDiskReport;
	var newDiskEndurance = getDiskEndurance(newDiskReport);
	var oldDiskEndurance = getDiskEndurance(oldDiskReport);
	var diskToUpdateClone = utils.extend(true, diskToUpdateClone, diskToUpdate);
	var calcDelta = this;
	if (oldDiskReport)
		diskToUpdateClone.health_old = oldDiskReport.health;

	if (newDiskEndurance === null) return true;

	if (1 >= newDiskEndurance)
		if (!oldDiskReport || oldDiskEndurance > 1) {
			logger.sysDEBUG(`Drive ${newDiskReport.diskID} in target ${nodeID} endurance below 1%`);

			if (diskToUpdate.health !== consts.targetHealth.CRITICAL) {
				calcDelta.updateDisk(diskToUpdate, diskToUpdate.uuid, 'health', consts.targetHealth.CRITICAL);
				diskToUpdateClone.health = diskToUpdate.health;
				eventsList.push({
					ids: [events.getTargetID(nodeID), events.getDiskID(newDiskReport.diskID)],
					event: objectNotifier.events.diskFailureEvent,
					payload: diskToUpdateClone
				});
			}
			return false;
		}

	var alreadyReported = false;
	[5, 10, 20, 50].forEach(function(percentage) {
		if (alreadyReported)
			return;

		if (newDiskEndurance <= percentage)
			if ((oldDiskReport && oldDiskEndurance > percentage) || !oldDiskReport) {
				logger.sysDEBUG(`Drive ${newDiskReport.diskID} endurance percentage is below ${percentage} in target ${nodeID}`);

				if (diskToUpdate.health === consts.targetHealth.HEALTHY) {
					calcDelta.updateDisk(diskToUpdate, diskToUpdate.uuid, 'health', consts.targetHealth.ALARM);
					diskToUpdateClone.health = diskToUpdate.health;
					eventsList.push({
						ids: [events.getTargetID(nodeID), events.getDiskID(newDiskReport.diskID)],
						event: objectNotifier.events.diskFailureEvent,
						payload: diskToUpdateClone
					});
				}

				alreadyReported = true;
			}
	});

	return !alreadyReported;
}

//Returns the write edurance of the disk in numbers, if coulnd't extract returning null.
function getDiskEndurance(diskReport) {
	if (!diskReport || !diskReport.Available_Spare)
		return null;

	var parts = diskReport.Available_Spare.split('_');
	var endurance;

	if (parts && parts.length)
		endurance = parseInt(parts[0]);

	return !isNaN(endurance) ? endurance : null;
}

scope.checkDiskStatus = function(oldDiskReport, newDiskReport, eventsList, node, calcDelta) {
	var somethingWrong = false;
	var diskUUID = oldDiskReport ? oldDiskReport.uuid : newDiskReport.uuid;

	this.updateDisk(newDiskReport, diskUUID, 'nodeID', node.node_id);
	this.updateDisk(newDiskReport, diskUUID, 'nodeUUID', node.uuid);

	// for backward compatibility
	this.updateDisk(newDiskReport, diskUUID, 'status',
		newDiskReport.status === 1 ? consts.diskStatus.OK : newDiskReport.status === 2 ? consts.diskStatus.ERROR : newDiskReport.status);

	somethingWrong = handleDriveStatusChanged.bind(calcDelta)(oldDiskReport, newDiskReport, eventsList, node, false);

	if (newDiskReport.status === consts.diskStatus.NOT_INITIALIZED || newDiskReport.isExcluded)
		return true;

	return somethingWrong ? !somethingWrong : checkDiskEndurance.bind(calcDelta)(oldDiskReport, newDiskReport, eventsList, node.node_id);
};

var diskCanBeDeleted = function(disk) {
	return (disk.status !== consts.diskStatus.NOT_INITIALIZED
		&& (!disk.isExcluded || disk.status === consts.diskStatus.MISSING)
		&& (!disk.diskSegments
			|| (disk.diskSegments.filter(function(seg) { return seg.type !== consts.segmentTypes.EXCELERO_METADATA; }).length === 0))
		&& (disk.status === consts.diskStatus.MISSING || disk.isOutOfService));
};

scope.evictDiskByDiskIDsAndUUIDsWithLogsWrapper = (disks, user, callback) => {
	scope.evictDiskByDiskIDsAndUUIDs(disks, user, false, null, null, null, callback);
};

scope.updateVolumesAfterEvict = (disk, raidSegmentsIdsToRemap, zonesToLock, callback) => {
	const raidSegments = disk.diskSegments.filter(s => raidSegmentsIdsToRemap.includes(s._id));

	for (const segment of raidSegments) {
		if (segment.status === consts.diskSegmentStatuses.DEAD)
			segment.isDead = true;

		logger.sysDEBUG(`setting REMAP for segment id: ${segment.uuid}`);
		segment.status = consts.diskSegmentStatuses.REMAP;
	}

	if (raidSegments.length)
		return volumeModule.updateVolumeDiskSegmentsAfterEvict(disk.diskSegments, null, zonesToLock, callback);

	callback();
};

scope.evictDiskByDiskIDsAndUUIDs = function(disks, user, isAutoEvict, lockedZones, existingMessages, autoEvictReason, callback) {
	var db = app.get('db');
	var serverCollection = db.collection('server');
	var disksToRetryEviction = [];
	var lockAcquired;
	var zonesToLock = new Set();
	var messages = existingMessages || [];

	async.eachSeries(disks, function(disk, callback) {
		var zone;
		var shouldRetryEvict = false;
		var shouldIncConfiguration = false;
		var $matchDisk = {
			disks: {
				$elemMatch: {
					diskID: disk.diskID,
					uuid: disk.uuid
				}
			}
		};

		async.series([
			//Find the drive zone
			(callback) => {
				if (disk.zone) {
					zone = disk.zone;
					zonesToLock.add(zone);
					return callback();
				}

				serverCollection.findOne($matchDisk, (err, server) => {
					var errMsg;

					if (err || !server) {
						if (err)
							new MongoError(err).log();

						errMsg = `Failed to find a target with this drive: ${disk.diskID} ${disk.uuid}`;
						messages.push(new SystemAdminMessage(systemMessages.DRIVE_NOT_FOUND).addInfo(Entities.Error, errMsg));

						return callback(errMsg);
					}

					zone = server.zone;
					zonesToLock.add(zone);

					callback(errMsg);
				});
			},
			//Lock the zone if needed
			(callback) => {
				if (lockedZones && lockedZones.size) {
					const unmatchedZonesLockedError = new SystemMessage(systemMessages.UNMATCHED_ZONES_LOCKED_ON_DISK_EVICT)
						.addInfo(Entities.Drive.ID, disk.diskID)
						.addInfo(Entities.Error, 'Already Locked zones: ' + Array.from(lockedZones) + ' disk zone: ' + Array.from(zone));

					//kill the process in case we found a difference between the zone set that were already locked to the ones we inted to lock
					zoneModule.enforceLockedZoneSetEqualtyOrExit(lockedZones, zonesToLock, unmatchedZonesLockedError);
					callback();
				} else
					lockModule.acquireLockByZone(zone, () => {
						lockAcquired = true;
						callback();
					});
			},
			//Handle the evict
			(callback) => {
				var diskClone = utils.extend(true, diskClone, disk);
				$matchDisk = { 'disks.diskID': disk.diskID, 'disks.uuid': disk.uuid };

				if (!isAutoEvict)
					$matchDisk['disks.isOutOfService'] = { $ne: true };

				serverCollection.aggregate([
					{ $unwind: '$disks' },
					{ $match: $matchDisk }
				]).toArray(function(err, serverDisks) {
					if (!serverDisks || !serverDisks.length) {
						var errMsg = `There is no such drive in the system ${JSON.stringify($matchDisk)}`;
						messages.push(new SystemAdminMessage(systemMessages.DRIVE_NOT_FOUND).addInfo(Entities.Error, errMsg));

						return callback();
					}

					var node = serverDisks[0];
					var disk = node.disks;
					var kafkaMessageSequenceKey = consts.kafkaMessageTypes.TOMAToManagament.reportTarget;
					var currentKafkaMessageSequence = node.kafkaMessageSequence[kafkaMessageSequenceKey];
					disk.health_old = disk.health;

					var noneMetadataSegments = disk.diskSegments ? disk.diskSegments.filter(function(seg) {
						return seg.type !== consts.segmentTypes.EXCELERO_METADATA;
					}) : [];

					if (disk.status === consts.diskStatus.NOT_INITIALIZED && !noneMetadataSegments.length || disk.isExcluded) {
						const errorSystemMsg = new SystemMessage(systemMessages.CANNOT_EVICT_DISK);
						messages.push(new SystemAdminMessage(systemMessages.DISK_CANT_BE_EVICTED).addInfo(Entities.Error, errorSystemMsg)
							.addInfo(Entities.Drive.ID, getDriveID(disk.diskID, disk.nodeID))
							.addInfo(Entities.Drive.UUID, disk.uuid));

						return callback();
					}

					disk.isOutOfService = true;
					disk.version++;
					disk.automaticallyEvicted = isAutoEvict;

					if (isAutoEvict)
						disk.health = consts.targetHealth.CRITICAL;

					var $inc = { 'disks.$.version': 1 };
					var $set = {
						'disks.$.diskSegments': disk.diskSegments || [],
						'disks.$.isOutOfService': disk.isOutOfService,
						'disks.$.automaticallyEvicted': disk.automaticallyEvicted,
						'disks.$.health': disk.health
					};

					if (autoEvictReason)
						$set['disks.$.autoEvictReason'] = autoEvictReason;

					if (!disk.diskSegments)
						disk.diskSegments = [];

					async.waterfall([
						function(callback) {
							scope.getAndValidateSegmentsForRemapOnEvict(disk, isAutoEvict, callback);
						},
						function(segmentsIdsToDeprecate, raidSegmentsIdsToRemap, callback) {
							async.series([
								function updateServerCollection(callback) {
									serverCollection.updateOne({
										_id: node.node_id,
										'disks.diskID': disk.diskID,
										'disks.uuid': disk.uuid,
										[`kafkaMessageSequence.${kafkaMessageSequenceKey}`]: currentKafkaMessageSequence
									}, {
										$set: $set, $inc: $inc
									}, function(err, results) {
										if (err) {
											new MongoError(err).log();
											callback('Something bad happened while trying to update server isOutOfService flag');
										} else if (results.modifiedCount == 0) {
											disksToRetryEviction.push(disk);
											shouldRetryEvict = true;
											callback();
										} else {
											shouldIncConfiguration = true;
											events.emitEvent(
												[events.getDiskID(disk.diskID), events.getTargetID(node.node_id)],
												objectNotifier.events.diskEvictedEvent,
												disk
											);
											callback();
										}
									});
								},
								function updateVolumeCollection(callback) {
									if (shouldRetryEvict)
										return callback();

									scope.updateVolumesAfterEvict(disk, raidSegmentsIdsToRemap, zonesToLock, callback);
								}
							], function(err) {
								callback(err, segmentsIdsToDeprecate);
							});
						},
						function(segmentsIdsToDeprecate, callback) {
							if (shouldRetryEvict)
								return callback();

							if (!segmentsIdsToDeprecate || !segmentsIdsToDeprecate.length)
								return callback();

							volumeModule.deprecateSegments(segmentsIdsToDeprecate, zone, user, callback);
						},
					], function(err) {
						if (shouldRetryEvict)
							return callback();

						let systemAdminMessage = (err ?
							new SystemAdminMessage(systemMessages.DISK_EVICT_FAILED).addInfo(Entities.Error, err)
							: new SystemAdminMessage(systemMessages.DISK_EVICTED))
							.addInfo(Entities.Drive.ID, getDriveID(disk.diskID, disk.nodeID))
							.addInfo(Entities.Drive.UUID, disk.uuid);

						messages.push(systemAdminMessage);

						if (shouldIncConfiguration)
							utils.incZonesConfigurationVersion([zone], () => {
								zoneModule.dispatchZonesHardwareConfigurationByZones([zone]);
								callback();
							});
						else
							callback();
					});
				});
			},
			(callback) => {
				if (shouldRetryEvict)
					return callback();

				// remove only drives that were successfully evicted
				let evictedDrives = messages
					.filter(l => l.systemMessage.id === systemMessages.DISK_EVICTED.id)
					.map(l => ({ diskID: l.getAdditionalInfoByKey(Entities.Drive.ID) }));

				//update the diskClass collection
				diskClassModule.removeEvictedDrivesFromClasses(evictedDrives, () => { callback(); });
			}], () => {
			if (lockAcquired)
				lockModule.releaseLockByZone(zone);

			callback();
		});
	}, () => {
		if (disksToRetryEviction.length)
			scope.evictDiskByDiskIDsAndUUIDs(disksToRetryEviction, user, isAutoEvict, lockedZones, messages, autoEvictReason, callback);
		else
			callback(messages);
	});
};

scope.getSegmentForEvict = function(segment, callback) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	volumeCollection.aggregate([
		{ $unwind: '$chunks' },
		{ $unwind: '$chunks.pRaids' },
		{ $match: { _id: segment.volumeName, 'chunks.pRaids.diskSegments._id': segment._id } }])
		.toArray((err, results) => {
			if (!err && results && results.length)
				return callback(err, results[0]);
			else
				return callback(err);
		});
};

scope.getAndValidateSegmentsForRemapOnEvict = function(disk, isAutoEvict, cb) {

	var raidSegmentsIdsToRemap = [];
	var segmentsIdsToDeprecate = [];

	var noneMetadataSegments = disk.diskSegments ? disk.diskSegments.filter(function(seg) {
		return seg.type !== consts.segmentTypes.EXCELERO_METADATA;
	}) : [];

	async.eachSeries(noneMetadataSegments, function(segment, callback) {
		scope.getSegmentForEvict(segment, function(err, volume) {
			if (!err && volume) {
				// get the segment status from the volume segment
				volume.chunks.pRaids.diskSegments.forEach(s=> {
					if (s.uuid == segment._id)
						segment.status = s.status;
				});

				if (volume.action == consts.volumeActions.MARKED_FOR_DELETION)
					segmentsIdsToDeprecate.push({ id: segment._id, volType: volume.type, pRaidUUID: volume.chunks.pRaids.uuid });
				else {
					switch (volume.RAIDLevel) {
						case consts.RAIDLevel.CONCATENATED:
						case consts.RAIDLevel.STRIPED_RAID_0:
							if (!isAutoEvict)
								err = consts.evictFailureReasons.VOLUME_WITHOUT_REDUNDENCY;
							break;
						case consts.RAIDLevel.MIRRORED_RAID_1:
						case consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10:
						case consts.RAIDLevel.ERASURE_CODING:
						case consts.RAIDLevel.STRIPED_ERASURE_CODING:
							err = scope.checkRedundancyViolationOnEvict(volume, segment, isAutoEvict);
							if (!err) {
								const hasRebuildOldSiblingInSamePRaid = volume.chunks.pRaids.diskSegments.some((s) =>
									s.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD &&
									s.pRaidIndex === segment.pRaidIndex);
								const isActiveRebuildInProgress =
									(segment.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD && hasRebuildOldSiblingInSamePRaid) ||
									segment.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING;

								if (!isActiveRebuildInProgress)
									raidSegmentsIdsToRemap.push(segment._id);
								else if (!isAutoEvict)
									err = consts.evictFailureReasons.MARKED_FOR_REBUILD_SEG_FOUND;
							}
					}
				}

				if (err)
					err = err + ' (volume: ' + volume._id + ')';
			}

			callback(err);
		});
	}, function(err) {
		cb(err, segmentsIdsToDeprecate, raidSegmentsIdsToRemap);
	});
};

scope.checkRedundancyViolationOnEvict = function(volume, segmentToEvict, isAutoEvict) {
	if (isAutoEvict)
		return;

	const isHealthySegment = seg => seg.status === consts.diskSegmentStatuses.NORMAL && !seg.isDead;
	const isRelevantSegment = seg => seg._id !== segmentToEvict._id &&
		seg.type === consts.segmentTypes.DATA &&
		volumeModule.isEffectiveSegmentInPRaidStatus(seg.status);
	const segmentByHealth = volume.chunks.pRaids.diskSegments.reduce((acc, segment) => {
		if (!isRelevantSegment(segment))
			return acc;

		if (isHealthySegment(segment))
			acc.healthy.push(segment);
		else
			acc.unhealthy.push(segment);

		return acc;
	}, { unhealthy: [], healthy: [] });
	const { unhealthy, healthy } = segmentByHealth;

	if ((consts.erasureCodedRaidLevels.includes(volume.RAIDLevel) && unhealthy.length >= volume.parityBlocks) ||
		(consts.mirroredRaidLevels.includes(volume.RAIDLevel) && !healthy.length))
		return consts.evictFailureReasons.LAST_LIVE_COPY;
};

function autoEvictTimedoutMissingDrives(cb) {
	var db = app.get('db');
	var serverCollection = db.collection('server');

	var autoEvictMissingSince = new Date();
	autoEvictMissingSince.setMilliseconds(autoEvictMissingSince.getMilliseconds() - consts.autoEvictMissingDriveAfter);

	logger.sysDEBUG('Scanning for missing drives');

	serverCollection.aggregate([
		{ $project: {
			node_id: 1,
			kafkaMessageSequence: 1,
			'disks.isExcluded': 1,
			'disks.diskID': 1,
			'disks.uuid': 1,
			'disks.status': 1,
			'disks.missingSince': 1,
			'disks.isOutOfService': 1
		} },
		{ $unwind: '$disks' },
		{
			$match:	{
				$and: [
					{ $or: [{ 'disks.isExcluded': { $exists: 0 } }, { 'disks.isExcluded': false }] },
					{ $or: [{ 'disks.isOutOfService': { $exists: 0 } }, { 'disks.isOutOfService': false }] }
				],
				'disks.status': consts.diskStatus.MISSING,
				'disks.missingSince': { $lt: autoEvictMissingSince }
			}
		},
		{ $group: { _id: '$node_id', disks: { $push: '$disks' } } }
	]).toArray(function(err, targets) {
		if (err) {
			new MongoError(err).log();
			return cb();
		}

		if (!targets || !targets.length)
			return cb();

		var disksToEvict = [];
		targets.forEach(function(target) {
			if (target.disks && target.disks.length) {
				target.disks.forEach(function(disk) {
					disk.autoEvictReason = consts.autoEvictReason.MISSING_DRIVE;
				});

				disksToEvict = disksToEvict.concat(target.disks);
			}
		});

		logger.sysDEBUG('Going to auto evicts missing drives after timeout', disksToEvict.map(function(disk) { return disk.diskID; }));

		if (disksToEvict.length)
			scope.evictDiskByDiskIDsAndUUIDs(disksToEvict, consts.SYSTEM_USER, true, null, null, consts.autoEvictReason.MISSING_DRIVE, logs => {
				logWithRequestUUID(logs);
				cb();
			});
		else
			cb();
	});
}

scope.startMissingDriveCheckupInterval = function(callback) {
	//Server start-up callback
	callback();

	var GLOBAL_SETTINGS_HIDDEN = app.get('globalSettingsHidden');

	if (!GLOBAL_SETTINGS_HIDDEN || !GLOBAL_SETTINGS_HIDDEN.autoEvictMissingDrive)
		return;

	function intervalFunc() {
		autoEvictTimedoutMissingDrives(function() {
			setTimeout(intervalFunc, consts.missingDriveCheckupInterval);
		});
	}

	setTimeout(intervalFunc, consts.missingDriveCheckupInterval);
};

function validateVolumeSegmentsBeforeReinstate(drive, callback) {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');

	const diskID = drive.diskID;
	const volumeNames = [...new Set(
		drive.diskSegments
			.filter(seg => seg.type === consts.segmentTypes.DATA)
			.map(seg => seg.volumeName)
	)];

	const pipeline = [
		{
			$match: {
				_id: { $in: volumeNames },
				RAIDLevel: { $in: [...consts.mirroredRaidLevels, ...consts.erasureCodedRaidLevels] }
			}
		},
		{
			$project: {
				RAIDLevel: 1,
				numberOfMirrors: 1,
				parityBlocks: 1,
				chunks: {
					pRaids: {
						diskSegments: {
							diskID: 1,
							type: 1,
							status: 1
						}
					}
				}
			}
		},
		{ $unwind: '$chunks' },
		{ $unwind: '$chunks.pRaids' },
		{ $match: { 'chunks.pRaids.diskSegments': { $elemMatch: { diskID, type: consts.segmentTypes.DATA } } } },
		{
			$addFields: {
				segmentsOnDisk: {
					$size: {
						$filter: {
							input: '$chunks.pRaids.diskSegments',
							as: 'seg',
							cond: { $and: [{ $eq: ['$$seg.diskID', diskID] }, { $eq: ['$$seg.type', consts.segmentTypes.DATA] }] }
						}
					}
				},
				maxAllowed: {
					$switch: {
						branches: [
							{
								case: { $in: ['$RAIDLevel', consts.mirroredRaidLevels] },
								then: '$numberOfMirrors'
							},
							{
								case: { $in: ['$RAIDLevel', consts.erasureCodedRaidLevels] },
								then: '$parityBlocks'
							}
						],
						default: 0
					}
				}
			}
		},
		{
			$addFields: {
				rebuildInProgress: {
					$gt: [
						{
							$size: {
								$filter: {
									input: '$chunks.pRaids.diskSegments',
									as: 'seg',
									cond: {
										$and: [
											{ $eq: ['$$seg.diskID', diskID] },
											{ $eq: ['$$seg.type', consts.segmentTypes.DATA] },
											{ $eq: ['$$seg.status', consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD] }
										]
									}
								}
							}
						},
						0
					]
				},
				noSurvivingCopy: { $gt: ['$segmentsOnDisk', '$maxAllowed'] }
			}
		},
		{ $match: { $or: [{ rebuildInProgress: true }, { noSurvivingCopy: true }] } },
		{ $limit: 1 },
		{ $project: { _id: 1, rebuildInProgress: 1, noSurvivingCopy: 1 } }
	];

	volumeCollection.aggregate(pipeline).toArray((err, results) => {
		if (err)
			return callback(new MongoError(err));

		if (!results.length)
			return callback();

		if (results[0].rebuildInProgress)
			return callback(new SystemMessage(systemMessages.DRIVE_REINSTATE_REBUILD_IN_PROGRESS)
				.addInfo(Entities.Volume.ID, results[0]._id));

		if (results[0].noSurvivingCopy)
			return callback(new SystemMessage(systemMessages.DRIVE_REINSTATE_NO_SURVIVING_COPY_ON_OTHER_DISK)
				.addInfo(Entities.Volume.ID, results[0]._id));

		callback();
	});
}

function validateDriveToReinstate(drive, callback) {
	if (!drive)
		return callback(new SystemMessage(systemMessages.DRIVE_NOT_FOUND));

	if (!drive.isOutOfService)
		return callback(new SystemMessage(systemMessages.DRIVE_REINSTATE_NOT_OUT_OF_SERVICE));

	if (!drive.diskSegments.some(seg => seg.type === consts.segmentTypes.DATA))
		return callback(new SystemMessage(systemMessages.DRIVE_REINSTATE_NO_DATA_SEGMENTS));

	if (drive.diskSegments.some(seg => seg.type === consts.segmentTypes.DATA && !utils.hasRedundancy(seg)))
		return callback(new SystemMessage(systemMessages.DRIVE_REINSTATE_NON_PROTECTED_SEGMENTS));

	validateVolumeSegmentsBeforeReinstate(drive, (err) => {
		if (err)
			return callback(err);

		utils.validateFeatureCompatibility(consts.FEATURE_REQUIREMENTS.REINSTATE, callback);
	});
}

function applyReinstateSegmentPairsToVolume(segmentsPairs, volume){
	segmentsPairs.forEach(({ oldSegment, newSegment }) => {
		volume.chunks.forEach(chunk => {
			chunk.pRaids.forEach(pRaid => {
				if (pRaid.uuid !== newSegment.pRaidUUID)
					return;

				const volumeOldSegment = pRaid.diskSegments.find(seg => seg._id === oldSegment._id);
				if (!volumeOldSegment)
					return;

				volumeOldSegment.status = consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD;

				const volumeNewSegment = utils.extend(true, {}, volumeOldSegment, {
					_id: newSegment._id,
					uuid: newSegment.uuid,
					status: newSegment.status,
					diskUUID: newSegment.diskUUID
				});

				pRaid.diskSegments.push(volumeNewSegment);
			});
		});
	});
}

scope.updateVolumesAfterReinstate = (segmentPairsByVolume, callback) => {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');
	let hadFailure;

	async.eachSeries(Object.keys(segmentPairsByVolume), (volumeName, cb) => {
		const segmentsPairs = segmentPairsByVolume[volumeName];

		async.waterfall([
			function fetchVolume(cb) {
				volumeCollection.findOne({ _id: volumeName }, (err, volume) => {
					if (err)
						return cb(new MongoError(err));

					if (!volume) {
						hadFailure = true;
						logger.sysDEBUG(`Volume ${volumeName} not found during reinstate`);
					}

					cb(null, volume);
				});
			},
			function updateVolume(volume, cb) {
				if (!volume)
					return cb();

				applyReinstateSegmentPairsToVolume(segmentsPairs, volume);
				const calcResult = volumeModule.calculateVolumeStatus(volume);

				const query = {
					_id: volumeName,
					version: volume.version
				};

				const update = {
					$currentDate: { dateModified: true },
					$inc: { version: 1 },
					$set: {
						status: calcResult.newStatus,
						action: calcResult.newAction,
						health: calcResult.newHealth,
						chunks: volume.chunks
					}
				};

				volumeCollection.findOneAndUpdate(query, update, { returnDocument: consts.mongoReturnDocument.AFTER }, (err, result) => {
					if (err)
						return cb(new MongoError(err));

					if (!result) {
						hadFailure = true;
						logger.sysDEBUG(`Volume ${volumeName} version conflict during reinstate, sanity will recover`);
						return cb();
					}

					calcResult.eventsToEmit.forEach((eventName) =>
						events.emitEvent([events.getVolumeID(result.name)], objectNotifier.events[eventName], result));

					volumeModule.sendVolumeUpdateToTomaByVolume(result);
					cb();
				});
			}
		], (err) => {
			if (err) {
				hadFailure = true;
				new SystemMessage(systemMessages.DRIVE_REINSTATE_VOLUME_UPDATE_FAILED)
					.addInfo(Entities.Volume.ID, volumeName)
					.addInfo(Entities.Error, err)
					.log();
			}
			cb();
		});
	}, (err) => {
		if (hadFailure)
			utils.toggleForceSanityAndRecover();

		callback(err);
	});
};

function buildSegmentReplacementPairsByVolume(server, newDiskSegmentStatus) {
	const segmentPairsByVolume = {};

	for (const oldSegment of server.disks.diskSegments) {
		if (oldSegment.type !== consts.segmentTypes.DATA)
			continue;

		// there may be other volumes on this disk that were not reinstated
		if (newDiskSegmentStatus === consts.diskSegmentStatuses.MARKED_FOR_REBUILD &&
			oldSegment.status !== consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING)
			continue;

		if (!segmentPairsByVolume[oldSegment.volumeName])
			segmentPairsByVolume[oldSegment.volumeName] = [];

		oldSegment.status = consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD;

		const replacementUUID = uuid.v1();
		const segmentsPair = {
			oldSegment,
			newSegment: utils.extend(true, {}, oldSegment, {
				_id: replacementUUID,
				uuid: replacementUUID,
				status: newDiskSegmentStatus,
				diskUUID: server.disks.uuid
			})
		};

		segmentPairsByVolume[oldSegment.volumeName].push(segmentsPair);
	}

	return segmentPairsByVolume;
}

function executeInPlaceSegmentReplacement(serverQuery, newDiskSegmentStatus, callback, preReplaceValidation) {
	const db = app.get('db');
	const serverCollection = db.collection('server');

	async.waterfall([
		function fetchDrive(cb) {
			const pipeline = [
				{ $match: serverQuery },
				{ $unwind: '$disks' },
				{ $match: serverQuery },
				{ $project: { zone: 1, 'disks.uuid': 1, 'disks.version': 1, 'disks.diskSegments': 1, 'disks.isOutOfService': 1 } },
			];

			serverCollection.aggregate(pipeline).toArray((err, result) => {
				if (err)
					return cb(new MongoError(err));

				if (!result.length)
					return cb(new SystemMessage(systemMessages.DRIVE_REINSTATE_SERVER_VERSION_CONFLICT));

				cb(null, result[0]);
			});
		},
		function runPreReplaceValidation(server, cb) {
			if (!preReplaceValidation)
				return cb(null, server);

			preReplaceValidation(server.disks, (err) => cb(err, server));
		},
		function updateDrive(server, cb) {
			const { 'disks.diskID': diskID, 'disks.uuid': diskUUID, ...documentConditions } = serverQuery;
			const query = {
				...documentConditions,
				disks: {
					$elemMatch: {
						diskID,
						uuid: diskUUID,
						version: server.disks.version,
					}
				}
			};

			const segmentPairsByVolume = buildSegmentReplacementPairsByVolume(server, newDiskSegmentStatus);
			const newSegments = Object.values(segmentPairsByVolume).flatMap(segmentPair => segmentPair.map(pair => pair.newSegment));

			const drivePath = 'disks.$';
			const update = {
				$currentDate: { dateModified: true },
				$inc: { [`${drivePath}.version`]: 1 },
				$set: { [`${drivePath}.diskSegments`]: server.disks.diskSegments.concat(newSegments) }
			};

			serverCollection.updateOne(query, update, (err, result) => {
				if (err)
					return cb(new MongoError(err));

				if (result.modifiedCount === 0)
					return cb(new SystemMessage(systemMessages.DRIVE_REINSTATE_SERVER_VERSION_CONFLICT));

				utils.incZonesConfigurationVersion([server.zone], () =>
					zoneModule.dispatchZonesHardwareConfigurationByZones([server.zone], () =>
						cb(null, segmentPairsByVolume)));
			});
		},
		function updateVolumes(segmentPairsByVolume, cb) {
			scope.updateVolumesAfterReinstate(segmentPairsByVolume, cb);
		}
	], callback);
}

function enrichServerQuery(serverQuery, callback) {
	const db = app.get('db');
	const serverCollection = db.collection('server');

	const projection = {
		zone: 1,
		[`kafkaMessageSequence.${consts.kafkaMessageTypes.TOMAToManagament.reportTarget}`]: 1,
		'disks.diskID': 1,
		'disks.uuid': 1,
		'disks.isOutOfService': 1,
		'disks.diskSegments.type': 1,
		'disks.diskSegments.redundancyRatio': 1,
		'disks.diskSegments.volumeName': 1
	};

	serverCollection.findOne(serverQuery, { projection }, (err, server) => {
		if (err)
			return callback(new MongoError(err));

		if (!server)
			return callback(new SystemMessage(systemMessages.DRIVE_NOT_FOUND));

		const reportTargetMsgType = consts.kafkaMessageTypes.TOMAToManagament.reportTarget;
		serverQuery._id = server._id;
		serverQuery.zone = server.zone;
		serverQuery[`kafkaMessageSequence.${reportTargetMsgType}`] = server.kafkaMessageSequence[reportTargetMsgType];

		callback(null, server);
	});
}


function executeReinstateReplacement({ drive, newSegmentStatus, preReplaceValidation }, callback) {
	const { diskID: driveID, uuid: driveUUID } = drive;
	const backoff = new Backoff({ maxRetries: consts.MAX_REINSTATE_RETRIES });
	const phaseLabel = newSegmentStatus === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING ? 'pre-format' : 'post-format';

	function attempt() {
		const serverQuery = { 'disks.diskID': driveID, 'disks.uuid': driveUUID };
		let zoneLocked;

		async.series([
			cb => {
				enrichServerQuery(serverQuery, (err, server) => {
					if (err)
						return cb(err);

					if (!preReplaceValidation)
						return cb();

					const drive = server.disks.find(d => d.diskID === driveID);
					preReplaceValidation(drive, cb);
				});
			},
			cb => {
				lockModule.acquireLockByZone(serverQuery.zone, (err) => {
					if (err)
						return cb(err);

					zoneLocked = serverQuery.zone;
					cb();
				});
			},
			cb => executeInPlaceSegmentReplacement(serverQuery, newSegmentStatus, cb, preReplaceValidation)
		], (err) => {
			const finish = () => {
				const isVersionConflict = err?.systemMessage?.id === systemMessages.DRIVE_REINSTATE_SERVER_VERSION_CONFLICT.id;
				if (!isVersionConflict)
					return callback(err);

				backoff.backoff((backoffErr) => {
					if (backoffErr) {
						logger.sysDEBUG(`Reinstate ${phaseLabel} for drive ${driveID} exhausted retries: ${backoffErr}`);
						return callback(err);
					}

					logger.sysDEBUG(`Retrying reinstate ${phaseLabel} for drive ${driveID} (attempt ${backoff.retries + 1}/${consts.MAX_REINSTATE_RETRIES})`);
					attempt();
				});
			};

			if (zoneLocked)
				return lockModule.releaseLockByZone(zoneLocked, finish);

			finish();
		});
	}

	attempt();
}

function reinstateDrive(drive, callback) {
	executeReinstateReplacement({
		drive,
		newSegmentStatus: consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING,
		preReplaceValidation: (disk, cb) => validateDriveToReinstate(disk, cb)
	}, (err) => {
		const message = new SystemAdminMessage(err ? systemMessages.DRIVE_REINSTATE_FAILED : systemMessages.DRIVE_REINSTATED)
			.addInfo(Entities.Drive.ID, drive.diskID)
			.addInfo(Entities.Drive.UUID, drive.uuid);

		if (err)
			message.addInfo(Entities.Error, err);

		callback(null, message);
	});
}

scope.reinstateDrives = (drives, callback) => {
	async.mapSeries(drives, reinstateDrive, (_, messages) => callback(messages));
};

module.exports = scope;
