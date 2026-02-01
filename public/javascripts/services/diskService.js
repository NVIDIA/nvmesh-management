/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global angular,consts */

var managementApp = angular.module('managementApp');

managementApp.service('$diskService', function($http){
	this.validateEvictAction = function(disks, callback) {
		var volumesOnDisks = {};
		var allowEvict = true;
		var shouldShowConfirm = false;
		var msg = '';

		for (var diskIndex in disks) {
			if (disks[diskIndex].diskSegments && disks[diskIndex].diskSegments.length) {
				var diskSegments = disks[diskIndex].diskSegments;

				for (var diskSegmentIndex in diskSegments) {
					var diskSegment = diskSegments[diskSegmentIndex];

					if (diskSegment.volumeName) {
						if (!volumesOnDisks[diskSegment.volumeName])
							volumesOnDisks[diskSegment.volumeName] = [];

						volumesOnDisks[diskSegment.volumeName].push(disks[diskIndex]);
					}
				}
			}
		}

		var singleDrive = disks.length === 1;

		var volumesList = Object.keys(volumesOnDisks);
		if (!volumesList.length)
			return callback(allowEvict, shouldShowConfirm, msg);

		var url = '/volumes/all/0/0?filter={"_id": { "$in": ' + JSON.stringify(volumesList) + ' } }&projection={"RAIDLevel": 1, "status": 1, "action": 1}';
		$http.get(url).then(function(data) {
			var volumes = data.data;
			var volumesThatForbidEvict = [];
			var redundantVolumesExists = false;

			if (volumes && volumes.length !== 0) {
				for (var volumeIndex in volumes) {
					var volume = volumes[volumeIndex];
					if ((volume.RAIDLevel == consts.RAIDLevel.CONCATENATED || volume.RAIDLevel == consts.RAIDLevel.STRIPED_RAID_0)
						&& volume.action !== consts.volumeActions.MARKED_FOR_DELETION) {

						volumesThatForbidEvict.push(volume._id);
					}

					if (volume.RAIDLevel !== consts.RAIDLevel.CONCATENATED && volume.RAIDLevel !== consts.RAIDLevel.STRIPED_RAID_0) {
						redundantVolumesExists = true;
					}
				}

				if (volumesThatForbidEvict.length) {
					allowEvict = false;
					shouldShowConfirm = false;

					// finding which drives are effected to show a detailed message
					var drivesThatCannotBeEvicted = new Set();

					volumesThatForbidEvict.forEach(function(volumeId) {
						if (volumesOnDisks[volumeId])
							volumesOnDisks[volumeId].forEach(function(effectedDisks) {
								drivesThatCannotBeEvicted.add(effectedDisks.diskID);
							});
					});

					var singleDrive = drivesThatCannotBeEvicted.size === 1;
					var singleVolume = volumesThatForbidEvict.length === 1;
					msg = 'Error: ' + (singleDrive ? 'The Drive ' : 'Drives ') + Array.from(drivesThatCannotBeEvicted).join(', ')
						+ ' cannot be evicted because the non-redundant '
						+ (singleVolume ? 'Volume' : 'Volumes') + ' ' + volumesThatForbidEvict.join(', ')
						+ ' ' + (singleVolume ? 'has' : 'have') + ' segments on ' + (singleDrive ? 'it' : 'them') + '.';

				} else {
					// Evict Allowed, let's check if we need to show a confirm
					shouldShowConfirm = !!redundantVolumesExists;

					msg = 'Warning: You are about to evict ' + (singleDrive ? 'the drive' : 'drives') +
						'. All the data on this ' + (singleDrive ? 'drive' : 'drives')
						+ ' will be rebuilt using other drives.';
				}
			}

			return callback(allowEvict, shouldShowConfirm, msg);
		}).catch(function() {
			msg = 'Warning: You are about to evict ' + (singleDrive ? ' the drive' : 'drives');
			shouldShowConfirm = true;
			callback(allowEvict, shouldShowConfirm, msg);
		});
	};

	this.updateDiskFormatDetails = function(data, disksCollection) {
		if (data.payload.formatType) {
			disksCollection.forEach(function(disk) {
				if ((disk.uuid && disk.uuid === data.payload.uuid) ||
					(data.payload.diskID && disk.diskID === data.payload.diskID && data.payload.vendor && disk.Vendor === data.payload.vendor)) {

					disk.formatDetails = { 'formatType': data.payload.formatType };
					disk.nZeroedBlks = 0;

					if (consts.driveFormatStatuses.indexOf(disk.status) === -1)
						disk.isPendingFormat = true;
				}
			});
		}
	};

	this.isDriveDeletable = function(server, drive) {
		if (hasVolumeSegments(drive) ||
				(server.tomaStatus !== consts.tomaStatuses.UNAVAILABLE &&
				drive.status !== consts.diskStatus.MISSING &&
				!drive.isOutOfService))
			return false;
		return true;
	};

	function hasVolumeSegments(drive) {
		return drive.diskSegments && drive.diskSegments.filter(function(seg) { return seg.type != consts.segmentTypes.EXCELERO_METADATA; }).length;
	}
});
