/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

const consts = require('../../consts.js');
const { evictDiskByDiskIDsAndUUIDs, reinstateDrives } = require('../../modules/disk.js');

const ADMIN_USER = consts.ADMIN_USER;
const DISK_SYNC_PROPERTIES = ['uuid', 'reappearingCounter', 'formatRequestCounter', 'activeFormatRequestCounter', 'version', 'isOutOfService', 'status'];

exports.evictDisk = function(disk, isAutoEvict) {
	return new Promise((resolve, reject) => {
		evictDiskByDiskIDsAndUUIDs([disk], ADMIN_USER, isAutoEvict, null, null, null, logs => {
			const response = logs[0].createApiResponse();
			if (response.error)
				return reject(new Error(`Evict failed: ${JSON.stringify(response.error)}`));


			resolve(logs);
		});
	});
};

exports.reinstateDisk = function(disk) {
	return new Promise(resolve => reinstateDrives([disk], logs => resolve(logs)));
};

exports.getDiskFromDB = function(diskID) {
	const serverCollection = app.get('db').collection('server');
	return serverCollection.aggregate([
		{ $unwind: '$disks' },
		{ $match: { 'disks.diskID': diskID } }
	]).toArray().then(results => results[0]?.disks);
};

exports.findTargetWithDisk = function(targetsList, diskID) {
	return targetsList.find(t => t.disks.some(d => d.diskID === diskID));
};

exports.syncTargetDiskFromDB = async function(target, diskID, syncFormatDetails) {
	const dbDisk = await exports.getDiskFromDB(diskID);
	if (!dbDisk)
		throw new Error(`syncTargetDiskFromDB: disk ${diskID} not found in DB`);

	const targetDisk = target.disks.find(d => d.diskID === diskID);
	if (!targetDisk)
		throw new Error(`syncTargetDiskFromDB: disk ${diskID} not found on target ${target.node_id}`);

	DISK_SYNC_PROPERTIES.forEach(prop => { targetDisk[prop] = dbDisk[prop]; });

	if (syncFormatDetails && dbDisk.formatDetails) {
		targetDisk.block_size = dbDisk.formatDetails.blockSize;
		targetDisk.metadata_size = dbDisk.formatDetails.metadataSize;
		targetDisk.GPT.diskGuid = dbDisk.uuid;
		targetDisk.GPT.mgmtDbUuid = app.get('dbUUID');
		targetDisk.status = consts.diskStatus.OK;
	}

	return dbDisk;
};

exports.evictDiskAndSyncTarget = async function(disk, targets) {
	const logs = await exports.evictDisk(disk);
	const target = exports.findTargetWithDisk(targets, disk.diskID);

	await target.clearQueues();
	await exports.syncTargetDiskFromDB(target, disk.diskID);
	target.messageSequence += 1;
	await target.sendKeepAlive();
	await target.sendReport();

	return { logs, target };
};
