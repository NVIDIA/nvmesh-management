/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

var scope = {};
module.exports = scope;

var async = require('async');
var ObjectId = require('mongodb-legacy').ObjectId;
var uuid = require('uuid');
var crypto = require('crypto');
var { AssignerProtocol: { MemberAssignment } } = require('kafkajs');
var objectNotifier = require('./objectNotifier.js');
var consts = require('./consts.js');
var logger = require('./logger.js');
var events = require('./events.js');
var { ExecutionTimer } = require('./models/executionTimer.js');
var fs = require('fs');
var path = require('path');
const os = require('os');

var websocket = require('./modules/websocket');
var logModule = require('./modules/log.js');
var kafkaModule = require('./modules/kafka.js');
var lockModule = require('./modules/lock.js');
var zoneModule = require('./modules/zone.js');
var nvmeshMetadata = require('./modules/nvmeshMetadata.js');
var systemMessages = require('./systemMessages.js');
var config = require('./modules/config.js');
var clientModule = require('./modules/client.js');
var volumeModule = require('./modules/volume.js');
var targetModule = require('./modules/target.js');

var { Entities, Differentiators, MongoError, SystemMessage, SystemAdminMessage, getDriveID } = require('./modules/error.js');
var { AddVolume } = require('./models/kafkaMessages/AddVolume.js');

var MIN_VOLUME_CAPACITY = 1;
var debouncerCache = {};

scope.volumesDeletionOnZeroProgress = {};

scope.afterModuleLoaded = function() {
	logModule = require('./modules/log.js');
	logger = require('./logger.js');
	events = require('./events.js');
	({ Entities, Differentiators, MongoError, SystemMessage, SystemAdminMessage, getDriveID } = require('./modules/error.js'));
};

function updateDiskSegmentReservedState(diskSegment, cb) {
	var db = app.get('db');
	var serverCollection = db.collection('server');

	serverCollection.aggregate([
		{ $unwind: '$disks' },
		{ $match: { 'disks.uuid': diskSegment.diskUUID } }
	]).toArray(function(err, results) {
		if (err) {
			new MongoError(err).log();
			return cb();
		}

		if (!results || !results.length) {
			logger.sysDEBUG(`Failed to find disk by segment ${diskSegment._id}`, err);
			return cb();
		}

		var disk = results[0].disks;

		disk.diskSegments.forEach(function(s) {
			if (s.uuid === diskSegment.uuid) {
				s.fromReserved = false;
				s.wasFromReserved = true;
			}
		});

		serverCollection.updateOne({ 'disks.uuid': disk.uuid }, { $set: { 'disks.$.diskSegments': disk.diskSegments } }, function() { cb(); });
	});
}

function getDiskProtectionIdentifierByDomain(diskID, domain, cb) {
	var db = app.get('db');
	var serverCollection = db.collection('server');

	serverCollection.aggregate([
		{ $match: { 'disks.diskID': diskID } },
		{ $unwind: '$disks' },
		{ $match: { 'disks.diskID': diskID } },
		{ $project: { diskID: '$disks.diskID', nodeID: '$node_id' } },
		{
			$lookup: {
				from: 'serverClass',
				let: { serverID: '$nodeID' },
				pipeline: [{
					$match: {
						$expr: {
							$and: [
								{ $in: [domain, '$domains.scope'] },
								{ $in: ['$$serverID', '$targetNodes'] }
							]
						}
					}
				}],
				as: 'serverClasses'
			}
		}, {
			$lookup: {
				from: 'diskClass',
				let: { diskID: '$diskID' },
				pipeline: [{
					$match: {
						$expr: {
							$and: [
								{ $in: [domain, '$domains.scope'] },
								{ $in: ['$$diskID', '$disks.diskID'] }
							]
						}
					}
				}],
				as: 'diskClasses'
			}
		},
		{
			$project: {
				diskID: 1,
				nodeID: 1,
				domains: {
					$concatArrays: ['$serverClasses.domains', '$diskClasses.domains']
				}
			}
		},
		{
			$project: {
				diskID: 1,
				nodeID: 1,
				domains: {
					$reduce: {
						input: '$domains',
						initialValue: [],
						in: { $concatArrays: ['$$value', '$$this'] }
					}
				}
			}
		},
		{ $unwind: '$domains' },
		{ $match: { 'domains.scope': domain } },
		{
			$group: {
				_id: '$domains.identifier',
				diskID: { $first: '$diskID' },
				nodeID: { $first: '$nodeID' }
			}
		}
	]).toArray((err, results) => {
		if (err)
			new MongoError(err).log();

		cb(err, results && results.length ? results[0] : null);
	});
}

function getUsedDomainsBySegments(segments, domain, cb) {
	let diskIDs = segments.map((segment) => { return segment.diskID; });
	let usedDomains = [];

	async.each(diskIDs, (diskID, callback) => {
		getDiskProtectionIdentifierByDomain(diskID, domain, (err, results) => {
			if (err)
				return callback(err);
			if (results)
				usedDomains.push(results._id);
			callback();
		});
	}, (err) => {
		cb(err, usedDomains);
	});
}

function subtituteDiskSegment(volume, chunk, pRaid, diskSegment, cb) {
	logger.sysDEBUG('Substituting volume segment ' + diskSegment.uuid + ' on volume ' + volume._id);

	var diskSegmentBlocks = (diskSegment.lbe - diskSegment.lbs) + 1;

	function createRAIDSegment(disk) {
		var segUUID = uuid.v1();
		var segment = {
			_id: segUUID,
			uuid: segUUID,
			diskID: disk.disks.diskID,
			diskUUID: disk.disks.uuid,
			diskFormatRequestCounter: disk.disks.formatRequestCounter,
			nodeUUID: disk.uuid,
			node_id: disk.node_id,
			volumeName: diskSegment.volumeName,
			volumeUUID: diskSegment.volumeUUID,
			allocationIndex: diskSegment.allocationIndex,
			pRaidIndex: diskSegment.pRaidIndex,
			pRaidUUID: diskSegment.pRaidUUID,
			lbs: disk.disks.largestSegmentAvailable.lbs,
			lbe: disk.disks.largestSegmentAvailable.lbs + (diskSegment.lbe - diskSegment.lbs),
			fromReserved: disk.disks.largestSegmentAvailable.fromReserved,
			type: diskSegment.type,
			pRaidTypeIndex: diskSegment.pRaidTypeIndex,
			status: volume.isReserved ? consts.diskSegmentStatuses.NORMAL : consts.diskSegmentStatuses.MARKED_FOR_REBUILD,
			zone: disk.disks.zone,
			redundancyRatio: scope.getRedundancyToTotalRatio(volume)
		};

		if (segment.fromReserved)
			segment.reservedUUID = disk.disks.largestSegmentAvailable.uuid;

		if (volume.isReserved) {
			segment.isReserved = true;
			segment._id = diskSegment.id;
			segment.uuid = diskSegment.uuid;
		}

		return segment;
	}

	function getDisksCallback(err, disks) {
		if (!disks || !disks.length)
			return cb(null, null);

		var disk = disks[0];
		var segment = createRAIDSegment(disk);

		addAndSaveSegmentOnDisk(disk.disks, segment, function(err, diskSegment) {
			return cb(err, diskSegment);
		});
	}

	function getDisksThatWeShouldNotUseForReplacement(pRaid) {
		return pRaid.diskSegments.filter(function(segment) {
			return segment._id !== diskSegment._id;
		});
	}

	function getSubtitutionDisk() {
		let identifiersInUse = [];

		async.series([
			(callback) => {
				if (!volume.domain)
					return callback();

				getUsedDomainsBySegments(getDisksThatWeShouldNotUseForReplacement(pRaid), volume.domain, (err, results) => {
					if (err)
						return callback(err);
					identifiersInUse = results;
					callback();
				});
			},
			(callback) => {
				getDiskAndServerMatchByVolume(volume, null, identifiersInUse, function(diskMatch, nodeMatch) {
					scope.appendPropertyOrObject(diskMatch, 'disks.largestSegmentAvailable.blocks', '$gte', diskSegmentBlocks);

					function getNodesThatWeShouldNotUseForReplacement(pRaid) {
						const protectionLevel = scope.getEffectiveProtectionLevel(volume);

						if (protectionLevel === consts.separationTypes.IGNORE)
							return [];

						const nodeIDs = pRaid.diskSegments
							.filter(segment => segment._id !== diskSegment._id)
							.map(segment => segment.node_id);

						if (protectionLevel === consts.separationTypes.FULL)
							return nodeIDs;

						const nodesWeShouldNotUse = [];
						const nodesReferenceCount = {};

						for (const id of nodeIDs) {
							if (!nodesReferenceCount[id])
								nodesReferenceCount[id] = 0;

							nodesReferenceCount[id]++;
						}

						const maxPerNode = consts.erasureCodedRaidLevels.includes(volume.RAIDLevel)
							? volume.parityBlocks
							: volume.numberOfMirrors;

						for (const key in nodesReferenceCount) {
							if (nodesReferenceCount[key] >= maxPerNode)
								nodesWeShouldNotUse.push(key);
						}

						return nodesWeShouldNotUse;
					}

					function seriesCallback(err, disks) {
						callback();
						getDisksCallback(err, disks);
					}

					var $nin;

					//Use only the same zone for replacement.
					nodeMatch.zone = diskSegment.zone;

					//Get disks for every RAIDLevel
					switch (volume.RAIDLevel) {
						case consts.RAIDLevel.CONCATENATED:
							getDisksForRAID0(nodeMatch, diskMatch, 1, true, seriesCallback);
							break;
						case consts.RAIDLevel.STRIPED_RAID_0:
							//Don't use disks that are already being used by the volume.
							$nin = getDisksAlreadyInUseByTheChunk(chunk, null, 'diskID');
							scope.appendPropertyOrObject(diskMatch, 'disks.diskID', '$nin', $nin);

							getDisksForRAID0(nodeMatch, diskMatch, 1, true, seriesCallback);
							break;
						case consts.RAIDLevel.MIRRORED_RAID_1:
							//Avoid all the nodes that are already in use by the pRaid
							$nin = getNodesThatWeShouldNotUseForReplacement(pRaid);
							scope.appendPropertyOrObject(nodeMatch, 'node_id', '$nin', $nin);

							getDisksForRAID0(nodeMatch, diskMatch, 1, true, seriesCallback);
							break;
						case consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10:
							var remapType = getRemapSegmentType(pRaid);

							if (!remapType || remapType === consts.segmentTypes.DATA) {
								var $ninDisks = getDisksAlreadyInUseByTheChunk(chunk, consts.segmentTypes.DATA, 'diskID');
								scope.appendPropertyOrObject(diskMatch, 'disks.diskID', '$nin', $ninDisks);
							}

							var $ninNodes = getNodesThatWeShouldNotUseForReplacement(pRaid);
							scope.appendPropertyOrObject(nodeMatch, 'node_id', '$nin', $ninNodes);

							getDisksForRAID0(nodeMatch, diskMatch, 1, true, seriesCallback);
							break;
						case consts.RAIDLevel.ERASURE_CODING:
						case consts.RAIDLevel.STRIPED_ERASURE_CODING:
							scope.appendPropertyOrObject(diskMatch, 'disks.metadata_size', '$ne', 0);

							$ninDisks = getDisksAlreadyInUseByTheChunk(chunk, consts.segmentTypes.DATA, 'diskID');
							scope.appendPropertyOrObject(diskMatch, 'disks.diskID', '$nin', $ninDisks);

							if (volume.protectionLevel === consts.separationTypes.FULL || volume.protectionLevel === consts.separationTypes.MINIMAL) {
								$ninNodes = getNodesThatWeShouldNotUseForReplacement(pRaid);
								scope.appendPropertyOrObject(nodeMatch, 'node_id', '$nin', $ninNodes);
							}

							getDisksForRAID0(nodeMatch, diskMatch, 1, true, seriesCallback);

							break;
					}
				});
			}
		]);
	}

	if (diskSegment.fromReserved && diskSegment.reservedUUID) {
		return getDiskByReservedUUID(diskSegment, function(err, disk) {
			if (!disk)
				return getSubtitutionDisk();

			var availableReserved = scope.getReservedSegments(disk.disks, volume.VPG);
			var largestSegment = availableReserved.sort(function(a, b) { return scope.getCapacityBySegment(b) - scope.getCapacityBySegment(a); })[0];

			if (largestSegment) {
				disk.disks.largestSegmentAvailable = largestSegment;
				var delta = largestSegment.lbe - largestSegment.lbs;
				disk.disks.largestSegmentAvailable.blocks = delta === 0 ? delta : delta + 1;
				disk.disks.largestSegmentAvailable.fromReserved = true;

				return updateDiskSegmentReservedState(diskSegment, function() {
					getDisksCallback(null, [disk]);
				});
			}

			getSubtitutionDisk();
		});
	}

	getSubtitutionDisk();
}

function getRemapSegmentType(pRaid) {
	var type;

	pRaid.diskSegments.forEach(function(segment) {
		if (segment.status === consts.diskSegmentStatuses.REMAP)
			type = segment.type;
	});

	return type;
}

scope.appendPropertyOrObject = (object, parentKey, key, value) => {
	if (!object[parentKey])
		object[parentKey] = {};

	if (!object[parentKey][key])
		return object[parentKey][key] = value;

	//Value already presented
	if (object[parentKey][key] === value)
		return;

	if (Array.isArray(object[parentKey][key]))
		object[parentKey][key] = scope.uniqueUnion([object[parentKey][key], value]);
};

function getDisksAlreadyInUseByTheChunk(chunk, segmentType, projection) {
	let disks = [];

	chunk.pRaids.forEach((pRaid) => {
		pRaid.diskSegments.forEach((diskSegment) => {
			if (!segmentType || segmentType === diskSegment.type)
				disks.push(projection ? diskSegment[projection] : diskSegment);
		});
	});

	return disks;
}

function getPRaidBySegmentId(chunk, segmentId) {
	var segmentPRaid = null;

	chunk.pRaids.forEach(function(pRaid) {
		pRaid.diskSegments.forEach(function(segment) {
			if (segment._id === segmentId)
				segmentPRaid = pRaid;
		});
	});

	return segmentPRaid;
}

function getDiskByReservedUUID(segment, cb) {
	var db = app.get('db');
	var serverCollection = db.collection('server');

	var nodeMatch = segment.node_id ? { _id: segment.node_id } : {};

	serverCollection.aggregate([
		{ $match: nodeMatch },
		{ $unwind: '$disks' },
		{ $match: { 'disks.diskSegments.uuid': segment.reservedUUID, 'disks.diskID': { $ne: segment.diskID } } }
	]).toArray(function(err, results) {
		if (err)
			new MongoError(err).log();

		if (!results || !results.length)
			return cb('Disk not found!');

		cb(null, results[0]);
	});
}

function getDiskByUUID(uuid, cb) {
	var db = app.get('db');
	var serverCollection = db.collection('server');

	serverCollection.aggregate([
		{ $unwind: '$disks' },
		{ $match: { 'disks.uuid': uuid } }
	]).toArray(function(err, results) {
		if (err)
			new MongoError(err).log();

		if (!results || !results.length)
			return cb('Disk not found!');

		cb(null, results[0].disks);
	});
}

function removeSegmentFromDiskByDiskUUID(segment, diskUUID, cb) {
	var db = app.get('db');
	var serverCollection = db.collection('server');

	getDiskByUUID(diskUUID, function(err, disk) {
		if (err)
			return cb(err);

		disk.diskSegments = disk.diskSegments.filter(function(s) { return s.uuid !== segment.uuid; });

		var updateObj = { $set: { 'disks.$.diskSegments': disk.diskSegments } };
		var newLargestSegment = scope.getLargestSegment(disk);
		var delta = segment.lbe - segment.lbs;

		if (delta)
			updateObj.$inc = { 'disks.$.availableBlocks': delta + 1 };

		updateObj.$set['disks.$.largestSegmentAvailable'] = newLargestSegment;

		serverCollection.updateOne({ 'disks.uuid': segment.diskUUID }, updateObj, function(err) {
			if (err)
				new MongoError(err).log();

			cb(err);
		});
	});
}

//By default will return success false to all volumes, the only case that the success is set to true is when at least 1 segment was replaced.
scope.startVolumesRebuild = function(volumes, user, lockedZones, callback, messages = []) {
	async.eachSeries(volumes, function(volume, eachVolumeCB) {
		scope.startSingleVolumeRebuild(volume, user, lockedZones, message => {
			messages.push(message);
			eachVolumeCB();
		});
	}, function() {
		if (callback)
			callback(messages);
	});
};

scope.startSingleVolumeRebuild = function(volume, user, alreadyLockedZones, callback) {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');

	let lockedZones = new Set();
	var savedVol = null;
	var chunks = zoneModule.getAllVolumeChunks(volume);

	if (!chunks || !chunks.length)
		return callback(new SystemAdminMessage(systemMessages.VOLUME_FAILED_TO_REBUILD).addInfo(Entities.Error, 'No chunks found'));

	async.series([
		function takeLockIfNeeded(cb) {
			if (alreadyLockedZones && alreadyLockedZones.size) {
				var volumeZones = zoneModule.getZonesByVolume(volume);

				const unmatchedZonesLockedError = new SystemMessage(systemMessages.UNMATCHED_ZONES_LOCKED_ON_VOLUME_REBUILD)
					.addInfo(Entities.Volume.ID, volume._id)
					.addInfo(Entities.Error, 'Already Locked zones: ' + Array.from(alreadyLockedZones) + ' volume zones: ' + Array.from(volumeZones));

				//kill the process in case we found a difference between the zone set that were already locked to the ones we inted to lock
				zoneModule.enforceLockedZoneSetEqualtyOrExit(alreadyLockedZones, volumeZones, unmatchedZonesLockedError);
				return cb();
			}

			// we should lock the volume zones ourselves
			lockModule.acquireLockByVolume(volume, (err, zones) => {
				lockedZones = zones;
				cb(err);
			});
		},
		function doStuff(cb) {
			async.eachSeries(chunks, function(chunk, eachChunkCB) {
				async.eachSeries(chunk.pRaids, function(pRaid, eachPraidCB) {
					var segmentsToRemap = pRaid.diskSegments.filter(function(segment) { return segment.status === consts.diskSegmentStatuses.REMAP; });

					if (!segmentsToRemap.length)
						return eachPraidCB();

					async.eachSeries(segmentsToRemap, function(segment, callback) {

						let newDiskSegment;
						let segmentPRaid;

						async.series([
							function doSubstitution(callback) {
								subtituteDiskSegment(volume, chunk, pRaid, segment, (err, resNewDiskSegment) => {
									newDiskSegment = resNewDiskSegment;

									if (err)
										return callback(err);

									if (!newDiskSegment)
										return callback('Couldn\'t remap some of the disk segments, not enough eligible resources');

									segmentPRaid = getPRaidBySegmentId(chunk, segment._id);
									if (!segmentPRaid)
										return callback('Couldn\'t find the remap segment PRaid');

									callback();
								});
							},
							function markForRebuild(callback) {
								//If this is VPG that we rebuilding, no need to wait for TOMA deprecation message, we can just drop it.
								if (volume.isReserved) {
									segmentPRaid.diskSegments = segmentPRaid.diskSegments.filter(function(s) { return s.uuid !== segment.uuid; });
									//Copy the old reserved segment uuid, so we'll be able to find it.
									newDiskSegment.uuid = segment.uuid;
									newDiskSegment.isReserved = true;

									return removeSegmentFromDiskByDiskUUID(segment, segment.diskUUID, callback);
								} else {
									//Marked the old one as marked for rebuild (instead of remap).
									logger.sysVERBOSE('diskSegments', 'setting MARKED_FOR_REBUILD_OLD for segment id: ' + segment.uuid);
									segment.status = consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD;
									return callback();
								}
							},
							function updateVolume(callback) {
								segmentPRaid.diskSegments.push(newDiskSegment);

								volume.action = consts.volumeActions.MARKED_FOR_REBUILD;
								volume.health = consts.targetHealth.ALARM;
								volume.version += 1;

								//It's ok to set the lastVersionSentToTomaViaKafka before the message are actually sent, because
								//we're looking for the action in sanityAndRecover and
								volume.lastVersionSentToTomaViaKafka = volume.version;
								volume.modifiedBy = user;
								volume.dateModified = new Date();

								volumeCollection.findOneAndUpdate(
									{ _id: volume._id },
									{ $set: volume },
									{ projection: scope.volumeProjection, returnDocument: consts.mongoReturnDocument.AFTER },
									function(err, result) {
										if (err)
											new MongoError(err).log();

										events.emitEvent([events.getVolumeID(volume.name)], objectNotifier.events.volumeStatusChangeEvent, volume);
										events.emitEvent([events.getVolumeID(volume.name)], objectNotifier.events.volumeActionChangeEvent, volume);

										savedVol = result;
										callback();
									}
								);
							}
						], err => {
							callback(err);
						});
					}, eachPraidCB);
				}, eachChunkCB);
			}, cb);
		}
	], err => {
		if (lockedZones.size)
			lockModule.releaseLockByZones(lockedZones);

		let systemAdminMessage = (new SystemAdminMessage(err ? systemMessages.VOLUME_FAILED_TO_REBUILD : systemMessages.VOLUME_MARKED_FOR_REBUILD))
			.addInfo(Entities.Volume.ID, volume.name)
			.addInfo(Entities.Volume.UUID, volume.uuid);


		if (err) {
			systemAdminMessage.addInfo(Entities.Error, err);
			logger.sysDEBUG('Volume ' + volume.name + ' failed to start rebuild, err: ' + err);
		} else if (savedVol) {
			logModule.acknowledgeByQuery({ 'meta.id': volume.name, 'meta.header': 'Rebuild Required' }, user);
			events.emitEvent([events.getVolumeID(volume.name)], objectNotifier.events.volumeRemapEvent, savedVol);
		}

		callback(systemAdminMessage);
	});
};

//This function just convert the volumeIds to volumes.
scope.startVolumeRebuildByIdsAndUUIDs = function(volumes, user, callback) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	const messages = [];

	volumeCollection.find({
		$or: [
			{ $or: volumes.map(v => ({ $and: [{ _id: v._id }, { uuid: v.uuid }] })) },
			{ isReserved: true, action: consts.volumeActions.REBUILD_REQUIRED }
		]
	}).toArray(function(err, results) {
		if (results.length === 0) {
			const errMsg = 'There are no such volumes in the system';
			messages.push(new SystemAdminMessage(new SystemAdminMessage(systemMessages.VOLUME_FAILED_TO_REBUILD).addInfo(Entities.Error, errMsg)));
			callback(messages);
		} else {
			scope.saveLogsForNonExistingVolumes(volumes, results, messages);
			//Sort the volumes so the VPG will be rebuilt first.
			results = results.sort(function(a, b) { return b.isReserved; });
			scope.startVolumesRebuild(results, user, null, callback, messages);
		}
	});
};

scope.saveLogsForNonExistingVolumes = function(volumes, results, logs) {
	var resultsIds = scope.getCollectionSetByKey(results, volume => volume._id);
	volumes.forEach(requestVolume => {
		if (!resultsIds.has(requestVolume._id)) {
			const errMsg = `There is no such volumes in the system: ${requestVolume._id}`;
			logs.push(new SystemAdminMessage(new SystemAdminMessage(systemMessages.VOLUME_FAILED_TO_REBUILD)
				.addInfo(Entities.Volume.ID, requestVolume._id)
				.addInfo(Entities.Volume.UUID, requestVolume.uuid)
				.addInfo(Entities.Error, errMsg)));
		}
	});
};

scope.startVolumeRebuildByDiskClasses = function(diskClasses, user) {
	diskClasses.forEach(function(diskClass) {
		scope.getVolumesAffectedDiskClass(diskClass, null, function(err, results) {
			scope.startVolumesRebuild(results, user, null);
		});
	});
};

scope.startVolumeRebuildByServerClasses = function(serverClasses, user) {
	serverClasses.forEach(function(serverClass) {
		scope.getVolumesAffectedServerClass(serverClass, null, function(err, results) {
			scope.startVolumesRebuild(results, user, null);
		});
	});
};

scope.startVolumeRebuildForAllRelevantVolumes = function(user) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	volumeCollection.find({
		'chunks.pRaids.diskSegments.status': consts.diskSegmentStatuses.REMAP
	}).toArray(function(err, results) {
		if (err)
			return new MongoError(err).log();

		scope.startVolumesRebuild(results, user, null);
	});
};

//ill return all the volumes that were allocated with this diskClass AND are using disk from the diskClass.
scope.getVolumesAffectedDiskClass = function(diskClass, diskIDsToMatch, callback) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');
	var diskIDs = [];

	if (diskIDsToMatch && diskIDsToMatch.length) {
		diskIDs = diskIDsToMatch;
	} else {
		diskClass.disks.forEach(function(disk) {
			diskIDs.push(disk.diskID);
		});
	}

	volumeCollection.find({
		diskClasses: { $in: [diskClass._id] },
		chunks: {
			$elemMatch: {
				diskSegments: {
					$elemMatch: {
						diskID: { $in: diskIDs }
					}
				}
			}
		}
	}).toArray(function(err, results) {
		if (err)
			err = new MongoError(err).log();

		callback(err, results);
	});
};

//ill return all the volumes that were allocated with this serverClass AND are using server from the serverClass.
scope.getVolumesAffectedServerClass = function(serverClass, serverIDsToMatch, callback) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');
	var serverIDs = [];

	if (serverIDsToMatch && serverIDsToMatch.length)
		serverIDs = serverIDsToMatch;
	else
		serverIDs = serverClass.targetNodes;

	volumeCollection.find({
		serverClasses: { $in: [serverClass._id] },
		chunks: {
			$elemMatch: {
				diskSegments: {
					$elemMatch: {
						node_id: { $in: serverIDs }
					}
				}
			}
		}
	}).toArray(function(err, results) {
		if (err)
			err = new MongoError(err).log();

		callback(err, results);
	});
};

scope.deleteLeftoverBlockDevicesOfVolume = function(volName, volUUID, callback) {
	var db = app.get('db');
	var clientCollection = db.collection('client');

	//removing both the original block_device by uuid and the leftover recovery attaches if were by name using prefix with [
	clientCollection.updateMany(
		{},
		{ $pull: { block_devices: { $or: [{ uuid: volUUID }, { name: { $regex: `^${volName}\\[` } }] } } },
		function(err, results) {
			if (err)
				new MongoError(err).log();

			if (callback)
				callback(err, results);
		});
};

scope.addObjectsToVolumeLimiter = function(designatedClassFieldName, designatedClassId, objectsToAdd, limitByFieldName, callback) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');
	var searchQuery = {};
	var setQuery = {};

	searchQuery[designatedClassFieldName] = { $in: [designatedClassId] };
	setQuery[limitByFieldName] = { $each: objectsToAdd };

	volumeCollection.updateMany(searchQuery, { $addToSet: setQuery }, function(err, results) {
		if (err)
			new MongoError(err).log();

		if (callback)
			callback(err, results);
	});
};

scope.deleteDisksFromVolumeLimiter = function(diskClass, diskClassDisks, disksGoingToBeRemoved, cb) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	volumeCollection.find({ diskClasses: { $in: [diskClass._id] } }).toArray(function(err, volumes) {
		if (err)
			new MongoError(err).log();

		async.eachSeries(volumes, function(volume, callback) {
			//Remove the current diskClass from the array.
			//This is only needed when removing the whole diskclass
			const classes = volume.diskClasses.filter(d => d !== diskClass._id).map(d => ({ _id: d }));
			scope.getDisksByDiskClass(classes, null, null, function(err, results) {
				if (err) {
					logger.sysDEBUG(err);
					return callback(err);
				}

				//Get all the diskClass disk that aren't going to be removed.
				volume.limitByDisks = results.map(function(e) { return e._id; });
				//Add all the other disks this diskClass has.
				volume.limitByDisks = scope.uniqueUnion([
					volume.limitByDisks,
					diskClassDisks.filter(function(e) { return disksGoingToBeRemoved.indexOf(e) === -1; })
				]);

				volumeCollection.updateOne(
					{ _id: volume._id },
					{ $set: { diskClasses: volume.diskClasses, limitByDisks: volume.limitByDisks } },
					function(err) {
						if (err)
							err = new MongoError(err).log();

						callback(err);
					});

			});
		}, function(err) {
			if (cb)
				cb(err);
		});
	});
};

scope.deleteServersFromVolumeLimiter = function(serverClass, serverClassServers, serversGoingToBeRemoved, cb) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	volumeCollection.find({ serverClasses: { $in: [serverClass._id] } }).toArray(function(err, volumes) {
		if (err)
			new MongoError(err).log();

		if (volumes && volumes.length)
			logger.sysDEBUG('Affected Volumes', volumes);

		async.eachSeries(volumes, function(volume, callback) {
			//Remove the current diskClass from the array.
			//This is only needed when removing the whole diskclass
			const classes = volume.serverClasses.filter(s => s !== serverClass._id).map(s => ({ _id: s }));
			scope.getServersByServerClass(classes, null, null, function(err, results) {
				if (err) {
					logger.sysDEBUG(err);
					return callback(err);
				}

				//Get all the serverClass server that aren't going to be removed.
				volume.limitByNodes = results.map(function(e) { return e.serverID; });
				//Add all the other servers this serverClass has.
				volume.limitByNodes = scope.uniqueUnion([
					volume.limitByNodes,
					serverClassServers.filter(function(e) {
						return serversGoingToBeRemoved.indexOf(e) === -1;
					})
				]);

				volumeCollection.updateOne(
					{ _id: volume._id },
					{ $set: { serverClasses: volume.serverClasses, limitByNodes: volume.limitByNodes } },
					function(err) {
						if (err)
							err = new MongoError(err).log();

						callback(err);
					}
				);

			});
		}, cb);
	});
};

scope.authenticate = function(email, password, cb) {
	if (!email)
		return cb(null, null);

	isValidUser(email, password, null, cb);
};

scope.authenticateClientCert = (clientCert, cb) => {
	const db = app.get('db');
	const userCollection = db.collection('user');

	scope.getAuthenticationEmail(clientCert.subject.OU, authenticationEmail => {
		const query = { email: authenticationEmail.toLowerCase() };

		userCollection.findOne(query, (err, user) => {
			if (err)
				new MongoError(err).log();

			cb(err, user);
		});
	});
};

scope.isAdminPassword = function(email, password, cb) {
	isValidUser(email, password, consts.userRoles.ADMIN, cb);
};

scope.isEmailValid = (email, cb) => {
	const db = app.get('db');
	const userCollection = db.collection('user');

	userCollection.findOne({ email: email }, (err, user) => {
		if (err)
			logger.sysERROR(new MongoError(err));

		cb(err, user);
	});
};

function isValidUser(email, password, role, cb) {
	var db = app.get('db');
	var userCollection = db.collection('user');
	var query = {};

	if (email)
		query.email = email.toLowerCase();

	if (password)
		query.password = scope.getHash(password);

	if (role)
		query.role = role;

	userCollection.findOne(query, function(err, user) {
		if (err)
			new MongoError(err).log();

		cb(err, user);
	});
}

scope.getHash = function(str) {
	return crypto.createHmac('sha512', '-x(}6$@Am\'?:VSpk').update(str).digest('hex');
};

scope.getVolumeVersionsSumByVolumeUUIDs = function(uuids, cb) {
	var volumesInfo = [];

	objectNotifier.getObject(objectNotifier.events.volumesVersionsChangeEvent.name, (err, volumesVersions) => {
		if (volumesVersions)
			async.eachSeries(uuids, (uuid, eachCB) => {
				if (!volumesVersions[uuid]) {
					logger.sysDEBUG(`The volume uuid ${uuid} is missing in cache! updating the cache`);
					volumeModule.fetchVolumeVersionByUUID(uuid, (err, version) => {
						if (err)
							logger.sysDEBUG(`Failed to fetch volume version for uuid ${uuid}`);
						else {
							volumesVersions[uuid] = version;
							volumesInfo.push({
								uuid: uuid,
								version: volumesVersions[uuid]
							});
						}
						eachCB();
					});

				} else {
					volumesInfo.push({
						uuid: uuid,
						version: volumesVersions[uuid]
					});
					eachCB();
				}
			}, () => {
				let volumeVersionsSum = 0;
				volumesInfo.forEach(vol => volumeVersionsSum += vol.version);
				cb(volumeVersionsSum);
			});
	});
};

scope.getZoneConfiguration = function(zone, cb) {
	var db = app.get('db');
	var version = db.collection('configurationVersion');

	if (!zone)
		return cb({ configurationVersion: 1 });

	version.find({ _id: zone }).toArray(function(err, result) {
		var data;
		if (err)
			new MongoError(err).log();

		if (result && result.length)
			data = result[0];

		cb(data);
	});
};

// Returns all free ranges within [startRange, endRange) given a list of used segments.
function getAllFreeRanges(segments, startRange, endRange) {
	let freeRanges = [];
	let cursor = startRange;

	if (segments && segments.length) {
		segments.sort((a, b) => a.lbs - b.lbs).forEach(segment => {
			if (segment.lbs > cursor)
				freeRanges.push({ lbs: cursor, lbe: segment.lbs - 1 });

			if (segment.lbe + 1 > cursor)
				cursor = segment.lbe + 1;
		});
	}

	if (cursor < endRange)
		freeRanges.push({ lbs: cursor, lbe: endRange - 1 });

	return freeRanges;
}

function getLargestRangeAndTotalAvailableSpace(disk, startRange, endRange) {
	const freeRanges = getAllFreeRanges(disk.diskSegments, startRange, endRange);

	let lbs = startRange;
	let lbe = startRange - 1;
	let totalAvailableSpace = 0;
	let maxVal = 0;

	freeRanges.forEach(range => {
		const blocks = range.lbe - range.lbs + 1;
		totalAvailableSpace += blocks;

		if (blocks >= maxVal) {
			maxVal = blocks;
			lbs = range.lbs;
			lbe = range.lbe;
		}
	});

	return { start: lbs, end: lbe, totalAvailableSpace: totalAvailableSpace };
}

//Returns the total available blocks of a disk.
scope.calculateAvailableSpace = function(disk) {
	var GLOBAL_SETTINGS = app.get('globalSettings');
	var minValSegment;
	var maxValSegment;

	if (disk.GPT) {
		minValSegment = disk.GPT.firstUsableLba;
		maxValSegment = disk.GPT.lastUsableLba + 1;
	} else {
		minValSegment = Math.ceil(GLOBAL_SETTINGS.RESERVED_BLOCKS / 100 * disk.usableBlocks / consts.BLOCK_SET_SIZE)
			* consts.BLOCK_SET_SIZE + consts.RESERVED_GPT_BLOCKS;
		maxValSegment = scope.getAvailableSpace(disk) + consts.RESERVED_GPT_BLOCKS;
	}

	var result = getLargestRangeAndTotalAvailableSpace(disk, minValSegment, maxValSegment);

	return result.totalAvailableSpace;
};

//Returns the largest segment available in the disk.
scope.getLargestSegment = function(disk) {
	var GLOBAL_SETTINGS = app.get('globalSettings');
	var minValSegment;
	var maxValSegment;

	if (disk.GPT) {
		minValSegment = disk.GPT.firstUsableLba;
		maxValSegment = disk.GPT.lastUsableLba + 1;
	} else {
		maxValSegment = scope.getAvailableSpace(disk) + consts.RESERVED_GPT_BLOCKS;
		minValSegment = Math.ceil(GLOBAL_SETTINGS.RESERVED_BLOCKS / 100 * disk.usableBlocks / consts.BLOCK_SET_SIZE) *
			consts.BLOCK_SET_SIZE + consts.RESERVED_GPT_BLOCKS;
	}

	var segment = getLargestRangeAndTotalAvailableSpace(disk, minValSegment, maxValSegment);

	var result = {
		lbs: segment.start,
		lbe: segment.end,
		blocks: segment.end - segment.start + 1
	};

	//Will happen only when the disk segments take exactly all the space.
	if (result.lbe <= result.lbs) {
		result.lbe = 0;
		result.lbs = 0;
	}

	return result;
};

scope.getDate = function(date) {
	return date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + date.getDate();
};

scope.getHoursWithDays = function(hours) {
	var results = {};
	var date = new Date();
	for (var i = 1; i < hours + 1; i++) {
		date.setHours(date.getHours() + (i == 1 ? 0 : - 1));

		var formattedDate = scope.getDate(date);

		if (!results[formattedDate])
			results[formattedDate] = [];

		results[formattedDate].push(date.getHours());
	}

	return results;
};

scope.updateCollection = function(obj, collectionName, isMongoID, callback) {
	var db = app.get('db');
	var collection = db.collection(collectionName);

	var results = {};

	if (obj && obj.length) {
		async.each(obj, function(obj, callback) {
			var ID = isMongoID ? new ObjectId(obj._id) : obj._id;
			obj = setUpdateOperators(obj);

			collection.updateOne({ _id: ID }, obj, function(err, res) {
				if (err)
					new MongoError(err).log();

				results[ID] = { err: err, results: res };

				callback();
			});
		}, function(err) {
			callback(err, results);
		});
	} else
		callback();
};

scope.updateCollectionWithQuery = function(query, obj, collectionName, isMongoID, callback) {
	var db = app.get('db');
	var collection = db.collection(collectionName);

	var results = {};

	if (obj && obj.length) {
		async.each(obj, function(obj, callback) {
			query._id = isMongoID ? new ObjectId(obj._id) : obj._id;
			obj = setUpdateOperators(obj);

			collection.updateOne(query, obj, function(err, res) {
				results[query._id] = { err: err, results: res };

				callback();
			});
		}, function(err) {
			callback(err, results);
		});
	} else
		callback();
};

//Create $set operator foreach key/value in the object. (so we won't lose the original document on update.)
function setUpdateOperators(obj) {
	var $update = { $set: {} };

	for (var key in obj) {
		if (key !== '_id')
			$update.$set[key] = obj[key];
	}

	return $update;
}
scope.setUpdateOperators = setUpdateOperators;

scope.deleteFromCollectionByQuery = function(query, collectionName, callback) {
	var db = app.get('db');
	var collection = db.collection(collectionName);

	collection.deleteMany(query, (err, results) => {
		if (err)
			err = new MongoError(err).log();

		callback(err, results);
	});
};

scope.deleteFromCollection = function(obj, collectionName, isMongoID, callback) {
	var db = app.get('db');
	var collection = db.collection(collectionName);

	if (obj && obj.length) {
		var objIds = obj.map(function(o) { return isMongoID ? new ObjectId(o._id) : o._id; });

		collection.deleteMany({ _id: { $in: objIds } }, function(err, results) {
			if (err)
				err = new MongoError(err).log();

			callback(err, results);
		});
	} else {
		callback(null, { n: 0 });
	}
};

scope.insertToCollection = function(obj, collectionName, callback) {
	var db = app.get('db');
	var collection = db.collection(collectionName);

	collection.insertOne(obj, function(err, results) {
		if (err)
			err = new MongoError(err).log();

		callback(err, results);
	});
};

scope.loadCollection = function(collectionName, query, callback, isMongoID = false) {
	var db = app.get('db');
	var collection = db.collection(collectionName);

	var options = {};

	function convertObjectId(IDObj) {
		const isObjectId = v => typeof v === 'string' && ObjectId.isValid(v);

		if (isObjectId(IDObj))
			return new ObjectId(IDObj);

		for (const key in IDObj) {
			const value = IDObj[key];
			if (isObjectId(value))
				IDObj[key] = new ObjectId(value);
			else if (typeof value === 'object')
				convertObjectId(value);
			else if (value.isArray())
				if (value.every(element => isObjectId(element)))
					IDObj[key] = value.map(element => new ObjectId(element));
				else if (value.every(element => typeof element === 'object'))
					value.forEach(element => { convertObjectId(element); });
		}

		return IDObj;
	}

	for (var key in query) {
		if (isMongoID && query[key]._id)
			query[key]._id = convertObjectId(query[key]._id);

		if (key !== 'filter')
			options[key] = query[key];
	}

	collection
		.find(query.filter)
		.sort(options.sort || null)
		.project(options.projection || null)
		.skip(options.skip || 0)
		.limit(options.limit || 0)
		.toArray((err, results) => {
			if (err)
				err = new MongoError(err).log();

			if (callback)
				callback(err, results);
		});
};

scope.getDisksByNodes = function(nodes, callback) {
	var db = app.get('db');
	var serverCollection = db.collection('server');
	var servers = nodes;
	var pipeline = [];
	var hasServers = servers && servers.length;

	if (hasServers)
		pipeline.push({ $match: { _id: { $in: servers.map(function(e) { return e.serverID; }) } } });

	pipeline.push({ $unwind: '$disks' });
	pipeline.push({
		$project: {
			node_id: '$node_id',
			_id: '$disks.diskID',
			largestSegmentAvailable: '$disks.largestSegmentAvailable.blocks',
			status: '$disks.status'
		}
	});

	serverCollection.aggregate(pipeline).toArray(function(err, results) {
		if (err)
			err = new MongoError(err).log();

		callback(err, results.map(function(e) {
			var obj = {
				node_id: e.node_id,
				_id: e._id,
				largestSegmentAvailable: e.largestSegmentAvailable,
				status: e.status
			};

			if (hasServers)
				obj.domain = servers.filter(function(n) { return n.serverID === e.node_id; })[0].domain;

			return obj;
		}));
	});
};

/**
 * Constructs a MongoDB query for serverClass and diskClass collections
 * based on provided classes, domain, and excluded identifiers.
 *
 * @param {Array<Object>} classes - An array of objects describing classes.
 *                                  Each object must contain `_id` or both `_id` and `uuid`.
 * @param {Array<string>} [domain] - An array of strings representing domain scopes to filter by.
 * @param {Array<string>} [identifiersToExclude] - An array of string identifiers to exclude from the query.
 * @returns {Object} A MongoDB query object for filtering serverClass and diskClass collections.
 */
function getQueryByClassesAndDomains(classes, domain, identifiersToExclude) {
	// make sure we return nothing when no classes and domain are passed
	if (!classes?.length && !domain?.length)
		return { _id: null };

	const $query = {};

	if (classes?.length)
		$query.$or = classes;

	if (domain?.length) {
		const $elemMatch = { scope: domain };

		if (identifiersToExclude?.length)
			$elemMatch.identifier = { $nin: identifiersToExclude };

		$query.domains = { $elemMatch };
	}

	return $query;
}

scope.getDisksByDiskClass = function(classes, domain, identifiersToExclude, callback) {
	var db = app.get('db');
	var diskClassCollection = db.collection('diskClass');

	var $query = getQueryByClassesAndDomains(classes, domain, identifiersToExclude);

	diskClassCollection.find($query).project({ _id: 0, disks: 1, domains: 1 }).toArray(function(err, results) {
		if (err)
			err = new MongoError(err).log();

		//Get unique disks.
		var disks = [];
		results.forEach(function(e) {
			e.disks.forEach(function(disk) {
				if (disks.map(function(e) { return e.diskID; }).indexOf(disk.diskID) === -1) {
					if (e.domains && e.domains.length)
						disk.domain = e.domains.filter(function(d) { return d.scope === domain; })[0];

					disk._id = disk.diskID;
					disks.push(disk);
				}
			});
		});
		callback(err, disks);
	});
};

scope.getServersByServerClass = function(classes, domain, identifiersToExclude, callback) {
	var db = app.get('db');
	var serverClassCollection = db.collection('serverClass');

	var $query = getQueryByClassesAndDomains(classes, domain, identifiersToExclude);

	//Get all the servers
	serverClassCollection.find($query).project({ _id: 0, targetNodes: 1, domains: 1 }).toArray(function(err, results) {
		if (err)
			err = new MongoError(err).log();

		//Get unique servers.
		var servers = [];
		results.forEach(function(e) {
			e.targetNodes.forEach(function(target) {
				if (servers.map(function(e) { return e.serverID; }).indexOf(target) == -1) {
					var server = { serverID: target };

					if (e.domains && e.domains.length)
						server.domain = e.domains.filter(function(d) { return d.scope === domain; })[0];

					servers.push(server);
				}
			});
		});

		callback(err, servers);
	});
};

scope.getDisksByServerClass = function(classes, domain, identifiersToExclude, callback) {
	scope.getServersByServerClass(classes, domain, identifiersToExclude, function(err, servers) {
		if (!servers.length)
			return callback(err, []);

		scope.getDisksByNodes(servers, function(err, data) {
			callback(err, data);
		});
	});
};

scope.asyncIterCursor = function(cursor, processFunction, callback) {
	function closeCursor(err) {
		cursor.close();
		callback(err);
	}

	function iterItem() {
		cursor.hasNext(function(err, hasNext) {
			if (hasNext)
				cursor.next(process);
			else
				closeCursor(err);
		});
	}

	function process(err, item) {
		if (err) {
			new MongoError(err).log();
			closeCursor(err);
		} else {
			processFunction(item, function(error) {
				if (error)
					return closeCursor(error);

				setTimeout(iterItem, 0);
			});
		}
	}

	iterItem();
};

function getClassesByDomain(domain, callback) {
	var db = app.get('db');
	var diskClassCollection = db.collection('diskClass');
	var serverClassCollection = db.collection('serverClass');

	var $query = { 'domains.scope': domain };
	var $projection = { _id: 1 };

	async.parallel([
		function(callback) {
			diskClassCollection.find($query).project($projection).toArray(callback);
		},
		function(callback) {
			serverClassCollection.find($query).project($projection).toArray(callback);
		}
	], function(err, results) {
		if (err) {
			new MongoError(err).log();
			return callback([], []);
		}

		var parsedResults = [];

		results.forEach(function(r) {
			parsedResults.push(r.map(function(e) { return e._id; }));
		});

		callback(parsedResults[0], parsedResults[1]);
	});
}

//Returns all the disks by server and Drive classes, disk and server classes form a logical AND and between each disk/server class logical OR
//If only one predicate is presented the classes form logical OR
scope.getDisksByClasses = function(diskClasses, serverClasses, domain, identifiersToExclude, recurse, callback) {
	var hasServerClasses = serverClasses && serverClasses.length;
	var hasDiskClasses = diskClasses && diskClasses.length;
	var doesNotHaveClasses = !hasDiskClasses && !hasServerClasses;

	if (!recurse && doesNotHaveClasses && domain) {
		getClassesByDomain(domain, function(diskClasses, serverClasses) {
			scope.getDisksByClasses(diskClasses, serverClasses, domain, identifiersToExclude, true, callback);
		});
	} else {
		async.parallel([
			function(callback) {
				if (doesNotHaveClasses) {
					scope.getDisksByNodes([], function(err, data) {
						callback(err, data);
					});

					return false;
				} else if (!hasServerClasses) {
					return callback(null, []);
				} else
					scope.getDisksByServerClass(serverClasses.map(s => ({ _id: s })), domain, identifiersToExclude, function(err, data) {
						callback(err, data);
					});
			},
			function(callback) {
				if (!hasDiskClasses)
					return callback(null, []);

				scope.getDisksByDiskClass(diskClasses.map(d => ({ _id: d })), domain, identifiersToExclude, function(err, data) {
					callback(err, data);
				});
			}
		], function(err, results) {
			if (err)
				logger.sysDEBUG(err);

			//Check if both of the classes are set, if so do logical AND.
			if (hasServerClasses && hasDiskClasses) {
				return callback(scope.intersectionByID(results[0], results[1]));
			} else {
				return callback(scope.uniqueUnion(results));
			}
		});
	}
};

scope.intersectionByID = function(arr1, arr2) {
	return arr1.filter(function(n) { return arr2.map(function(e) { return e._id; }).indexOf(n._id) != -1; });
};

scope.intersection = function(arr1, arr2) {
	return arr1.filter(function(n) { return arr2.indexOf(n) != -1; });
};

scope.uniqueUnion = function(arrays) {
	var results = [];

	arrays.forEach(function(arr) {
		(arr || []).forEach(function(e) {
			if (results.indexOf(e) === -1)
				results.push(e);
		});
	});

	return results;
};

// this function creates a volume extension but does not deletes the new temp volume
scope.createVolumeExtension = (volume, newCapacity, user, callback) => {
	var extensionVolume = scope.extend(true, extensionVolume, volume);
	delete extensionVolume._id;
	extensionVolume.isExtension = true;
	extensionVolume.capacity = volume.capacity;

	if (newCapacity == consts.volumeCapacity.MAX)
		extensionVolume.capacity = newCapacity;
	else
		extensionVolume.capacity = newCapacity - extensionVolume.capacity;

	extensionVolume.chunks = volume.chunks;

	scope.saveVolumes([extensionVolume], false, user, logs => {
		//if the volume saved correctly, migrate the chunks to the original volume and we will later delete the extension.
		if (!([systemMessages.EXTENSION_CREATED.id, systemMessages.VPG_RESERVATION_MADE.id].includes(logs[0].systemMessage.id)))
			return callback(logs[0]);

		for (var chunk of extensionVolume.chunks) {
			for (var praid of chunk.pRaids) {
				for (var segment of praid.diskSegments) {
					delete segment.isExtension;
				}
			}
		}

		callback(null, extensionVolume);
	});
};

// Update volume does not handle capacity changes, for this refer to extendVolume
scope.updateVolumes = function(volumes, user, cb) {
	let messages = [];

	async.eachSeries(volumes, (volume, cb) => {
		scope.updateVolume(volume, user, message => {
			messages.push(message);

			cb();
		});
	}, () => cb(messages));
};

scope.updateVolume = function(updateObj, user, callback) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	var dbVolume;
	var updatedVolume;
	var volumeID = updateObj._id;
	var volumeUUID = updateObj.uuid;
	var shouldIncreaseVersion;
	var $update = { $set: {} };
	var query = { _id: volumeID, uuid: volumeUUID };
	var message;

	async.series([
		function fetchTheVolume(cb) {
			//Load the original volume in order to determine the capacity delta.
			volumeCollection.findOne(query, function(err, dbVol) {
				if (err || !dbVol) {
					message = new SystemAdminMessage(systemMessages.VOLUME_UPDATE_NOT_FOUND);

					if (err)
						message.addInfo(Entities.Error, new MongoError(err).log());

				} else if (dbVol.action === consts.volumeActions.MARKED_FOR_DELETION) {
					message = new SystemAdminMessage(systemMessages.CANT_EDIT_MARKED_FOR_DELETION_VOLUME).addInfo(Entities.Volume.action, dbVol.action);
				} else if (Object.prototype.hasOwnProperty.call(updateObj, 'allowAllocationOnOfflineDrives')) {
					return scope.validateAllocationOnOfflineDrives(dbVol, updateObj, (err) => {
						if (err)
							message = err;

						dbVolume = dbVol;
						return cb(message);
					});
				} else if (dbVol.VPG && consts.updateExcludedPropertiesForVPGVolumes.some(property => property in updateObj)) {
					message = new SystemAdminMessage(systemMessages.CANT_EDIT_VOLUME_CUSTOM_PROPS_WHILE_VPG_USED).addInfo(Entities.Volume.VPG, dbVol.VPG);
				} else if ('enableCrcCheck' in updateObj && !consts.pRaidOptionsPropertiesByRaidLevel[dbVol.RAIDLevel].includes('enableCrcCheck')) {
					message = new SystemAdminMessage(systemMessages.CANT_EDIT_CRC_CHECK_FOR_RAID_LEVEL).addInfo(Entities.Volume.RAIDLevel, dbVol.RAIDLevel);
				}

				dbVolume = dbVol;
				cb(message);
			});
		},
		function validateVolumeLimitations(cb) {
			validateVolumeLimitationsAndVPGExists(updateObj, db, (limitationsStatus) => {
				for (var status of limitationsStatus)
					if (status && !status.success)
						message = new SystemAdminMessage(systemMessages.VOLUME_UPDATE_VALIDATION_FAILED)
							.addInfo(Entities.Error, getMissingLimitationError(status));

				if (message)
					return cb(true);

				cb();
			});
		},
		function compareChanges(cb) {
			if (updateObj.capacity && updateObj.capacity !== consts.volumeCapacity.NO_CHANGE && updateObj.capacity !== dbVolume.capacity) {
				message = new SystemAdminMessage(systemMessages.UPDATE_CAPACITY);

				return cb(true);
			}

			consts.updatableVolumeProperties.forEach(property => {
				if (property in updateObj)
					$update.$set[property] = updateObj[property];
			});

			if (dbVolume.VPG) {
				$update.$set.serverClasses = dbVolume.serverClasses;
				$update.$set.diskClasses = dbVolume.diskClasses;
			}

			let relativeRebuildPriorityChanged = updateObj.relativeRebuildPriority !== dbVolume.relativeRebuildPriority;
			let enableCrcCheckChanged = updateObj.enableCrcCheck !== dbVolume.enableCrcCheck;

			let isReadOnlyChanged = updateObj.isReadOnly !== dbVolume.isReadOnly;
			let changingReadOnlyToFalse = updateObj.isReadOnly === false && dbVolume.isReadOnly === true;

			if (changingReadOnlyToFalse) {
				if (dbVolume.usedAsSourceCount > 0) {
					message = new SystemAdminMessage(systemMessages.CHANGE_READ_ONLY_ON_SOURCE);
					return cb(true);
				}

				if (!query['$and'])
					query['$and'] = [];

				query['$and'].push({
					$or: [
						{ usedAsSourceCount: { $exists: false } },
						{ usedAsSourceCount: 0 },
						{ isReadOnly: false }
					]
				});
			}

			let volumeIsReservedAsRW = dbVolume.reservation && consts.writableReservationModes.indexOf(dbVolume.reservation.mode) > -1;

			if ($update.$set.isReadOnly && volumeIsReservedAsRW) {
				message = new SystemAdminMessage(systemMessages.READ_WRITE_VOLUME);
				return cb(true);
			}
			shouldIncreaseVersion = relativeRebuildPriorityChanged || enableCrcCheckChanged || isReadOnlyChanged;

			if ($update.$set.isReadOnly)
				query['reservation.mode'] = { $nin: consts.writableReservationModes };

			if (shouldIncreaseVersion) {
				$update['$inc'] = { version: 1 };
				$update.$set['lastVersionSentToTomaViaKafka'] = dbVolume.lastVersionSentToTomaViaKafka || 0;
			}

			$update.$set.modifiedBy = user.email;
			$update.$set.dateModified = new Date();

			cb();
		},
		function updateVolumeInDB(cb) {
			volumeCollection.findOneAndUpdate(
				query,
				$update,
				{ returnDocument: consts.mongoReturnDocument.AFTER, projection: scope.volumeProjection },
				function(err, result) {
					if (err || !result) {
						message = new SystemAdminMessage(systemMessages.VOLUME_FAILED_TO_UPDATE);

						if (err)
							message.addInfo(Entities.Error, new MongoError(err).log());

						return cb(true);
					}

					updatedVolume = result;
					cb();
				}
			);
		},
		function doAfterVolumeUpdated(cb) {
			message = new SystemAdminMessage(systemMessages.VOLUME_UPDATED);

			if (shouldIncreaseVersion)
				events.emitEvent([events.getVolumeID(volumeID)], objectNotifier.events.volumeVersionChangeEvent, updatedVolume);

			cb();
		},
		function updateNVMeOFClients(cb) {
			var newClientsForNvmf = updateObj.selectedClientsForNvmf || [];
			var DbClientsForNvmf = dbVolume.selectedClientsForNvmf;

			var clientsToToggleNvmfOn = newClientsForNvmf.filter(x => !DbClientsForNvmf.includes(x));
			var clientsToToggleNvmfOff = DbClientsForNvmf.filter(x => !newClientsForNvmf.includes(x));

			var vol = updatedVolume;
			for (const clientID of clientsToToggleNvmfOn) {
				incNvmfExportIDbyClient(clientID, true, function(nvmfExportID, nvmfAttachmentsID) {
					events.emitEvent(
						[events.getClientID(clientID)],
						objectNotifier.events.canExportVolumeViaNvmfChangedEvent,
						{
							volumes: [{ '_id': vol._id, 'uuid': vol.uuid }],
							isOn: true,
							isDelta: true,
							nvmfExportID: nvmfExportID,
							nvmfAttachmentsID: nvmfAttachmentsID
						}
					);
				});
			}

			for (const clientID of clientsToToggleNvmfOff) {
				incNvmfExportIDbyClient(clientID, false, function(nvmfExportID, nvmfAttachmentsID) {
					events.emitEvent(
						[events.getClientID(clientID)],
						objectNotifier.events.canExportVolumeViaNvmfChangedEvent,
						{
							volumes: [{ '_id': vol._id, 'uuid': vol.uuid }],
							isOn: false,
							isDelta: true,
							nvmfExportID: nvmfExportID,
							nvmfAttachmentsID: nvmfAttachmentsID
						}
					);
				});
			}

			cb();
		},
		function startVolumeRebuildIfNeeded(cb) {
			//TODO: Do we need this now that we don't change the capacity in this flow ?
			logger.sysDEBUG('Automatically try to start the rebuild process');
			scope.startVolumesRebuild([updatedVolume], updatedVolume.modifiedBy, null);
			cb();
		}
	], () => callback(message.addInfo(Entities.Volume.ID, volumeID).addInfo(Entities.Volume.UUID, volumeUUID)));
};

//For now update volume can only extend the total capacity of the volume, it's done by creating dummy volume
//(in order to achieve two phase commit, along with the ability
//to rollback easily, if update(extension) failed.) then migrating the created chunks to the volume.
//*Marking the volume as extension volume, which means that the diskSegments will be with the original name,
//while the temporary volume name will be variation of the name.
//If extension volume created successfully updating the volume version, and the global configurationVersion.
scope.extendVolumes = function(volumes, user, cb) {
	let messages = [];

	async.eachSeries(volumes, (volume, cb) => {
		scope.extendVolume(volume, user, message => {
			messages.push(message);

			cb();
		});
	}, () => cb(messages));
};

scope.extendVolume = function(updateObj, user, callback) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	var globs = {};
	var volumeID = updateObj._id;
	var volumeUUID = updateObj.uuid;
	var extensionVolume;
	var isMaxCapacity;
	var capacityChanged;
	var newCapacity;
	var $query = { _id: volumeID, uuid: volumeUUID };
	var $set = {};
	var $update = { $set: $set };
	var message;

	async.series([
		function fetchTheVolume(cb) {
			//Load the original volume in order to determine the capacity delta.
			volumeCollection.findOne($query, (err, result) => {
				if (err || !result) {
					message = new SystemAdminMessage(systemMessages.VOLUME_EXTEND_NOT_FOUND);

					if (err) {
						new MongoError(err).log();
						message.addInfo(Entities.Error, err);
					}
				} else {
					globs.dbVolume = result;

					const excludedVolumes = clientModule.handleSnapshotVolumes([result], true);

					if (result.action === consts.volumeActions.INITIALIZING && !result.isReserved)
						message = new SystemAdminMessage(systemMessages.CANT_EXTEND_INITALIZING_VOLUME).addInfo(Entities.Volume.action, result.action);
					else if (result.action === consts.volumeActions.MARKED_FOR_DELETION)
						message = new SystemAdminMessage(systemMessages.CANT_DELETE_MARKED_FOR_DELETION_VOLUME).addInfo(Entities.Volume.action, result.action);
					else if (excludedVolumes.length)
						message = new SystemAdminMessage(systemMessages.VOLUME_EXTEND_SNAPSHOT_ERROR).addInfo(Entities.Error, excludedVolumes[0].error);
					else if (!globs.dbVolume.chunks || !globs.dbVolume.chunks.length)
						message = new SystemAdminMessage(systemMessages.VOLUME_EXTEND_FAILURE_NO_CHUNKS);
				}

				cb(message);
			});
		},
		function compareChanges(cb) {
			var dbVol = globs.dbVolume;

			isMaxCapacity = updateObj.capacity === consts.volumeCapacity.MAX;
			capacityChanged = updateObj.capacity > dbVol.capacity && updateObj.capacity !== consts.volumeCapacity.NO_CHANGE || isMaxCapacity;
			newCapacity = updateObj.capacity;

			if (!capacityChanged) {
				let error = `The new capacity must be greater then or equal to: ${globs.dbVolume.capacity}`;
				message = new SystemAdminMessage(systemMessages.VOLUME_EXTEND_CAPACITY_ERROR).addInfo(Entities.Error, error);
				return cb(true);
			}

			globs.updatedVol = scope.extend(true, {}, dbVol);
			cb();
		},
		function createVolumeExtensions(cb) {
			scope.createVolumeExtension(globs.updatedVol, newCapacity, user, function(err, extensionVol) {
				if (err) {
					if (err instanceof SystemMessage)
						message = new SystemAdminMessage(systemMessages.VOLUME_EXTEND_CREATE_EXTENSION_FAILED, err);
					else
						message = new SystemAdminMessage(systemMessages.VOLUME_EXTEND_CREATE_EXTENSION_FAILED).addInfo(Entities.Error, err);

					return cb(true);
				}

				extensionVolume = extensionVol;

				$update.$push = {};
				$update.$push['chunks'] = { $each: extensionVol.chunks };

				$set.capacity = globs.dbVolume.capacity + extensionVol.capacity;
				$set.blocks = globs.dbVolume.blocks + extensionVol.blocks;
				$set.action = consts.volumeActions.EXTENDING;

				cb();
			});
		},
		function updateOriginalVolume(cb) {
			$query.version = globs.dbVolume.version;
			$update['$inc'] = { version: 1 };
			$update.$set.modifiedBy = user.email;
			$update.$set.dateModified = new Date();
			$update.$set.lastVersionSentToTomaViaKafka = globs.dbVolume.lastVersionSentToTomaViaKafka || 0;
			var options = { returnDocument: consts.mongoReturnDocument.AFTER, projection: scope.volumeProjection };

			volumeCollection.findOneAndUpdate($query, $update, options, function(err, result) {
				if (err || !result) {
					const error = err ? new MongoError(err) : new SystemMessage(systemMessages.EXTEND_VOLUME_VERSION_FAILED);
					message = new SystemAdminMessage(systemMessages.VOLUME_EXTEND_ORGINAL_FAILED).addInfo(Entities.Error, error);
					return scope.forceDeleteVolume(extensionVolume, null, null, () => cb(true));
				}

				globs.updatedVol = result;

				cb();
			});
		},
		function removeExtensionDoc(cb) {
			//Remove all extension volumes.
			var extVolumeID = extensionVolume._id;
			var serverCollection = db.collection('server');

			volumeCollection.deleteMany({ _id: extVolumeID }, function() {
				// remove extensionVolumeId from all diskSegments
				serverCollection.updateMany(
					{ 'disks.diskSegments.extensionVolumeId': extVolumeID },
					{
						$unset: {
							'disks.$[disk].diskSegments.$[segment].extensionVolumeId': 1,
						}
					},
					{
						arrayFilters: [
							{ 'disk.diskSegments': { $exists: 1 } },
							{ 'segment.extensionVolumeId': extVolumeID }]
					},
					function() {
						cb();
					});
			});
		},
		function doAfterVolumeUpdated(cb) {
			logger.sysDEBUG('Volume extended, events sent with volume: ', globs.updatedVol);
			events.emitEvent([events.getVolumeID(volumeID)], objectNotifier.events.volumeExtendedEvent, globs.updatedVol);
			events.emitEvent([events.getVolumeID(volumeID)], objectNotifier.events.volumeActionChangeEvent, globs.updatedVol);

			message = new SystemAdminMessage(systemMessages.VOLUME_EXTENDED);

			cb();
		},
		function startVolumeRebuildIfNeeded(cb) {
			var volume = globs.updatedVol;
			logger.sysDEBUG('Automatically try to start the rebuild process');
			scope.startVolumesRebuild([volume], volume.modifiedBy, null);
			cb();
		}
	], () => {
		const entityType = globs.dbVolume.isReserved ? Entities.VPG : Entities.Volume;
		callback(message.addInfo(entityType.ID, volumeID).addInfo(entityType.UUID, volumeUUID));
	});
};

scope.getLockServerForVolume = function(volume) {
	return {
		maxNOwners: 1 + (volume.parityBlocks || volume.numberOfMirrors) || 1,
		type: consts.volumeLockServerTypes.OWNER_SCHEME_SL_START_DEC_C,
		locksetShift: -1
	};
};

scope.saveVolumes = function(volumes, shouldUpdateConfiguration, user, callback) {
	var messages = [];

	async.eachSeries(volumes, (volume, cb) => {
		scope.saveVolume(volume, shouldUpdateConfiguration, user, (err, allocatedVolume, message) =>{
			messages.push(message);
			cb();
		});
	}, () => {
		callback(messages);
	});
};

scope.saveVolume = function(volume, shouldUpdateConfiguration, user, mainCallback) {
	var db = app.get('db');
	var zonesFailedAllocation = [];
	var saveVolumesTimer = new ExecutionTimer('saveVolumes');
	var clonedVolume;

	//first save the volume in "pending" status and only after all
	//the diskSegments successfully saved in servers/disks update the status - to ensure integrity.
	volume.status = consts.volumeStatuses.PENDING;
	volume.handledBy = scope.getHandlingMgmtParams();

	const shouldGenerateUUID = !(volume.isExtension || volume.isReserved || volume.type === consts.volumeTypes.METADATA_VOLUME);
	if (shouldGenerateUUID)
		volume.uuid = uuid.v1();

	var nameError = scope.isValidVolumeName(volume);
	if (nameError)
		return saveVolumeCallback(nameError);

	function allocationCallback(zone, success, allocationError, shouldTryNextZone) {
		async.series([
			function releaseLocks(cb) {
				if (!zone)
					return cb();

				lockModule.releaseLockByZone(zone, cb);
			},
			function updateConfiguration(cb) {
			//If volume created, update global configurationVersion.
				if (success && shouldUpdateConfiguration) {
					scope.sendAddVolumeAfterVolumeSaved(volume, cb);
				} else
					cb();
			}
		], function endOfSeries() {
			if (!success && shouldTryNextZone) {
				zonesFailedAllocation.push(zone);
				volume = clonedVolume;
				clonedVolume = scope.extend(true, {}, volume);
				createVolumeByRAIDLevel(null, volume, zonesFailedAllocation, allocationCallback);
			} else {
				saveVolumeCallback(allocationError);
			}
		});
	}

	var err;

	volume.reservation = {
		mode: consts.reservationModes.NONE,
		version: 1,
		reservedBy: null,
		attachedClients: [],
		lastTransitionDate: null
	};

	validateVolumeLimitationsAndVPGExists(volume, db, (limitationsStatus) => {
		var finishSaveVolume = false;

		for (var status of limitationsStatus) {
			if (status && !status.success) {
				finishSaveVolume = true;
				err = getMissingLimitationError(status);
			}
		}

		if (finishSaveVolume)
			return allocationCallback(null, false, err);

		if (consts.mirroredRaidLevels.includes(volume.RAIDLevel) && !consts.validNumberOfMirrors.includes(volume.numberOfMirrors)) {
			const err = new SystemMessage(systemMessages.INVALID_NUMBER_OF_MIRRORS).addInfo(Entities.Volume.numberOfMirrors, volume.numberOfMirrors);
			return allocationCallback(null, false, err);
		}

		scope.validateVolumesFeatureCompatibility([volume], (err) => {
			if (err)
				return allocationCallback(null, false, err);

			volume.health = consts.targetHealth.HEALTHY;
			volume.lockServer = scope.getLockServerForVolume(volume);
			volume.selectedClientsForNvmf = volume.selectedClientsForNvmf || [];

			// working only on the cloned volume in order to keep the original for retrying the allocating with another zone
			clonedVolume = scope.extend(true, {}, volume);

			if (volume.isExtension)
				lockModule.acquireLockByVolume(volume, (err, zones) => {
					createVolumeByRAIDLevel(Array.from(zones)[0], volume, zonesFailedAllocation, allocationCallback);
				});
			else
				createVolumeByRAIDLevel(null, volume, zonesFailedAllocation, allocationCallback);
		});
	});

	function saveVolumeCallback(error) {
		let systemAdminMessage;

		//Notify volume creation.
		if (!error) {
			if (volume.isReserved) {
				systemAdminMessage = new SystemAdminMessage(systemMessages.VPG_RESERVATION_MADE);
			} else if (volume.isExtension) {
				systemAdminMessage = new SystemAdminMessage(systemMessages.EXTENSION_CREATED);
			} else {
				systemAdminMessage = new SystemAdminMessage(systemMessages.VOLUME_SAVED);

				events.emitEvent([events.getVolumeID(volume._id)], objectNotifier.events.newVolumeEvent, volume);

				for (const clientID of volume.selectedClientsForNvmf) {
					incNvmfExportIDbyClient(clientID, true, function(nvmfExportID, nvmfAttachmentsID) {
						events.emitEvent(
							[events.getClientID(clientID)],
							objectNotifier.events.canExportVolumeViaNvmfChangedEvent,
							{
								volumes: [{ '_id': volume._id, 'uuid': volume.uuid }],
								isOn: true,
								isDelta: true,
								nvmfExportID: nvmfExportID,
								nvmfAttachmentsID: nvmfAttachmentsID
							}
						);
					});
				}
			}
		} else {
			if (volume.isReserved) {
				systemAdminMessage = new SystemAdminMessage(systemMessages.UTILS_CREATE_VPG_RESERVATION_FAILURE);
			} else if (volume.isExtension) {
				systemAdminMessage = new SystemAdminMessage(systemMessages.UTILS_CREATE_VOLUME_EXTENSION_FAILURE);
			} else {
				const isNameAlreadyExistsFailure = (error && error instanceof MongoError && error.isDuplicateKeyError);
				systemAdminMessage = new SystemAdminMessage(isNameAlreadyExistsFailure ?
					systemMessages.UTILS_CREATE_VOLUME_FAILURE_NAME_EXISTS :
					systemMessages.VOLUME_SAVE_FAILED);

				if (!isNameAlreadyExistsFailure)
					systemAdminMessage.addInfo(Entities.Error, error instanceof SystemMessage ? error.toApiResponse() : error);
			}
		}

		const entityType = volume.isReserved ? Entities.VPG : Entities.Volume;
		systemAdminMessage.addInfo(entityType.ID, volume.name);

		if (!error)
			systemAdminMessage.addInfo(entityType.UUID, volume.uuid);

		saveVolumesTimer.stop();
		mainCallback(err, volume, systemAdminMessage);
	}
};

function createVolumeByRAIDLevel(lockedZone, volume, zonesToIgnore, allocationCallback) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');
	var err;
	var allocateBlocksTimer;

	if (volume.RAIDLevel === consts.RAIDLevel.STRIPED_ERASURE_CODING && volume.stripeSize) {
		const stripedECBlockSetSize = scope.getVolumeBlockSetSize(volume);

		volume.stripeSize = Math.ceil(volume.stripeSize / stripedECBlockSetSize) * stripedECBlockSetSize;
	}

	function unknownRaidLevelError(volume) {
		err = new SystemMessage(systemMessages.UNKNOWN_RAID_LEVEL).addInfo(Entities.Volume.RAIDLevel, volume.RAIDLevel).log();
		var noZone = null;
		var success = false;
		allocationCallback(noZone, success, err, false);
	}

	function localAllocationCB(zone, success, allocationError, shouldTryNextZone) {
		if (allocateBlocksTimer)
			allocateBlocksTimer.stop();

		allocationCallback(zone, success, allocationError, shouldTryNextZone);
	}

	//Those lines make sense when extending a volume.
	var chunks = volume.chunks;
	delete volume.chunks;

	var timer1 = new ExecutionTimer('saveVolumes.firstInsert');

	volumeCollection.insertOne(volume, function(err) {
		timer1.stop();
		volume.chunks = chunks;

		if (err)
			return allocationCallback(null, false, new MongoError(err).log(), false);

		allocateBlocksTimer = new ExecutionTimer('saveVolumes.allocateBlocks');

		switch (volume.RAIDLevel) {
			case consts.RAIDLevel.STRIPED_RAID_0:
				delete volume.domain;
				createRAID0(lockedZone, volume, 'Creating Striped Volume', zonesToIgnore, localAllocationCB);

				break;
			case consts.RAIDLevel.MIRRORED_RAID_1:
				scope.createRAID1(lockedZone, volume, zonesToIgnore, localAllocationCB);

				break;
			case consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10:
				createRAID0(lockedZone, volume, 'Creating Striped & Mirrored Volume', zonesToIgnore, localAllocationCB);

				break;
			case 'LVM/JBOD': // for backward compatibility
			case consts.RAIDLevel.CONCATENATED:
				volume.RAIDLevel = consts.RAIDLevel.CONCATENATED;
				delete volume.domain;
				scope.createJBOD(lockedZone, volume, zonesToIgnore, localAllocationCB);

				break;
			case consts.RAIDLevel.ERASURE_CODING:
				createRAID0(lockedZone, volume, 'Creating Erasure Coding Volume', zonesToIgnore, localAllocationCB);

				break;
			case consts.RAIDLevel.STRIPED_ERASURE_CODING:
				createRAID0(lockedZone, volume, 'Creating Striped Erasure Coding Volume', zonesToIgnore, localAllocationCB);

				break;
			default:
				unknownRaidLevelError(volume);
				break;
		}
	});
}

function incNvmfExportIDbyClient(clientID, isExposed, cb) {
	var db = app.get('db');
	var clientCollection = db.collection('client');
	var incNvmfRefCount = isExposed ? 1 : -1;

	clientCollection.findOneAndUpdate({
		_id: clientID
	}, {
		$inc: { nvmfExportID: 1, nvmfRefCount: incNvmfRefCount }
	},
	{
		projection: {
			nvmfExportID: 1,
			nvmfAttachmentsID: 1
		},
		returnDocument: consts.mongoReturnDocument.AFTER
	},
	(err, result) => {
		if (err)
			err = new MongoError(err);

		if (err || !result)
			return new SystemMessage(systemMessages.UTILS_INC_NVMF_EXPORTID_BY_CLIENT_FAILURE)
				.addInfo(Entities.Error, err).addInfo(Entities.Client.ID, clientID).log();

		cb(result.nvmfExportID, result.nvmfAttachmentsID);
	});
}

function getMissingLimitationError(status) {
	var err;
	var entityType;

	switch (status.limitationType) {
		case 'diskClasses':
			err = new SystemMessage(systemMessages.UTILS_SAVE_VOLUMES_DRIVECLASS_NOT_FOUND);
			entityType = Entities.DriveClass.ID;
			break;
		case 'serverClasses':
			err = new SystemMessage(systemMessages.UTILS_SAVE_VOLUMES_SERVERCLASS_NOT_FOUND);
			entityType = Entities.ServerClass.ID;
			break;
		case 'VSGs':
			err = new SystemMessage(systemMessages.UTILS_SAVE_VOLUMES_VSG_NOT_FOUND);
			entityType = Entities.VSG.ID;
			break;
		case 'VPG':
			err = new SystemMessage(systemMessages.UTILS_SAVE_VOLUMES_VPG_NOT_FOUND);
			entityType = Entities.VPG.ID;
			break;
	}

	status.missingLimitations.forEach((limit) => {
		err.addInfo(entityType, limit);
	});

	return err;
}

function validateVolumeLimitationsAndVPGExists(volume, db, cb) {
	function checkIfExistInDB(collectionName, dbKeyName, callback) {
		if (!volume[dbKeyName] || volume[dbKeyName].length === 0) {
			callback(null);
		} else {
			var limitation = volume[dbKeyName];
			var collection = db.collection(collectionName);
			var isVPG = dbKeyName === 'VPG';
			var query = isVPG ? { _id: limitation } : { _id: { $in: limitation } };

			collection.find(query).project({ _id: 1 }).toArray((err, result) => {
				var success = null;
				var missingLimitations = [];

				if (err) {
					new MongoError(err).log();
				} else {
					var resultIds = result.map((result) => result._id);
					var allLimitationsExist = () => { return result.length === limitation.length; };
					var vpgExist = () => { return resultIds.length !== 0 && resultIds[0] === limitation; };

					success = isVPG ? vpgExist() : allLimitationsExist();

					if (!success) {
						missingLimitations = isVPG ? [limitation] : limitation.filter(x => !resultIds.includes(x));
					}
				}

				callback(err ? err : null, { limitationType: dbKeyName, success: success, missingLimitations: missingLimitations });
			});
		}
	}

	async.parallel([
		(callback) => {
			checkIfExistInDB('diskClass', 'diskClasses', callback);
		},
		(callback) => {
			checkIfExistInDB('serverClass', 'serverClasses', callback);
		},
		(callback) => {
			checkIfExistInDB('volumeSecurityGroup', 'VSGs', callback);
		},
		(callback) => {
			checkIfExistInDB('volumeProvisioningGroup', 'VPG', callback);
		}
	], function(err, results) {
		cb(results);
	});
}

function isSegmentOverlaps(disk, diskSegment, cb) {
	var overlapSegment = null;
	var overlapError = null;

	if (disk.diskSegments && disk.diskSegments.length && diskSegment)
		disk.diskSegments.forEach(function(seg) {
			if (overlapSegment)
				return;

			if ((diskSegment.lbs >= seg.lbs && diskSegment.lbs <= seg.lbe ||
				diskSegment.lbe >= seg.lbs && diskSegment.lbe <= seg.lbe ||
				seg.lbs >= diskSegment.lbs && seg.lbe <= diskSegment.lbs) &&
				!(diskSegment.fromReserved && seg.isReserved))
				overlapSegment = seg;
		});

	if (overlapSegment) {
		var innerMessage = null;

		if (overlapSegment.type == diskSegment.type
			&& overlapSegment.partitionName == diskSegment.partitionName
			&& overlapSegment.uuid != overlapSegment.uuid)
			innerMessage = new SystemMessage(systemMessages.UTILS_SEGMENTS_OVERLAP_METADATA_SEGMENT_UUID_CHANGED);

		overlapError = new SystemMessage(systemMessages.UTILS_ADD_SEGMENT_TO_DISK_OVERLAP).addInfo(Entities.Error, innerMessage)
			.addInfo(Entities.Drive.UUID, disk.uuid)
			.addInfo(Entities.DiskSegment.NAME, overlapSegment, Differentiators.Old)
			.addInfo(Entities.DiskSegment.NAME, diskSegment, Differentiators.New);
	}

	return cb(overlapError);
}


scope.isSegmentOutOfBound = function(drive, diskSegment) {
	var err = null;

	if (drive.GPT && (diskSegment.lbs < drive.GPT.firstUsableLba || diskSegment.lbe > drive.GPT.lastUsableLba))
		err = new SystemMessage(systemMessages.UTILS_SEGMENT_OUT_OF_BOUND)
			.addInfo(Entities.DiskSegment.type, diskSegment.type)
			.addInfo(Entities.DiskSegment.UUID, diskSegment.uuid)
			.addInfo(Entities.DiskSegment.start, diskSegment.lbs)
			.addInfo(Entities.DiskSegment.end, diskSegment.lbe)
			.addInfo(Entities.Drive.ID, getDriveID(drive.diskID, drive.nodeID))
			.addInfo(Entities.Drive.GPT.firstUsableLba, drive.GPT.firstUsableLba)
			.addInfo(Entities.Drive.GPT.lastUsableLba, drive.GPT.lastUsableLba);

	return err;
};

// removes segments from disk and recalculate the largestSegment and availableBlocks
scope.removeSegmentsFromDisk = function(disk, diskSegmentsToRemove, cb) {
	var totalDeltaToFree = 0;
	var delta = 0;
	var diskSegmentsToRemoveUUIDs = diskSegmentsToRemove.map(function(seg) { return seg.uuid; });

	this.pullDiskSegmentsFromDisk(disk, disk.uuid, diskSegmentsToRemoveUUIDs);

	// recalculate largestSegment
	this.updateDisk(disk, disk.uuid, 'largestSegmentAvailable', scope.getLargestSegment(disk));

	// calculate the total amount of block to free from availableBlock after removal
	diskSegmentsToRemove.forEach(function(diskSegment) {
		delta = diskSegment.lbe - diskSegment.lbs;

		if (delta)
			totalDeltaToFree = totalDeltaToFree + delta + 1;
	});

	// update availableBlocks if needed
	if (totalDeltaToFree)
		this.updateDisk(disk, disk.uuid, 'availableBlocks', disk.availableBlocks + totalDeltaToFree);

	if (cb)
		cb(disk);
};

// add segments to disk and recalculate the largestSegment and availableBlocks
scope.addSegmentToDisk = function(disk, diskSegment, isMetadataSegment, calcDelta, cb) {
	var err = null;
	var calcDeltaUpdateDisk = this.updateDisk;
	// check if new segment overlaps the exist ones and evict disk if true
	isSegmentOverlaps(disk, diskSegment, function(overlapError) {
		if (overlapError) {
			calcDeltaUpdateDisk.bind(calcDelta)(disk, disk.uuid, 'autoEvictReason', consts.autoEvictReason.SEGMENTS_OVERLAPS);

			overlapError.log();
			return cb(disk, null, overlapError);
		}
	});

	err = scope.isSegmentOutOfBound(disk, diskSegment);
	if (err) {
		this.updateDisk(disk, disk.uuid, 'autoEvictReason', consts.autoEvictReason.SEGMENT_OUT_OF_BOUND);
		err = new SystemMessage(systemMessages.UTILS_ADD_SEGMENT_TO_DISK_OUT_OF_BOUND).addInfo(Entities.Error, err).log();

		return cb(disk, null, err);
	}

	var updateObj = {
		$push: { 'disks.$.diskSegments': diskSegment }
	};

	if (!isMetadataSegment && !diskSegment.isReserved)
		updateObj.$inc = { 'disks.$.version': 1 };

	if (!diskSegment.fromReserved) {
		//Add the diskSegment to the disk so we could calculate the newLargestSegment
		if (disk.diskSegments && Array.isArray(disk.diskSegments))
			disk.diskSegments.push(diskSegment);
		else
			disk.diskSegments = [diskSegment];

		//If the diskSegment came from reserved, the largestSegment shouldn't change.
		this.updateDisk(disk, disk.uuid, 'largestSegmentAvailable', scope.getLargestSegment(disk));
		updateObj.$set = { 'disks.$.largestSegmentAvailable': disk.largestSegmentAvailable };

		//Again, if came from reserved no need to decrement avilableBlocks, already decremented when the reservation were made.
		var delta = diskSegment.lbe - diskSegment.lbs;

		//making sure that it's not segment with size 0 (used to be raft only)
		if (delta) {
			this.updateDisk(disk, disk.uuid, 'availableBlocks', disk.availableBlocks - (delta + 1));

			scope.appendPropertyOrObject(updateObj, '$inc', 'disks.$.availableBlocks', -(delta + 1));

			//decrease also the usableBlocks if the segment is metadata
			if (isMetadataSegment) {
				this.updateDisk(disk, disk.uuid, 'usableBlocks', disk.usableBlocks - (delta + 1));

				scope.appendPropertyOrObject(updateObj, '$inc', 'disks.$.usableBlocks', -(delta + 1));
			}
		}
	}

	cb(disk, updateObj, null);
};

// add segments from disk, recalculate the largestSegment and availableBlocks and save to db
function addAndSaveSegmentOnDisk(disk, diskSegment, cb) {
	var db = app.get('db');
	var serverCollection = db.collection('server');

	var calcDelta = new scope.calcDelta();

	scope.addSegmentToDisk.bind(calcDelta)(disk, diskSegment, false, calcDelta, function(updatedDisk, updateObj, err) {
		if (err)
			return cb(err, diskSegment);

		serverCollection.updateOne({ 'disks.diskID': disk.diskID }, updateObj, function(err) {
			if (err)
				new MongoError(err).log();

			cb(err, diskSegment);
		});
	});
}

function getNumberOfRequiredDisksByVolume(volume) {
	var numberOfDataSegments = volume.dataBlocks + volume.parityBlocks || volume.numberOfMirrors + 1 || 1;
	numberOfDataSegments *= (volume.stripeWidth || 1);

	return numberOfDataSegments;
}

function receivedEnoughDataDisks(disks, threshold, volume) {
	let blockSetSize = scope.getVolumeBlockSetSize(volume);

	return disks && disks.filter(function(e) { return e.disks.largestSegmentAvailable.blocks >= blockSetSize; }).length >= threshold;
}

scope.getVolumeBlockSetSize = function(volume) {
	if (volume && volume.RAIDLevel === consts.RAIDLevel.STRIPED_ERASURE_CODING)
		return consts.BLOCK_SET_SIZE * (volume.dataBlocks || 1);

	return consts.BLOCK_SET_SIZE;
};

scope.getRedundancyToTotalRatio = function(volume) {
	const ratio = scope.getRedundancyRatio(volume);
	return ratio / (1 + ratio);
};

scope.getRedundancyRatio = (volume) => {
	switch (volume.RAIDLevel) {
		case consts.RAIDLevel.MIRRORED_RAID_1:
		case consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10:
			return volume.numberOfMirrors;

		case consts.RAIDLevel.STRIPED_ERASURE_CODING:
		case consts.RAIDLevel.ERASURE_CODING:
			return volume.parityBlocks / volume.dataBlocks;

		case consts.RAIDLevel.CONCATENATED:
		case consts.RAIDLevel.STRIPED_RAID_0:
			return 0;
	}
};


scope.allocateBlocks = function(lockedZone, volume, blocks, zonesToIgnore, allocationCB) {
	const isMaxAllocation = getIsMaxAllocation(volume);
	var GLOBAL_SETTINGS = app.get('globalSettings');
	var blocksToAllocate = scope.roundBlocksToNearestBlockSet(blocks, volume);
	var originalBlockToAllocate = blocksToAllocate;

	var failed = false;
	var shouldTryNextZone = GLOBAL_SETTINGS.enableZones && !volume.isExtension;
	var vlbs = volume.isExtension ? scope.getMaxOfArray(volume.chunks.map(function(c) { return c.vlbe; })) + 1 : 0;
	var totalMaxAllocatedBlocks = 0;

	volume.dateCreated = new Date();
	volume.createdByManagement = app.get('managementId');

	var alreadyInUseDisks = [];
	var newDisksUsedForVolume = {};

	if (volume.chunks)
		alreadyInUseDisks = getUsedDisksIdsByVolume(volume);

	volume.chunks = [];

	var triedToTakeChunkFromReserved;
	var triedToTakeChunkFromUsedResources;
	var triedToTakeReservedChunkFromUsedResources;

	async.whilst(
		function(callback) {
			logger.sysDEBUG(`allocateBlocks:: Need to allocate : ${isMaxAllocation ? 'MAX' : blocksToAllocate} blocks`);
			const shouldContinue = !failed && (isMaxAllocation || blocksToAllocate > 0);
			callback(null, shouldContinue);
		},
		function(callback) {
			var numberOfDisks = getNumberOfRequiredDisksByVolume(volume);
			var stripeIndex = 0;

			async.waterfall([
				function getChunk(callback) {
					var fromReserved = true;
					var notFromReserved = false;

					if (!volume.isReserved && volume.VPG && !triedToTakeChunkFromReserved) {
						logger.sysDEBUG('Trying to take something from reserved');
						var alreadyUsedDisks = !triedToTakeReservedChunkFromUsedResources ? alreadyInUseDisks : null;
						scope.getLargestReservedChunk(volume, alreadyUsedDisks, lockedZone, function(data, zone) {
							lockedZone = lockedZone || zone;

							let notEnoughDrives = (!data
								|| !receivedEnoughDataDisks(data, numberOfDisks, volume)
								|| data.length < numberOfDisks
							);

							//If none results came from reserved, stop trying! just take anything.
							triedToTakeChunkFromReserved = triedToTakeReservedChunkFromUsedResources && notEnoughDrives;
							triedToTakeReservedChunkFromUsedResources = true;

							var hasChance = !triedToTakeChunkFromReserved || volume.allowOverflow;
							if (!hasChance)
								shouldTryNextZone = false;

							return callback(null, fromReserved, hasChance, data);
						});
					} else {
						var timer1 = new ExecutionTimer('saveVolumes.allocateBlocks.getLargestChunk');
						alreadyUsedDisks = !triedToTakeChunkFromUsedResources ? alreadyInUseDisks : null;
						scope.getLargestChunk(lockedZone, volume, alreadyUsedDisks, zonesToIgnore, function(data, zone) {
							lockedZone = lockedZone || zone;
							timer1.stop();

							if (!zone)
								shouldTryNextZone = false;

							var hasChance = !triedToTakeChunkFromUsedResources
								|| receivedEnoughDataDisks(data, numberOfDisks, volume)
								&& data.length >= numberOfDisks;

							triedToTakeChunkFromUsedResources = true;
							callback(null, notFromReserved, hasChance, data);
						});
					}
				},
				function(fromReserved, hasChance, results, callback) {
					//If tried to take anything, and still none available just return, you've been failed :(.
					if (!results || (results && results.length < numberOfDisks)) {
						if (!hasChance)
							failed = true;

						return callback();
					}

					var chunkUUID = uuid.v1();

					var chunk = {
						_id: chunkUUID,
						uuid: chunkUUID,
						vlbs: vlbs
					};

					//If the volume is VPG reservation, stamped the chunk as well.
					if (volume.isReserved)
						chunk.isReserved = true;

					//If the chunk is from reserved mark him.
					if (fromReserved)
						chunk.fromReserved = true;

					//Populate the chunk, allocate by the smallest segment available.
					//Check if this is enough
					var smallestSegment = Math.min.apply(null,
						results.map(function(e) { return e.disks.largestSegmentAvailable.blocks; }));

					var blockSetSize = scope.getVolumeBlockSetSize(volume);
					var blocks = blocksToAllocate <= smallestSegment && !isMaxAllocation
						? blocksToAllocate
						: volume.numberOfMirrors && volume.numberOfMirrors > 0
							? Math.floor(smallestSegment / blockSetSize) * blockSetSize
							: Math.floor(Math.floor(smallestSegment / (volume.stripeSize || 1)) * (volume.stripeSize || 1) / blockSetSize)
							* blockSetSize;

					chunk.vlbe = chunk.vlbs + blocks * (((volume.dataBlocks * volume.stripeWidth) || volume.stripeWidth) || 1) - 1;

					//Check if the metadata is bigger than the segment.
					if ((chunk.vlbe - chunk.vlbs) <= 0) {
						if (!hasChance)
							failed = true;

						return callback();
					}

					//Just to make the document looks better in DB.
					chunk.pRaids = [];
					chunk.zone = lockedZone;

					var allocationIndex = 0;
					var allocatedBlocks = 0;
					var pRaidIndex = 0;
					var pRaidTypeIndex = 0;

					var lastPRaid = {};
					//Create diskSegment and update all the servers.
					async.eachSeries(results, function(diskObj, callback) {
						var disk = diskObj.disks;
						var dsUUID = uuid.v1();

						disk.node_id = diskObj.node_id;

						var pRaid = {
							activated: false,
							version: {
								major: 0,
								minor: 0
							},
							tomaLeaderRaftTerm: 0,
							zone: disk.zone
						};

						if ((consts.erasureCodedRaidLevels.includes(volume.RAIDLevel) && (allocationIndex % (volume.dataBlocks + volume.parityBlocks) != 0)) ||
							(consts.mirroredRaidLevels.includes(volume.RAIDLevel) && (allocationIndex % (1 + volume.numberOfMirrors) != 0))) {
							// use same pRaid
							pRaid = lastPRaid;
						} else {
							// creating new pRaid
							pRaidIndex = 0;
							pRaidTypeIndex = 0;
							pRaid.uuid = uuid.v1();
							pRaid.stripeIndex = stripeIndex++;
							pRaid.diskSegments = [];
							chunk.pRaids.push(pRaid);
							lastPRaid = pRaid;
						}

						var diskSegment = {
							_id: dsUUID,
							uuid: dsUUID,
							diskID: disk.diskID,
							diskUUID: disk.uuid,
							diskFormatRequestCounter: disk.formatRequestCounter,
							nodeUUID: diskObj.uuid,
							node_id: diskObj.node_id,
							volumeName: volume.isExtension ? volume.name : volume._id,
							volumeUUID: volume.uuid,
							pRaidUUID: pRaid.uuid,
							allocationIndex: allocationIndex,
							pRaidIndex: pRaidIndex,
							zone: disk.zone,
							redundancyRatio: scope.getRedundancyToTotalRatio(volume)
						};

						diskSegment.lbs = disk.largestSegmentAvailable.lbs;
						diskSegment.lbe = disk.largestSegmentAvailable.lbs + blocks - 1;
						diskSegment.type = consts.segmentTypes.DATA;

						allocatedBlocks = (diskSegment.lbe - diskSegment.lbs) + 1;
						pRaidIndex++;
						diskSegment.pRaidTypeIndex = pRaidTypeIndex++;

						if (alreadyInUseDisks.indexOf(disk.diskID) === -1) {
							alreadyInUseDisks.push(disk.diskID);
							triedToTakeChunkFromUsedResources = false;
							triedToTakeReservedChunkFromUsedResources = false;
						}

						//If the volume is VPG reservation, stamped the segment too.
						if (volume.isReserved) {
							diskSegment.isReserved = true;
							diskSegment.status = consts.diskSegmentStatuses.NORMAL;
						} else
							diskSegment.status = consts.diskSegmentStatuses.INITIALIZING;

						//Mark the segment that it came from reserved.
						if (fromReserved) {
							diskSegment.fromReserved = true;
							diskSegment.reservedUUID = disk.largestSegmentAvailable.uuid;
						}

						if (volume.isExtension) {
							diskSegment.isExtension = true;
							diskSegment.extensionVolumeId = volume._id;
						}

						allocationIndex++;

						var timer2 = new ExecutionTimer('saveVolumes.allocateBlocks.addAndSaveSegmentOnDisk');
						addAndSaveSegmentOnDisk(disk, diskSegment, function(err, diskSegment) {
							timer2.stop();
							pRaid.diskSegments.push(diskSegment);
							newDisksUsedForVolume[disk.diskID] = disk;

							callback(err);
						});

					}, function(err) {
						if (isMaxAllocation)
							totalMaxAllocatedBlocks += allocatedBlocks;
						else
							blocksToAllocate -= allocatedBlocks;

						volume.chunks.push(chunk);
						vlbs = chunk.vlbe + 1;

						callback(err);
					});
				}
			], function(err) {
				callback(err);
			});
		},
		function endOfWhilst(err) {
			if (err)
				logger.sysDEBUG(`Allocation failed. err: ${err}`);

			volume.blockSize = consts.BLOCK_SIZE;
			volume.blocks = originalBlockToAllocate;

			if (isMaxAllocation) {
				volume.blocks = totalMaxAllocatedBlocks;
				volume.capacity = volume.blocks * scope.BtoGB(consts.BLOCK_SIZE) * (volume.stripeWidth || 1);

				if (volume.RAIDLevel === consts.RAIDLevel.ERASURE_CODING || volume.RAIDLevel === consts.RAIDLevel.STRIPED_ERASURE_CODING)
					volume.capacity *= volume.dataBlocks;

				volume.capacity = parseFloat(Number(volume.capacity).toFixed(9));
			}

			volume.blocks = volume.blocks * ((volume.dataBlocks * volume.stripeWidth) || volume.stripeWidth || 1);

			if (err || (failed && !isMaxAllocation) || (failed && isMaxAllocation && volume.capacity < MIN_VOLUME_CAPACITY)) {
				rollbackFailedVolumeAllocation(lockedZone, 'Failed to allocate', shouldTryNextZone, volume, allocationCB);
			} else
				afterAllocationSucceeded(lockedZone, volume, newDisksUsedForVolume, allocationCB);
		}
	);
};

function rollbackFailedVolumeAllocation(lockedZone, err, shouldTryNextZone, volume, allocationCB) {
	logger.sysDEBUG(`Failed to allocate ${volume.name}, RAIDLevel: ${volume.RAIDLevel}. Performing Rollback`, err);

	scope.forceDeleteVolume(volume, lockedZone, null, function() {
		logger.sysDEBUG(`${volume.name} volume rollback completed, RAIDLevel: ${volume.RAIDLevel}`);
		allocationCB(lockedZone, err, shouldTryNextZone);
	});
}

function afterAllocationSucceeded(lockedZone, volume, newDisksUsedForVolume, allocationCB) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	volume.action = consts.volumeActions.INITIALIZING;

	// if this is a temp volume extention we keep it pending until it is deleted.
	// if this is a data/metadata volume of a snapshot we keep it pending until snapshot created successfully
	if (!volume.isExtension && !scope.isSnapshotDataOrMetadataVolume(volume))
		volume.status = consts.volumeStatuses.UNAVAILABLE;

	var timer = new ExecutionTimer('saveVolumes.allocateBlocks.finalSave');
	var query = { _id: volume._id };
	var $update = { $set: volume };

	if (volume.isExtension)
		volume.chunks.forEach(c => c.pRaids.forEach(p => p.diskSegments.forEach(d => delete d.extensionVolumeId)));

	volumeCollection.updateOne(query, $update, function(err, result) {
		timer.stop();

		if (err) {
			err = new MongoError(err).log();
		} else if (!result.modifiedCount) {
			err = `Failed to finalize volume on creation, volume._id: ${volume._id}, probably SanityAndRecover deleted the pending volume`;
		} else {
			Object.keys(newDisksUsedForVolume).forEach(function(diskID) {
				events.emitEvent(
					[events.getTargetID(newDisksUsedForVolume[diskID].node_id), events.getDiskID(diskID)],
					objectNotifier.events.segmentsChangedOnDiskEvent,
					newDisksUsedForVolume[diskID]
				);
			});

			zoneModule.handleVolumeCreation(volume);
		}

		allocationCB(lockedZone, err, false);
	});
}

function getIsMaxAllocation(volume) {
	return isNaN(volume.capacity) && volume.capacity === consts.volumeCapacity.MAX;
}

function createRAID0(lockedZone, volume, message, zonesToIgnore, callback) {
	logger.sysDEBUG(message);

	volume.numberOfMirrors = volume.numberOfMirrors || 0;
	let blocksToAllocate;

	if (!getIsMaxAllocation(volume)) {
		//Calculate the blocks to allocate - and align to stripeSize'.
		const allocationSizeInGigabytes = volume.capacity / ((volume.dataBlocks * volume.stripeWidth) || volume.stripeWidth);
		const stripeSizeInGigabytes = scope.BtoGB(volume.stripeSize * consts.BLOCK_SIZE);
		const numberOfStripes = Math.floor(allocationSizeInGigabytes / stripeSizeInGigabytes);
		blocksToAllocate = Math.floor((stripeSizeInGigabytes * numberOfStripes) / scope.BtoGB(consts.BLOCK_SIZE));
	}

	scope.allocateBlocks(lockedZone, volume, blocksToAllocate, zonesToIgnore, function(zone, err, shouldTryNextZone) {
		if (err) {
			logger.sysDEBUG('Failed to allocate blocks', err);
			callback(zone, false, err, shouldTryNextZone);
		} else {
			callback(zone, true);
		}
	});
}

scope.createRAID1 = function createRAID1(lockedZone, volume, zonesToIgnore, callback) {
	logger.sysDEBUG('Creating Mirrored Volume');

	let blocksToAllocate;
	if (!getIsMaxAllocation(volume))
		blocksToAllocate = Math.floor(volume.capacity / scope.BtoGB(consts.BLOCK_SIZE));

	var sdt1 = new Date();
	scope.allocateBlocks(lockedZone, volume, blocksToAllocate, zonesToIgnore, function(zone, err, shouldTryNextZone) {
		var edt1 = new Date();
		logger.sysDEBUG('Create RAID1::allocateBlocks finished in: ' + (edt1 - sdt1) + ' milliseconds');
		if (err) {
			logger.sysDEBUG('Failed to allocate blocks', err);
			callback(zone, false, err, shouldTryNextZone);
		} else {
			callback(zone, true);
		}
	});
};

scope.createJBOD = function(lockedZone, volume, zonesToIgnore, callback) {
	logger.sysDEBUG('Creating Concatenated Volume');

	volume.numberOfMirrors = 0;
	let blocksToAllocate;
	if (!getIsMaxAllocation(volume))
		blocksToAllocate = Math.floor(volume.capacity / scope.BtoGB(consts.BLOCK_SIZE));

	scope.allocateBlocks(lockedZone, volume, blocksToAllocate, zonesToIgnore, function(zone, err, shouldTryNextZone) {
		if (err) {
			logger.sysDEBUG('Failed to allocate blocks', err);
			callback(zone, false, err, shouldTryNextZone);
		} else {
			callback(zone, true);
		}
	});
};

scope.roundBlocksToNearestBlockSet = function(blocks, volume) {
	let blockSetSize = scope.getVolumeBlockSetSize(volume);

	return (Math.floor(blocks / blockSetSize) * blockSetSize) || 1;
};

//Return reserved segments of the VPG in the current disk.
//The function will find the reserved segments and intersect with all the other segments to find the reserved parts that are free.
scope.getReservedSegments = function(disk, VPG) {
	var availableReserved = [];

	if (disk.diskSegments && disk.diskSegments.length) {
		//Reserved segments
		var reservedSegments = VPG ? disk.diskSegments.filter(function(segment) {
			return segment.isReserved && segment.volumeName === VPG && !segment.pendingReclaim;
		}) : [];
		//Regular segments
		var segments = disk.diskSegments.filter(function(segment) { return !segment.isReserved; });

		//Check for each reserved the available reserved space.
		reservedSegments.forEach(function(rs) {
			if (rs.type === consts.segmentTypes.DATA) {
				var availableSegments = scope.getAvailableSegments(rs.lbs, rs.lbe + 1, segments);

				availableSegments.forEach(function(e) {
					e.pRaidUUID = rs.pRaidUUID;
					e.diskID = rs.diskID;
					e.nodeUUID = rs.nodeUUID;
					e.uuid = rs.uuid;
				});
				availableReserved = availableReserved.concat(availableSegments);
			} else
				availableReserved.push(rs);
		});
	}

	availableReserved.forEach(function(segment) {
		segment.fromReserved = true;
	});

	return availableReserved;
};

scope.getAvailableSpace = function(disk) {
	var totalBlocks = Math.floor(disk.blocks * disk.block_size / consts.BLOCK_SIZE);

	return Math.floor(totalBlocks / consts.BLOCK_SET_SIZE) * consts.BLOCK_SET_SIZE - 2 * consts.RESERVED_GPT_BLOCKS;
};

//The function gets a range and used segments and looks for available segments.
scope.getAvailableSegments = function(minValue, maxValue, diskSegments) {
	var segments = [];
	var minVal = minValue;

	if (diskSegments && diskSegments.length) {
		var sortedDiskSegments = diskSegments;
		if (diskSegments.length > 1)
			sortedDiskSegments = diskSegments.sort(function(a, b) { return a.lbs - b.lbs; });

		for (let i = 0; i < sortedDiskSegments.length; i++) {
			const ds = sortedDiskSegments[i];
			var blocksFromLeft = ds.lbs - minVal;
			if (blocksFromLeft > 0) {
				segments.push({
					lbs: minVal,
					lbe: Math.min(ds.lbs - 1, maxValue - 1)
				});
			}

			if (ds.lbe + 1 > minVal)
				minVal = ds.lbe + 1;

			if (maxValue <= minVal)
				break;

			//If last segment check for available blocks in the end of the disk.
			if (diskSegments.length - 1 == i) {
				var totalBlocks = maxValue;
				if (minVal < totalBlocks)
					segments.push({
						lbs: minVal,
						lbe: totalBlocks - 1
					});
			}
		}
	} else {
		segments.push({
			lbs: minValue,
			lbe: maxValue - 1
		});
	}

	return segments;
};

scope.getCapacityBySegments = function(segments) {
	var bytes = 0;

	segments.forEach(function(segment) {
		bytes += scope.getCapacityBySegment(segment);
	});

	return bytes;
};

scope.getCapacityBySegment = function(segment) {
	var bytes = (segment.lbe - segment.lbs) * consts.BLOCK_SIZE;

	return bytes;
};

//Returns N' disks with the largest reserved chunk available.
scope.getLargestReservedChunk = function(volume, alreadyUsedDisks, lockedZone, cb) {
	const db = app.get('db');
	const serverCollection = db.collection('server');

	const allowAllocationOnOfflineDrives = volume.allowAllocationOnOfflineDrives;
	let nodeMatch = scope.getAllocatableNodesMatch(allowAllocationOnOfflineDrives);
	let diskMatch = scope.getAllocatableDrivesMatch(false, allowAllocationOnOfflineDrives);
	if (alreadyUsedDisks && alreadyUsedDisks.length)
		diskMatch['disks.diskID'] = { $in: alreadyUsedDisks };

	async.waterfall([
		function getLock(callback) {
			if (!lockedZone)
				lockModule.acquireLockByVPG(volume.VPG, (err, zone) => {
					if (err)
						return callback(err);

					if (zone)
						lockedZone = zone;

					callback();
				});
			else
				callback();
		},
		function checkNotReclaiming(callback) {
			const volumeCollection = db.collection('volume');
			volumeCollection.findOne(
				{
					_id: volume.VPG,
					isReserved: true,
					reclaimAction: { $in: [consts.reservedVolumeReclaimActions.IN_PROGRESS, consts.reservedVolumeReclaimActions.COMMITTING] }
				},
				{ projection: { name: 1, uuid: 1 } },
				(err, reclaimingVolume) => {
					if (err)
						return callback(new MongoError(err).log());

					if (reclaimingVolume)
						return callback(new SystemMessage(systemMessages.VPG_RESERVED_VOLUME_IS_RECLAIMING)
							.addInfo(Entities.VPG.Name, reclaimingVolume.name)
							.addInfo(Entities.VPG.UUID, reclaimingVolume.uuid).log());

					callback();
				}
			);
		},
		function fetchDisks(callback) {
			//Load reserved segments
			serverCollection.aggregate([
				{ $match: nodeMatch },
				{ $unwind: '$disks' },
				{ $match: diskMatch },
				{ $match: { 'disks.diskSegments': { $elemMatch: { volumeName: volume.VPG } } } },
				{
					$project: {
						uuid: 1,
						node_id: 1,
						'disks.diskID': 1,
						'disks.blocks': 1,
						'disks.usableBlocks': 1,
						'disks.availableBlocks': 1,
						'disks.GPT.firstUsableLba': 1,
						'disks.GPT.lastUsableLba': 1,
						'disks.block_size': 1,
						'disks.diskSegments': 1,
						'disks.largestSegmentAvailable': 1,
						'disks.uuid': 1,
						'disks.zone': '$zone',
						'disks.formatRequestCounter': '$disks.formatRequestCounter',
						cmpToMaxNGptEntries: { $cmp: [{ $size: { '$ifNull': ['$disks.diskSegments', []] } }, '$disks.GPT.maxNGptEntries'] }
					}
				},
				{ $match: { cmpToMaxNGptEntries: -1 } }
			]).toArray(function(err, results) {
				if (err)
					err = new MongoError(err).log();

				callback(err, results);
			});
		},
		function(results, cb) {
			var disksWithAvailableReservedSpace = [];
			var alreadyTaken = [];
			results.forEach(function(diskObj) {
				//Get the reserved segments that are not in use.
				var availableReserved = scope.getReservedSegments(diskObj.disks, volume.VPG);

				(Array.from(new Set(availableReserved.map(function(e) { return e.pRaidUUID; })))).forEach(function(pRaid) {
					//Get the biggest reserved segment.
					var largestSegment = availableReserved
						.filter(function(segment) {
							return segment.pRaidUUID === pRaid
								&& alreadyTaken.indexOf(segment.pRaidUUID + segment.diskID) === -1;
						})
						.sort(function(a, b) { return scope.getCapacityBySegment(b) - scope.getCapacityBySegment(a); })[0];

					if (!largestSegment) return;

					alreadyTaken.push(largestSegment.pRaidUUID + largestSegment.diskID);
					var diskClone = scope.extend(true, {}, diskObj);

					diskClone.disks.largestSegmentAvailable = largestSegment;
					var delta = largestSegment.lbe - largestSegment.lbs;
					diskClone.disks.largestSegmentAvailable.blocks = delta === 0 ? delta : delta + 1;

					disksWithAvailableReservedSpace.push(diskClone);
				});
			});

			disksWithAvailableReservedSpace = disksWithAvailableReservedSpace.sort(function(a, b) {
				return b.disks.largestSegmentAvailable.blocks - a.disks.largestSegmentAvailable.blocks;
			});

			var biggestChunk = [];
			var numberOfDisks = getNumberOfRequiredDisksByVolume(volume);

			//Arrange disks to pRaids.
			var arrangedSegments = {};
			disksWithAvailableReservedSpace.forEach(function(diskObj) {
				var pRaidUUID = diskObj.disks.largestSegmentAvailable.pRaidUUID;

				if (!arrangedSegments[pRaidUUID] || !arrangedSegments[pRaidUUID])
					arrangedSegments[pRaidUUID] = [];

				arrangedSegments[pRaidUUID].push(diskObj);
			});

			var segments = [];
			var numberOfPRaidsNeeded = volume.stripeWidth || 1;

			for (var key in arrangedSegments)
				if (arrangedSegments[key].length === numberOfDisks / numberOfPRaidsNeeded)
					segments = segments.concat(arrangedSegments[key]);

			segments.forEach(function(diskObj) {
				//Finished to take all the disks needed for the chunk.
				if (biggestChunk && biggestChunk.length == numberOfDisks) return;

				if (!biggestChunk.filter(function(segment) { return segment.diskID === diskObj.disks.largestSegmentAvailable.diskID; }).length)
					biggestChunk.push(diskObj);
			});

			cb(null, biggestChunk && biggestChunk.length ? biggestChunk : []);
		}
	], function endOfWaterfall(err, biggestChunk) {
		cb(biggestChunk, lockedZone);
	});
};

function getUsedDisksIdsByVolume(volume) {
	var disks = [];

	volume.chunks.forEach(function(chunk) {
		chunk.pRaids.forEach(function(pRaid) {
			pRaid.diskSegments.filter(function(ds) { return disks.indexOf(ds.diskID) === -1; }).forEach(function(ds) {
				disks.push(ds.diskID);
			});
		});
	});

	return disks;
}
function calcRequiredMirrorsBySeparation(separation, totalSegments, redundancy) {
	if (separation === consts.separationTypes.FULL)
		return totalSegments;

	if (separation === consts.separationTypes.MINIMAL)
		return Math.ceil(totalSegments / redundancy);

	return 1;
}

scope.getMaxTolerableFaults = (volume) => {
	if (consts.erasureCodedRaidLevels.includes(volume.RAIDLevel))
		return volume.parityBlocks;

	if (consts.mirroredRaidLevels.includes(volume.RAIDLevel))
		return volume.numberOfMirrors;

	return 0;
};

scope.getPRaidStatus = (volume, nonFunctionalSegmentsCount) => {
	if (nonFunctionalSegmentsCount === 0)
		return consts.volumeStatuses.ONLINE;

	return nonFunctionalSegmentsCount <= scope.getMaxTolerableFaults(volume)
		? consts.volumeStatuses.DEGRADED
		: consts.volumeStatuses.OFFLINE;
};

scope.getEffectiveProtectionLevel = (volume) => {
	if (volume.protectionLevel)
		return volume.protectionLevel;

	if (volume.ignoreNodeSeparation && consts.mirroredRaidLevels.includes(volume.RAIDLevel))
		return consts.separationTypes.IGNORE;

	return consts.separationTypes.MINIMAL;
};

// applied in code as AJV defaults conflicts with protectionLevel/ignoreNodeSeparation mutual exclusivity.
scope.applyProtectionLevelDefaults = (volume) => {
	if (!consts.mirroredRaidLevels.includes(volume.RAIDLevel))
		return;

	if (volume.ignoreNodeSeparation && !volume.protectionLevel)
		volume.protectionLevel = consts.separationTypes.IGNORE;

	if (!volume.protectionLevel)
		volume.protectionLevel = consts.separationTypes.FULL;
};

scope.calcHasEnoughMirrors = (volume, availableMirrors) => {
	const protectionLevel = scope.getEffectiveProtectionLevel(volume);
	let requiredTargets;

	if (consts.erasureCodedRaidLevels.includes(volume.RAIDLevel))
		requiredTargets = calcRequiredMirrorsBySeparation(protectionLevel, volume.dataBlocks + volume.parityBlocks, volume.parityBlocks);

	else if (consts.mirroredRaidLevels.includes(volume.RAIDLevel))
		requiredTargets = calcRequiredMirrorsBySeparation(protectionLevel, volume.numberOfMirrors + 1, volume.numberOfMirrors);

	else
		return true;

	return availableMirrors >= requiredTargets - 1;
};

scope.validateFeatureCompatibility = (featureRequirements, callback) => {
	const db = app.get('db');
	const { displayName, ...componentRequirements } = featureRequirements;

	async.each(Object.entries(componentRequirements), ([componentType, minVersion], eachCb) => {
		const mapping = consts.FCV_COLLECTION_MAP[componentType];
		if (!mapping)
			return eachCb();

		const minVersionInt = parseInt(minVersion);
		const collection = db.collection(mapping.collection);
		const query = { $expr: { $lt: [{ $toInt: `$${mapping.field}` }, minVersionInt] } };

		if (mapping.collection === consts.dbCollections.CONFIGURATION_VERSION)
			query._id = { $ne: 'CLUSTER' };

		collection.countDocuments(query, (err, count) => {
			if (err)
				return eachCb(new MongoError(err).log());

			if (count) {
				const error = new SystemMessage(systemMessages.FEATURE_COMPATIBILITY_VERSION_NOT_MET)
					.addInfo(Entities.Component.name, componentType)
					.addInfo(Entities.Component.version, minVersion)
					.addInfo(Entities.Feature.name, displayName);

				return eachCb(error);
			}

			eachCb();
		});
	}, callback);
};

scope.validateVolumesFeatureCompatibility = (volumes, callback) => {
	const validateFeatureCondition = (condition, featureRequirements, cb) => {
		if (condition)
			return scope.validateFeatureCompatibility(featureRequirements, cb);

		cb();
	};

	async.each(volumes, (volume, eachCb) => {
		async.parallel([
			cb => validateFeatureCondition(volume.numberOfMirrors === 2, consts.FEATURE_REQUIREMENTS.NUMBER_OF_MIRRORS_2, cb),
			cb => validateFeatureCondition(volume.RAIDLevel === consts.RAIDLevel.STRIPED_ERASURE_CODING, consts.FEATURE_REQUIREMENTS.STRIPED_EC, cb)
		], eachCb);
	}, callback);
};

scope.validateAllocationOnOfflineDrives = function(entity, updateObj, callback) {
	scope.getDisksByClasses(entity.diskClasses, entity.serverClasses, null, null, false, disks => {
		targetModule.getAvailableMirrorsCount(entity.capacity, null, disks.map(disk => disk._id), null, updateObj.allowAllocationOnOfflineDrives,
			availableMirrors => {
				let err;
				if (!scope.calcHasEnoughMirrors(entity, availableMirrors))
					err = new SystemAdminMessage(systemMessages.NOT_ENOUGH_AVAILABLE_MIRRORS_FOR_THE_SELECTED_RAID_LEVEL)
						.addInfo(Entities.Volume.RAIDLevel, entity.RAIDLevel);

				return callback(err);
			});
	});
};

scope.getAllocatableDrivesMatch = function(onlyDrivesWithMD, allowAllocationOnOfflineDrives, limitByDisks) {
	const match = {
		'disks.status': { $in: [consts.diskStatus.OK, consts.diskStatus.INITIALIZING] },
		'disks.isExcluded': { $ne: true },
		'disks.isOutOfService': { $ne: true },
		'disks.isPendingFormat': { $ne: true }
	};

	if (onlyDrivesWithMD)
		scope.appendPropertyOrObject(match, 'disks.metadata_size', '$ne', 0);

	if (allowAllocationOnOfflineDrives)
		match['disks.status'].$in = match['disks.status'].$in.concat([consts.diskStatus.MISSING, consts.diskStatus.INGESTING]);

	if (limitByDisks && limitByDisks.length)
		match['disks.diskID'] = { $in: limitByDisks };

	return match;
};

scope.getAllocatableNodesMatch = (allowAllocationOnOfflineDrives, limitByNodes) => {
	const match = {
		node_status: allowAllocationOnOfflineDrives ? { $ne: consts.nodeStatus.DELETING } : consts.nodeStatus.OK,
		isPending: { $ne: true }
	};

	if (limitByNodes && limitByNodes.length)
		match.node_id = { $in: limitByNodes };

	return match;
};


function shouldUseOnlyMetadataDrives(volume) {
	return volume.RAIDLevel == consts.RAIDLevel.ERASURE_CODING || volume.RAIDLevel == consts.RAIDLevel.STRIPED_ERASURE_CODING || volume.enableCrcCheck;
}

function getDiskAndServerMatchByVolume(volume, alreadyUsedDisks, identifiersToExclude, cb) {
	const limitByNodes = volume.limitByNodes;
	const limitByDisks = volume.limitByDisks;
	const allowAllocationOnOfflineDrives = volume.allowAllocationOnOfflineDrives;
	const onlyDrivesWithMD = shouldUseOnlyMetadataDrives(volume);

	let nodeMatch = scope.getAllocatableNodesMatch(allowAllocationOnOfflineDrives, limitByNodes);
	let diskMatch = scope.getAllocatableDrivesMatch(onlyDrivesWithMD, allowAllocationOnOfflineDrives, limitByDisks);

	if (!(volume.diskClasses && volume.diskClasses.length || volume.serverClasses && volume.serverClasses.length) && !volume.domain)
		return cb(diskMatch, nodeMatch);

	scope.getDisksByClasses(volume.diskClasses, volume.serverClasses, volume.domain, identifiersToExclude, false, function(disksWithDomains) {
		var targets = scope.uniqueUnion([disksWithDomains.map((doc) => { return doc.node_id; })]);
		var disks = disksWithDomains.map(function(doc) { return doc._id; });

		if (alreadyUsedDisks && alreadyUsedDisks.length)
			disks = scope.intersection(disks, alreadyUsedDisks);

		scope.appendPropertyOrObject(diskMatch, 'disks.diskID', '$in', disks);
		scope.appendPropertyOrObject(nodeMatch, 'node_id', '$in', targets);

		cb(diskMatch, nodeMatch, disksWithDomains);
	});
}

//Returns the N' disks with the largest segment available.
scope.getLargestChunk = function(lockedZone, volume, alreadyUsedDisks, zonesToIgnore, cb) {
	var limit;

	var timer1 = new ExecutionTimer('saveVolumes.allocateBlocks.getLargestChunk.getDisksForRAID1');

	function getLargestChunkCB(err, results) {
		if (err)
			logger.sysERROR(err);

		timer1.stop();

		cb((err || !results) ? [] : results, lockedZone);
	}

	var timer2 = new ExecutionTimer('saveVolumes.allocateBlocks.getLargestChunk.getDiskAndServerMatchByVolume');
	getDiskAndServerMatchByVolume(volume, alreadyUsedDisks, null, function(diskMatch, nodeMatch, disksWithDomains) {
		timer2.stop();
		var queryDiskWithBlocks = { 'disks.largestSegmentAvailable.blocks': { $gt: 0 } };
		async.series([
			(callback) => {
				if (lockedZone)
					return callback();

				var limitTargets = nodeMatch.node_id ? nodeMatch.node_id.$in : [];
				var limitDisks = diskMatch['disks.diskID'] ? diskMatch['disks.diskID'].$in : [];
				lockModule.acquireZoneLockForAllocation(limitTargets, limitDisks, zonesToIgnore, (err, zone) => {
					if (err)
						return getLargestChunkCB(err);

					lockedZone = zone;
					callback();
				});
			},
			() => {
				nodeMatch.zone = lockedZone;

				switch (volume.RAIDLevel) {
					case consts.RAIDLevel.STRIPED_RAID_0:
						diskMatch = scope.extend(diskMatch, queryDiskWithBlocks);
						limit = volume.stripeWidth;
						getDisksForRAID0(nodeMatch, diskMatch, limit, true, getLargestChunkCB);

						break;
					case consts.RAIDLevel.MIRRORED_RAID_1:
						getDisksForRAID1(nodeMatch, diskMatch, volume, disksWithDomains, getLargestChunkCB);

						break;
					case consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10:
						getDisksForRAID10(nodeMatch, diskMatch, volume, disksWithDomains, getLargestChunkCB);

						break;
					case consts.RAIDLevel.CONCATENATED:
						diskMatch = scope.extend(diskMatch, queryDiskWithBlocks);
						getDisksForRAID0(nodeMatch, diskMatch, 1, true, getLargestChunkCB);

						break;
					case consts.RAIDLevel.ERASURE_CODING:
						getDisksForErasureCoding(nodeMatch, diskMatch, volume, disksWithDomains, getLargestChunkCB);

						break;
					case consts.RAIDLevel.STRIPED_ERASURE_CODING:
						getDisksForStripedErasureCoding(nodeMatch, diskMatch, volume, disksWithDomains, getLargestChunkCB);

						break;
					default:
						var err = `Unknown RAID LEVEL: ${volume.RAIDLevel}`;
						logger.sysDEBUG(err);

						getLargestChunkCB(err);
						break;
				}
			}
		]);
	});
};

function getDisksForStripedErasureCoding(nodeMatch, diskMatch, volume, disksWithDomains, callback) {
	getDisksForStripedVolume(nodeMatch, diskMatch, volume, disksWithDomains, getDisksForErasureCoding, callback);
}

function getDisksForErasureCoding(nodeMatch, diskMatch, volume, disksWithDomain, callback) {
	const db = app.get('db');
	const serverCollection = db.collection('server');

	//Get the servers that we should use sorted by the number of segments in the machine ascending
	const pipeline = [
		{ $match: nodeMatch },
		{
			$project: {
				uuid: 1,
				zone: 1,
				node_id: 1,
				disks: {
					$map: {
						input: '$disks',
						in: {
							zone: '$zone',
							uuid: '$$this.uuid',
							diskID: '$$this.diskID',
							status: '$$this.status',
							blocks: '$$this.blocks',
							block_size: '$$this.block_size',
							usableBlocks: '$$this.usableBlocks',
							metadata_size: '$$this.metadata_size',
							isExcluded: '$$this.isExcluded',
							isOutOfService: '$$this.isOutOfService',
							isPendingFormat: '$$this.isPendingFormat',
							availableBlocks: '$$this.availableBlocks',
							formatRequestCounter: '$$this.formatRequestCounter',
							numOfDiskSegments: { '$size': { '$ifNull': ['$$this.diskSegments', []] } },
							largestSegmentAvailable: '$$this.largestSegmentAvailable',
							GPT: {
								firstUsableLba: '$$this.GPT.firstUsableLba',
								lastUsableLba: '$$this.GPT.lastUsableLba',
								maxNGptEntries: '$$this.GPT.maxNGptEntries'
							}
						}
					}
				}
			}
		},
		{ $unwind: '$disks' },
		{ $match: diskMatch },
		{
			$project: {
				uuid: '$uuid',
				zone: '$zone',
				disks: '$disks',
				node_id: '$node_id',
				cmpToMaxNGptEntries: { $cmp: ['$disks.numOfDiskSegments', '$disks.GPT.maxNGptEntries'] }
			}
		},
		{ $match: { cmpToMaxNGptEntries: -1 } },
		{ $sort: { 'disks.largestSegmentAvailable.blocks': -1 } }
	];

	let disksCursor = serverCollection.aggregate(pipeline);

	chooseDrivesForAllocation(disksCursor, volume, disksWithDomain, (err, results) => {
		if (err)
			return callback(new MongoError(err).log());

		enrichDrives(results, (err, enrichedResults) => {
			callback(err, enrichedResults);
		});
	});
}

function isDiskViolateProtectionDomain(protectionDomain, allreadyUsedDomains) {
	return (allreadyUsedDomains[protectionDomain.scope] || []).filter(function(scopeID) { return scopeID === protectionDomain.identifier; }).length;
}

function getDiskProtectionDomain(diskObj, disksWithDomains) {
	var diskDomain = (disksWithDomains || []).filter(function(diskWithDomain) { return diskWithDomain._id === diskObj.disks.diskID; });

	if (diskDomain && diskDomain.length)
		return diskDomain[0].domain;

	return null;
}

function chooseDrivesForAllocation(cursor, volume, disksWithDomain, callback) {
	var store = [];
	var nodesInUse = {};
	var protectionDomainsInUse = {};
	var results = [];
	var shouldContinue = true;

	var drivesNeeded = getNumberOfRequiredDisksByVolume(volume);

	async.whilst(function(callback) { callback(null, shouldContinue); }, function(callback) {
		cursor.hasNext(function(err, hasNext) {
			if (err)
				return callback(new MongoError(err));

			if (hasNext)
				cursor.next(function(err, diskObj) {
					if (err)
						return callback(new MongoError(err));

					var protectionDomain = getDiskProtectionDomain(diskObj, disksWithDomain);

					if (volume.domain && !protectionDomain) {
						logger.sysDEBUG('For some reason I failed to find the protection domain of this drive: ' + diskObj.disks.diskID);
						return callback();
					}

					if (Object.prototype.hasOwnProperty.call(nodesInUse, diskObj.node_id) ||
						volume.domain && isDiskViolateProtectionDomain(protectionDomain, protectionDomainsInUse))
						store.push(diskObj);
					else {
						if (!diskObj.disks.largestSegmentAvailable.blocks)
							return callback();

						if (volume.domain)
							(protectionDomainsInUse[protectionDomain.scope] = protectionDomainsInUse[protectionDomain.scope] || [])
								.push(protectionDomain.identifier);

						nodesInUse[diskObj.node_id] = (nodesInUse[diskObj.node_id] + 1) || 1;
						results.push(diskObj);

						if (results.length >= drivesNeeded)
							shouldContinue = false;
					}

					callback();
				});
			else {
				shouldContinue = false;
				callback();
			}
		});
	}, function(err) {
		if (results.length < drivesNeeded && volume.protectionLevel !== consts.separationTypes.FULL) {
			store.forEach(function(e) {
				if (results.length === drivesNeeded) return;

				if (volume.protectionLevel === consts.separationTypes.IGNORE ||
					volume.protectionLevel === consts.separationTypes.MINIMAL && nodesInUse[e.node_id] < volume.parityBlocks) {

					if (!e.disks.largestSegmentAvailable.blocks && results.length < drivesNeeded)
						return;

					results.push(e);
					nodesInUse[e.node_id]++;
				}
			});
		}

		cursor.close();
		callback(err, results.length < drivesNeeded ? [] : reShuffleDrives(results, drivesNeeded));
	});
}

//Re-shuffle the drives so no following drives will be from the same target.
function reShuffleDrives(drives, drivesNeeded) {
	var results = [];
	var targetsWithDrives = drives.reduce(function(rv, d) { (rv[d.node_id] = rv[d.node_id] || []).push(d); return rv; }, {});

	while (results.length < drivesNeeded) {
		for (var target in targetsWithDrives) {
			results.push(targetsWithDrives[target].splice(targetsWithDrives[target].length - 1, 1)[0]);

			if (!targetsWithDrives[target].length)
				delete targetsWithDrives[target];
		}
	}

	return results;
}

function getDisksForStripedVolume(nodeMatch, diskMatch, volume, disksWithDomains, func, callback) {
	let stripes = new Array(volume.stripeWidth || 1);
	let disks = [];

	if (!diskMatch['disks.diskID'])
		diskMatch['disks.diskID'] = {};
	if (!diskMatch['disks.diskID'].$nin)
		diskMatch['disks.diskID'].$nin = [];

	volume.stripeWidth = null;

	async.eachSeries(stripes, function(_, callback) {
		func(nodeMatch, diskMatch, volume, disksWithDomains, function(err, results) {
			if (!results || err)
				return callback(err);

			disks = disks.concat(results);
			scope.appendPropertyOrObject(diskMatch, 'disks.diskID', '$nin', results.map(function(d) { return d.disks.diskID; }));
			callback(err);
		});
	}, function(err) {
		volume.stripeWidth = stripes.length;

		if (err)
			err = new SystemMessage(systemMessages.UTILS_GET_DRIVES_FOR_STRIPED_VOLUME_FAILURE).addInfo(Entities.Error, err);

		callback(err, disks);
	});
}

function getDisksForRAID10(nodeMatch, diskMatch, volume, disksWithDomains, callback) {
	getDisksForStripedVolume(nodeMatch, diskMatch, volume, disksWithDomains, getDisksForRAID1, callback);
}

function getDisksForRAID0(nodeMatch, diskMatch, limit, biggestFirst, callback) {
	var db = app.get('db');
	var serverCollection = db.collection('server');

	var pipeline = [
		{ $match: nodeMatch },
		{
			$project: {
				uuid: 1,
				zone: 1,
				node_id: 1,
				isPending: 1,
				node_status: 1,
				disks: {
					$map: {
						input: '$disks',
						in: {
							zone: '$zone',
							uuid: '$$this.uuid',
							diskID: '$$this.diskID',
							status: '$$this.status',
							blocks: '$$this.blocks',
							block_size: '$$this.block_size',
							usableBlocks: '$$this.usableBlocks',
							metadata_size: '$$this.metadata_size',
							isExcluded: '$$this.isExcluded',
							isOutOfService: '$$this.isOutOfService',
							isPendingFormat: '$$this.isPendingFormat',
							availableBlocks: '$$this.availableBlocks',
							formatRequestCounter: '$$this.formatRequestCounter',
							numOfDiskSegments: { '$size': { '$ifNull': ['$$this.diskSegments', []] } },
							largestSegmentAvailable: '$$this.largestSegmentAvailable',
							GPT: {
								firstUsableLba: '$$this.GPT.firstUsableLba',
								lastUsableLba: '$$this.GPT.lastUsableLba',
								maxNGptEntries: '$$this.GPT.maxNGptEntries'
							}
						}
					}
				}
			}
		},
		{ $unwind: '$disks' },
		{ $match: diskMatch },
		{
			$project: {
				uuid: '$uuid',
				zone: '$zone',
				disks: '$disks',
				node_id: '$node_id',
				isPending: '$isPending',
				node_status: '$node_status',
				cmpToMaxNGptEntries: { $cmp: ['$disks.numOfDiskSegments', '$disks.GPT.maxNGptEntries'] }
			}
		},
		{ $match: { cmpToMaxNGptEntries: -1 } },
		{ $sort: { 'disks.largestSegmentAvailable.blocks': biggestFirst ? -1 : 1, _id: 1 } },
		{ $limit: limit }
	];

	serverCollection.aggregate(pipeline).toArray((err, results) => {
		if (err)
			return callback(new MongoError(err).log());

		enrichDrives(results, (err, results) => {
			callback(err, results);
		});
	});
}

function enrichDrives(drives, callback) {
	let db = app.get('db');
	let serverCollection = db.collection('server');

	let nodeIDs = new Set(drives.map((d) => { return d.node_id; }));

	let pipeline = [
		{ $match: { _id: { $in: Array.from(nodeIDs) } } },
		{ $project: { _id: 0, node_id: 1, 'disks.uuid': 1, 'disks.diskSegments': 1 } },
		{ $unwind: '$disks' },
		{ $match: { 'disks.uuid': { $in: drives.map((d) => { return d.disks.uuid; }) } } },
	];

	let drivesWithoutSegments = {};

	drives.forEach((d) => {
		drivesWithoutSegments[d.disks.uuid] = d;
	});

	serverCollection.aggregate(pipeline).toArray((err, disks) => {
		if (err)
			return callback(new MongoError(err));

		if (!disks.length)
			return callback('No disks found in fetchDiskSegmentsIfNeeded');

		disks.forEach(d => drivesWithoutSegments[d.disks.uuid].disks.diskSegments = d.disks.diskSegments);

		callback(null, drives);
	});
}

function getDataDisksForRAID1(nodeMatch, diskMatch, volume, maxDisksPerGroup, callback) {
	const db = app.get('db');
	const serverCollection = db.collection('server');

	diskMatch = scope.extend(true, diskMatch, { 'disks.largestSegmentAvailable.blocks': { $gt: 0 } });

	let pipeline = [
		{ $match: nodeMatch },
		{
			$project: {
				uuid: 1,
				zone: 1,
				node_id: 1,
				isPending: 1,
				node_status: 1,
				disks: {
					$map: {
						input: '$disks',
						in: {
							zone: '$zone',
							uuid: '$$this.uuid',
							diskID: '$$this.diskID',
							status: '$$this.status',
							blocks: '$$this.blocks',
							block_size: '$$this.block_size',
							usableBlocks: '$$this.usableBlocks',
							metadata_size: '$$this.metadata_size',
							isExcluded: '$$this.isExcluded',
							isOutOfService: '$$this.isOutOfService',
							isPendingFormat: '$$this.isPendingFormat',
							availableBlocks: '$$this.availableBlocks',
							formatRequestCounter: '$$this.formatRequestCounter',
							numOfDiskSegments: { '$size': { '$ifNull': ['$$this.diskSegments', []] } },
							largestSegmentAvailable: '$$this.largestSegmentAvailable',
							GPT: {
								firstUsableLba: '$$this.GPT.firstUsableLba',
								lastUsableLba: '$$this.GPT.lastUsableLba',
								maxNGptEntries: '$$this.GPT.maxNGptEntries'
							}
						}
					}
				}
			}
		},
		{ $unwind: '$disks' },
		{ $match: diskMatch },
		{
			$project: {
				uuid: '$uuid',
				zone: '$zone',
				disks: '$disks',
				node_id: '$node_id',
				isPending: '$isPending',
				node_status: '$node_status',
				cmpToMaxNGptEntries: { $cmp: ['$disks.numOfDiskSegments', '$disks.GPT.maxNGptEntries'] }
			}
		},
		{ $match: { cmpToMaxNGptEntries: -1 } },
		{ $sort: { 'disks.largestSegmentAvailable.blocks': -1 } }
	];

	if (volume.domain) {
		pipeline = pipeline.concat([
			{
				$lookup: {
					from: 'serverClass',
					let: { serverID: '$node_id' },
					pipeline: [{
						$match: {
							$expr: {
								$and: [
									{ $in: [volume.domain, '$domains.scope'] },
									{ $in: ['$$serverID', '$targetNodes'] }
								]
							}
						}
					}],
					as: 'serverClasses'
				}
			}, {
				$lookup: {
					from: 'diskClass',
					let: { diskID: '$disks.diskID' },
					pipeline: [{
						$match: {
							$expr: {
								$and: [
									{ $in: [volume.domain, '$domains.scope'] },
									{ $in: ['$$diskID', '$disks.diskID'] }
								]
							}
						}
					}],
					as: 'diskClasses'
				}
			},
			{
				$project: {
					disks: 1,
					uuid: 1,
					node_id: 1,
					zone: 1,
					domains: {
						$concatArrays: ['$serverClasses.domains', '$diskClasses.domains']
					}
				}
			},
			{
				$project: {
					disks: 1,
					uuid: 1,
					node_id: 1,
					zone: 1,
					domains: {
						$reduce: {
							input: '$domains',
							initialValue: [],
							in: { $concatArrays: ['$$value', '$$this'] }
						}
					}
				}
			},
			{ $unwind: '$domains' },
			{ $match: { 'domains.scope': volume.domain } },
			{ $sort: { 'disks.largestSegmentAvailable.blocks': -1 } },
			{
				$group: {
					_id: '$domains.identifier',
					disks: { $push: '$disks' },
					node_id: { $first: '$node_id' },
					uuid: { $first: '$uuid' },
					zone: { $first: '$zone' },
					largestAvailableBlocks: { $max: '$disks.largestSegmentAvailable.blocks' }
				}
			},
			{ $project: { disks: { $slice: ['$disks', maxDisksPerGroup] }, node_id: 1, uuid: 1, zone: 1, largestAvailableBlocks: 1 } },
			{ $sort: { largestAvailableBlocks: -1, _id: 1 } },
		]);
	}

	pipeline = pipeline.concat([
		{
			$group: {
				_id: '$_id',
				zone: { $first: '$zone' },
				uuid: { $first: '$uuid' },
				disks: volume.domain ? { $first: '$disks' } : { $push: '$disks' },
				node_id: { $first: '$node_id' },
				largestAvailableBlocks: volume.domain
					? { $max: { $arrayElemAt: ['$disks.largestSegmentAvailable.blocks', 0] } }
					: { $max: '$disks.largestSegmentAvailable.blocks' }
			}
		},
		{ $project: { disks: { $slice: ['$disks', maxDisksPerGroup] }, node_id: 1, uuid: 1, zone: 1, largestAvailableBlocks: 1 } },
		{ $match: { disks: { $exists: true, $ne: [] } } },
		{ $sort: { largestAvailableBlocks: -1, _id: 1 } },
	]);

	serverCollection.aggregate(pipeline).toArray((err, separationGroups) => {
		if (err)
			return callback(new MongoError(err).log());

		callback(null, separationGroups);
	});
}

// returns suitable drives only, regardless of if it is enough for allocation or not
function selectDisksForRAID1(separationGroups, segmentsNeeded, protectionLevel, numberOfMirrors) {
	const selected = [];
	const groupUsage = {};

	for (const group of separationGroups) {
		if (selected.length === segmentsNeeded)
			break;

		if (group.disks.length > 0) {
			selected.push(projectDiskFromGroup(group, 0));
			groupUsage[group._id] = 1;
		}
	}

	if (selected.length === segmentsNeeded)
		return selected;

	const canRelaxSeparation = protectionLevel === consts.separationTypes.IGNORE ||
		(protectionLevel === consts.separationTypes.MINIMAL && numberOfMirrors > 1);

	if (!canRelaxSeparation)
		return selected;

	const remaining = [];
	for (const group of separationGroups) {
		const startIdx = groupUsage[group._id] ? 1 : 0;
		for (let i = startIdx; i < group.disks.length; i++)
			remaining.push({ group, diskIdx: i });
	}

	if (remaining.length < segmentsNeeded - selected.length)
		return selected;

	remaining.sort((a, b) =>
		b.group.disks[b.diskIdx].largestSegmentAvailable.blocks -
		a.group.disks[a.diskIdx].largestSegmentAvailable.blocks);

	const MAX_DISKS_PER_GROUP_MINIMAL = 2;
	const maxPerGroup = protectionLevel === consts.separationTypes.MINIMAL ? MAX_DISKS_PER_GROUP_MINIMAL : Infinity;

	for (const candidate of remaining) {
		if (selected.length === segmentsNeeded)
			break;

		const usage = groupUsage[candidate.group._id] || 0;
		if (usage < maxPerGroup) {
			selected.push(projectDiskFromGroup(candidate.group, candidate.diskIdx));
			groupUsage[candidate.group._id] = usage + 1;
		}
	}

	return selected;
}

function projectDiskFromGroup(group, diskIdx) {
	const disk = group.disks[diskIdx];
	return {
		_id: group._id,
		node_id: group.node_id,
		uuid: group.uuid,
		zone: group.zone,
		disks: {
			uuid: disk.uuid,
			diskID: disk.diskID,
			blocks: disk.blocks,
			block_size: disk.block_size,
			zone: group.zone,
			usableBlocks: disk.usableBlocks,
			GPT: disk.GPT ? { lastUsableLba: disk.GPT.lastUsableLba, firstUsableLba: disk.GPT.firstUsableLba } : undefined,
			largestSegmentAvailable: disk.largestSegmentAvailable,
		}
	};
}

function getDisksForRAID1(nodeMatch, dataDiskMatch, volume, drivesWithDomains, callback) {
	const segmentsNeeded = getNumberOfRequiredDisksByVolume(volume) / (volume.stripeWidth || 1);
	const onError = (innerErr) => callback(new SystemMessage(systemMessages.UTILS_GET_DRIVES_FOR_RAID1_FAILURE).addInfo(Entities.Error, innerErr));

	getDataDisksForRAID1(nodeMatch, dataDiskMatch, volume, segmentsNeeded, function(err, separationGroups) {
		if (err)
			return onError(err);

		const selected = selectDisksForRAID1(separationGroups, segmentsNeeded, scope.getEffectiveProtectionLevel(volume), volume.numberOfMirrors);
		if (selected.length < segmentsNeeded)
			return onError(new SystemMessage(systemMessages.UTILS_GET_DATA_DISKS_FOR_RAID1_FAILURE_NOT_ENOUGH_DRIVES));

		if (volume.domain) {
			const diskIDs = selected.map(d => d.disks.diskID);
			if (new Set(diskIDs).size !== diskIDs.length)
				return onError(new SystemMessage(systemMessages.UTILS_GET_DATA_DISKS_FOR_RAID1_FAILURE_DOMAIN_VIOLATION));
		}

		enrichDrives(selected, (err, enrichedDisks) => {
			if (err)
				return onError(err);

			callback(null, enrichedDisks);
		});
	});
}

scope.saveAutoRemovedDiskSegments = (diskSegmentsToRemove, volumeToRemove, callback) => {
	const db = app.get('db');
	const autoRemovedSegmentCollection = db.collection('autoRemovedSegment');

	//saving the removed disk segments into the autoRemoveSegment collection
	const $update = {
		$set: {
			volumeName: volumeToRemove.name,
			volumeUUID: volumeToRemove.uuid
		},
		$addToSet: { diskSegments: { $each: diskSegmentsToRemove } }
	};

	autoRemovedSegmentCollection.updateOne(
		{ volumeUUID: volumeToRemove.uuid },
		$update,
		{ upsert: true },
		err => {
			new SystemMessage(systemMessages.UTILS_FORCE_DELETE_VOLUMES_SAVE_AUTO_REMOVED_FAILURE)
				.addInfo(Entities.Error, err).addInfo(Entities.Volume.ID, volumeToRemove.name).addInfo(Entities.Volume.UUID, volumeToRemove.uuid).log();

			callback();
		}
	);
};

scope.forceDeleteVolume = function(volume, lockedZone, sanityInformation, cb) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');
	var serverCollection = db.collection('server');

	var volumeToRemove = volume;
	var diskSegmentsToRemove = [];
	var isSanity = (sanityInformation && typeof sanityInformation === 'object');
	var zoneToLock;
	//This series will:
	//1.Takes a lock in case we are not under lock (Rollback)
	//2.Gets the diskSegments of the given volume from the server collection
	//3.Removes from DB the disk segments of the volume from the disks and resets the values of largestSegmentAvailable to 0
	//4.Gets the affected disks from DB, calculates and saves to DB the largestSegmentAvailable of each drive that had a volume segment
	//5.Removes the volume from DB
	//6.Log the removed segments into autoRemovedSegment in case it was auto removed by sanity
	//7.Log the removed volume into autoRemovedVolume in case it was auto removed by sanity

	async.series([
		function getVolumeZones(cb) {
			var zones = zoneModule.getZonesByVolume(volume);

			// Volume can have only one zone
			zones.delete(lockedZone);
			if (zones.size > 0)
				zoneToLock = Array.from(zones)[0];

			cb();
		},
		function acquireLocks(callback) {
			if (!zoneToLock)
				return callback(null);

			lockModule.acquireLockByZone(zoneToLock, function(err) {
				callback(err);
			});
		},
		function validateSanityInformation(callback) {
			if (!isSanity)
				return callback();

			if (!sanityInformation.volumeQuery)
				return callback(`Missing volumeQuery in sanityInformation: ${JSON.stringify(sanityInformation)}`);

			let query = scope.extend(true, { _id: volumeToRemove._id }, sanityInformation.volumeQuery);
			let options = { projection: { _id: 1 } };

			volumeCollection.findOne(query, options, (err, res) => {
				if (err)
					return callback(new MongoError(err));

				if (!res)
					return callback(`Can't find volume ${volume._id} during forceDeleteVolume with the sanityInformation ${JSON.stringify(sanityInformation)}`);

				callback();
			});
		},
		function(callback) {
			//getting the diskSegments of the volume to remove from the server collection
			var match = { 'diskSegments.volumeUUID': volumeToRemove.uuid };

			if (volume.isExtension)
				match['diskSegments.extensionVolumeId'] = { $exists: true };

			serverCollection.aggregate([
				{
					$project: {
						'disks.diskID': 1,
						'disks.diskSegments': 1
					}
				},
				{ $unwind: '$disks' },
				{ $project: { diskSegments: '$disks.diskSegments' } },
				{ $unwind: '$diskSegments' },
				{ $match: match }
			]).toArray(function(err, results) {
				if (err) {
					new MongoError(err).log();
				} else if (results && results.length)
					results.forEach(function(res) {
						diskSegmentsToRemove.push(res.diskSegments);
					});

				callback(err);
			});
		},
		function(callback) {
			if (!isSanity || !diskSegmentsToRemove.length)
				return callback();

			scope.saveAutoRemovedDiskSegments(diskSegmentsToRemove, volumeToRemove, callback);
		},
		function(callback) {
			if (!isSanity)
				return callback();

			// saving the removed volume into the autoRemovedVolume collection
			scope.insertToCollection(volumeToRemove, 'autoRemovedVolume', function(err) {
				if (err)
					new SystemMessage(systemMessages.UTILS_FORCE_DELETE_VOLUMES_SAVE_AUTO_REMOVED_FAILURE).addInfo(Entities.Error, err)
						.addInfo(Entities.Volume.ID, volumeToRemove.name).addInfo(Entities.Volume.UUID, volumeToRemove.uuid).log();

				callback();
			});
		},
		function(callback) {
			scope.forceDeleteDiskSegments(diskSegmentsToRemove, callback);
		},
		function(callback) {
			//deleting the volume from volume collection
			volumeCollection.deleteMany({ _id: volumeToRemove._id }, function(err) {
				callback(err);
			});
		}
	], function(err) {
		var res = { id: volumeToRemove._id };

		if (err) {
			res.ex = err;
			res.success = false;

			err = new SystemMessage(systemMessages.UTILS_FORCE_DELETE_VOLUMES_DELETE_VOLUME_FAILURE)
				.addInfo(Entities.Error, err).addInfo(Entities.Volume.ID, volumeToRemove._id).log();
		} else {
			res.success = true;
		}

		if (zoneToLock > 0)
			lockModule.releaseLockByZone(zoneToLock, function() { cb(err, res); });
		else
			cb(err, res);
	});
};

scope.forceDeleteDiskSegments = function(diskSegmentsToRemove, cb) {
	const db = app.get('db');
	const serverCollection = db.collection('server');
	const lockCollection = db.collection('lock');

	if (!diskSegmentsToRemove.length)
		return cb();

	const zone = diskSegmentsToRemove.map(d => d.zone)[0];

	async.series([
		function pullOutDiskSegmentsFromDisks(callback) {
			async.eachSeries(diskSegmentsToRemove, function(ds, cb) {
				var delta = ds.lbe - ds.lbs;
				if (delta) delta++;

				serverCollection.updateMany({ 'disks.diskID': ds.diskID }, {
					$pull: { 'disks.$.diskSegments': { _id: ds._id } },
					$inc: {
						'disks.$.availableBlocks': (ds.fromReserved || ds.wasFromReserved) ? 0 : delta,
						'disks.$.version': 1
					},
					//Set The largestSegmentAvailable to zero, until it will be updated with the correct value.
					$set: { 'disks.$.largestSegmentAvailable': { blocks: 0, lbs: 0, lbe: 0 } }
				}, function(err) {
					if (err)
						err = new MongoError(err).log();

					cb(err);
				});
			}, function(err) {
				if (err) {
					logger.sysDEBUG(err);
				}

				callback(err);
			});
		},
		function updateLargestSegmentAvailable(callback) {
			//Take all the disks that were affected
			var updatedDisks = diskSegmentsToRemove.map(function(e) { return e.diskID; });

			//Make the array distinct
			updatedDisks = updatedDisks.filter(function(e, i) {
				return updatedDisks.lastIndexOf(e) === i;
			});

			async.waterfall([
				function(callback) {
					//get all the disks that needs to be updated.
					serverCollection.aggregate([
						{
							$project: {
								'disks.diskID': 1,
								'disks.diskSegments': 1,
								'disks.usableBlocks': 1,
								'disks.availableBlocks': 1,
								'disks.blocks': 1,
								'disks.block_size': 1,
								'disks.GPT.firstUsableLba': 1,
								'disks.GPT.lastUsableLba': 1
							}
						},
						{ $unwind: '$disks' },
						{ $match: { 'disks.diskID': { $in: updatedDisks } } },
						{
							$project: {
								diskID: '$disks.diskID',
								diskSegments: '$disks.diskSegments',
								usableBlocks: '$disks.usableBlocks',
								availableBlocks: '$disks.availableBlocks',
								blocks: '$disks.blocks',
								block_size: '$disks.block_size',
								'GPT.firstUsableLba': '$disks.GPT.firstUsableLba',
								'GPT.lastUsableLba': '$disks.GPT.lastUsableLba'
							}
						}
					]).toArray(function(err, results) {
						if (err)
							err = new MongoError(err).log();

						callback(err, results);
					});
				},
				function(disks, callback) {
					async.eachSeries(disks, function(disk, cb) {
						var largestSegmentAvailable = scope.getLargestSegment(disk);

						serverCollection.updateMany({ 'disks.diskID': disk.diskID }, {
							$set: { 'disks.$.largestSegmentAvailable': largestSegmentAvailable }
						}, function(err) {
							if (err)
								err = new MongoError(err).log();

							cb(err);
						});
					}, function(err) {
						callback(err);
					});
				}
			], function(err) {
				if (err) {
					logger.sysDEBUG('Update largestSegmentAvailable: Failed to update largestSegmentAvailable', err);
				}

				callback(err);
			});
		},
		function updateSegmentsInZone(callback) {
			const numberOfRemovedSegmentsFromZone = diskSegmentsToRemove.length;
			lockCollection.updateOne({ _id: zone }, { $inc: { segmentsInZone: -numberOfRemovedSegmentsFromZone } }, (err, result) => {
				if (err) {
					new MongoError(err).log();
				} else if (!result.modifiedCount) {
					err = new SystemMessage(systemMessages.FAILED_UPDATE_SEGMENTS_IN_ZONE).addInfo(Entities.Target.zone, zone).log();
				}

				callback(err);
			});
		}
	], function(err) {
		if (err)
			logger.sysERROR(err);

		cb(err);
	});
};

scope.commitReclaimRemovals = function(removals, cb) {
	const db = app.get('db');
	const serverCollection = db.collection('server');

	async.eachSeries(removals, (seg, nextSegment) => {
		const blocks = seg.lbe - seg.lbs + 1;
		serverCollection.updateOne(
			{ 'disks.diskID': seg.diskID },
			{
				$pull: { 'disks.$.diskSegments': { _id: seg._id } },
				$inc: { 'disks.$.availableBlocks': blocks, 'disks.$.version': 1 },
				$set: { 'disks.$.largestSegmentAvailable': { blocks: 0, lbs: 0, lbe: 0 } }
			},
			(err) => {
				if (err)
					new MongoError(err).log();

				nextSegment();
			}
		);
	}, cb);
};

// Commits pending-replace segments: atomically swaps original with replacements and updates
// reservedUUID on derived segments in a single pipeline update per replacement.
// `replacementItems` is an array of { diskID, originalDiskSegmentID, replacements: [...], freedBlocks }.
scope.commitReclaimReplacements = function(replacementItems, callback) {
	const db = app.get('db');
	const serverCollection = db.collection('server');

	async.eachSeries(replacementItems, (item, nextItem) => {
		// for each replacement segment, match derived segments (fromReserved=true) within its range and set their reservedUUID to the new UUID.
		const reservedUUIDBranches = item.replacements.map(replacementSegment => ({
			case: { $and: [
				{ $gte: ['$$seg.lbs', replacementSegment.lbs] },
				{ $lte: ['$$seg.lbe', replacementSegment.lbe] },
				{ $eq: ['$$seg.fromReserved', true] }
			] },
			then: { $mergeObjects: ['$$seg', { reservedUUID: replacementSegment.uuid }] }
		}));

		serverCollection.updateOne(
			{ 'disks.diskID': item.diskID },
			[{
				$set: {
					disks: {
						$map: {
							input: '$disks',
							as: 'disk',
							in: {
								$cond: [
									{ $eq: ['$$disk.diskID', item.diskID] },
									{
										$mergeObjects: [
											'$$disk',
											{
												// Filter out original, update reservedUUID on covered derived segments, append replacements
												diskSegments: {
													$concatArrays: [
														{ $map: {
															input: { $filter: {
																input: '$$disk.diskSegments',
																cond: { $ne: ['$$this._id', item.originalDiskSegmentID] }
															} },
															as: 'seg',
															in: {
																$switch: {
																	branches: reservedUUIDBranches,
																	default: '$$seg'
																}
															}
														} },
														item.replacements
													]
												},
												availableBlocks: { $add: ['$$disk.availableBlocks', item.freedBlocks] },
												version: { $add: ['$$disk.version', 1] },
												largestSegmentAvailable: { blocks: 0, lbs: 0, lbe: 0 }
											}
										]
									},
									'$$disk'
								]
							}
						}
					}
				}
			}],
			(err) => {
				if (err)
					new MongoError(err).log();

				nextItem();
			}
		);
	}, callback);
};

scope.recalculateLargestSegmentForDisks = function(diskIDs, cb) {
	const db = app.get('db');
	const serverCollection = db.collection('server');

	serverCollection.aggregate([
		{
			$project: {
				'disks.diskID': 1,
				'disks.diskSegments': 1,
				'disks.usableBlocks': 1,
				'disks.availableBlocks': 1,
				'disks.blocks': 1,
				'disks.block_size': 1,
				'disks.GPT.firstUsableLba': 1,
				'disks.GPT.lastUsableLba': 1
			}
		},
		{ $unwind: '$disks' },
		{ $match: { 'disks.diskID': { $in: diskIDs } } },
		{
			$project: {
				diskID: '$disks.diskID',
				diskSegments: '$disks.diskSegments',
				usableBlocks: '$disks.usableBlocks',
				availableBlocks: '$disks.availableBlocks',
				blocks: '$disks.blocks',
				block_size: '$disks.block_size',
				'GPT.firstUsableLba': '$disks.GPT.firstUsableLba',
				'GPT.lastUsableLba': '$disks.GPT.lastUsableLba'
			}
		}
	]).toArray((err, disks) => {
		if (err)
			return cb(new MongoError(err).log());

		async.eachSeries(disks, (disk, nextDisk) => {
			const largestSegmentAvailable = scope.getLargestSegment(disk);
			serverCollection.updateMany(
				{ 'disks.diskID': disk.diskID },
				{ $set: { 'disks.$.largestSegmentAvailable': largestSegmentAvailable } },
				(err) => {
					if (err)
						new MongoError(err).log();

					nextDisk();
				}
			);
		}, cb);
	});
};

// Builds a map of { reservedUUID -> [{ lbs, lbe }] } from derived volumes' fromReserved disk segments.
function buildUsedRangesByReservedUUID(derivedVolumes) {
	const usedRangesByReservedUUID = {};

	derivedVolumes.forEach(vol => {
		vol.chunks.forEach(chunk => {
			chunk.pRaids.forEach(pRaid => {
				pRaid.diskSegments.forEach(diskSegment => {
					if (diskSegment.fromReserved) {
						if (!usedRangesByReservedUUID[diskSegment.reservedUUID])
							usedRangesByReservedUUID[diskSegment.reservedUUID] = [];

						usedRangesByReservedUUID[diskSegment.reservedUUID].push({ lbs: diskSegment.lbs, lbe: diskSegment.lbe });
					}
				});
			});
		});
	});

	return usedRangesByReservedUUID;
}

// Merges sorted ranges into contiguous groups.
// e.g. [100-199, 200-299, 500-599] -> [100-299, 500-599]
function mergeContiguousRanges(ranges) {
	ranges.sort((a, b) => a.lbs - b.lbs);
	const groups = [];
	let groupStart = ranges[0].lbs;
	let groupEnd = ranges[0].lbe;

	for (const range of ranges) {
		if (range.lbs <= groupEnd + 1) {
			groupEnd = Math.max(groupEnd, range.lbe);
		} else {
			groups.push({ lbs: groupStart, lbe: groupEnd });
			groupStart = range.lbs;
			groupEnd = range.lbe;
		}
	}
	groups.push({ lbs: groupStart, lbe: groupEnd });

	return groups;
}

// Creates replacement segments for each used group across all pRaids in a chunk.
// Returns [{ blocks, pRaidSegments: [[seg, seg], [seg, seg]] }], one entry per group.
function buildGroupedReplacements(groups, refSeg, reservedVolumeChunk) {
	return groups.map(group => {
		const blocks = group.lbe - group.lbs + 1;
		const offset = group.lbs - refSeg.lbs;

		const pRaidSegments = reservedVolumeChunk.pRaids.map(pRaid =>
			pRaid.diskSegments.map(originalDiskSegment => {
				const newId = uuid.v1();

				return {
					...originalDiskSegment,
					_id: newId,
					uuid: newId,
					lbs: originalDiskSegment.lbs + offset,
					lbe: originalDiskSegment.lbs + offset + blocks - 1
				};
			})
		);

		return { blocks, pRaidSegments };
	});
}

// Updates reservedUUID on derived volume documents to match the new replacement segment UUIDs.
// uuidMap: { oldUUID: [{ uuid: newUUID, lbs, lbe }, ...], ... }
scope.updateReservedUUIDsOnDerivedVolumes = function(vpgId, uuidMap, cb) {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');

	const branches = [];
	for (const [oldUUID, replacements] of Object.entries(uuidMap)) {
		for (const replacement of replacements) {
			branches.push({
				case: { $and: [
					{ $eq: ['$$seg.reservedUUID', oldUUID] },
					{ $gte: ['$$seg.lbs', replacement.lbs] },
					{ $lte: ['$$seg.lbe', replacement.lbe] }
				] },
				then: { $mergeObjects: ['$$seg', { reservedUUID: replacement.uuid }] }
			});
		}
	}

	const pipeline = [{
		$set: {
			chunks: {
				$map: {
					input: '$chunks',
					as: 'chunk',
					in: {
						$mergeObjects: ['$$chunk', {
							pRaids: {
								$map: {
									input: '$$chunk.pRaids',
									as: 'pRaid',
									in: {
										$mergeObjects: ['$$pRaid', {
											diskSegments: {
												$map: {
													input: '$$pRaid.diskSegments',
													as: 'seg',
													in: { $switch: { branches, default: '$$seg' } }
												}
											}
										}]
									}
								}
							}
						}]
					}
				}
			}
		}
	}];

	volumeCollection.updateMany(
		{ VPG: vpgId, _id: { $ne: vpgId }, isReserved: { $ne: true } },
		pipeline,
		(err) => {
			if (err)
				new MongoError(err).log();
			cb();
		}
	);
};

/**
 * Reclaims all unused reserved space for a VPG by shrinking/splitting reserved disk segments
 * to tightly fit only the portions actually used by derived volumes.
 * Reclaims head gaps, tail gaps, and interior gaps (from deleted volumes).
 **/
scope.shrinkReservedSpaceVolume = function(vpgId, targetCapacityGB, cb) {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');
	const serverCollection = db.collection('server');
	const lockCollection = db.collection('lock');

	let reservedVolume;
	// Unused reserved segments to remove entirely from disks (for example a chunk that is not used by any volume)
	let segmentsToRemove = [];
	// Partially used reserved segments to replace with fitting ones
	let segmentReplacements = [];
	let affectedDiskIds = new Set();
	let updatedChunks = [];
	// Maps old reserved segment UUIDs to new replacement UUIDs for updating derived volumes
	let reclaimUUIDMap = {};

	async.series([
		function fetchReservedVolume(callback) {
			volumeCollection.findOne({ _id: vpgId, isReserved: true }, (err, result) => {
				if (err)
					return callback(new MongoError(err).log());

				if (!result)
					return callback(new SystemMessage(systemMessages.VPG_RESERVED_VOLUME_NOT_FOUND));

				reservedVolume = result;
				callback();
			});
		},
		// Queries derived volumes and uses reservedUUID to directly map which reserved segments are in use.
		// Merges derived segments into contiguous groups per reserved segment, then identifies
		// segments to remove (fully free) or replace (partially used with gaps).
		// Also builds updatedChunks with one chunk per contiguous used group (uniform segment sizes).
		function identifyReclaimableSegments(callback) {
			const diskSegmentsProjection = {
				'chunks.pRaids.diskSegments.lbs': 1,
				'chunks.pRaids.diskSegments.lbe': 1,
				'chunks.pRaids.diskSegments.fromReserved': 1,
				'chunks.pRaids.diskSegments.reservedUUID': 1
			};
			volumeCollection.find(
				{ VPG: vpgId, _id: { $ne: vpgId }, isReserved: { $ne: true } },
				{ projection: diskSegmentsProjection }
			).toArray((err, derivedVolumes) => {
				if (err)
					return callback(new MongoError(err).log());

				const usedRangesByReservedUUID = buildUsedRangesByReservedUUID(derivedVolumes);
				const vlbsMultiplier = ((reservedVolume.dataBlocks * reservedVolume.stripeWidth) || reservedVolume.stripeWidth) || 1;
				let vlbs = 0;
				let stripeIndex = 0;

				reservedVolume.chunks.forEach(reservedVolumeChunk => {
					// Use the first pRaid's first disk segment as reference.
					// All disks in a pRaid share the same logical gap structure.
					const refSeg = reservedVolumeChunk.pRaids[0].diskSegments[0];
					const refOrigBlocks = refSeg.lbe - refSeg.lbs + 1;

					// Look up derived segments directly by the reference segment's UUID
					const derivedRanges = usedRangesByReservedUUID[refSeg.uuid] || [];

					// No derived volumes use any segment in this chunk (can happen when the reserved
					// volume spans multiple chunks and all volumes were allocated from other chunks).
					if (!derivedRanges.length) {
						reservedVolumeChunk.pRaids.forEach(pRaid => {
							pRaid.diskSegments.forEach(ds => {
								segmentsToRemove.push(ds);
								affectedDiskIds.add(ds.diskID);
							});
						});
						return;
					}

					const groups = mergeContiguousRanges(derivedRanges);
					const keptBlocks = groups.reduce((sum, currGroup) => sum + (currGroup.lbe - currGroup.lbs + 1), 0);

					// Reserved segment is fully used, nothing to reclaim.
					if (keptBlocks === refOrigBlocks) {
						updatedChunks.push({
							...reservedVolumeChunk,
							vlbs,
							vlbe: vlbs + refOrigBlocks * vlbsMultiplier - 1,
							pRaids: reservedVolumeChunk.pRaids.map(pRaid => ({ ...pRaid, stripeIndex: stripeIndex++ }))
						});

						vlbs += refOrigBlocks * vlbsMultiplier;
						return;
					}

					const groupedReplacements = buildGroupedReplacements(groups, refSeg, reservedVolumeChunk);

					// Build disk level replacement entries for markPendingOnDisks and commitPendingReclaim.
					const freedBlocks = refOrigBlocks - keptBlocks;
					reservedVolumeChunk.pRaids.forEach((pRaid, pRaidIndex) => {
						pRaid.diskSegments.forEach((origDS, dsIndex) => {
							segmentReplacements.push({
								original: origDS,
								replacements: groupedReplacements.map(gr => gr.pRaidSegments[pRaidIndex][dsIndex]),
								freedBlocks
							});
							affectedDiskIds.add(origDS.diskID);
						});
					});

					// Build new chunks, one per used group, with uniform segment sizes.
					// Uses the same segment objects as segmentReplacements so UUIDs match.
					groupedReplacements.forEach(gr => {
						const newChunkId = uuid.v1();

						updatedChunks.push({
							_id: newChunkId,
							uuid: newChunkId,
							isReserved: true,
							vlbs,
							vlbe: vlbs + gr.blocks * vlbsMultiplier - 1,
							zone: reservedVolumeChunk.zone,
							pRaids: reservedVolumeChunk.pRaids.map((pRaid, pRaidIdx) => ({
								activated: pRaid.activated,
								version: pRaid.version,
								tomaLeaderRaftTerm: pRaid.tomaLeaderRaftTerm,
								zone: pRaid.zone,
								uuid: uuid.v1(),
								stripeIndex: stripeIndex++,
								diskSegments: gr.pRaidSegments[pRaidIdx]
							}))
						});

						vlbs += gr.blocks * vlbsMultiplier;
					});
				});

				callback();
			});
		},
		// PENDING PHASE: mark segments with pendingReclaim flags without modifying disk layout.
		// No segments are removed/added, no availableBlocks changes. If management crashes here,
		// sanity rolls back by simply unsetting the flags.
		function markPendingOnDisks(callback) {
			if (!segmentsToRemove.length && !segmentReplacements.length)
				return callback();

			function setPendingReclaimOnSegment(diskID, segmentId, pendingReclaim, cb) {
				serverCollection.updateOne(
					{ 'disks.diskID': diskID, 'disks.diskSegments._id': segmentId },
					{ $set: { 'disks.$[disk].diskSegments.$[seg].pendingReclaim': pendingReclaim } },
					{
						arrayFilters: [
							{ 'disk.diskID': diskID },
							{ 'seg._id': segmentId }
						]
					},
					(err) => {
						if (err)
							err = new MongoError(err).log();

						cb(err);
					}
				);
			}

			async.series([
				function markRemovals(cb) {
					async.eachSeries(segmentsToRemove, (diskSegment, nextSegment) => {
						setPendingReclaimOnSegment(diskSegment.diskID, diskSegment._id, {
							vpgId,
							type: consts.segmentPendingReclaimTypes.REMOVAL
						}, nextSegment);
					}, cb);
				},
				function markReplacements(cb) {
					async.eachSeries(segmentReplacements, (replacement, nextSegment) => {
						setPendingReclaimOnSegment(replacement.original.diskID, replacement.original._id, {
							vpgId,
							type: consts.segmentPendingReclaimTypes.REPLACE,
							replacements: replacement.replacements,
							freedBlocks: replacement.freedBlocks
						}, nextSegment);
					}, cb);
				}
			], callback);
		},
		// COMMIT POINT: write the pre-computed chunk structure to the reserved volume.
		// Set reclaimAction to COMMITTING so allocation stays blocked until the actual disk changes are applied.
		// Store reclaimUUIDMap so sanity can update derived volumes' reservedUUID if management crashes.
		/// If management crashes after this step, sanity will complete the pending disk operations.
		function updateReservedVolume(callback) {
			if (!segmentsToRemove.length && !segmentReplacements.length)
				return callback();

			segmentReplacements.forEach(segmentReplacement => {
				reclaimUUIDMap[segmentReplacement.original.uuid] = segmentReplacement.replacements
					.map(replacement => ({ uuid: replacement.uuid, lbs: replacement.lbs, lbe: replacement.lbe }));
			});

			const newBlocks = Math.floor(targetCapacityGB * consts.GB / consts.BLOCK_SIZE);
			volumeCollection.updateOne(
				{ _id: vpgId, isReserved: true },
				{
					$set: {
						chunks: updatedChunks,
						blocks: newBlocks,
						capacity: targetCapacityGB,
						reclaimAction: consts.reservedVolumeReclaimActions.COMMITTING,
						reclaimUUIDMap
					}
				},
				err => {
					if (err)
						return callback(new MongoError(err).log());

					callback();
				}
			);
		},
		// APPLY PHASE: perform the actual disk changes for segments marked as pending.
		function commitPendingReclaim(callback) {
			if (!segmentsToRemove.length && !segmentReplacements.length)
				return callback();

			const replacementItems = segmentReplacements.map(segmentReplacement => ({
				diskID: segmentReplacement.original.diskID,
				originalDiskSegmentID: segmentReplacement.original._id,
				replacements: segmentReplacement.replacements,
				freedBlocks: segmentReplacement.freedBlocks
			}));

			async.series([
				cb => scope.commitReclaimRemovals(segmentsToRemove, cb),
				cb => scope.commitReclaimReplacements(replacementItems, cb)
			], callback);
		},
		function updateDerivedVolumeReservedUUIDs(callback) {
			scope.updateReservedUUIDsOnDerivedVolumes(vpgId, reclaimUUIDMap, callback);
		},
		function recalculateLargestSegmentAvailable(callback) {
			scope.recalculateLargestSegmentForDisks([...affectedDiskIds], callback);
		},
		function updateSegmentsInZone(callback) {
			const segmentsInZone = {};
			segmentsToRemove.forEach(diskSegment => {
				if (diskSegment.zone)
					segmentsInZone[diskSegment.zone] = (segmentsInZone[diskSegment.zone] || 0) + 1;
			});
			segmentReplacements.forEach(replacement => {
				const net = 1 - replacement.replacements.length;
				if (replacement.original.zone)
					segmentsInZone[replacement.original.zone] = (segmentsInZone[replacement.original.zone] || 0) + net;
			});

			const zoneKeys = Object.keys(segmentsInZone).filter(zone => segmentsInZone[zone] !== 0);
			if (!zoneKeys.length)
				return callback();

			async.eachSeries(zoneKeys, (zone, cb) => {
				lockCollection.updateOne(
					{ _id: zone },
					{ $inc: { segmentsInZone: -segmentsInZone[zone] } },
					(err) => {
						if (err)
							new MongoError(err).log();
						cb();
					}
				);
			}, callback);
		},
		// Clear the COMMITTING reclaimAction now that all changes are applied.
		function clearReclaimAction(callback) {
			volumeCollection.updateOne(
				{ _id: vpgId, isReserved: true },
				{ $unset: { reclaimAction: 1, reclaimUUIDMap: 1 } },
				(err) => {
					if (err)
						new MongoError(err).log();

					callback();
				}
			);
		}
	], (err) => cb(err));
};

scope.forceDeleteVolumes = function(volumes, lockedZones, isSanity, cb) {
	if (!Array.isArray(volumes))
		volumes = [volumes];

	var results = [];
	async.eachSeries(volumes, function(volume, callback) {
		scope.forceDeleteVolume(volume, lockedZones, isSanity, function(err, data) {
			results.push(data);

			callback(err);
		});
	}, function(err) {
		cb(err, results);
	});
};

scope.getVPGByID = function(vpgID, cb) {
	var db = app.get('db');
	var vpgCollection = db.collection('volumeProvisioningGroup');

	vpgCollection.find({ _id: vpgID }).toArray(function(err, results) {
		if (err)
			err = new MongoError(err).log();

		cb(err, results);
	});
};

scope.count = function(collectionName, match, cb) {
	var db = app.get('db');
	var collection = db.collection(collectionName);

	collection.countDocuments(match ? match : {}, function(err, results) {
		if (err)
			err = new MongoError(err).log();

		cb(err, results);
	});
};

//jQuery implementation for deep copy of obj - jQuery version 3.7.1
/* eslint-disable */
scope.extend = function () {
	var options, name, src, copy, copyIsArray, clone,
		target = arguments[0] || {},
		i = 1,
		length = arguments.length,
		deep = false,
		getProto = Object.getPrototypeOf,
		class2type = {},
		toString = class2type.toString,
		hasOwn = class2type.hasOwnProperty,
		fnToString = hasOwn.toString,
		ObjectFunctionString = fnToString.call(Object),
		isFunction = function (obj) {
			return typeof obj === "function" && typeof obj.nodeType !== "number" &&
				typeof obj.item !== "function";
		},
		isPlainObject = function (obj) {
			var proto, Ctor;

			// Detect obvious negatives
			// Use toString instead of jQuery.type to catch host objects
			if (!obj || toString.call(obj) !== "[object Object]") {
				return false;
			}

			proto = getProto(obj);

			// Objects with no prototype (e.g., `Object.create( null )`) are plain
			if (!proto) {
				return true;
			}

			// Objects with prototype are plain iff they were constructed by a global Object function
			Ctor = hasOwn.call(proto, "constructor") && proto.constructor;
			return typeof Ctor === "function" && fnToString.call(Ctor) === ObjectFunctionString;
		};

	// Handle a deep copy situation
	if (typeof target === "boolean") {
		deep = target;

		// Skip the boolean and the target
		target = arguments[i] || {};
		i++;
	}

	// Handle case when target is a string or something (possible in deep copy)
	if (typeof target !== "object" && !isFunction(target)) {
		target = {};
	}

	// Extend jQuery itself if only one argument is passed
	if (i === length) {
		target = this;
		i--;
	}

	for (; i < length; i++) {

		// Only deal with non-null/undefined values
		if ((options = arguments[i]) != null) {

			// Extend the base object
			for (name in options) {
				copy = options[name];

				// Prevent Object.prototype pollution
				// Prevent never-ending loop
				if (name === "__proto__" || target === copy) {
					continue;
				}

				// Recurse if we're merging plain objects or arrays
				if (deep && copy && (isPlainObject(copy) ||
					(copyIsArray = Array.isArray(copy)))) {
					src = target[name];

					// Ensure proper type for the source value
					if (copyIsArray && !Array.isArray(src)) {
						clone = [];
					} else if (!copyIsArray && !isPlainObject(src)) {
						clone = {};
					} else {
						clone = src;
					}
					copyIsArray = false;

					// Never move original objects, clone them
					target[name] = scope.extend(deep, clone, copy);

					// Don't bring in undefined values
				} else if (copy !== undefined) {
					target[name] = copy;
				}
			}
		}
	}

	// Return the modified object
	return target;
};
/* eslint-enable */

scope.getMaxOfArray = function(arr) {
	return Math.max.apply(null, arr);
};

scope.tryParseJSON = function(jsonString) {
	if (jsonString === undefined || jsonString === '')
		return false;

	try {
		var o = JSON.parse(jsonString);

		scope.parseDatetime(o);

		//Handle non-exception-throwing cases:
		if (o && typeof o === 'object' && o !== null)
			return o;
		/* eslint-disable-next-line */
	} catch (e) { }

	return false;
};

scope.tryParseInt = function(stringValue) {
	try {
		return parseInt(stringValue);
	} catch (ex) {
		return null;
	}
};

scope.parseDatetime = function(jsonObj) {
	for (var key in jsonObj) {
		var regex = /[\d]{4}-[\d]{2}-[\d]{2}T[\d]{2}:[\d]{2}:[\d]{2}.[\d]{3}Z/;
		if (typeof jsonObj[key] === 'string' || jsonObj[key] instanceof String) {
			if (jsonObj[key].match(regex))
				jsonObj[key] = new Date(jsonObj[key]);
		} else if (typeof jsonObj[key] === 'object' && jsonObj[key] !== null) {
			scope.parseDatetime(jsonObj[key]);
		}
	}

	return jsonObj;
};

scope.incZonesConfigurationVersion = function(zones, cb) {
	var db = app.get('db');
	var versionCollection = db.collection('configurationVersion');

	async.eachSeries(Array.from(zones), (zone, callback) => {
		versionCollection.updateOne({ _id: zone }, { $inc: { configurationVersion: 1 } }, (err) => {
			if (err)
				new MongoError(err).log();

			callback();
		});
	}, (err) => {
		if (cb)
			cb(err);
	});
};

scope.getStatus = function(skipLogs, cb) {
	var db = app.get('db');
	var nvmeshMetadataDB = app.get('nvmeshMetadataDB');
	var logCollection = db.collection('log');
	var clientCollection = db.collection('client');
	var serverCollection = db.collection('server');
	var volumeCollection = db.collection('volume');
	var status = { servers: {}, clients: {}, volumes: {} };

	var logProjection = { _id: 0, message: 1, timestamp: 1, 'meta.header': 1 };

	var date = new Date();
	date.setMinutes(date.getMinutes() - 5);
	var lessThenFiveMinutes = { $lt: date };

	async.parallel([
		//Get management version.
		function(callback) {
			status.managementVersion = app.get('managementVersion');
			status.dbUUID = app.get('dbUUID');
			callback();
		},
		function getClusterID(callback) {
			nvmeshMetadata.getClusterID((clusterID) => {
				status.clusterID = {
					id: clusterID ? clusterID.id : '',
					uuid: clusterID ? clusterID.uuid : ''
				};

				callback();
			});
		},
		//Get NVMesh Metadata identification.
		function getIdentificationInfo(callback) {
			var identificationCollection = nvmeshMetadataDB.collection('identification');
			identificationCollection.findOne({}, (_, identData) => {
				if (identData) {
					delete identData._id;
					status.identification = identData;
				}
				callback();
			});
		},
		//Get warnings.
		function(callback) {
			if (skipLogs)
				return callback();

			logCollection.find({ level: 'WARNING', 'meta.acknowledged': { $ne: true } }).project(logProjection).toArray(function(err, results) {
				if (err)
					err = new MongoError(err);

				status.warnings = results;
				callback(err);
			});
		},
		//Get errors.
		function(callback) {
			if (skipLogs)
				return callback();

			logCollection.find({ level: 'ERROR', 'meta.acknowledged': { $ne: true } }).project(logProjection).toArray(function(err, results) {
				if (err)
					err = new MongoError(err);

				status.errors = results;
				callback(err);
			});
		},
		//Get total servers
		function(callback) {
			serverCollection.countDocuments(function(err, count) {
				if (err)
					err = new MongoError(err);

				status.servers.totalServers = count;
				callback(err);
			});
		},
		//Get offline server
		function(callback) {
			serverCollection.countDocuments({ node_status: { $ne: 1 } }, function(err, count) {
				if (err)
					err = new MongoError(err);

				status.servers.offlineServers = count;
				callback(err);
			});
		},
		//Get timed out servers
		function(callback) {
			serverCollection.countDocuments({ dateModified: lessThenFiveMinutes }, function(err, count) {
				if (err)
					err = new MongoError(err);

				status.servers.timedOutServers = count;
				callback(err);
			});
		},
		//Get total clients
		function(callback) {
			clientCollection.countDocuments(function(err, count) {
				if (err)
					err = new MongoError(err);

				status.clients.totalClients = count;
				callback(err);
			});
		},
		//Get offline clients
		function(callback) {
			clientCollection.countDocuments({ client_status: { $ne: 1 } }, function(err, count) {
				if (err)
					err = new MongoError(err);

				status.clients.offlineClients = count;
				callback(err);
			});
		},
		//Get timed out clients
		function(callback) {
			clientCollection.countDocuments({ dateModified: lessThenFiveMinutes }, function(err, count) {
				if (err)
					err = new MongoError(err);

				status.clients.timedOutClients = count;
				callback(err);
			});
		},
		//Get volumes count
		function(callback) {
			const groupByRaidLevelPipeline = [
				{
					$group: { _id: '$RAIDLevel',
						...[consts.targetHealth.HEALTHY, consts.targetHealth.ALARM, consts.targetHealth.CRITICAL]
							.reduce(
								(acc, currHealth) => {
									acc[currHealth] = { $push: { $cond: [{ $eq: ['$newHealth', currHealth] }, '$_id', '$$REMOVE'] } };
									return acc;
								},
								{}
							) }
				}
			];

			const pipeline = volumeModule.getVolumesHealthCalculationPipeline().concat(groupByRaidLevelPipeline);
			volumeCollection.aggregate(pipeline).toArray(function(err, results) {
				if (err)
					err = new MongoError(err);

				results.forEach(function(e) {
					status.volumes[e._id] = { healthy: e.healthy, alarm: e.alarm, critical: e.critical };
				});

				callback(err);
			});
		},
		//Get space allocation
		function(callback) {
			zoneModule.getSpaceAllocation({}, {}, false, function(err, results) {
				if (results) {
					var spaceAllocation = results;
					status.totalSpace = spaceAllocation.totalCapacity;
					status.allocatedSpace = spaceAllocation.totalCapacity - spaceAllocation.availableSpace;
					status.freeSpace = spaceAllocation.availableSpace;
				}

				callback(err);
			});
		}],
	function(err) {
		if (err)
			logger.sysDEBUG('Failed to export status query', err);

		if (cb)
			cb(status);
	}
	);
};

scope.zeroFill = function(number, width = consts.TARGET_ID_DEFAULT_LENGTH) {
	width -= number.toString().length;

	if (width > 0) {
		number += '_';
		for (var i = 0; i < width - 1; i++)
			number += '0';
	}
	return number + '';
};

scope.getPhoneHomeUser = function(cb) {
	var db = app.get('db');
	var userCollection = db.collection('user');

	userCollection.findOne({ _id: consts.PHONE_HOME_USER }, function(err, user) {
		if (err)
			new MongoError(err).log();

		cb(user);
	});
};

scope.isAdmin = function(user) {
	return user.role === consts.userRoles.ADMIN;
};

scope.isEmpty = function(obj) {
	for (var prop in obj) {
		if (Object.prototype.hasOwnProperty.call(obj, prop))
			return false;
	}

	return true;
};

scope.getDefaultDomain = function(cb) {
	var db = app.get('db');
	var globalSettings = db.collection('globalSettings');

	globalSettings.findOne({}, function(err, data) {
		if (err)
			new MongoError(err).log();

		if (data && data.domain)
			data = data.domain;

		cb(data);
	});
};

scope.getAuthenticationEmail = (user, authCB) => {
	let authenticationEmail = user;

	if (!user || user.includes('@'))
		authCB(authenticationEmail);
	else
		// get default domain from DB
		scope.getDefaultDomain(domain => {
			if (domain)
				authenticationEmail = user + domain;

			authCB(authenticationEmail);
		});
};

scope.updateDefaultDomain = function(domain, cb) {
	var db = app.get('db');
	var globalSettings = db.collection('globalSettings');

	if (domain.indexOf('@') == -1)
		domain = '@' + domain;

	globalSettings.updateOne({}, { $set: { 'domain': domain } }, function(err) {
		if (err) {
			new MongoError(err).log();
		} else {
			new SystemMessage(systemMessages.UTILS_UPDATE_DEFAULT_DOMAIN).addInfo(Entities.ManagementDefaultDomain, domain.split('@')[1]).log();
		}
		cb(err);
	});
};

scope.getQueryStrings = function(url, parseToJSON) {
	var result = {};
	var decode = function(s) { return decodeURIComponent(s.replace(/\+/g, ' ')); };
	var queryString = url.substring(url.indexOf('?') + 1);
	var keyValues = queryString.split('&');

	for (var i in keyValues) {
		var key = keyValues[i].split('=');
		if (key.length > 1)
			result[decode(key[0])] = parseToJSON ? JSON.parse(decode(key[1])) : decode(key[1]);
	}

	return result;
};

// this function creates a javascript object from a bash variables declaration files
// bash file example:
//
// COMMIT_ID="some commit id"
// GIT_DESCRIBE="git-describe"
//
// will result in the object: { COMMIT_ID: "some commit id", GIT_DESCRIBE: "git-describe" }
scope.readBashVariablesFile = function(filename, cb) {
	fs.readFile(filename, 'utf-8', function(err, data) {
		if (err) {
			err = new SystemMessage(systemMessages.UTILS_READ_BASH_VARIABLES_FILE_FAILURE).addInfo(Entities.Error, err).log();
			return cb(err, data);
		}

		var lines = data.split('\n').filter(Boolean);

		var variables = {};
		for (var i = 0; i < lines.length; i++) {
			var lineArray = lines[i].split('=');
			var key = lineArray[0];
			var value = lineArray[1];

			// value should be cleaned of wrapped quotes - if exists
			value = value.replace(/^"|"$/g, '');
			variables[key] = value;
		}

		cb(err, variables);
	});
};

scope.readVersionFile = function(cb) {
	scope.readBashVariablesFile(path.join(__dirname, 'version'), cb);
};

scope.mapDiskToModel = function(disksInDB) {
	var diskToModel = {};

	// maps each disk to its model
	for (let modelDisks of disksInDB) {
		for (let i = 0; i < modelDisks.disks.length; i++) {
			diskToModel[modelDisks.disks[i].id] = modelDisks._id.model;
		}
	}

	return diskToModel;
};

scope.getCollectionSetByKey = function(collectionInDB, keySelector) {
	var result = new Set([]);

	for (let document of collectionInDB) {
		result.add(keySelector(document));
	}

	return result;
};

// if one of the value is undefined, the field will not be seen on the client side, making the API response structure not consistent
scope.createApiResponse = function(_id = null, uuid = null, success = null, error = null, payload = null) {
	return { _id, uuid, success, error, payload };
};

const isApiResponse = (e) => typeof e === 'object' && Object.keys(scope.createApiResponse()).every((key) => Object.prototype.hasOwnProperty.call(e, key));

const getDeprecationWarning = () => ({
	message: 'This endpoint is deprecated and will be removed in the next release.',
	currentRelease: app.get('rpmVersion'),
	documentation: getDocumentationURL()
});

const getDocumentationURL = () => {
	const protocol = config.get('useSSL') ? 'https' : 'http';
	const host = app.get('hostname') || app.get('ipAddress') || 'localhost';
	const port = config.get('port');

	return `${protocol}://${host}:${port}/docs/index.html`;
};

scope.deprecateApiResponses = (body) => {
	if (Array.isArray(body))
		body.forEach(item => isApiResponse(item) && (item.deprecationWarning = getDeprecationWarning()));
	else if (isApiResponse(body))
		body.deprecationWarning = getDeprecationWarning();

	return body;
};

scope.isEqualSet = (a, b) => {
	if (a.size === b.size)
		return [...a].every(value => b.has(value));

	return false;
};

scope.getHandlingMgmtParams = () => {
	return {
		managementId: app.get('managementId'),
		bootVersion: app.get('bootVersion')
	};
};

scope.durationToSeconds = function(str) {
	var seconds = 0;
	var weeks = str.match(/(\d+)\s*w/);
	var days = str.match(/(\d+)\s*d/);
	var hours = str.match(/(\d+)\s*h/);
	var minutes = str.match(/(\d+)\s*m/);
	var secondsMatch = str.match(/(\d+)\s*s/);
	if (secondsMatch) { seconds += parseInt(secondsMatch[1]); }
	if (weeks) { seconds += parseInt(weeks[1]) * 604800; }
	if (days) { seconds += parseInt(days[1]) * 86400; }
	if (hours) { seconds += parseInt(hours[1]) * 3600; }
	if (minutes) { seconds += parseInt(minutes[1]) * 60; }
	return seconds;
};

scope.getCachedStats = function(cachedStatsName, clearCache, cacheInit = {}) {
	var cachedStats = app.get(cachedStatsName);

	if (clearCache) {
		app.set(cachedStatsName, cacheInit);
		cachedStats = cacheInit;
	}

	return cachedStats;
};

scope.getCachedTimedIntervals = function(clearCache) {
	if (clearCache) {
		var executionTimers = app.get('executionTimers');

		if (executionTimers && executionTimers.length) {
			executionTimers.forEach((t) => t.stop());
			app.set('executionTimers', []);
		}
	}

	return scope.getCachedStats('timedIntervals', clearCache, { intervals: {} });
};

scope.collectCommStats = function(message) {
	var comm = app.get('communicationStats');
	var registrantStats;

	if (!comm[message.registrant.id])
		comm[message.registrant.id] = { total: 0, routes: {} };


	registrantStats = comm[message.registrant.id];
	registrantStats.total++;

	if (message.messageType) {
		if (!registrantStats.routes[message.messageType]) {
			var registrant = message.registrant.type ? message.registrant.type : '';
			registrantStats.routes[message.messageType] = { registrant: registrant, total: 0 };
		}

		registrantStats.routes[message.messageType].total++;
	}

	app.set('communicationStats', comm);
};

scope.makeDir = function(dir) {
	var success = true;
	try {
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir);
		}
	} catch (e) {
		new SystemMessage(systemMessages.UTILS_MAKE_DIR_FAILURE).addInfo(Entities.Path, dir).addInfo(Entities.Exception, e).log();

		success = false;
	}

	return success;
};

scope.writeToFile = function(filePath, data) {
	fs.writeFile(filePath, data, { flag: 'w+', encoding: 'utf8' }, (err) => {
		if (err)
			new SystemMessage(systemMessages.UTILS_WRITE_TO_FILE_FAILURE).addInfo(Entities.Path, filePath).addInfo(Entities.Error, err).log();
	});
};


scope.equalInValue = function(a, b) {
	if (a === null)
		return b === null;

	if (Array.isArray(a) != Array.isArray(b))
		return false;

	if (typeof a !== typeof b)
		return false;

	if (!(typeof a === 'object'))
		return a == b;

	var aKeys = Object.keys(a);
	var bKeys = Object.keys(b);
	if (aKeys.length != bKeys.length)
		return false;

	for (var i = 0; i < aKeys.length; i++) {
		var key = aKeys[i];
		if (!(key in b))
			return false;

		if (!scope.equalInValue(a[key], b[key]))
			return false;
	}

	return true;
};

scope.getDebugLoggerWithPrefix = function(prefixMsg) {
	return (debugMsg, data) => {
		var msg = prefixMsg + debugMsg;
		if (data)
			logger.sysDEBUG(msg, data);
		else
			logger.sysDEBUG(msg);
	};
};

// calcDelta is an object that saves all the changes needed to be save by set / push / pull and generates the right query
// PAY ATTENTION that push and pull cannot be done together for the same entitiy (nic/disk/diskSegment) at the same query
class calcDelta {
	constructor() {
		this.delta = {};
		this.unsetDelta = {};
		this.pushDiskDelta = [];
		this.pullDiskDelta = [];
		this.pullSegmentsDelta = {};
		this.pushSegmentsDelta = {};
		this.pushNicDelta = [];
		this.pullNicDelta = [];
	}

	updateTarget(target, key, value) {
		target[key] = value;
		this.delta[key] = value;
	}

	updateObjectInTarget(target, objectName, key, value) {
		if (!(objectName in target))
			target[objectName] = {};

		target[objectName][key] = value;

		this.delta[objectName] = target[objectName];
	}

	updateDisk(disk, uuid, key, value) {
		disk[key] = value;

		if (!('disks' in this.delta))
			this.delta.disks = {};

		if (!(uuid in this.delta.disks))
			this.delta.disks[uuid] = {};

		this.delta.disks[uuid][key] = value;
	}

	incDiskField(disk, uuid, key) {
		disk[key] = disk[key] + 1; // might differ from the actual version saved to DB

		if (!('disks' in this.delta))
			this.delta.disks = {};

		if (!(uuid in this.delta.disks))
			this.delta.disks[uuid] = {};

		if (!('$inc' in this.delta.disks[uuid]))
			this.delta.disks[uuid].$inc = [];

		this.delta.disks[uuid].$inc.push(key);
	}

	updateDiskSecondLevel(disk, uuid, key, innerKey, value) {
		if (!(key in disk))
			disk[key] = {};

		disk[key][innerKey] = value;

		if (!('disks' in this.delta))
			this.delta.disks = {};

		if (!(uuid in this.delta.disks))
			this.delta.disks[uuid] = {};

		if (!(key in this.delta.disks[uuid]))
			this.delta.disks[uuid][key] = {};

		this.delta.disks[uuid][key][innerKey] = value;
	}

	unsetFromDisk(disk, uuid, key) {
		delete disk[key];
		if (!('disks' in this.unsetDelta))
			this.unsetDelta.disks = {};

		if (!(uuid in this.unsetDelta.disks))
			this.unsetDelta.disks[uuid] = [];

		this.unsetDelta.disks[uuid].push(key);
	}

	pushDiskToTarget(target, disk) {
		if (target.disks == null || !Array.isArray(target.disks))
			target.disks = [];

		//target.disks.push(disk);
		this.pushDiskDelta.push(disk);
	}

	pullDiskFromTarget(target, diskUUID, diskIdx) {
		target.disks.splice(diskIdx, 1);
		this.pullDiskDelta.push(diskUUID);
	}

	pullDiskSegmentsFromDisk(disk, uuid, diskSegmentsToPullUUIDs) {
		disk.diskSegments = disk.diskSegments.filter(function(seg) { return diskSegmentsToPullUUIDs.indexOf(seg.uuid) === -1; });

		if (!(uuid in this.pullSegmentsDelta))
			this.pullSegmentsDelta[uuid] = [];

		this.pullSegmentsDelta[uuid] = this.pullSegmentsDelta[uuid].concat(diskSegmentsToPullUUIDs);
	}

	pushDiskSegmentToDisk(disk, diskUUID, diskSegmentToPush) {
		if (disk.diskSegments && Array.isArray(disk.diskSegments))
			disk.diskSegments.push(diskSegmentToPush);
		else
			disk.diskSegments = [diskSegmentToPush];

		if (!(diskUUID in this.pushSegmentsDelta))
			this.pushSegmentsDelta[diskUUID] = [];

		this.pushSegmentsDelta[diskUUID].push(diskSegmentToPush);
	}

	updateNic(nic, uuid, key, value) {
		nic[key] = value;

		if (!('nics' in this.delta))
			this.delta.nics = {};

		if (!(uuid in this.delta.nics))
			this.delta.nics[uuid] = {};

		this.delta.nics[uuid][key] = value;
	}

	incNicField(nic, uuid, key) {
		nic[key] = nic[key] + 1; // might differ from the actual version saved to DB

		if (!('nics' in this.delta))
			this.delta.nics = {};

		if (!(uuid in this.delta.nics))
			this.delta.nics[uuid] = {};

		if (!('$inc' in this.delta.nics[uuid]))
			this.delta.nics[uuid].$inc = [];

		this.delta.nics[uuid].$inc.push(key);
	}

	pushNicToTarget(target, nic) {
		if (target.nics == null || !Array.isArray(target.nics))
			target.nics = [];

		//target.nics.push(nic);
		this.pushNicDelta.push(nic);
	}

	/*pullNicFromTarget(target, nicUUID, nicIdx) {
		target.nics.splice(nicIdx, 1);
		this.pullNicDelta.push(nicUUID);
	}*/

	// query generation methods

	generateSecondLevelSetOrUnsetQuery(query, deltaObj, entityKey, entityIdentifier, isSet) {
		var i = 0;

		for (var entityUUID in deltaObj[entityKey]) {
			var entityPrefix = entityKey + '.$[' + entityIdentifier + i + ']';
			var entityFilter = {};
			entityFilter[entityIdentifier + i + '.uuid'] = entityUUID;
			query.arrayFilters.push(entityFilter);

			if (isSet)
				for (var key in deltaObj[entityKey][entityUUID]) {
					if (key == '$inc') {
						for (var incField of deltaObj[entityKey][entityUUID].$inc) {
							query.update.$inc[entityPrefix + '.' + incField] = 1;
						}
					} else
						query.update.$set[entityPrefix + '.' + key] = deltaObj[entityKey][entityUUID][key];
				}
			else
				deltaObj[entityKey][entityUUID].forEach(function(key) {
					query.update.$unset[entityPrefix + '.' + key] = 1;
				});

			i++;
		}
	}

	generateFirstLevelPushQuery(query, pushDeltaObj, entityKey) {
		if (pushDeltaObj.length && !(entityKey in query.update.$push))
			query.update.$push[entityKey] = { $each: [] };

		for (var i = 0; i < pushDeltaObj.length; i++) {
			var entityToPush = pushDeltaObj[i];
			if (this.delta[entityKey] && Object.keys(this.delta[entityKey]).length) {
				delete this.delta[entityKey][entityToPush.uuid];
			}
			if (this.unsetDelta[entityKey] && Object.keys(this.unsetDelta[entityKey]).length) {
				delete this.unsetDelta[entityKey][entityToPush.uuid];
			}

			query.update.$push[entityKey].$each.push(entityToPush);
		}
	}

	generateFirstLevelPullQuery(query, pullDeltaObj, entityKey) {
		if (pullDeltaObj.length && !(entityKey in query.update.$pull))
			query.update.$pull[entityKey] = { 'uuid': { $in: [] } };

		for (var i = 0; i < pullDeltaObj.length; i++) {
			var entityUUIDToPull = pullDeltaObj[i];
			if (this.delta[entityKey] && Object.keys(this.delta[entityKey]).length) {
				delete this.delta[entityKey][entityUUIDToPull];
			}
			if (this.unsetDelta[entityKey] && Object.keys(this.unsetDelta[entityKey]).length) {
				delete this.unsetDelta[entityKey][entityUUIDToPull];
			}

			query.update.$pull[entityKey].uuid.$in.push(entityUUIDToPull);
		}
	}

	generateSecondLevelPushQuery(query, pushDeltaObj, firstLevelEntityKey, firstLevelEntityIdentifier, conflictingFirstLevelPushArr) {
		var i = 0;

		for (var entityUUID in pushDeltaObj) {
			// checks if the first level entity key is newly pushed, if so no need to push the second level
			if (conflictingFirstLevelPushArr.filter(function(firstLevelPushEntity) { return firstLevelPushEntity.uuid == entityUUID; }).length)
				continue;

			var entityPrefix = firstLevelEntityKey + '.$[' + firstLevelEntityIdentifier + i + '].diskSegments';
			var entityFilter = {};
			entityFilter[firstLevelEntityIdentifier + i + '.uuid'] = entityUUID;
			query.arrayFilters.push(entityFilter);

			if (!(entityPrefix in query.update.$push))
				query.update.$push[entityPrefix] = { $each: [] };

			pushDeltaObj[entityUUID].forEach(function(entityToPush) {
				//db.getCollection('server').update({},
				//{ $push: { 'disks.$[d].segs': { $each: [{a: 2222}, {a: 3333}] } } }, { arrayFilters: [{ 'd.uuid': 34 }] })
				query.update.$push[entityPrefix].$each.push(entityToPush);
			});

			i++;
		}
	}

	generateSecondLevelPullQuery(query, pullDeltaObj, firstLevelEntityKey, firstLevelEntityIdentifier, conflictingFirstLevelPullArr) {
		var i = 0;

		for (var entityUUID in pullDeltaObj) {
			// checks if the first level entity key should be pulled, if so no need to pull the second level
			if (conflictingFirstLevelPullArr.filter(function(firstLevelPullUUID) { return firstLevelPullUUID == entityUUID; }).length)
				continue;

			//db.getCollection('server').update({}, { $pull: { 'disks.$[d].diskSegments': { uuid: { $in: [ 3, 4 ] } } } }, { arrayFilters: [{ 'd.uuid': 34 }] })
			var entityPrefix = firstLevelEntityKey + '.$[' + firstLevelEntityIdentifier + i + '].diskSegments';
			var entityFilter = {};
			entityFilter[firstLevelEntityIdentifier + i + '.uuid'] = entityUUID;

			query.arrayFilters.push(entityFilter);
			query.update.$pull[entityPrefix] = { 'uuid': { $in: pullDeltaObj[entityUUID] } };

			i++;
		}
	}

	generateQueryParts() {
		var query = {
			update: { $set: {}, $unset: {}, $push: {}, $pull: {}, $inc: {} },
			arrayFilters: []
		};

		var key;

		// push & pull must come first before set/unset
		this.generateFirstLevelPushQuery(query, this.pushDiskDelta, 'disks');
		this.generateFirstLevelPushQuery(query, this.pushNicDelta, 'nics');

		this.generateFirstLevelPullQuery(query, this.pullNicDelta, 'nics');

		this.generateSecondLevelPushQuery(query, this.pushSegmentsDelta, 'disks', 'diskToPushSeg', this.pushDiskDelta);
		this.generateSecondLevelPullQuery(query, this.pullSegmentsDelta, 'disks', 'diskToPullSeg', this.pullDiskDelta);

		for (key in this.delta) {
			if (key == 'disks') {
				this.generateSecondLevelSetOrUnsetQuery(query, this.delta, 'disks', 'sdisk', true);
			} else if (key == 'nics') {
				this.generateSecondLevelSetOrUnsetQuery(query, this.delta, 'nics', 'snic', true);
			} else {
				// target first level set
				query.update.$set[key] = this.delta[key];
			}
		}

		for (key in this.unsetDelta) {
			if (key == 'disks') {
				this.generateSecondLevelSetOrUnsetQuery(query, this.unsetDelta, 'disks', 'udisk', false);
				/*} else if (key == 'nics') {
					this.generateSecondLevelSetOrUnsetQuery(query, this.unsetDelta, 'nics', 'unic', false);*/
			} else {
				// target first level unset
				query.update.$unset[key] = 1;
			}
		}

		return this.removeUnusedQueryAttributes(query);
	}

	removeUnusedQueryAttributes(query) {
		if (!Object.keys(query.update.$unset).length)
			delete query.update.$unset;

		if (!Object.keys(query.update.$push).length)
			delete query.update.$push;

		if (!Object.keys(query.update.$pull).length)
			delete query.update.$pull;

		if (!Object.keys(query.update.$inc).length)
			delete query.update.$inc;

		return query;
	}
}

scope.calcDelta = calcDelta;

scope.concatListsUnique = function(list1, list2, idKey) {
	var ids = new Set();
	var newList = [];

	list1.forEach(v => {
		ids.add(v[idKey]);
		newList.push(v);
	});

	list2.forEach(item => {
		if (ids.has(item[idKey]))
			return;

		ids.add(item[idKey]);
		newList.push(item);
	});

	return newList;
};

scope.createVolumes = function(volumesToCreate, user, cb) {
	const messages = [];

	async.each(volumesToCreate, function(volume, callback) {
		scope.createVolume(volume, user, (err, allocatedVolume, message) => {
			messages.push(message);
			callback();
		});
	}, () => cb(messages));
};

scope.createVolume = function(volume, user, cb) {
	volume._id = volume.name;
	volume.version = 1;
	volume.isReserved = false;
	volume.isReady = !volume.isEncrypted;

	let sdt1 = new Date();
	scope.cloneVPGProperties(volume, function(err) {
		let edt1 = new Date();
		logger.sysDEBUG('createVolumes::cloneVPGProperties took ' + (edt1 - sdt1) + ' milliseconds');

		if (err)
			return cb(err, null, new SystemAdminMessage(systemMessages.VOLUME_FAILED_TO_RESOLVE_VPG).addInfo(Entities.Error, err));

		scope.applyProtectionLevelDefaults(volume);

		// This is the data/metadata volume of a snapshot, we don't send configuration until snapshot created successfully
		let shouldUpdateConfiguration = !scope.isSnapshotDataOrMetadataVolume(volume);

		scope.saveVolume(volume, shouldUpdateConfiguration, user, function(err, allocatedVolume, log) {
			cb(err, allocatedVolume, log);
		});
	});
};

scope.cloneVPGProperties = function(volume, cb) {
	if (!volume.VPG)
		return cb(null);

	//port classes
	scope.getVPGByID(volume.VPG, function(err, results) {
		if (!results || results.length != 1)
			return cb(err);

		var vpg = results[0];

		if (volume.snapshotID && vpg.type !== consts.volumeTypes.METADATA_VOLUME)
			return cb(new SystemMessage(systemMessages.VPG_NOT_MD_TYPE)
				.addInfo(Entities.Volume.RAIDLevel, vpg.RAIDLevel)
				.addInfo(Entities.VPG.ID, vpg.RAIDLevel)
				.addInfo(Entities.VPG.type, vpg.type));

		const propsToClone = ['diskClasses', 'serverClasses', 'domain', 'type', 'isEncrypted', 'encryption', 'VSGs', 'allowOverflow'];
		propsToClone.forEach(property => {
			if (Object.prototype.hasOwnProperty.call(vpg, property)) {
				volume[property] = vpg[property];
			}
		});

		//Clone Raid Properties
		volume.RAIDLevel = vpg.RAIDLevel;

		switch (vpg.RAIDLevel) {
			case consts.RAIDLevel.CONCATENATED:
				break;
			case consts.RAIDLevel.STRIPED_RAID_0:
				volume.stripeSize = vpg.stripeSize;
				volume.stripeWidth = vpg.stripeWidth;

				break;

			case consts.RAIDLevel.MIRRORED_RAID_1:
				volume.numberOfMirrors = vpg.numberOfMirrors;
				volume.protectionLevel = scope.getEffectiveProtectionLevel(vpg);
				volume.enableCrcCheck = vpg.enableCrcCheck;

				break;
			case consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10:
				volume.numberOfMirrors = vpg.numberOfMirrors;
				volume.stripeSize = vpg.stripeSize;
				volume.stripeWidth = vpg.stripeWidth;
				volume.protectionLevel = scope.getEffectiveProtectionLevel(vpg);
				volume.enableCrcCheck = vpg.enableCrcCheck;

				break;
			case consts.RAIDLevel.STRIPED_ERASURE_CODING:
			case consts.RAIDLevel.ERASURE_CODING:
				volume.stripeSize = vpg.stripeSize;
				volume.stripeWidth = vpg.stripeWidth || 1;
				volume.parityBlocks = vpg.parityBlocks;
				volume.dataBlocks = vpg.dataBlocks;
				volume.protectionLevel = vpg.protectionLevel;
				volume.enableCrcCheck = vpg.enableCrcCheck;

				break;
			default:
				logger.sysERROR('Unknown RAID type', vpg.RAIDLevel);
				return cb(new SystemMessage(systemMessages.VOLUME_UNKNOWN_RAID_TYPE)
					.addInfo(Entities.Volume.RAIDLevel, vpg.RAIDLevel)
					.addInfo(Entities.VPG.ID, vpg.RAIDLevel));
		}

		cb(err);
	});
};

scope.swapObjValues = (obj, key1, key2) => {
	[obj[key1], obj[key2]] = [obj[key2], obj[key1]];
};

scope.sendStatsPeriodically = function(callback) {
	callback();
	var minimumIntervalValue = 1000 * 60 * 60; // one hour
	var sendStatsIntervalMS;
	var GLOBAL_SETTINGS = app.get('globalSettings');
	sendStatsIntervalMS = (GLOBAL_SETTINGS.sendStatsInterval || config.get('sendStatsInterval')) * 1000;

	if (sendStatsIntervalMS < minimumIntervalValue)
		new SystemMessage(systemMessages.APP_STATS_CONF_PARSE_FAILED).log();

	sendStatsHome(sendStatsIntervalMS);

	setInterval(function() {
		sendStatsHome(sendStatsIntervalMS);
	}, sendStatsIntervalMS);
};

function sendStatsHome(sendStatsIntervalMS) {
	var db = app.get('db');
	var userCollection = db.collection('user');

	scope.getPhoneHomeUser(function(user) {
		if (!user || !user.sendStats)
			return;

		var isTimeForStatsEmail = !user.lastTimeSentStats || (user.lastTimeSentStats && (new Date() - user.lastTimeSentStats) > sendStatsIntervalMS);
		if (!isTimeForStatsEmail)
			return;

		scope.getStatus(false, function(data) {
			data.messageType = 'stats';

			if (data.warnings && data.errors) {
				data.warnings = data.warnings.slice(0, 50);
				data.errors = data.errors.slice(0, 50);
			}

			logger.sendMail([config.get('supportEmail')], 'Client Statistics', JSON.stringify(data), function(err, shouldLog) {
				if (!err)
					userCollection.updateOne(
						{ _id: 'phoneHome@acme.com' },
						{ $set: { lastTimeSentStats: new Date() } },
						function(err) {
							if (err)
								new MongoError(err).log();
						}
					);
				else if (shouldLog)
					new SystemMessage(systemMessages.APP_SEND_STATS_EMAIL_FAILED).addInfo(Entities.Error, err).log();
			});
		});
	});
}

// returns null if valid and an error object if invalid
scope.isValidVolumeName = function(volume) {
	var name = volume.name;
	var errorMessage;

	var isNameTooLong = name && name.length > consts.MAX_VOLUME_NAME_LENGTH;
	var hasIllegalCharacters = name && name.match(/^[a-zA-Z0-9_\-+=]+$/) === null;
	var isNameInvalidForExport = volume.enableNVMf && name && name.indexOf('_') != -1;
	var hasIllegalEnding = volume.type != consts.volumeTypes.METADATA_VOLUME && name.endsWith(consts.MetadataVolumeEnding);

	if (isNameTooLong)
		errorMessage = `Volume name must not exceed ${consts.MAX_VOLUME_NAME_LENGTH} characters`;
	else if (hasIllegalCharacters)
		errorMessage = 'Volume name has illegal characters';
	else if (isNameInvalidForExport)
		errorMessage = 'Volume name is invalid for NVMf export';
	else if (hasIllegalEnding)
		errorMessage = 'Volume name cannot end with ' + consts.MetadataVolumeEnding;
	else
		return null;

	return new SystemMessage(systemMessages.VOLUME_NAME_ILLEGAL).addInfo(Entities.Error, new Error(errorMessage));
};

scope.volumeProjection = {
	'uuid': 1,
	'version': 1,
	'name': 1,
	'type': 1,
	'blockSize': 1,
	'lockServer': 1,
	'blocks': 1,
	'RAIDLevel': 1,
	'numberOfMirrors': 1,
	'stripeSize': 1,
	'stripeWidth': 1,
	'dataBlocks': 1,
	'parityBlocks': 1,
	'status': 1,
	'action': 1,
	'relativeRebuildPriority': 1,
	'reservation': 1,
	'enableCrcCheck': 1,
	'use_debug_di': 1,
	'isEncrypted': 1,
	'encryption.headerSize': 1,
	'metadataVolumeID': 1,
	'metadataVolumeUUID': 1,
	'snapshotVolumeID': 1,
	'snapshotVolumeUUID': 1,
	'sourceID': 1,
	'sourceUUID': 1,
	'chunks.uuid': 1,
	'chunks.vlbs': 1,
	'chunks.vlbe': 1,
	'chunks.pRaids.uuid': 1,
	'chunks.pRaids.activated': 1,
	'chunks.pRaids.stripeIndex': 1,
	'chunks.pRaids.zone': 1,
	'chunks.pRaids.diskSegments.uuid': 1,
	'chunks.pRaids.diskSegments.lbs': 1,
	'chunks.pRaids.diskSegments.lbe': 1,
	'chunks.pRaids.diskSegments.type': 1,
	'chunks.pRaids.diskSegments.pRaidIndex': 1,
	'chunks.pRaids.diskSegments.pRaidTypeIndex': 1,
	'chunks.pRaids.diskSegments.status': 1,
	'chunks.pRaids.diskSegments.diskUUID': 1,
	'chunks.pRaids.diskSegments.diskID': 1,
	'chunks.pRaids.diskSegments.nodeUUID': 1,
	'chunks.pRaids.diskSegments.node_id': 1
};

function createErrorsForMissingVolumes(requestVolumes, volumes, snapshots, mdVolumes) {
	const getVolumeID = volume => { return volume._id || volume.name; };
	const getVolumeUUID = volume => { return volume.uuid; };

	const allVolumes = volumes.map(v => getVolumeID(v))
		.concat(snapshots.map(s => getVolumeID(s)))
		.concat(mdVolumes.map(v => getVolumeID(v)));

	let missingVolumeLogs = [];

	requestVolumes.forEach(volume => {
		const volumeID = getVolumeID(volume);
		const volumeUUID = getVolumeUUID(volume);

		if (!allVolumes.includes(volumeID))
			missingVolumeLogs.push(new SystemAdminMessage(systemMessages.VOLUME_NOT_FOUND)
				.addInfo(Entities.Volume.ID, volumeID).addInfo(Entities.Volume.UUID, volumeUUID));
	});

	return [missingVolumeLogs];
}

scope.executeFunctionsOnVolumes = (categorizedVolumes, executeForVolumes, executeForSnapshots, executeForMDVolumes, requestVolumes, cb) => {
	let { volumes, snapshots, mdVolumes } = categorizedVolumes;
	let combinedLogs = [];

	const concatExecutionResults = logs => combinedLogs = combinedLogs.concat(logs);

	async.series({
		executeForVolumes: callback => {
			if (!volumes.length)
				return callback();

			executeForVolumes(volumes, logs => { concatExecutionResults(logs); callback(); });
		},
		executeForSnapshots: callback => {
			if (!snapshots.length)
				return callback();

			executeForSnapshots(snapshots, logs => { concatExecutionResults(logs); callback(); });
		},
		executeForMDVolumes: callback => {
			if (!mdVolumes.length)
				return callback();

			executeForMDVolumes(mdVolumes, logs => { concatExecutionResults(logs); callback(); });
		}
	}, () => {
		concatExecutionResults(...createErrorsForMissingVolumes(requestVolumes, volumes, snapshots, mdVolumes));
		cb(combinedLogs);
	});
};

function categorizeVolumesAndExecute(requestVolumes, executeForVolumes, executeForSnapshots, executeForMDVolumes, cb) {
	scope.categorizeVolumes(requestVolumes, (err, categorizedVolumes) => {
		if (err)
			return cb([new SystemAdminMessage(systemMessages.GENERAL_VOLUME_ERROR).addInfo(Entities.Error, err)]);

		scope.executeFunctionsOnVolumes(categorizedVolumes, executeForVolumes, executeForSnapshots, executeForMDVolumes, requestVolumes, cb);
	});
}

scope.executeOnVolumes = (requestVolumes, executeForVolumes, executeForSnapshots, executeForMDVolumes, cb) => {
	categorizeVolumesAndExecute(
		requestVolumes,
		executeForVolumes,
		executeForSnapshots,
		executeForMDVolumes,
		cb
	);
};

scope.executeOnVolumesWithIDs = (requestVolumes, executeForVolumes, executeForSnapshots, executeForMDVolumes, cb) => {
	requestVolumes = requestVolumes.map(volumeName => { return { _id: volumeName }; });

	scope.executeOnVolumes(
		requestVolumes,
		executeForVolumes,
		executeForSnapshots,
		executeForMDVolumes,
		cb
	);
};

scope.executeOnVolumesAndClient = (requestVolumes, clientID, clientUUID, executeForVolumes, executeForSnapshots, executeForMDVolumes, cb) => {
	const createWrapper = func => { return (volumes, callback) => func(clientID, clientUUID, volumes, callback); };
	const executeForVolumesWrapper = createWrapper(executeForVolumes);
	const executeForSnapshotsWrapper = createWrapper(executeForSnapshots);
	const executeForMDVolumesWrapper = createWrapper(executeForMDVolumes);

	categorizeVolumesAndExecute(
		requestVolumes,
		executeForVolumesWrapper,
		executeForSnapshotsWrapper,
		executeForMDVolumesWrapper,
		cb
	);
};

scope.splitVolumesAndSnapshots = volumes => {
	let volType = { volumes: [], snapshots: [], mdVolumes: [] };
	volumes.forEach(vol => {
		if (vol.sourceID)
			volType['snapshots'].push(vol);
		else if (vol.type == consts.volumeTypes.METADATA_VOLUME)
			volType['mdVolumes'].push(vol);
		else
			volType['volumes'].push(vol);
	});

	return volType;
};

function addRequestVolumesPropertiesToDBVolumes(dbVolumes, requestVolumesMap) {
	dbVolumes.forEach(dbVolume => {
		Object.keys(requestVolumesMap[dbVolume.name]).forEach(key => {
			dbVolume[key] = requestVolumesMap[dbVolume.name][key];
		});
	});
}

scope.categorizeVolumes = (volumes, cb) => {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');
	const requestVolumesMap = volumes.reduce((acc, currVol) => {
		acc[currVol._id || currVol.name] = currVol;
		return acc;
	}, {});
	const $query = {
		status: { $nin: [consts.volumeStatuses.PENDING, consts.volumeStatuses.TO_BE_DELETED] },
		$or: volumes.map(v => ({ $and: [{ _id: v._id || v.name }, { uuid: v.uuid }] }))
	};

	volumeCollection.find($query)
		.project({ name: 1, sourceID: 1, metadataVolumeID: 1, metadataVolumeUUID: 1, type: 1, uuid: 1, capacity: 1 })
		.toArray((err, dbVolumes) => {
			if (err)
				return cb(new MongoError(err).log());

			addRequestVolumesPropertiesToDBVolumes(dbVolumes, requestVolumesMap);
			const categorizeVolumes = scope.splitVolumesAndSnapshots(dbVolumes);
			cb(null, categorizeVolumes);
		});
};

scope.handleRESTAndLog = (incomingRequestSystemAdminMessages, handleFunction, callback) => {
	const requestUUID = uuid.v1();
	const shouldLogWithRequestUUID = incomingRequestSystemAdminMessages && incomingRequestSystemAdminMessages.length;

	if (shouldLogWithRequestUUID)
		incomingRequestSystemAdminMessages.forEach(message => message.addInfo(Entities.ApiRequest.UUID, requestUUID).log());

	handleFunction(systemAdminMessages => {
		if (systemAdminMessages)
			logModule.logWithRequestUUID(systemAdminMessages, shouldLogWithRequestUUID && requestUUID);

		callback(systemAdminMessages);
	});
};

scope.isSnapshotDataOrMetadataVolume = (volume) => {
	return volume.sourceID || volume.snapshotID;
};

scope.sendAddVolumeAfterVolumeSaved = (volume, cb) => {
	const affectedZones = zoneModule.getZonesByVolume(volume);

	Array.from(affectedZones).forEach(zone =>
		kafkaModule.sendMessages(
			cb => kafkaModule.getIncrementalUpdatesTopic(zone, cb),
			[new AddVolume(volume)]
		)
	);

	cb();
};

/**
 * This function ensures that a function is not called more than once every `minWaitMS`.
 * If multiple calls were made with the same `id` in the duration of `minWaitMS` only the last `func` will be called.
 * @param {function} func The function to debounce
 * @param {string} id A unique ID for this debouncer. [agentID]_[MessageType] for example will ensure a specific message not sent too often to the same agent
 * @param {integer} [minWaitMS] Optional - The minimum time between two calls in miliseconds
 */
scope.callFunctionWithDebouncer = function(func, id, minWaitMS) {
	if (!minWaitMS) {
		var GLOBAL_SETTINGS = app.get('globalSettings');
		minWaitMS = GLOBAL_SETTINGS.defaultDownstreamDebouncerMinimumWait ?
			GLOBAL_SETTINGS.defaultDownstreamDebouncerMinimumWait * 1000 : consts.DEFAULT_DEBOUNCER_MINIMUM_WAIT;
	}

	var cache = debouncerCache;

	var entry = cache[id];
	if (!entry) {
		// first time - send and create cache
		cache[id] = {
			lastSent: new Date(),
			timeoutHandle: null
		};

		logger.sysDEBUG(`callFunctionWithDebouncer::${id} no cache entry, calling now`);
		func();
		return;
	}

	let timeSinceLastSent = new Date() - entry.lastSent;

	if (timeSinceLastSent >= minWaitMS) {
		if (entry.timeoutHandle) {
			clearTimeout(entry.timeoutHandle);
			entry.timeoutHandle = null;
		}

		logger.sysDEBUG(`callFunctionWithDebouncer::${id} last call was long enough, calling now`);
		entry.lastSent = new Date();
		func();
		return;
	}

	logger.sysDEBUG(`callFunctionWithDebouncer::${id} Not enough time passed since last call, delaying`);

	if (entry.timeoutHandle)
		// here we also discard the previous function call
		clearTimeout(entry.timeoutHandle);

	let timeLeft = Math.max(0, minWaitMS - timeSinceLastSent);

	entry.timeoutHandle = setTimeout(() => {
		let entry = cache[id];

		if (!entry) return;
		entry.timeoutHandle = null;

		logger.sysDEBUG(`callFunctionWithDebouncer::${id} has waited enough, sending`);
		entry.lastSent = new Date();
		func();
	}, timeLeft);
};

/**
 * Clears the debouncer timeout and deleted the entry for `id`
 * @param {string} id
 */
scope.clearFunctionDebouncer = function(id) {
	var cache = debouncerCache;

	var entry = cache[id];
	if (entry) {
		if (entry.timeoutHandle)
			clearTimeout(entry.timeoutHandle);
	}

	delete cache[id];
};

scope.resetDebouncerCache = () => {
	for (const id in debouncerCache)
		scope.clearFunctionDebouncer(id);
};

scope.getMaxMessageSequence = (kafkaMessageSequenceObject) => {
	let dbMaxMessageSequence = 0;

	if (kafkaMessageSequenceObject) {
		let allMessageSequences = Object.values(kafkaMessageSequenceObject);
		dbMaxMessageSequence = allMessageSequences.length ? Math.max(...allMessageSequences) : 0;
	}

	return dbMaxMessageSequence;
};

scope.getMgmtClusterState = mgmts => {
	const now = new Date();
	const mgmtTimeout = new Date(now.setTime(now.getTime() - consts.MANAGEMENT_TIMED_OUT_INTERVAL_IN_MINUTES * 60 * 1000));

	return mgmts.reduce((acc, currMgmt) => (
		{
			...acc,
			[currMgmt._id]: {
				_id: currMgmt._id,
				bootVersion: currMgmt.bootVersion,
				status: mgmtTimeout > currMgmt.dateModified ? consts.managementStatuses.DOWN : consts.managementStatuses.UP
			}
		}
	), {});
};

scope.iterativeConnect = (connectFunction, entity, maxConnectTries, timeBetweenConnectTries, callback) => {
	let tries = 1;
	let error;

	async.doWhilst((callback) => {
		logger.sysDEBUG(`Trying to connect to ${entity}. Try: ${tries}/${maxConnectTries}`);
		connectFunction((err) => {
			tries++;

			if (err) {
				error = err;

				setTimeout(callback, timeBetweenConnectTries);
			} else {
				error = null;

				callback();
			}
		});
	}, (callback) => {
		callback(null, error && tries <= maxConnectTries);
	}, () => {
		callback(error);
	});
};

scope.waitForState = (backoff, debugInfoStr, checkStateFunc, callback) => {
	let shouldContinue = true;
	const syncTestFunc = cb => cb(null, shouldContinue);

	async.whilst(syncTestFunc, cb => {
		checkStateFunc((err, isStateReached) => {
			if (err)
				return cb(err);

			if (isStateReached) {
				shouldContinue = false;
				return cb();
			}

			logger.sysDEBUG(`${debugInfoStr} isStateReached=${isStateReached} waiting for ${backoff.currentBackoff / 1000} sec`);

			backoff.backoff(err => cb(err));
		});
	}, err => callback(err));
};

scope.BtoGB = number => number / consts.GB;
scope.getMessageSequenceObjectFromKafkaMessageTypes = kafkaMessageTypesObject => Object.fromEntries(Object.values(kafkaMessageTypesObject).map(t => [t, 0]));

scope.fetchEntityByID = (entityType, entityID, isMongoObjectID = false, projection = {}, notFoundError = systemMessages.CANT_FIND_ENTITY, cb) => {
	const db = app.get('db');
	const collection = db.collection(entityType);
	const _id = isMongoObjectID ? new ObjectId(entityID) : entityID;

	collection.findOne({ _id }, { projection }, (error, entity) => {
		if (error)
			return cb(new MongoError(error).log());

		if (!entity)
			return cb(new SystemMessage(notFoundError));

		cb(null, entity);
	});
};

scope.partition = (array, isValid) => {
	return array.reduce(([pass, fail], elem) => {
		return isValid(elem) ? [[...pass, elem], fail] : [pass, [...fail, elem]];
	}, [[], []]);
};

scope.md5 = function(stringExpression) {
	return crypto.createHash('md5').update(stringExpression).digest('hex');
};

/** this function returns serializable object with relevant internal states as sub objects
* including aboutInfo, outboundClusterConnections, inboundClusterConnections, remoteMonitoredEvents, authorizedConnections, commStats, cluster
* systemInfo will not include ClusterID to prevent quering the db - so we can call this also during uncaught exceptions in case the db is not available
*/
scope.getSerializableInternalState = async() => {
	const kafka = require('./modules/kafka.js');
	const { concurrentConnections, registeredToEvents } = require('./modules/websocketCommon.js');

	const debouncerCacheCopy = scope.extend(true, {}, debouncerCache);

	function serializeManagementClusterConnections(mc) {
		var printableObj = scope.extend(true, {}, mc);

		for (var management in printableObj) {
			delete printableObj[management].connection;
			delete printableObj[management].registerToClusterEvents;
			delete printableObj[management].unregisterFromClusterEvents;
			delete printableObj[management].setLastResponse;
		}

		return printableObj;
	}

	function serializeDebouncerCache() {
		for (const id in debouncerCacheCopy) {
			delete debouncerCacheCopy[id].timeoutHandle;
		}
		return debouncerCacheCopy;
	}

	function serializeKafkaOffsetRegistry() {
		const Timeout = setTimeout(() => {}, 0).constructor;
		const objStr = JSON.stringify(kafka.offsetsRegistry, (k, v) => v instanceof Timeout ? 'Timeout' : v);
		return JSON.parse(objStr);
	}

	function serializeVolumeCalculationInProgress() {
		return Object.keys(volumeModule.volumeCalculationInProgress).map(key => {
			return {
				volumeID: key,
				pendingCalculation: volumeModule.volumeCalculationInProgress[key].pendingCalculation,
				numOfCallbacks: volumeModule.volumeCalculationInProgress[key].callbacks?.lnegth || 0
			};
		});
	}

	function getPausedPartitions() {
		try {
			const consumer = app.get('kafkaConsumer');
			return consumer.paused();
		} catch (e) {
			let err = `getSerializableInternalState:: Error getting kafka paused topic/partitions: ${e}`;
			logger.sysDEBUG(err);
			return err;
		}
	}

	async function getKafkaDescribeGroup() {
		try {
			const consumer = app.get('kafkaConsumer');
			const describeGroup = await consumer.describeGroup();
			// parse describeGroup
			if (!describeGroup || !describeGroup.members || !describeGroup.members.length)
				throw new Error('No members found');

			const members = describeGroup.members.map(member => {
				const memberAssingment = MemberAssignment.decode(member.memberAssignment);

				return {
					clientHost: member.clientHost,
					clientId: member.clientId,
					memberId: member.memberId,
					assignment: memberAssingment?.assignment,
				};
			});

			return members;

		} catch (e) {
			let err = `getSerializableInternalState:: Error getting kafka describe group: ${e}`;
			logger.sysDEBUG(err);
			return err;
		}
	}

	const managementCluster = {
		outboundClusterConnections: serializeManagementClusterConnections(app.get('mgmtOutboundClusterConnections')),
		inboundClusterConnections: serializeManagementClusterConnections(app.get('mgmtInboundClusterConnections')),
	};

	const kafkaMetrics = {
		subscribedTopics: kafka.subscribedTopics,
		messagesInProcess: kafka.messagesInProcess,
		isConsumerPaused: kafka.isConsumerPaused,
		pausedTopics: getPausedPartitions(),
		describeGroup: await getKafkaDescribeGroup(),
		totalConsumed: kafka.totalConsumed,
		totalSent: kafka.totalSent,
		totalSentFailed: kafka.totalSentFailed,
		metrics: Object.values(kafka.metrics)
	};

	const data = {
		systemInfo: scope.collectSystemInfo(null),
		managementCluster: managementCluster,
		remoteMonitoredEvents: websocket.getRemoteMonitoredEvents(),
		registeredToEvents: registeredToEvents,
		authorizedConnections: app.get('authorizedConnections'),
		concurrentConnections: concurrentConnections,
		commStats: scope.getCachedStats('communicationStats', false),
		debouncerCache: serializeDebouncerCache(),
		kafkaMetrics: kafkaMetrics,
		kafkaOffsetsRegistry: serializeKafkaOffsetRegistry(),
		volumeCalculationInProgress: serializeVolumeCalculationInProgress()
	};

	return data;
};

scope.writeInternalStateToFiles = (data, dir) => {
	function getFilePath(key, dir) {
		const fileName = `${key}.json`;
		const filePath = dir + fileName;
		return filePath;
	}

	for (let key in data) {
		let filePath = getFilePath(key, dir);
		let jsonString = JSON.stringify(data[key], null, 4);
		scope.writeToFile(filePath, jsonString);
	}
};

scope.dumpInternalState = async(dir) => {
	logger.sysDEBUG(`Dumping internal state to directory: ${dir}`);

	// Ensure directory exists with recursive creation (mkdir -p)
	try {
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
	} catch (e) {
		new SystemMessage(systemMessages.UTILS_MAKE_DIR_FAILURE).addInfo(Entities.Path, dir).addInfo(Entities.Exception, e).log();
		return;
	}

	const internalState = await scope.getSerializableInternalState();
	scope.writeInternalStateToFiles(internalState, dir);
};

scope.collectSystemInfo = (clusterID) => {
	const versionsFromFile = app.get('versionsFromFile');
	return {
		// Version information
		version: versionsFromFile.version,
		managementVersion: app.get('managementVersion'),
		rpmVersion: app.get('rpmVersion'),
		managementCompatibilityVersion: app.get('managementCompatibilityVersion'),
		APIVersion: app.get('APIVersion'),
		websocketProtocolVersion: consts.WS_PROTOCOL_VERSION,
		protocolVersion: app.get('protocolVersion'),
		bootVersion: app.get('bootVersion'),

		// Git/Commit information
		commitID: versionsFromFile.commit,
		changeID: versionsFromFile.changeID,
		branch: versionsFromFile.branch,

		// System information
		hostname: app.get('hostname'),
		ipAddress: app.get('ipAddress'),
		managementId: app.get('managementId'),
		dbUUID: app.get('dbUUID'),
		clusterID: clusterID?.id,

		// Runtime information
		nodeVersion: app.get('nodeVersion'),
		mongoVersion: app.get('mongoVersion'),

		isMongoReplicated: app.get('isMongoReplicated'),
		hasMongoRootRole: app.get('hasMongoRootRole'),
		hasMongoClusterManagerRole: app.get('hasMongoClusterManagerRole'),

		isDev: app.get('isDev'),
	};
};

scope.getSystemInfo = (callback) => {
	nvmeshMetadata.getClusterID(clusterID => {
		const systemInfo = scope.collectSystemInfo(clusterID);
		callback(systemInfo);
	});
};

scope.getIPAddress = () => {
	const interfaces = os.networkInterfaces();

	for (const networkInterface of Object.values(interfaces)) {
		for (const net of networkInterface || []) {
			if (net.family === 'IPv4' && !net.internal) {
				return net.address;
			}
		}
	}

	return '127.0.0.1';
};

module.exports = scope;
