/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

var scope = {};
module.exports = scope;

var async = require('async');
const uuid = require('uuid');

var utils = require('../utils.js');
var logger = require('../logger.js');
var events = require('../events.js');
var consts = require('../consts.js');
let { MongoError, SystemMessage, Entities } = require('./error.js');
var objectNotifier = require('../objectNotifier.js');
var kafkaModule = require('./kafka.js');
var systemMessages = require('../systemMessages.js');
var { TargetsZonesResult, PRaidsZonesResult } = require('../models/lockMultipleEntitiesResult');
var { AddTarget } = require('../models/kafkaMessages/AddTarget');
var { HardwareConfiguration } = require('../models/kafkaMessages/HardwareConfiguration');
const { UpdateTomaKeepaliveToken } = require('../models/kafkaMessages/UpdateTomaKeepaliveToken.js');
const { ExecutionTimer } = require('../models/executionTimer.js');
const { DeleteTarget } = require('../models/kafkaMessages/DeleteTarget.js');


scope.afterModuleLoaded = () => {
	events = require('../events.js');
	logger = require('../logger.js');
	({ MongoError, SystemMessage, Entities } = require('./error.js'));
};

scope.dispatchAllZonesHardwareConfiguration = (callback) => {
	let db = app.get('db');
	let confCollection = db.collection('configurationVersion');

	confCollection.find({ _id: { $ne: 'CLUSTER' } }).toArray((err, results) => {
		if (err)
			new MongoError(err).log();

		scope.dispatchZonesHardwareConfigurationByZones(results.map((z) => { return z._id; }), callback);
	});
};

scope.dispatchZonesHardwareConfigurationByZones = (zones, callback) => {
	async.eachSeries(zones, (zone, callback) => {
		let timer = new ExecutionTimer('getTOMAConfiguration');
		scope.getZoneHardwareConfiguration(zone, (err, hardwareConf, topics) => {
			timer.stop();
			if (err)
				return callback(new SystemMessage(systemMessages.ZONE_HARDWARE_CONFIGURATION_FAILED)
					.addInfo(Entities.Target.zone, zone)
					.addInfo(Entities.Error, err)
					.log());

			if (hardwareConf.targets.length)
				topics.forEach(topic => kafkaModule.sendMessages(topic, [new HardwareConfiguration(hardwareConf)]));

			callback();
		});
	}, () => {
		if (callback)
			callback();
	});
};

scope.getZoneHardwareConfiguration = (zone, callback) => {
	async.parallel({
		targets: (cb) => {
			var query = {
				filter: {
					isPending: { $ne: true },
					node_status: { $ne: consts.nodeStatus.DELETING },
					zone: zone
				},
				skip: 0,
				limit: 0,
				projection: {
					'node_id': 1,
					'uuid': 1,
					'disks.uuid': 1,
					'disks.diskID': 1,
					'disks.block_size': 1,
					'disks.blocks': 1,
					'disks.version': 1,
					'disks.vendorID': 1,
					'disks.isOutOfService': 1,
					'disks.activeFormatRequestCounter': 1,
					'nics.uuid': 1,
					'nics.version': 1,
					'nics.guid': 1,
					'nics.pkey': 1,
					'nics.nicID': 1,
					'nics.protocol': 1,
					'topics': 1,
				}
			};

			utils.loadCollection('server', query, function(err, results) {
				if (err)
					err = new MongoError(err).log();

				cb(err, results);
			});
		},
		managementConfiguration: (cb) => {
			let db = app.get('db');
			let confCollection = db.collection('configurationVersion');

			const projection = {
				isUnavailable: 0,
				lastReceivedLeaderKeepAlive: 0,
				topics: 0,
				featureCompatibilityVersion: 0,
				docVersion: 0
			};

			confCollection.findOne({ _id: zone }, { projection }, (err, conf) => {
				if (err)
					err = new MongoError(err).log();
				else
					conf['dbUUID'] = app.get('dbUUID');

				cb(err, conf);
			});
		}
	}, (err, hardwareConf) => {
		if (err)
			return callback(err);

		// handle case where we have multiple versions of hardware configuration topic
		const topics = new Set(hardwareConf.targets.map(target => {
			const topicName = target.topics[consts.topicSuffix.TOMA_HARDWARE_CONF];
			delete target.topics;
			return topicName;
		}));

		callback(null, hardwareConf, [...topics]);
	});
};

scope.getAllVolumeChunks = function(volume) {
	var chunks = volume.chunks ? volume.chunks.slice() : [];
	return chunks;
};

function getSegmentsInZoneCounterIncrementsByVolume(volume) {
	var results = {};

	var chunks = scope.getAllVolumeChunks(volume);
	chunks.forEach((chunk) => {
		chunk.pRaids.forEach((pRaid) => {
			results[pRaid.zone] = {
				segmentsInZone: (results[pRaid.zone]?.segmentsInZone || 0) + pRaid.diskSegments.length
			};
		});
	});

	return results;
}

function updateEachZoneCounter(zonesToCounter) {
	const db = app.get('db');
	const lockCollection = db.collection('lock');

	async.parallel(
		Object.keys(zonesToCounter).map(zone => {
			return callback => {
				lockCollection.findOneAndUpdate(
					{ _id: zone },
					{ $inc: zonesToCounter[zone] },
					err => {
						if (err)
							new MongoError(err).log();

						callback();
					});
			};
		})
	);
}

function updateZoneLock(zoneID, updateOperators, targetUpdatesSequence, cb) {
	const db = app.get('db');
	const lockCollection = db.collection('lock');

	lockCollection.findOneAndUpdate(
		{ _id: zoneID, targetUpdatesSequence: targetUpdatesSequence },
		updateOperators,
		{ returnDocument: consts.mongoReturnDocument.AFTER },
		(err, result) => {
			if (err)
				new MongoError(err).log();

			cb(result);
		});

}

function setIsTargetUpdateSequenceIncOnTarget(targetID, cb) {
	const db = app.get('db');
	const serverCollection = db.collection('server');
	const projection = { node_id: 1, uuid: 1, zone: 1, tomaToken: 1, health_old: 1, health: 1, topics: 1 };

	serverCollection.findOneAndUpdate(
		{ node_id: targetID },
		{ $set: { isTargetUpdateSequenceInc: true } },
		{ returnDocument: consts.mongoReturnDocument.AFTER, projection },
		(err, target) => {
			if (err)
				new MongoError(err).log();

			cb(target);
		});
}

scope.handleTargetUpdateInZone = (zoneID, targetID, updateType, callback) => {
	const db = app.get('db');
	const lockCollection = db.collection('lock');
	const serverCollection = db.collection('server');
	const GLOBAL_SETTINGS = app.get('globalSettings');

	const originalTarget = targetID;
	let dbTarget;
	const setIsTargetUpdateSequenceIncOnTargetCB = seriesCB => { return updatedTarget => { dbTarget = updatedTarget; seriesCB(); }; };

	// find zone lock
	lockCollection.findOne({ _id: zoneID }, { lastTargetUpdate: 1, targetUpdatesSequence: 1, targetsInZone: 1 }, (err, zoneLock) => {
		if (err) {
			new MongoError(err).log();
			return callback(err);
		}
		const prefixMsg = `handleTargetUpdateInZone [${uuid.v1()}]: `;
		const logWithUUID = utils.getDebugLoggerWithPrefix(prefixMsg);
		logWithUUID(`Starting ${zoneID}, ${targetID}, ${updateType}. zoneLock:`, zoneLock);

		// if lastTargetUpdate exists then there is a previous target update which was not completed - kafka message not sent
		// we will handle this target first, then retry for the original target
		const isLastTargetUpdateExists = zoneLock.lastTargetUpdate;
		const currentlyHandledUpdateType = isLastTargetUpdateExists ? zoneLock.lastTargetUpdate.updateType : updateType;
		const currentlyHandledTarget = isLastTargetUpdateExists ? zoneLock.lastTargetUpdate.nodeID : targetID;
		const isHandlingAddTargetUpdate = currentlyHandledUpdateType === consts.targetUpdateTypes.ADD;
		let targetWasAddedOrRemovedFromZoneLock = false;
		let { targetUpdatesSequence, targetsInZone } = zoneLock;

		async.series([
			function updateZone(cb) {
				// isTargetUpdateSequenceInc = true indicating that this target is handled and updated in the zone's targetsInZone set.
				// This means it can be calculated in bootstrap when counting targetsInZone from the server collection.
				if (isLastTargetUpdateExists) {
					targetWasAddedOrRemovedFromZoneLock = true;
					logWithUUID('lastTargetUpdateExists = true, setting targetWasAddedOrRemovedFromZoneLock = true');
				}

				// If one is true then somebody already updated the zone lock collection.
				const isTargetInLockTargetsInZone = zoneLock.targetsInZone.includes(currentlyHandledTarget);
				const shouldUpdateZone = isHandlingAddTargetUpdate && !isTargetInLockTargetsInZone ||
										!isHandlingAddTargetUpdate && isTargetInLockTargetsInZone;

				if (!shouldUpdateZone) {
					logWithUUID('Should not update zone, setting isTargetUpdateSequenceInc on Target');
					setIsTargetUpdateSequenceIncOnTarget(currentlyHandledTarget, setIsTargetUpdateSequenceIncOnTargetCB(cb));
				} else {
					const updateOperators = {
						[`${isHandlingAddTargetUpdate ? '$addToSet' : '$pull'}`]: { targetsInZone: currentlyHandledTarget },
						$inc: { targetUpdatesSequence: 1 },
						$set: { lastTargetUpdate: {
							nodeID: currentlyHandledTarget,
							updateType: currentlyHandledUpdateType
						} }
					};
					logWithUUID('Trying to update zone, updateOperators:', updateOperators);
					updateZoneLock(zoneID, updateOperators, targetUpdatesSequence, results => {
						if (!results) {
							//someone increased the targetUpdatesSequence, we will retry the flow in the end of the async.series
							logWithUUID(`setZone:: target ${currentlyHandledTarget} failed to update zone lock will retry targetsInZone: ${targetsInZone}`);
							return scope.handleTargetUpdateInZone(zoneID, currentlyHandledTarget, currentlyHandledUpdateType, callback);
						}

						// set the current seq and targetsInZone to use in the kafka message
						({ targetUpdatesSequence, targetsInZone } = results);
						targetWasAddedOrRemovedFromZoneLock = true;
						logWithUUID(
							'Successfully updated the zone, setting targetWasAddedOrRemovedFromZoneLock = true '
							+ 'and setting isTargetUpdateSequenceInc on Target. Updated zone:',
							results
						);
						setIsTargetUpdateSequenceIncOnTarget(currentlyHandledTarget, setIsTargetUpdateSequenceIncOnTargetCB(cb));
					});
				}
			},
			function sendMessages(cb) {
				let updateMessage;
				let targetsInZoneLength = targetsInZone.length;

				if (isHandlingAddTargetUpdate) {
					kafkaModule.sendMessages(
						dbTarget.topics[consts.topicSuffix.TOMA_COMMANDS],
						[new UpdateTomaKeepaliveToken(dbTarget.node_id, dbTarget.tomaToken, GLOBAL_SETTINGS.keepaliveIntervals.TOMA, dbTarget.zone)]
					);

					updateMessage = AddTarget;

					if (targetWasAddedOrRemovedFromZoneLock)
						targetsInZoneLength -= 1;
				} else {
					events.emitEvent(
						[events.getTargetID(dbTarget.node_id)],
						objectNotifier.events.targetRemovedEvent,
						dbTarget
					);
					updateMessage = DeleteTarget;
					if (targetWasAddedOrRemovedFromZoneLock)
						targetsInZoneLength += 1;
				}

				logWithUUID(`Sending ${updateType} message to TOMA. targetsInZone: ${targetsInZone}`);
				kafkaModule.sendMessages(
					cb => kafkaModule.getIncrementalTargetUpdatesTopic(zoneID, cb),
					[new updateMessage(dbTarget.node_id, dbTarget.uuid, targetsInZoneLength, targetUpdatesSequence)],
					cb
				);
			},
			function clearLastTargetUpdateInLock(cb) {
				// clearing lastTargetUpdate will indicate that the message was sent
				logWithUUID('Clearing lastTargetUpdate from the lock');
				lockCollection.findOneAndUpdate(
					{ _id: zoneID },
					{ $unset: { lastTargetUpdate: 1 } },
					err => {
						if (err)
							new MongoError(err).log();

						cb(err);
					});
			},
			function clearAddMessageRequiredOnTargetAndSaveTargetUpdatesSequence(cb) {
				if (currentlyHandledUpdateType === consts.targetUpdateTypes.REMOVE)
					return cb();

				logWithUUID(`Removing addTargetMessageRequired from target and setting the current targetUpdatesSequence=${targetUpdatesSequence}`);
				serverCollection.updateOne(
					{ node_id: currentlyHandledTarget },
					{ $unset: { addTargetMessageRequired: 1 }, $set: { targetUpdatesSequence: targetUpdatesSequence } },
					err => {
						if (err)
							new MongoError(err).log();

						cb(err);
					});
			},
			function retryFlowForOriginalTargetIfNeeded(cb) {
				if (originalTarget === currentlyHandledTarget)
					return cb();

				logWithUUID(`setZone:: retrying handleTargetUpdateInZone for target ${originalTarget}`);
				return scope.handleTargetUpdateInZone(zoneID, originalTarget, updateType, callback);
			}
		],
		err => callback(err)
		);
	});
};

scope.newTargetsInZone = (zoneID, targets, callback) => {
	async.each(targets, (targetID, cb) => {
		scope.handleTargetUpdateInZone(zoneID, targetID, consts.targetUpdateTypes.ADD, cb);
	}, () => {
		scope.dispatchZonesHardwareConfigurationByZones([zoneID], () => {
			if (callback)
				callback();
		});
	});
};

scope.removeTargetsFromZone = (zoneID, targets, callback) => {
	async.each(targets, (targetID, cb) => {
		scope.handleTargetUpdateInZone(zoneID, targetID, consts.targetUpdateTypes.REMOVE, cb);
	}, () => {
		scope.dispatchZonesHardwareConfigurationByZones([zoneID], () => {
			if (callback)
				callback();
		});
	});
};

scope.decSegmentFromZone = function(zone) {
	const zoneToCounter = { [zone]: { segmentsInZone: -1 } };
	updateEachZoneCounter(zoneToCounter);
};

scope.handleVolumeCreation = function(volume) {
	const zonesToCounter = getSegmentsInZoneCounterIncrementsByVolume(volume);
	updateEachZoneCounter(zonesToCounter);
};

function getMaxCriteriaValues(zones) {
	var max = {};

	for (var criteria of Object.keys(app.get('globalSettings').zoneRanking.criterias))
		max[criteria] = Math.max(...zones.map((zone) => {
			return zone[criteria];
		}));

	return max;
}

function calculateTimeSpentWaitingAvg(zones) {
	zones.forEach((zone) => {
		zone.avgTimeSpentWaitingForLock = zone.totalTimeSpentWaitingForLock / zone.lockCounter;
	});
}

function calculateCriteriaScore(zones, zone, criteria) {
	calculateTimeSpentWaitingAvg(zones);
	var maxValues = getMaxCriteriaValues(zones);
	var zoneRankingConf = app.get('globalSettings').zoneRanking;
	var criterias = zoneRankingConf.criterias;
	var fuzzyElement = (100 - Math.floor(Math.random() * zoneRankingConf.fuzziness)) / 100;

	if (!maxValues[criteria])
		return 0;

	var score;
	//For those two, the lower the better.
	switch (criteria) {
		case consts.zoneRankingCriterias.SEGMENTS_IN_ZONE:
		case consts.zoneRankingCriterias.AVG_TIME_SPENT_WAITING_FOR_LOCK: {
			score = (1 - zone[criteria] / maxValues[criteria]) * criterias[criteria];
			break;
		}
		default: {
			score = zone[criteria] / maxValues[criteria] * criterias[criteria];
		}
	}

	logger.sysVERBOSE('zoneRanking', 'Criteria value for zone', { criteria: criteria, criteriaScore: score, zone: zone._id });

	return fuzzyElement * score;
}

scope.getZonesRanks = (zones) => {
	calculateTimeSpentWaitingAvg(zones);
	var maxValues = getMaxCriteriaValues(zones);
	var zoneRankingConf = app.get('globalSettings').zoneRanking;
	var zonesRanks = {};

	logger.sysVERBOSE('zoneRanking', 'Max criteria values', maxValues);

	var criterias = zoneRankingConf.criterias;

	zones.forEach((zone) => {
		var score = 0;

		logger.sysVERBOSE('zoneRanking', 'Calculating rank for zone', zone);

		for (var criteria of Object.keys(criterias))
			score += calculateCriteriaScore(zones, zone, criteria);

		zonesRanks[zone._id] = score;
	});

	logger.sysVERBOSE('zoneRanking', 'Zones ranking', zonesRanks);

	return zonesRanks;
};

scope.deleteZone = (zoneID, callback) => {
	var db = app.get('db');
	var versionCollection = db.collection('configurationVersion');

	versionCollection.deleteOne({ _id: zoneID }, (err) => {
		if (err)
			new MongoError(err).log();

		callback(err);
	});
};

scope.setZoneAsUnavailable = (zoneID, leaderToken, callback) => {
	var db = app.get('db');
	var versionCollection = db.collection('configurationVersion');

	versionCollection.updateOne(
		{ _id: zoneID, leaderToken: leaderToken },
		{
			$set: {
				isUnavailable: true,
				stopSendingKeepaliveToken: false,
			},
			$inc: { 'leaderToken': 1 }
		}, (err, res) => {
			if (err)
				new MongoError(err).log();
			else if (res.modifiedCount > 0)
				events.emitEvent(null, objectNotifier.events.zoneAvailabilityChangeEvent);

			callback(err);
		});
};

scope.getZones = (zonesIDsToFilter, callback) => {
	var db = app.get('db');
	var lockCollection = db.collection('lock');
	var zonesIDsFilter = zonesIDsToFilter && zonesIDsToFilter.length ? { _id: { $in: zonesIDsToFilter } } : {};

	lockCollection.find(zonesIDsFilter).project({ segmentsInZone: 1, targetsInZone: 1, totalTimeSpentWaitingForLock: 1, lockCounter: 1 })
		.toArray((err, results) => {
			if (err)
				new MongoError(err).log();

			if (results && results.length)
				return callback(err, results);

			callback(err, []);
		});
};

scope.getSingleZone = (zoneID, callback) => {
	const db = app.get('db');
	const lockCollection = db.collection('lock');
	const projection = { segmentsInZone: 1, targetsInZone: 1, totalTimeSpentWaitingForLock: 1, lockCounter: 1, targetUpdatesSequence: 1 };

	lockCollection.findOne({ _id: zoneID }, projection, (err, zone) => {
		if (err)
			new MongoError(err).log();

		callback(err, zone);
	});
};

scope.getTargetToZone = callback => {
	var db = app.get('db');
	var serverCollection = db.collection('server');

	serverCollection.find({}).project({ zone: 1, node_id: 1, isPending: 1 }).toArray((err, targets) => {
		if (err || !targets.length) {
			if (err)
				new MongoError(err).log();

			return callback(err, {});
		}
		var targetToZone = {};
		targets.forEach(target => targetToZone[target.node_id] = target);

		callback(err, targetToZone);
	});
};

function getZonesByTargetIDsFromCache(targetIDs, cb) {
	objectNotifier.getObject(objectNotifier.events.targetZoneChange.name, (err, targetToZone) => {
		if (err)
			return cb(new MongoError(err));

		if (!targetIDs.every(targetID => targetToZone[targetID])) {
			err = new SystemMessage(systemMessages.TARGETS_MISSING_IN_ZONES_CACHE);
			targetIDs.forEach(targetID => err.addInfo(Entities.Target.ID, targetID));
			return cb(err);
		}

		var targets = [];
		targetIDs.forEach(targetID => targets.push(targetToZone[targetID]));

		var results = new TargetsZonesResult(targetIDs, targets);
		cb(null, results);
	});
}

scope.getZonesByTargetIDsFromDB = function(targetIDs, cb) {
	objectNotifier.updateObject(objectNotifier.events.targetZoneChange.name, err => {
		if (err)
			return cb(err);

		// Now the cache should be updated
		return getZonesByTargetIDsFromCache(targetIDs, cb);
	});
};

scope.getZoneByTargetID = function(targetID, cb) {
	return scope.getZonesByTargetIDs([targetID], (err, results) => {
		cb(err, results && Object.keys(results.zones).length ? Object.keys(results.zones)[0] : null);
	});
};

scope.getZonesByTargetIDs = function(targetIDs, cb) {
	getZonesByTargetIDsFromCache(targetIDs, (err, results) => {
		if (err) {
			logger.sysDEBUG(`Couldn't get targets zone from cache - updating cache from DB. Error: ${err}`);
			return scope.getZonesByTargetIDsFromDB(targetIDs, cb);
		}


		cb(err, results);
	});
};

scope.getZonesTargetsByDiskIDs = function(diskIDs, cb) {
	var db = app.get('db');
	var serverCollection = db.collection('server');

	var match = { 'disks.diskID': { $in: diskIDs } };
	var projection = { node_id: 1, zone: 1 };

	serverCollection.find(match).project(projection).toArray(function(err, targets) {
		if (err)
			return cb(err);

		var zones = {};
		targets.forEach(t => {
			if (!(t.zone in zones))
				zones[t.zone] = {
					id: t.zone,
					targetsInZone: new Set()
				};

			zones[t.zone].targetsInZone.add(t.node_id);
		});

		cb(err, zones);
	});
};

scope.getZonesByPRaidUUIDs = function(pRaidUUIDs, cb) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	volumeCollection.aggregate([
		{ $match: { 'chunks.pRaids.uuid': { $in: pRaidUUIDs } } },
		{ $project: {
			'chunks.pRaids.uuid': 1,
			'chunks.pRaids.zone': 1
		} },
		{ $unwind: '$chunks' },
		{ $unwind: '$chunks.pRaids' },
		{ $match: { 'chunks.pRaids.uuid': { $in: pRaidUUIDs } } },
		{ $project: {
			uuid: '$chunks.pRaids.uuid',
			zone: '$chunks.pRaids.zone'
		} }
	]).toArray((err, pRaids)=>{
		if (err)
			return cb(err);

		var results = new PRaidsZonesResult(pRaidUUIDs, pRaids || []);
		cb(null, results);
	});
};

scope.getZonesByVolume = function(volume) {
	var zoneLocksToAcquire = new Set();

	var chunks = scope.getAllVolumeChunks(volume);
	if (chunks)
		chunks.forEach((chunk) => {
			if (chunk.pRaids)
				chunk.pRaids.forEach((pRaid) => {
					zoneLocksToAcquire.add(pRaid.zone);
				});
		});

	return zoneLocksToAcquire;
};

scope.getZonesByVolumes = function(volumes) {
	return new Set(volumes.map(v => Array.from(scope.getZonesByVolume(v))).flat());
};

scope.enforceLockedZoneSetEqualtyOrExit = (alreadyLockedZones, wishfulZonesToLock, errorLogSystemMessage) => {
	if (![...wishfulZonesToLock].every((zone) => alreadyLockedZones.has(zone))) {
		// we have unmatched locked zones (not all of the zones were locked) - bailing out
		errorLogSystemMessage.log();
		process.exit(1);
	}
};

module.exports = scope;
