/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

var async = require('async');
var uuid = require('uuid');

var utils = require('../utils.js');
var logger = require('../logger.js');
var events = require('../events.js');
var consts = require('../consts.js');
var objectNotifier = require('../objectNotifier.js');
var { ExecutionTimer } = require('../models/executionTimer.js');

var logModule = require('./log.js');
var lockModule = require('./lock.js');
var zoneModule = require('./zone.js');
var kafkaModule = require('./kafka.js');

var { MongoError, SystemAdminMessage, Entities, SystemMessage } = require('./error.js');
var systemMessages = require('../systemMessages.js');
const { sysERROR } = require('../logger.js');

const { DeleteVolume } = require('../models/kafkaMessages/DeleteVolume');
const { UpdateVolume } = require('../models/kafkaMessages/UpdateVolume.js');
const { DeleteVolumeCompleted } = require('../models/kafkaMessages/DeleteVolumeCompleted.js');
const cdvTomaAutoAttach = require('./cdvTomaAutoAttach');

var scope = {};
scope.volumeCalculationInProgress = {};

scope.afterModuleLoaded = function() {
	logModule = require('./log.js');
	logger = require('../logger.js');
	events = require('../events.js');
	({ MongoError, SystemAdminMessage, Entities, SystemMessage } = require('./error.js'));
};

// this function takes into account the zone or target availability before returning the volume status
// non-protected volumes are check against target availability and protected volumes against the zone availability (configurationVersion collection)
scope.getAllVolumes = function(projection, page, count, filter, sort, cb) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	var query = {
		filter: filter || {},
		projection: projection || {},
		sort: sort || {},
		skip: page * count,
		limit: count
	};

	if (query.projection && query.projection['status']) {
		query.projection['zoneData'] = 1;
		query.projection['RAIDLevel'] = 1;
	}

	if (!query.filter.status)
		query.filter.status = { $nin: [consts.volumeStatuses.PENDING, consts.volumeStatuses.TO_BE_DELETED] };

	query.filter.isReserved = false;

	var pipeline = [
		{ $match: query.filter },
		{ $addFields: { zones: { $ifNull: ['$chunks.zone', []] } } },
		{
			$lookup: {
				from: 'configurationVersion',
				let: { zones: '$zones' },
				pipeline: [
					{ $match: { $expr: { $in: ['$_id', '$$zones'] } } },
					{ $project: { 'isUnavailable': 1 } }
				],
				as: 'zoneData'
			}
		}
	];

	// Denormalize CDV name for TPV queries
	if (query.filter.volumeClass === consts.volumeClass.TPV) {
		pipeline.push(
			{ $lookup: { from: 'volume', localField: 'tpvConfig.cdvId', foreignField: '_id', as: '_cdv', pipeline: [{ $project: { name: 1 } }] } },
			{ $addFields: { 'tpvConfig.cdvName': { $arrayElemAt: ['$_cdv.name', 0] } } },
			{ $unset: '_cdv' }
		);
	}

	if (Object.keys(query.projection).length)
		pipeline.push({ $project: query.projection });

	if (Object.keys(query.sort).length)
		pipeline.push({ $sort: query.sort });

	pipeline.push({ $skip: query.skip });

	if (query.limit > 0)
		pipeline.push({ $limit: query.limit });

	volumeCollection.aggregate(pipeline).toArray((err, results) => {
		if (err) {
			err = new MongoError(err).log();
		}

		// adjusting the correct volume status according to the availability status of the zone or the target depending on the volume RAID Level
		if (results && results.length)
			results.forEach((volume) => {
				if (volume.zoneData && volume.zoneData.length) {
					let unavailableVolumeZones = volume.zoneData.filter((zone) => { return zone.isUnavailable; });
					if (unavailableVolumeZones.length)
						volume.status = consts.volumeStatuses.UNAVAILABLE;
				}

				delete volume['zones'];
				delete volume['zoneData'];
			});

		cb(err, results || []);
	});
};

scope.getVolumesHealthCalculationPipeline = () => {
	return [
		{ $match: {
			status: { $nin: [consts.volumeStatuses.PENDING, consts.volumeStatuses.TO_BE_DELETED] },
			isReserved: false,
			volumeClass: { $nin: [consts.volumeClass.CDV, consts.volumeClass.TPV] },
		} },
		{ $addFields: { zones: '$chunks.zone' } },
		{ $project: { zones: 1, health: 1, RAIDLevel: 1 } },
		{
			$lookup: {
				from: 'configurationVersion',
				let: { zones: '$zones' },
				pipeline: [
					{ $match: { $expr: { $in: ['$_id', '$$zones'] } } },
					{ $project: { 'isUnavailable': 1 } }
				],
				as: 'zoneData'
			}
		},
		{
			$addFields: {
				isUnavailable: {
					$reduce: {
						input: '$zoneData',
						initialValue: false,
						in: { $or: ['$$value', '$$this.isUnavailable'] }
					}
				}
			}
		},
		{ $addFields: { newHealth: { $cond: { if: '$isUnavailable', then: 'critical', else: '$health' } } } },
	];
};

scope.calculateVolumeCounters = cb => {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');

	const groupingPipeline = [
		{ $group: { _id: '$newHealth', count: { $sum: 1 } } },
		{
			$group: {
				_id: null,
				mergedDoc: {
					$push: {
						k: '$_id',
						v: '$count'
					}
				}
			}
		},
		{
			$replaceRoot: {
				newRoot: {
					$arrayToObject: '$mergedDoc'
				}
			}
		},
		{ $addFields: { total: { $sum: ['$healthy', '$critical', '$alarm'] } } }
	];

	const pipeline = scope.getVolumesHealthCalculationPipeline().concat(groupingPipeline);

	volumeCollection.aggregate(pipeline).toArray((err, counters) => {
		if (err) {
			err = new MongoError(err).log();
		} else {
			counters = counters[0] || { total: 0 };
			[consts.targetHealth.HEALTHY, consts.targetHealth.ALARM, consts.targetHealth.CRITICAL]
				.forEach(healthStatus => {
					if (!(healthStatus in counters))
						counters[healthStatus] = 0;
				});
		}

		cb(err, counters);
	});
};

function getCombinedState(snapshot, state, statesInDecreasingImportance) {
	const dataState = snapshot.data[state];
	const metadataState = snapshot.metadata[state];
	const isVolumeInDeletingProgress = vol => [consts.volumeActions.MARKED_FOR_DELETION, consts.volumeActions.DELETING].includes(vol.action);
	let snapshotInternalStates = [dataState, metadataState];

	if (snapshot.source)
		snapshotInternalStates.push(snapshot.source[state]);
	else if (!isVolumeInDeletingProgress(snapshot.data) && !isVolumeInDeletingProgress(snapshot.metadata))
		sysERROR(`Snapshot ${snapshot.data.name} has no source volume and not in deleting progress! Snapshot:`, snapshot);

	return statesInDecreasingImportance[
		snapshotInternalStates
			.map(state => statesInDecreasingImportance.indexOf(state))
			.reduce((min, i) => i < min ? i : min, Number.MAX_SAFE_INTEGER)
	];
}

function getCombinedStatus(snapshot) {
	const statusesInDecreasingImportance = [
		consts.volumeStatuses.UNAVAILABLE,
		consts.volumeStatuses.OFFLINE,
		consts.volumeStatuses.DEGRADED,
		consts.volumeStatuses.TO_BE_DELETED,
		consts.volumeStatuses.ONLINE
	];

	return getCombinedState(snapshot, 'status', statusesInDecreasingImportance);
}

function getCombinedAction(snapshot) {
	const actionsInDecreasingImportance = [
		consts.volumeActions.DELETING,
		consts.volumeActions.MARKED_FOR_DELETION,
		consts.volumeActions.EXTENDING,
		consts.volumeActions.INITIALIZING,
		consts.volumeActions.BOOTING,
		consts.volumeActions.REBUILD_REQUIRED,
		consts.volumeActions.REBUILDING,
		consts.volumeActions.MARKED_FOR_REBUILD,
		consts.volumeActions.NONE
	];

	return getCombinedState(snapshot, 'action', actionsInDecreasingImportance);
}

function getCombinedHealth(snapshot) {
	const healthInDecreasingImportance = [
		consts.targetHealth.CRITICAL,
		consts.targetHealth.ALARM,
		consts.targetHealth.HEALTHY
	];

	return getCombinedState(snapshot, 'health', healthInDecreasingImportance);
}

function createCombinedVolumes(snapshotVolumesTrio) {
	return snapshotVolumesTrio.map(snapshotTrio => {
		let combinedVolume = snapshotTrio.data;

		combinedVolume.combinedStatus = getCombinedStatus(snapshotTrio);
		combinedVolume.combinedAction = getCombinedAction(snapshotTrio);
		combinedVolume.combinedHealth = getCombinedHealth(snapshotTrio);

		combinedVolume.isSnapshot = true;

		return combinedVolume;
	});
}

scope.getCombinedStatusVolume = (dataVolume, cb) => {
	scope.getAllVolumes({}, 0, 0, { _id: { $in: [dataVolume.sourceID, dataVolume.metadataVolumeID] } }, {}, (err, volumes) => {
		const metadataVolume = volumes.filter(v => v.type === consts.volumeTypes.METADATA_VOLUME)[0];
		const sourceVolume = volumes.filter(v => v.usedAsSourceCount);

		let snapshotTrio = {
			data: dataVolume,
			metadata: metadataVolume
		};

		if (sourceVolume.length)
			snapshotTrio.source = sourceVolume[0];

		logger.sysDEBUG(`combinedStatus for ${dataVolume._id}, snapshot trio:`, snapshotTrio);
		const combinedVolumes = createCombinedVolumes([snapshotTrio]);
		logger.sysDEBUG(`combinedStatus for ${dataVolume._id}, combinedVolume:`, combinedVolumes.length ? combinedVolumes[0] : {});
		cb(combinedVolumes.length ? combinedVolumes[0] : {});
	});
};

scope.incrementVersionOnTargets = function(targets, cb) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	var affectedZones = [];

	volumeCollection
		.find({
			status: { $nin: [consts.volumeStatuses.PENDING, consts.volumeStatuses.TO_BE_DELETED] },
			isReserved: false,
			'chunks.pRaids.diskSegments.node_id': { $in: targets }
		})
		.project(utils.volumeProjection)
		.toArray((err, results) => {
			if (err) {
				new MongoError(err).log();
				return cb([]);
			}

			volumeCollection.updateMany(
				{ '_id': { $in: results.map((v) => { return v._id; }) } },
				{ $inc: { version: 1 } },
				function(err) {
					if (err) {
						new MongoError(err).log();
						return cb([]);
					}

					results.forEach((v) => {
						v.version++;
						v.chunks.forEach((c) => {
							c.pRaids.forEach((p) => {
								if (p.zone !== undefined && p.zone !== null) {
									affectedZones.push(p.zone);
								}
							});
						});

						events.emitEvent([events.getVolumeID(v.name)], objectNotifier.events.volumeVersionChangeEvent, v);
					});

					cb(affectedZones);
				}
			);
		});
};

scope.sendVolumeUpdateToTomaByVolume = (volume) => {
	let zones = zoneModule.getZonesByVolume(volume);
	let affectedZones = {};

	Array.from(zones).forEach((zone) => {
		if (!affectedZones[zone])
			affectedZones[zone] = new Set();

		affectedZones[zone].add(volume);
	});

	scope.sendVolumeUpdateToToma(affectedZones);
};

scope.sendVolumeUpdateToToma = (affectedZones, callback) => {
	async.eachSeries(Object.keys(affectedZones), (zone, callback) => {
		let volumes = Array.from(affectedZones[zone]);

		// filter out marked for deletion volumes
		volumes = volumes.filter((volume) => { return volume.action !== consts.volumeActions.MARKED_FOR_DELETION; });

		const updateVolumeMessages = volumes.map(v => new UpdateVolume(v));

		kafkaModule.getIncrementalUpdatesTopic(zone, incrementalUpdateTopic => {
			kafkaModule.sendMessages(
				incrementalUpdateTopic,
				updateVolumeMessages,
				err => {
					if (err)
						return callback();

					scope.updateVolumesForSentVersionByEntityField(volumes, 'lastVersionSentToTomaViaKafka', incrementalUpdateTopic, callback);
				}
			);
		});
	}, () => {
		if (callback)
			callback();
	});
};

scope.updateVolumesForSentVersionByEntityField = (volumes, lastVersionSentEntityFieldName, tomaTopic, callback) => {
	let db = app.get('db');
	let volumeCollection = db.collection('volume');

	async.eachSeries(volumes, (volume, callback) => {
		const $set = { [lastVersionSentEntityFieldName]: volume.version };

		if (tomaTopic)
			$set.lastVersionSentToTomaTopicName = tomaTopic;

		volumeCollection.updateOne({ _id: volume._id, version: volume.version }, { $set }, (err) => {
			if (err)
				new MongoError(err).log();

			callback();
		});
	}, callback);
};

scope.logGrantedPermission = (clientID, volumeID, authorizingKeys) => {
	const sysAdminError = new SystemAdminMessage(systemMessages.VOLUME_CLIENT_PERMISSION_GRANTED);
	authorizingKeys.forEach((key) => sysAdminError.addInfo(Entities.Client.authorizedKey, key));
	sysAdminError.addInfo(Entities.Volume.ID, volumeID).addInfo(Entities.Client.ID, clientID).log();
};

scope.checkPermission = function(volume, clientID, callback) {
	if (!volume.VSGs?.length && !volume.VPG_VSGs?.length)
		return callback(true, [], [], []);

	var db = app.get('db');
	var clientCollection = db.collection('client');
	var vsgCollection = db.collection('volumeSecurityGroup');

	var volumeVsgIds = volume.VSGs || volume.VPG_VSGs || [];

	async.waterfall([
		function getClientKeys(cb) {
			clientCollection.findOne({ _id: clientID }, { keys: 1 }, (err, dbClient) => {
				cb(err, dbClient.keys || []);
			});
		},
		function getVolumeVSGs(clientKeys, cb) {
			vsgCollection.find({ _id: { $in: volumeVsgIds } }).toArray((err, volumeVSGs) => {
				cb(err, clientKeys, volumeVSGs);
			});
		},
	], (err, clientKeys, volumeVSGs) => {
		if (err) {
			logger.sysDEBUG('Failed to verify Volume VSGs with Client Keys', { clientID: clientID, volume: volume.name, error: err });
			return callback(false);
		}

		// Check if client has correct keys
		// and save the relevant VSG and keys used to authorize
		var authorizingVSGs = new Set();
		var authorizingKeys = [];

		volumeVSGs.forEach(vsg => {
			vsg.keys.forEach(k => {
				var authKey = clientKeys.find(key => key._id == k);
				if (authKey) {
					authorizingKeys.push(authKey);
					authorizingVSGs.add(vsg._id);
				}
			});
		});

		var allowed = !!authorizingKeys.length;
		authorizingVSGs = Array.from(authorizingVSGs);
		return callback(allowed, authorizingVSGs, authorizingKeys, clientKeys);
	});
};


scope.enrichVolumes = (requestedVolumes, cb) => {
	const getVolumeID = volume => volume._id || volume.name;
	const db = app.get('db');
	const volumeCollection = db.collection('volume');
	const volumesIdentificators = requestedVolumes.map(v => { return { $and: [{ _id: getVolumeID(v) }, { uuid: v.uuid }] }; });

	volumeCollection.aggregate([
		{ $match: { $or: volumesIdentificators } },
		{
			$lookup: {
				from: 'volumeProvisioningGroup',
				let: { vpgID: '$VPG' },
				pipeline: [
					{ $match: { $expr: { $eq: ['$_id', '$$vpgID'] } } },
					{ $project: { 'VSGs': 1 } }
				],
				as: 'VPGData'
			}
		},
		{ $unwind: {
			path: '$VPGData',
			preserveNullAndEmptyArrays: true
		} },
		{ $project: {
			uuid: '$uuid',
			name: '$name',
			status: '$status',
			action: '$action',
			RAIDLevel: '$RAIDLevel',
			VSGs: '$VSGs',
			VPG_VSGs: '$VPGData.VSGs',
			reservation: '$reservation',
			isReadOnly: '$isReadOnly',
			metadataVolumeID: '$metadataVolumeID',
			snapshotID: '$snapshotID',
			isReady: '$isReady'
		} }
	]).toArray((err, results) => {
		if (err)
			new MongoError(err).log();

		cb(!err && results && results.length ? results : []);
	});
};

scope.validateAllVolumesHaveReservationVersion = function(volumes, cb) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	if (volumes.every(v => { return v.reservationVersion; }))
		return cb(volumes);

	var volumesWithoutReservationVersionIDs = volumes.filter(v => { return !v.reservationVersion; }).map(v => { return v.uuid; });
	volumeCollection.find({ uuid: { $in: volumesWithoutReservationVersionIDs } }, { 'reservation.version': 1, uuid: 1 }).toArray((err, resultVolumes) => {
		if (err)
			new MongoError(err).log();

		if (resultVolumes)
			resultVolumes.forEach(resultVolume => {
				volumes.forEach(volume => {
					if (resultVolume.uuid === volume.uuid) {
						volume.reservationVersion = resultVolume.reservation.version;
						volume.err = consts.reservationVersionOutdatedMsg + resultVolume.reservation.version;
					}
				});
			});
		return cb(volumes);
	});
};

scope.updateVolumeReservation = (clientHostname, volume, dbVolume, cb) => {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');
	const logDebugWithClientID = utils.getDebugLoggerWithPrefix(`updateVolumeReservation clientID: ${clientHostname} `
		+ `volume.name: ${volume.name} volume.uuid: ${volume.uuid} `);
	let responseWithUUID = createReservationModeResponse(dbVolume.uuid, dbVolume.name);
	let responseObj;

	const $options = { projection: { uuid: 1, name: 1, reservation: 1 }, returnDocument: consts.mongoReturnDocument.AFTER };
	const query = getTransitionQuery(dbVolume.uuid, volume, clientHostname);
	volumeCollection.findOneAndUpdate(query.$filter, query.$update, $options, (err, result) => {
		if (err) {
			err = new MongoError(err).log();
			responseObj = responseWithUUID(false, null, err);
		} else if (!result) {
			let msg = new SystemMessage(systemMessages.VALIDATE_RESERVATION_MISMATCH_UPDATE_FAILED);
			logDebugWithClientID(msg);
			responseObj = responseWithUUID(false, null, msg, true);
		} else {
			if (dbVolume.reservation.mode != volume.reservation.mode)
				logDebugWithClientID(`The volume: ${result.name} successfully transitioned from RM: `
					+ `${dbVolume.reservation.mode} to RM: ${volume.reservation.mode}`);
			else
				logDebugWithClientID(`The volume: ${result.name} was updated with new attached client. reservation version not changed`);

			responseObj = responseWithUUID(true, result.reservation.version, null, null, result);
		}

		cb(responseObj);
	});
};

scope.validateReservationMode = function(clientHostname, volume, dbVolume, cb) {
	let id = uuid.v1();
	let validateReservationModeTimer = new ExecutionTimer(id + '.validateReservationMode');

	let msg;
	let responseWithUUID = createReservationModeResponse(dbVolume.uuid, dbVolume.name);
	let logDebugWithClientID = utils.getDebugLoggerWithPrefix(`validateReservationMode clientID: ${clientHostname} `
		+ `volume.name: ${volume.name} volume.uuid: ${volume.uuid} `);

	let responseObj;
	logDebugWithClientID('Validating RM with volume:', volume);

	const requestWritePermissions = consts.writableReservationModes.includes(volume.reservation.mode);
	const isJoiningMatchingSharedMode = dbVolume.reservation.mode &&
			dbVolume.reservation.mode === volume.reservation.mode && consts.sharedReservationModes.includes(volume.reservation.mode);
	const isTransitioningToDifferentMode = dbVolume.reservation.mode != 0 && volume.reservation.mode !== dbVolume.reservation.mode;
	const isRequestingExclusive = volume.reservation.mode === consts.reservationModes.EXCLUSIVE_READ_WRITE;
	const isRequestingExclusiveWithAlreadyExclusiveClient = isRequestingExclusive &&
			dbVolume.reservation.mode === consts.reservationModes.EXCLUSIVE_READ_WRITE && dbVolume.reservation.reservedBy === clientHostname;
	const isRequestingExclusiveWithDifferentClient = isRequestingExclusive && dbVolume.reservation.reservedBy &&
			dbVolume.reservation.reservedBy !== clientHostname;

	if (isJoiningMatchingSharedMode || isRequestingExclusiveWithAlreadyExclusiveClient) {
		logDebugWithClientID(
			'The volume reservation will not be updated since the client is: joining a matching shared mode: '
				+ isJoiningMatchingSharedMode + ' or requesting exclusive with an already exclusive client: '
				+ isRequestingExclusiveWithAlreadyExclusiveClient
		);
		responseObj = responseWithUUID(true, dbVolume.reservation.version, null, null, dbVolume);
	} else if (requestWritePermissions && dbVolume.isReadOnly) {
		msg = new SystemMessage(systemMessages.VALIDATE_RESERVATION_READ_ONLY_ERROR);
		logDebugWithClientID(msg, volume);
		responseObj = responseWithUUID(false, dbVolume.reservation.version, msg, true, dbVolume);
	} else if (isTransitioningToDifferentMode || isRequestingExclusiveWithDifferentClient) {
		// check preempt flag and reservation version
		var transition = getTransitionValidity(dbVolume, volume);
		logDebugWithClientID('Checked preempt and reservation version, transition: ', transition);

		responseObj = responseWithUUID(
			transition.isValid,
			transition.isReservationVersionOutdated ? dbVolume.reservation.version : null,
			transition.err,
			transition.isReservationVersionOutdated,
			dbVolume
		);
	} else {
		logDebugWithClientID(`Transitioning from NONE. dbVolume mode = ${dbVolume.reservation.mode}, requested mode = ${volume.reservation.mode }`);
		responseObj = responseWithUUID(true, dbVolume.reservation.version, null, null, dbVolume);
	}

	validateReservationModeTimer.stop(responseObj.success);
	cb(responseObj);
};

function createReservationModeResponse(uuid, name) {
	return (success, reservationVersion, err, isReservationVersionOutdated = false, dbVolume) => {
		return {
			success: success,
			reservationVersion: reservationVersion,
			err: err,
			uuid: uuid,
			name: name,
			isReservationVersionOutdated: isReservationVersionOutdated,
			dbVolume: dbVolume
		};
	};
}

function getTransitionValidity(dbVolume, volume) {
	const isRequestingExclusive = volume.reservation.mode === consts.reservationModes.EXCLUSIVE_READ_WRITE;
	const isReservationVersionOutdated = volume.reservation.version !== dbVolume.reservation.version;
	const isTransitioningFromSharedToExclusive = consts.sharedReservationModes.indexOf(dbVolume.reservation.mode) !== -1 && isRequestingExclusive;
	const isWeakPreempt = volume.reservation.preempt === consts.reservationModePreempts.WEAK_PREEMPT;
	const isPreempt = volume.reservation.preempt === consts.reservationModePreempts.PREEMPT;
	const isTransitionNeedsPreempt = dbVolume.reservation.mode !== consts.reservationModes.NONE;
	let err;

	if (isReservationVersionOutdated)
		err = new SystemMessage(systemMessages.VALIDATE_RESERVATION_MISMATCH).addInfo(Entities.Volume.reservation, dbVolume.reservation.version);
	else if (isTransitionNeedsPreempt) {
		let isPreemptErr = isTransitioningFromSharedToExclusive ? !(isWeakPreempt || isPreempt) : !isPreempt;

		if (isPreemptErr)
			err = new SystemMessage(systemMessages.VALIDATE_RESERVATION_PREEMPT_ERROR);
	}

	return { err: err, isValid: !err, isReservationVersionOutdated: isReservationVersionOutdated };
}

function getTransitionQuery(uuid, volume, clientHostname) {
	const isCurrentReservationModeNone = { 'reservation.mode': { $eq: consts.reservationModes.NONE } };
	const isReservationVersionMatching = { 'reservation.version': volume.reservation.version };
	const isJoiningMatchingMode = { 'reservation.mode': { $eq: volume.reservation.mode } };
	const filterDisjunctions = {
		$or: [
			isCurrentReservationModeNone,
			isReservationVersionMatching,
			isJoiningMatchingMode
		]
	};

	const $filter = {
		$and: [
			{ uuid: uuid },
			filterDisjunctions,
		]
	};

	const requestWritePermissions = consts.writableReservationModes.includes(volume.reservation.mode);
	if (requestWritePermissions) {
		$filter['$and'].push({ $or: [
			{ 'isReadOnly': { $exists: false } },
			{ 'isReadOnly': { $eq: false } }
		] });
	}
	const transitionMadeCond = {
		$or: [
			{ $ne: ['$reservation.mode', volume.reservation.mode] },
			{ $and: [
				{ $eq: ['$reservation.mode', consts.reservationModes.EXCLUSIVE_READ_WRITE] },
				{ $ne: ['$reservation.reservedBy', clientHostname] }
			] }
		]
	};

	return {
		$filter: $filter,
		$update: [
			{
				$set: {
					'reservation.mode': { $cond: [
						transitionMadeCond,
						volume.reservation.mode,
						'$reservation.mode'
					] },
					'reservation.reservedBy': { $cond: [
						transitionMadeCond,
						clientHostname,
						'$reservation.reservedBy'
					] },
					'reservation.version': { $cond: [
						transitionMadeCond,
						{ $add: ['$reservation.version', 1] },
						{ $add: ['$reservation.version', 0] }
					] },
					'reservation.lastTransitionDate': { $cond: [
						transitionMadeCond,
						new Date(),
						'$reservation.lastTransitionDate'
					] },
					'reservation.attachedClients': { $cond: [
						{ $and: [transitionMadeCond, volume.reservation.preempt, volume.reservation.isDetachOthers] },
						[clientHostname],
						{ $setUnion: ['$reservation.attachedClients', [clientHostname]] }
					] }
				}
			}
		]
	};
}

scope.updateVolumeVersionInCache = function(volume, cb) {
	if (!volume || !volume.uuid || !volume.version)
		return logger.sysDEBUG('Tried to update volume version but I didn\'t receive enough datat to update');

	objectNotifier.getObject(objectNotifier.events.volumesVersionsChangeEvent.name, (err, volumeVersions) => {
		if (volumeVersions[volume.uuid] && volumeVersions[volume.uuid].version < volume.version)
			volumeVersions[volume.uuid].version = volume.version;

		if (cb)
			cb();
	});
};

scope.resetVolumeStatuses = function(callback) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');
	var lastMessageLogCollection = db.collection('lastMessageLog');

	async.series([
		function(callback) {
			lockModule.acquireGlobalLock(function() {
				var cursor = volumeCollection.find({ status: { $nin: [consts.volumeStatuses.TO_BE_DELETED, consts.volumeStatuses.PENDING] } });

				function exit(err) {
					lockModule.releaseGlobalLock();
					if (cursor)
						cursor.close();
					return callback(err);
				}

				function processVolume(err, volume) {
					if (err)
						return exit(new MongoError(err).log());

					var updatedSomething = false;

					if (volume.chunks && volume.chunks.length)
						volume.chunks.forEach(function(chunk) {
							if (chunk.pRaids && chunk.pRaids.length)
								chunk.pRaids.forEach(function(pRaid) {
									if (pRaid.version && (pRaid.version.major !== 0 || pRaid.version.minor !== 0)) {
										pRaid.version = { major: 0, minor: 0 };
										updatedSomething = true;
									}

									if (pRaid.tomaLeaderRaftTerm) {
										pRaid.tomaLeaderRaftTerm = 0;
										updatedSomething = true;
									}
								});
						});

					if (updatedSomething)
						volumeCollection.updateOne({ _id: volume._id }, { $set: volume }, function(err) {
							if (err)
								return exit(new MongoError(err).log());

							iter();
						});
					else
						iter();
				}

				function iter() {
					cursor.hasNext(function(err, hasNext) {
						if (hasNext)
							setTimeout(function() { cursor.next(processVolume); }, 0);
						else
							exit();
					});
				}

				iter();
			});
		},
		function(callback) {
			lastMessageLogCollection.updateMany({},
				{ $unset: { raftTerm: 1 }, $set: { messageSequence: 0, token: 0 } },
				function(err) {
					if (err) {
						err = new MongoError(err).log();
					}

					callback(err);
				});
		}
	], function(err) {
		if (err)
			logger.sysDEBUG('Got an error while trying to reset sequences', err);

		callback(err);
	});
};

scope.getAllNodeIdsPerVolume = function(volume) {
	var nodesDict = {};

	volume.chunks.forEach(function(chunk) {
		chunk.pRaids.forEach(function(pRaid) {
			pRaid.diskSegments.forEach(function(segment) {
				nodesDict[segment.node_id] = {};
			});
		});
	});

	var nodeIDsList = Object.keys(nodesDict);

	return nodeIDsList;
};

var lastVolumesDeletionZeroUpdateTime = null;

scope.getTotalZeroedBlocks = function(callback) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	var $match = { 'deletionZeroingStarted': true };

	volumeCollection.aggregate([
		{ $match: $match },
		{ $unwind: '$chunks' },
		{ $unwind: '$chunks.pRaids' },
		{ $unwind: '$chunks.pRaids.diskSegments' },
		{
			$group: {
				_id: '$_id',
				totalZeroedBlks: { $sum: '$chunks.pRaids.diskSegments.nZeroedBlks' },
				totalBlocks: { $sum: { $add: [{ $subtract: ['$chunks.pRaids.diskSegments.lbe', '$chunks.pRaids.diskSegments.lbs'] }, 1] } },
				uuid: { $first: '$uuid' }
			}
		}
	]).toArray(function(err, results) {
		if (err) {
			err = new MongoError(err).log();
		}

		callback(err, results || []);
	});
};

scope.updateVolumesDeletionZeroProgress = function(timerCB) {
	if (lastVolumesDeletionZeroUpdateTime && (Date.now() - lastVolumesDeletionZeroUpdateTime < consts.VOLUME_DELETION_ZERO_PROGRESS_INTERVAL)) {
		timerCB();
		return;
	}

	scope.getTotalZeroedBlocks(function(err, totalPerVolumes) {
		timerCB();

		if (err)
			return;

		if (!totalPerVolumes.length)
			return;

		// aggregate results to sum ELECT volumes totals with their mdv totals
		// MDV results will have the _id of the ELECT volume
		var aggregateResults = {};
		totalPerVolumes.forEach(function(v) {
			if (!aggregateResults[v._id])
				aggregateResults[v._id] = v;
			else {
				aggregateResults[v._id].totalZeroedBlks += v.totalZeroedBlks;
				aggregateResults[v._id].totalBlocks += v.totalBlocks;
			}
		});

		// updating last volume zeroing update time
		lastVolumesDeletionZeroUpdateTime = Date.now();

		totalPerVolumes.forEach(function(volumeRes) {
			if (!volumeRes.totalZeroedBlks || !volumeRes.totalBlocks)
				return;

			var deletionZeroPercentage = Math.floor(volumeRes.totalZeroedBlks / volumeRes.totalBlocks * 100);
			// emit update event if the value of total zeroed blocks has changes from last event emitting
			if (!utils.volumesDeletionOnZeroProgress[volumeRes.uuid] || utils.volumesDeletionOnZeroProgress[volumeRes.uuid] < deletionZeroPercentage) {
				utils.volumesDeletionOnZeroProgress[volumeRes.uuid] = deletionZeroPercentage;
				events.emitEvent([events.getVolumeID(volumeRes._id)], objectNotifier.events.volumeDeletionZeroingProgressChangeEvent,
					{ 'totalZeroedPercentage': deletionZeroPercentage });
			}
		});
	});
};

scope.updateSegmentZeroingProgress = function(message) {
	let db = app.get('db');
	let volumeCollection = db.collection('volume');
	let executionTimer = new ExecutionTimer('updateSegmentZeroingProgress');

	let segmentSetter = 'chunks.$[].pRaids.$[].diskSegments.$[segment]';
	let volumeMatcher = {
		'chunks.pRaids.diskSegments': {
			$elemMatch: {
				_id: message.payload.segmentUUID,
				$or: [{
					tomaToken: { $exists: false }
				}, {
					tomaToken: { $lt: message.tomaToken }
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

	if (message.payload.pRaidUUID)
		volumeMatcher['chunks.pRaids'] = { '$elemMatch': { uuid: message.payload.pRaidUUID } };

	let $setObj = { deletionZeroingStarted: true };
	$setObj[segmentSetter + '.nZeroedBlks'] = message.payload.nZeroedBlks;
	$setObj[segmentSetter + '.kafkaMessageSequence'] = message.messageSequence;

	volumeCollection.findOneAndUpdate(volumeMatcher, { $set: $setObj }, { arrayFilters: [{ 'segment._id': message.payload.segmentUUID }] }, (err, res) => {
		if (err) {
			new MongoError(err).addInfo(Entities.DiskSegment.UUID, message.payload.segmentUUID).log();
			executionTimer.stop(false);

		} else if (res) {
			logger.sysDEBUG(`Updating zeroing progress for segment uuid: ${message.payload.segmentUUID} total zero blocks:${message.payload.nZeroedBlks}`);

			scope.updateVolumesDeletionZeroProgress(() => { executionTimer.stop(); });
		}
	});
};

function updatePRaidLeader(pRaidToUpdate, shouldUpdate, callback) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	var pRaidSetter = 'chunks.$[].pRaids.$[pRaid]';
	var $set = {};

	if (shouldUpdate) {
		$set[pRaidSetter + '.version.major'] = pRaidToUpdate.version.major;
		$set[pRaidSetter + '.version.minor'] = pRaidToUpdate.version.minor;
		$set[pRaidSetter + '.tomaLeaderRaftTerm'] = pRaidToUpdate.tomaLeaderRaftTerm;
		$set[pRaidSetter + '.lastReport'] = new Date();
	} else {
		$set[pRaidSetter + '.debug'] = 1;
	}

	var query = getPRaidUpdateQuery(pRaidToUpdate);
	var options = { returnDocument: consts.mongoReturnDocument.AFTER, arrayFilters: [{ 'pRaid.uuid': pRaidToUpdate.uuid }] };

	volumeCollection.findOneAndUpdate(query, { $set: $set }, options, callback);
}

function getPRaidUpdateQuery(pRaidToUpdate) {
	var statusChangeDecider = {};

	if (pRaidToUpdate.segments.length === 1) {
		statusChangeDecider = { 'diskSegments': { $elemMatch: { status: { $ne: pRaidToUpdate.segments[0].status } } } };

		if (pRaidToUpdate.segments[0].status === consts.diskSegmentStatuses.NORMAL)
			statusChangeDecider = { $or: [
				statusChangeDecider,
				{ 'diskSegments': { $elemMatch: { isDead: true } } }
			] };
	}

	var pRaidMatcher = {
		$elemMatch: {
			uuid: pRaidToUpdate.uuid,
			$or: [
				{ 'version.major': { $lt: pRaidToUpdate.version.major } },
				{
					$and: [
						{ 'version.major': pRaidToUpdate.version.major },
						{ $or: [
							{ 'version.minor': { $lt: pRaidToUpdate.version.minor } },
							{ $and: [
								{ 'version.minor': pRaidToUpdate.version.minor },
								statusChangeDecider
							] },
						] }
					]
				},
				{ tomaLeaderRaftTerm: { $lt: pRaidToUpdate.tomaLeaderRaftTerm } }
			]
		}
	};

	var chunksPraidMatcher = {
		'chunks.pRaids': pRaidMatcher
	};

	return chunksPraidMatcher;
}

function fetchDriveBySegmentID(segment, callback) {
	var db = app.get('db');
	var serverCollection = db.collection('server');

	var nodeMatch = segment.node_id ? { _id: segment.node_id } : {};

	serverCollection.aggregate([
		{ $match: nodeMatch },
		{ $project: {
			'node_id': 1,
			'zone': 1,
			'disks.usableBlocks': 1,
			'disks.block_size': 1,
			'disks.diskID': 1,
			'disks.availableBlocks': 1,
			'disks.diskSegments': 1,
			'disks.GPT.firstUsableLba': 1,
			'disks.GPT.lastUsableLba': 1
		} },
		{ $unwind: '$disks' },
		{ $match: { 'disks.diskSegments': { $elemMatch: { _id: segment.segmentID } } } }
	]).toArray(function(err, serverDisks) {
		if (!serverDisks || serverDisks.length != 1) {
			logger.sysDEBUG('Failed to find one disk with this diskSegment: ', segment.segmentID);
			return callback();
		}

		callback(serverDisks);
	});
}

function updatePRaidSegmentsInDrives(segments, callback) {
	var executionTimer = new ExecutionTimer('updatePRaidSegmentsInDrives');
	var db = app.get('db');
	var serverCollection = db.collection('server');

	var deprecatedSegments = [];
	var normalStatusChangeSegments = [];
	var segmentsToUpdate = [];

	segments.forEach((seg) => {
		if (seg.status === consts.diskSegmentStatuses.DEPRECATED)
			deprecatedSegments.push(seg);
		else
			normalStatusChangeSegments.push(seg);
	});


	function handleDeprecations(callback) {
		async.eachSeries(deprecatedSegments, (segment, callback) => {
			fetchDriveBySegmentID(segment, (serverDisks) => {
				if (!serverDisks || !serverDisks.length)
					return callback();

				var serverDisk = serverDisks[0];
				var disk = serverDisk.disks;
				var segmentsWithoutDeprecations = disk.diskSegments.filter(function(e) { return e._id !== segment.segmentID; });
				var deprecatedSegment = disk.diskSegments.filter(function(e) { return e._id === segment.segmentID; })[0];

				deprecatedSegment.status = consts.diskSegmentStatuses.DEPRECATED;
				deprecatedSegment.isDead = false;

				var updateObj = { $set: { 'disks.$.diskSegments': segmentsWithoutDeprecations } };
				var delta = deprecatedSegment.lbe - deprecatedSegment.lbs;

				if (delta && !deprecatedSegment.fromReserved && !deprecatedSegment.wasFromReserved)
					utils.appendPropertyOrObject(updateObj, '$inc', 'disks.$.availableBlocks', delta + 1);

				utils.appendPropertyOrObject(updateObj, '$inc', 'disks.$.version', 1);

				disk.diskSegments = segmentsWithoutDeprecations;
				updateObj.$set['disks.$.largestSegmentAvailable'] = utils.getLargestSegment(disk);

				serverCollection.updateOne(
					{ _id: serverDisk.node_id, 'disks.diskID': disk.diskID },
					updateObj,
					function(err) {
						if (err)
							new MongoError(err).log();
						else {
							segmentsToUpdate.push(deprecatedSegment);
							zoneModule.decSegmentFromZone(serverDisk.zone);
						}

						callback(err);
					}
				);
			});
		}, () => {
			if (deprecatedSegments.length)
				events.emitEvent(null, objectNotifier.events.allocatedSpaceDirtyEvent, null);
			callback();
		});
	}

	handleDeprecations(() => {
		executionTimer.stop();
		callback();
	});
}

scope.handleSegmentChangeInPRaid = function(reportPRaid, volume, user, lockedZones, callback) {
	const isCDVFirstPRaid = volume.volumeClass === consts.volumeClass.CDV &&
		volume.chunks && volume.chunks[0] &&
		volume.chunks[0].pRaids.some(pr => pr.uuid === reportPRaid.uuid);
	const oldNodeIds = isCDVFirstPRaid ? cdvTomaAutoAttach._firstPRaidNodeIds(volume) : null;

	async.parallel([
		function(callback) {
			var startDT3 = new Date();

			updatePRaidSegmentsInDrives(reportPRaid.segments, function() {
				var endDT3 = new Date();

				logger.sysVERBOSE('updatePRaidStatus', 'DT3::It took me ' + (endDT3 - startDT3) + 'ms to update segments in drives');
				callback();
			});
		},
		function(callback) {
			var startDT4 = new Date();

			scope.updatePRaidDiskSegments(volume, reportPRaid, user, lockedZones, function() {
				var endDT4 = new Date();

				logger.sysVERBOSE('updatePRaidStatus', 'DT4::It took me ' + (endDT4 - startDT4) + 'ms to update segments in volumes');
				callback();
			});
		}
	], function() {
		if (isCDVFirstPRaid) {
			cdvTomaAutoAttach.reconcileFirstPRaidAttachments(volume, oldNodeIds).catch(err =>
				logger.sysDEBUG(`handleSegmentChangeInPRaid: cdvTomaAutoAttach reconcile failed for CDV ${volume._id}: ${err}`)
			);
		}
		callback();
	});
};

function convertReportPRaidFormatToDBFormat(pRaid) {
	// convert report message format to db format for easier parsing
	pRaid.version = { major: pRaid.pRaidMajorVersion, minor: pRaid.pRaidMinorVersion };
	pRaid.tomaLeaderRaftTerm = pRaid.raftTerm;
	pRaid.segments.forEach(segment => {
		segment.isDead = segment.status === consts.diskSegmentStatuses.DEAD || segment.vitality === consts.segmentVitality.DOWN;
	});

	delete pRaid.pRaidMajorVersion;
	delete pRaid.pRaidMinorVersion;
	delete pRaid.raftTerm;
}

scope.handlePRaidStatusMessage = function(message, mainCallback) {
	let executionTimer = new ExecutionTimer('handlePRaidStatusMessage');

	if (!message.payload.pRaidsUpdate || !message.payload.pRaidsUpdate.length) {
		logger.sysDEBUG(`Received pRaid update without pRaids from ${message.hostname}`);
		executionTimer.stop();
		return mainCallback();
	}

	// split into pRaids with deprecated segments and ones without
	var pRaidsWithDeprecations = [];
	var pRaidsWithoutDeprecations = [];

	message.payload.pRaidsUpdate.forEach((pRaid) => {
		convertReportPRaidFormatToDBFormat(pRaid);

		var hasDeprecations = pRaid.segments.some((seg)=>seg.status == consts.diskSegmentStatuses.DEPRECATED);

		if (hasDeprecations)
			pRaidsWithDeprecations.push(pRaid);
		else
			pRaidsWithoutDeprecations.push(pRaid);

		//Filtering out segments in transient state that TOMA doesn't know their status, as we currently don't have a way to handle them.
		pRaid.segments = pRaid.segments.filter((seg) => {
			return seg.status !== consts.diskSegmentStatuses.INITIALIZING &&
					seg.status !== consts.diskSegmentStatuses.UNKNOWN;
		});
	});

	async.series([
		function handleWithDeprecations(cb) {
			if (!pRaidsWithDeprecations.length)
				return cb();

			scope.updatePRaidStatusWithDeprecated(pRaidsWithDeprecations, message.hostname, cb);
		},
		function handleWithoutDeprecations(cb) {
			var affectedVolumes = new Set();

			async.each(message.payload.pRaidsUpdate, (reportPRaid, eachCB) => {
				// no lock (and without updating serverCollection)
				scope.updatePRaidWithoutDeprecations(reportPRaid, function(err, skipped, volume, failedQuery) {
					if (err || !volume) {
						if (!volume || skipped) {
							var debugData = { reportPRaid: reportPRaid, failedQuery: failedQuery };

							logger.sysDEBUG('pRaid report skipped even though when checking against the cache it seems to be valid, '
								+ 'probably another report updated the db in between. pRaid UUID: '
								+ reportPRaid.uuid, debugData);

						} else {
							logger.sysDEBUG(`pRaid report updated for pRaid ${reportPRaid.uuid}`, reportPRaid);
						}

						return eachCB();
					}

					affectedVolumes.add(volume._id);
					eachCB();
				});
			}, function() {
				var affectedVolumesArray = Array.from(affectedVolumes);

				async.each(affectedVolumesArray, (volumeID, eachCB) => {
					scope.calculateAndUpdateVolumeStatus(volumeID, null, eachCB);
				}, cb);
			});
		}
	], function endOfSeries(err) {
		executionTimer.stop();

		let error = err instanceof MongoError && err;

		mainCallback(error);
	});
};

// handles pRaid updates for pRaids without deprecated segments
// Does not take lock
// Does not update serverCollection
scope.updatePRaidWithoutDeprecations = function(pRaidToUpdate, callback) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	var pRaidSetter = 'chunks.$[].pRaids.$[pRaid]';
	var $set = {};
	var arrayFilters = [];
	var segmentsUnderRecovery = [];

	// update pRaid fields
	$set[pRaidSetter + '.version.major'] = pRaidToUpdate.version.major;
	$set[pRaidSetter + '.version.minor'] = pRaidToUpdate.version.minor;
	$set[pRaidSetter + '.tomaLeaderRaftTerm'] = pRaidToUpdate.tomaLeaderRaftTerm;
	$set[pRaidSetter + '.lastReport'] = new Date();

	// set pendingStatus for each segment
	pRaidToUpdate.segments.forEach((seg, i)=> {
		var segFilterName = 'seg' + i;
		var segmentSetPath = pRaidSetter + '.diskSegments.$[' + segFilterName + ']';

		$set[segmentSetPath + '.pendingStatus'] = seg.status;

		if (seg.status === consts.diskSegmentStatuses.UNDER_RECOVERY_TOMA) {
			segmentsUnderRecovery.push(seg.segmentID);
			$set[segmentSetPath + '.remainingDirtyBits'] = 0;
		}

		var filter = {};
		filter[segFilterName + '.uuid'] = seg.segmentID;
		arrayFilters.push(filter);
	});

	var updateObj = { $set: $set };

	arrayFilters.push({ 'pRaid.uuid': pRaidToUpdate.uuid });

	var query = getPRaidUpdateQuery(pRaidToUpdate);

	volumeCollection.findOneAndUpdate(
		query,
		updateObj,
		{ returnDocument: consts.mongoReturnDocument.BEFORE, arrayFilters: arrayFilters },
		function(err, originalVolume) {
			if (err)
				new MongoError(err).log();

			if (!originalVolume) {
				logger.sysDEBUG(`pRaidReport::pRaid ${pRaidToUpdate.uuid} not updated`);
				return callback(null, true, null, query);
			}

			logger.sysDEBUG(`volumeStatus::updatePRaidWithoutDeprecations - pRaid ${pRaidToUpdate.uuid} updated`, updateObj);

			// If the under recovery segments in the original volume did not have remainingDirtyBits or remainingDirtyBits != 0, then emit an event.
			if (segmentsUnderRecovery.length && checkIfDirtyBitsZeroed(originalVolume, pRaidToUpdate, segmentsUnderRecovery))
				emitDirtyBitsChangeEvent(originalVolume);


			callback(null, false, originalVolume);
		});
};

function checkIfDirtyBitsZeroed(originalVolume, pRaidToUpdate, segmentsUnderRecoveryIDs) {
	var originalPraid;
	var isDirtyBitsZeroed = false;
	var chunks = originalVolume.chunks;

	for (let chunk of chunks) {
		originalPraid = chunk.pRaids.filter(pRaid => pRaid.uuid === pRaidToUpdate.uuid);

		if (originalPraid.length) {
			originalPraid = originalPraid[0];
			break;
		}
	}

	if (originalPraid)
		for (let originalSegment of originalPraid.diskSegments.filter(s => segmentsUnderRecoveryIDs.includes(s._id))) {
			isDirtyBitsZeroed = originalSegment.remainingDirtyBits > 0;

			if (isDirtyBitsZeroed) {
				originalSegment.remainingDirtyBits = 0;
				break;
			}
		}

	return isDirtyBitsZeroed;
}

// The function calculates the volume status and updates the new status
// if volume is not null, function not fetch the volume from the db and use the existing object ot calculate the status
scope.calculateAndUpdateVolumeStatus = function(volumeID, volume, callback) {
	var debugMessagePrefix = 'volumeStatus::calculateAndUpdateVolumeStatus(' + volumeID + ') ';
	logger.sysDEBUG(debugMessagePrefix + 'called');

	if (volumeID in scope.volumeCalculationInProgress) {
		if (!scope.volumeCalculationInProgress[volumeID].pendingCalculation) {
			logger.sysDEBUG(debugMessagePrefix + 'adding pending calculation');
			scope.volumeCalculationInProgress[volumeID].pendingCalculation = { callbacks: [] };
		}

		logger.sysDEBUG(debugMessagePrefix + 'adding callback to next calculation');
		scope.volumeCalculationInProgress[volumeID].pendingCalculation.callbacks.push(callback);

		logger.sysVERBOSE(debugMessagePrefix + 'volumeCalculationInProgress: ', Object.keys(scope.volumeCalculationInProgress));

		return;
	}

	scope.volumeCalculationInProgress[volumeID] = {
		volumeID: volumeID,
		started: new Date(),
	};

	var db = app.get('db');
	var volumeCollection = db.collection('volume');
	var executionTimer = new ExecutionTimer('calculateAndUpdateVolumeStatus');
	var shouldRetry = false;

	async.waterfall([
		function fetchVolume(cb) {
			if (volume)
				// volume received from caller
				return cb(null, volume);

			// volume not received from caller - fetch the volume
			volumeCollection.findOne({ _id: volumeID }, function(err, result) {
				if (err)
					err = new MongoError(err);

				if (!result)
					err = `Couldn't find the volume ${volumeID}`;

				cb(err, result);
			});
		},
		function fetchParentCDVStatusForTPV(volume, cb) {
			if (volume.volumeClass !== consts.volumeClass.TPV)
				return cb(null, volume);

			var cdvId = volume.tpvConfig && volume.tpvConfig.cdvId;
			if (!cdvId) {
				volume._parentCDVStatus = consts.volumeStatuses.UNAVAILABLE;
				return cb(null, volume);
			}

			volumeCollection.findOne({ _id: cdvId, volumeClass: consts.volumeClass.CDV }, { projection: { status: 1 } }, function(err, cdv) {
				if (err)
					err = new MongoError(err);

				volume._parentCDVStatus = (cdv && cdv.status) || consts.volumeStatuses.UNAVAILABLE;
				cb(err, volume);
			});
		},
		function calculateStatus(volume, cb) {
			var calcResult = scope.calculateVolumeStatus(volume);
			logger.sysDEBUG('volumeStatus::calculateVolumeStatus volume ' + volumeID + ' returned: ', calcResult);

			// update the object as it will be sent over any emitted event
			volume.status = calcResult.newStatus;
			volume.action = calcResult.newAction;
			volume.health = calcResult.newHealth;

			cb(null, volume, calcResult);
		},
		function updateVolumeCollectionWithNewStatus(volume, calcResult, cb) {
			var arrayFilters = [];

			var query = {
				_id: volumeID,
				action: calcResult.oldAction
			};

			var $set = {
				status: calcResult.newStatus,
				action: calcResult.newAction,
				health: calcResult.newHealth
			};

			var $unset = {};

			var persistentSegmentStatuses = [
				consts.diskSegmentStatuses.REMAP,
				consts.diskSegmentStatuses.MARKED_FOR_REBUILD,
				consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD
			];
			var isPersistentSegmentStatus = (status) => persistentSegmentStatuses.includes(status);
			var isTransitionFromMarkedForRebuildToUnderRecovery = (status, pendingStatus) =>
				status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD && pendingStatus === consts.diskSegmentStatuses.UNDER_RECOVERY_TOMA;

			function processPendingStatusesOnVolume(volume) {
				volume.chunks.forEach((chunk, chunkIdx)=> {
					chunk.pRaids.forEach((pRaid, pRaidIdx)=> {
						pRaid.diskSegments.forEach((segment, segtIdx) => {
							if (segment.pendingStatus) {
								var filterName = 'c' + chunkIdx + 'p' + pRaidIdx + 's' + segtIdx;
								var filter = {};
								filter[filterName + '.uuid'] = segment.uuid;
								arrayFilters.push(filter);

								// make sure the pendingStatus didn't change
								var segPendingStatusMustMatch = {
									$elemMatch: {
										uuid: segment.uuid,
										pendingStatus: segment.pendingStatus,
										status: segment.status
									}
								};

								if (!query['chunks.pRaids.diskSegments'])
									query['chunks.pRaids.diskSegments'] = { $all: [] };
								query['chunks.pRaids.diskSegments'].$all.push(segPendingStatusMustMatch);

								var segmentUpdatePath = 'chunks.$[].pRaids.$[].diskSegments.$[' + filterName + ']';

								// update status from pendingStatus
								if (!isPersistentSegmentStatus(segment.status) ||
									isTransitionFromMarkedForRebuildToUnderRecovery(segment.status, segment.pendingStatus))
									$set[segmentUpdatePath + '.status'] = segment.pendingStatus;

								// Keep backward compatibility for isDead
								if (segment.pendingStatus !== consts.diskSegmentStatuses.DEAD)
									$set[segmentUpdatePath + '.isDead'] = false;

								// remove pendingStatus
								$unset[segmentUpdatePath + '.pendingStatus'] = '';
							}
						}
						);
					});
				});
			}

			// make sure pendingStatus fields did not change, and update status to be pendingStatus
			processPendingStatusesOnVolume(volume, false);

			var updateObj = { $set: $set };
			if (Object.keys($unset).length)
				updateObj.$unset = $unset;

			volumeCollection.updateOne(
				query,
				updateObj,
				{ arrayFilters: arrayFilters },
				function(err, results) {
					if (err)
						return cb(new MongoError(err));

					if (!results.matchedCount) {
						logger.sysDEBUG('volumeStatus::Volume status not updated. someone made changes to segment statuses, will retry..');
						shouldRetry = true;
					} else if (!results.modifiedCount) {
						// matchedCount: != 0, modifiedCount: 0 we have nothing to update.
						// probably another calculation already updated the status
						// do not update the cache
						logger.sysDEBUG('volumeStatus::calculateVolumeStatus nothing left to update for volume ' + volumeID + '.');
					} else {
						// volume status updated successfully
						// emit events
						logger.sysDEBUG('volumeStatus:: emitting events for volume ' + volumeID + ' events: ' + calcResult.eventsToEmit);

						return scope.doAfterVolumeStatusChanged(volume, calcResult, null, null, cb);
					}

					cb();
				});
		}
	], function endOfWaterfall(err) {
		if (err)
			err = new SystemMessage(systemMessages.VOLUME_CALCULATE_AND_UPDATE_VOLUME_STATUS_FAILED).addInfo(Entities.Error, err).log();

		logger.sysDEBUG('volumeStatus::calculateAndUpdateVolumeStatus ended run for volume ' + volumeID);

		executionTimer.stop();

		if (shouldRetry || scope.volumeCalculationInProgress[volumeID].pendingCalculation) {
			// we need to run again
			var nextCallbacks = [];
			if (shouldRetry)
				// if we are retrying, then we append the current callback to the next calculation
				nextCallbacks.push(callback);

			if (scope.volumeCalculationInProgress[volumeID].pendingCalculation) {
				// if we have pendingCallbacks then we should add them so they are all called
				nextCallbacks = nextCallbacks.concat(scope.volumeCalculationInProgress[volumeID].pendingCalculation.callbacks);
			}

			setTimeout(() => {
				logger.sysDEBUG(debugMessagePrefix + `running calculation again because of ${ shouldRetry ? 'retry' : 'pending calculation'}`);

				// if we need to retry, we pass null as volume so it will be fetched from the db
				scope.calculateAndUpdateVolumeStatus(volumeID, null, err => {
					nextCallbacks.forEach(cb => cb(err));
				});
			}, 0);
		}

		delete scope.volumeCalculationInProgress[volumeID];

		if (!shouldRetry) {
			// Finished successfully
			logger.sysDEBUG(debugMessagePrefix + 'calculation finished');
			return callback(err);
		}
	});
};

// This function updates pRaid statuses with zone lock and remove deprecated segments from serverCollection
scope.updatePRaidStatusWithDeprecated = function(pRaidsWithDeprecations, user, callback) {
	var pRaidsUUIDs = pRaidsWithDeprecations.map((p)=>p.uuid);

	lockModule.acquireLockByPRaids(pRaidsUUIDs, function(err, pRaidZonesResult) {
		var lockedZones = pRaidZonesResult.getZonesSet();

		async.eachSeries(pRaidsWithDeprecations, function(reportPRaid, eachSeriesCallback) {
			var startDT1 = new Date();

			async.waterfall([
				function verifyPRaidVersion(callback) {
					var startDT2 = new Date();

					updatePRaidLeader(reportPRaid, true, function(err, volume) {
						var endDT2 = new Date();

						logger.sysVERBOSE('updatePRaidStatus', 'DT2::It took me ' + (endDT2 - startDT2) + 'ms to update pRaidLeader');

						if (volume)
							return callback(err, reportPRaid, volume);

						callback('Ignoring report after taking a lock');
					});
				},
				function handleSegmentChangeWrapper(reportPRaid, volume, callback) {
					scope.handleSegmentChangeInPRaid(reportPRaid, volume, user, lockedZones, callback);
				}
			], function() {
				eachSeriesCallback();

				var endDT1 = new Date();

				logger.sysVERBOSE('updatePRaidStatus', 'DT1::It took me: ' + (endDT1 - startDT1) + 'ms to update 1 pRaid');
			});
		}, function() {
			lockModule.releaseLockByZones(lockedZones, () => callback());
		});
	});
};

function zeroDirtyBitsUponSegmentStatus(diskSegment, status) {
	if (diskSegment.status === status && diskSegment.remainingDirtyBits && diskSegment.remainingDirtyBits !== 0) {
		diskSegment.remainingDirtyBits = 0;
	}
}

function getDiskSegmentsByChunk(chunk) {
	var diskSegments = [];

	chunk.pRaids.forEach(function(pRaid) {
		if (pRaid.diskSegments && pRaid.diskSegments.length) {
			pRaid.diskSegments.forEach(function(diskSegment) {
				diskSegments.push(diskSegment);
			});
		}
	});

	return diskSegments;
}

scope.deprecateSegments = function(segmentIds, lockedZone, user, callback) {
	logger.sysDEBUG('Marking segments: ' + JSON.stringify(segmentIds) + ' as DEPRECATED');

	var db = app.get('db');
	var volumeCollection = db.collection('volume');
	var alreadyLockedZones = new Set([lockedZone]);
	var newLockedZones;

	async.eachSeries(segmentIds, function onEach(segment, eachCallback) {
		var segmentID = segment.id || segment._id;

		var query = {
			'chunks.pRaids.uuid': segment.pRaidUUID,
			'chunks.pRaids.diskSegments.uuid': segmentID
		};

		async.series([
			function lockRelevantZones(cb) {
				var options = {
					projection: {
						'chunks.pRaids.zone': 1,
						'mdv.chunks.pRaids.zone': 1,
						'RAIDLevel': 1
					}
				};

				volumeCollection.findOne(query, options, function(err, result) {
					if (!err && !result)
						return cb('Failed to fetch volume to get zone Locks');

					var volumeZones = zoneModule.getZonesByVolume(result);

					// Lock all zones except the target.zone that is already locked
					lockModule.expandZoneLocks(alreadyLockedZones, volumeZones, function(err, lockedZones){
						newLockedZones = lockedZones;
						cb(err);
					});
				});
			},
			function fetchAndProcess(cb) {
				volumeCollection.findOne(query, function(err, volume) {
					if (!err && !volume)
						return cb('Failed to fetch volume to mark segments from evicted drive as deprecated');

					var pRaidUUID = null;
					var chunks = scope.getAllVolumeChunks(volume);
					chunks.forEach((chunk)=>{
						chunk.pRaids.forEach((pRaid) => {
							pRaid.diskSegments.forEach((seg)=>{
								if (seg.uuid == segmentID) {
									pRaidUUID = pRaid.uuid;
								}
							});
						});
					});

					// create partial pRaid report
					var partialPRaidReport = {
						segments: [{ segmentID: segmentID, status: consts.diskSegmentStatuses.DEPRECATED }],
						uuid: pRaidUUID,
						type: segment.volType
					};

					scope.handleSegmentChangeInPRaid(partialPRaidReport, volume, user, alreadyLockedZones, cb);
				});
			},
			function releaseLockedZones(cb) {
				// release only the zone locks that this volume has added
				lockModule.releaseLockByZones(newLockedZones, cb);
			}
		], eachCallback);
	},
	function(err) {
		callback(err);
	});
};

function getPraidAction(effectiveSegments) {
	var hasDeadDataSegment = effectiveSegments.some((s) => {
		return (s.isDead || s.status == consts.diskSegmentStatuses.DEAD)
				&& s.type === consts.segmentTypes.DATA;
	});
	var segmentsGroupedByStatus = effectiveSegments.reduce((rv, seg) => { rv[seg.status] = (rv[seg.status] + 1 || 1); return rv; }, {});


	var initializingSegments = 0;
	var extendingSegments = 0;

	effectiveSegments.forEach(s => {
		if (s.status == consts.diskSegmentStatuses.INITIALIZING) {
			if (s.extensionVolumeId && typeof s.extensionVolumeId !== 'string')
				extendingSegments++;
			else
				initializingSegments++;

		}
	});

	var pRaidAction;

	if (extendingSegments)
		pRaidAction = consts.volumeActions.EXTENDING;
	else if (initializingSegments)
		pRaidAction = consts.volumeActions.INITIALIZING;
	else if (segmentsGroupedByStatus[consts.diskSegmentStatuses.MARKED_FOR_REBUILD] > 0)
	// TODO: (PRAID_STATUS) - verify
		pRaidAction = consts.volumeActions.MARKED_FOR_REBUILD;
	else if (!hasDeadDataSegment && segmentsGroupedByStatus[consts.diskSegmentStatuses.BOOTING] > 0)
		pRaidAction = consts.volumeActions.BOOTING;
	else if (segmentsGroupedByStatus[consts.diskSegmentStatuses.UNDER_RECOVERY_TOMA] > 0)
		pRaidAction = consts.volumeActions.REBUILDING;
	else if (segmentsGroupedByStatus[consts.diskSegmentStatuses.REMAP] > 0)
		pRaidAction = consts.volumeActions.REBUILD_REQUIRED;
	return pRaidAction;
}

scope.getPRaidStatusAndAction = function(volume, pRaid) {
	var pRaidStatus;
	var pRaidAction;

	if ([consts.volumeActions.MARKED_FOR_DELETION, consts.volumeActions.DELETING].includes(volume.action) ||
		[consts.volumeStatuses.TO_BE_DELETED].includes(volume.status)) {
		return {
			status: volume.status,
			action: volume.action
		};
	}

	// MARKED_FOR_REBUILD_OLD segments should not be counted as a segment in the pRaid
	var effectiveSegments = pRaid.diskSegments.filter(s=>s.status != consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD);

	effectiveSegments = effectiveSegments.map(s => {
		// save original pendingStatus and status since we are manipulating the volume object
		if (s.pendingStatus)
			s.originalPendingStatus = s.pendingStatus;

		s.originalStatus = s.status;
		s.status = s.pendingStatus || s.status;
		delete s.pendingStatus;
		return s;
	});

	var nonFunctionalSegments = effectiveSegments.filter((seg) => {
		var nonFunctionalStatuses = [
			consts.diskSegmentStatuses.UNDER_RECOVERY_TOMA,
			consts.diskSegmentStatuses.BOOTING,
			consts.diskSegmentStatuses.DEAD,
			consts.diskSegmentStatuses.MARKED_FOR_REBUILD,
			consts.diskSegmentStatuses.REPLACEMENT
		];
		return seg.isDead || nonFunctionalStatuses.indexOf(seg.status) !== -1;
	}).length;

	var numberOfOnlineSegments = effectiveSegments.length - nonFunctionalSegments;

	if (!nonFunctionalSegments)
		pRaidStatus = consts.volumeStatuses.ONLINE;
	else {
		switch (volume.RAIDLevel) {
			case consts.RAIDLevel.CONCATENATED:
			case consts.RAIDLevel.JBOD:
			case consts.RAIDLevel.STRIPED_RAID_0:
				pRaidStatus = consts.volumeStatuses.OFFLINE;

				break;
			case consts.RAIDLevel.MIRRORED_RAID_1:
			case consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10:
				if (numberOfOnlineSegments >= nonFunctionalSegments)
					pRaidStatus = consts.volumeStatuses.DEGRADED;
				else
					pRaidStatus = consts.volumeStatuses.OFFLINE;

				break;
			case consts.RAIDLevel.ERASURE_CODING:
			case consts.RAIDLevel.STRIPED_ERASURE_CODING:
				// check if Degraded or Offline
				pRaidStatus = volume.parityBlocks >= nonFunctionalSegments
					? consts.volumeStatuses.DEGRADED
					: consts.volumeStatuses.OFFLINE;

				break;
			default:
				break;
		}
	}

	pRaidAction = getPraidAction(effectiveSegments);

	if (pRaidAction == consts.volumeActions.INITIALIZING)
		// this is the default status while a pRaid / volume is initializing
		pRaidStatus = consts.volumeStatuses.UNAVAILABLE;

	// restore pending statuses and statuses
	effectiveSegments.forEach(s => {
		if (s.originalPendingStatus) {
			s.pendingStatus = s.originalPendingStatus;
			delete s.originalPendingStatus;
		}

		s.status = s.originalStatus;
		delete s.originalStatus;
	});

	return {
		status: pRaidStatus,
		action: pRaidAction
	};
};

scope.canDeleteVolume = function(volume) {
	var allEmpty = true;

	var chunks = scope.getAllVolumeChunks(volume);

	chunks.forEach(function(chunk) {
		chunk.pRaids.forEach(function(pRaid) {
			allEmpty = allEmpty && !(pRaid.diskSegments && pRaid.diskSegments.length);
		});
	});

	return allEmpty;
};

scope.doAfterVolumeDeleted = function(volume, callback) {
	let db = app.get('db');
	let volumeCollection = db.collection('volume');

	events.emitEvent([events.getVolumeID(volume.name)], objectNotifier.events.volumeRemovedEvent, volume);
	// deleting old volume/block device occurrences from all the clients including their recovery block devices
	utils.deleteLeftoverBlockDevicesOfVolume(volume.name, volume.uuid);
	// deleting the volume from the update zeroing progress list if exist
	if (utils.volumesDeletionOnZeroProgress[volume.uuid])
		delete utils.volumesDeletionOnZeroProgress[volume.uuid];

	var affectedZones = zoneModule.getZonesByVolume(volume);
	async.eachSeries(Array.from(affectedZones), (zone, callback) => {
		kafkaModule.sendMessages(
			cb => kafkaModule.getIncrementalUpdatesTopic(zone, cb),
			[new DeleteVolumeCompleted(volume._id, volume.uuid)],
			callback
		);
	}, (err) => {
		if (err)
			return callback(err);

		volumeCollection.findOneAndDelete({ name: volume._id }, callback);
	});
};

scope.getActionByEncryptionCommand = function(volume) {
	if (volume.isEncrypted && volume.encryption.command?.status !== consts.encryptionCommandStatuses.EXECUTED) {
		switch (volume.encryption.command?.name) {
			case consts.volumeEncryptionCommands.INIT_ENCRYPTION:
				return consts.volumeActions.INITIALIZING_ENCRYPTION;

			case consts.volumeEncryptionCommands.ADD_PASSPHRASE:
				return consts.volumeActions.ADDING_PASSPHRASE;

			case consts.volumeEncryptionCommands.DELETE_PASSPHRASE:
				return consts.volumeActions.DELETING_PASSPHRASE;

			case consts.volumeEncryptionCommands.ROTATE_PASSPHRASE:
				return consts.volumeActions.ROTATING_PASSPHRASE;
		}
	}
};

scope.calculateVolumeStatus = function(volume) {
	var oldStatus = volume.status;
	var oldAction = volume.action;
	var oldHealth = volume.health;
	var newStatus, newAction, newHealth;

	var eventsToEmit = [];

	// TPVs have no chunks/pRAIDs — derive status from parent CDV + attachment state
	if (volume.volumeClass === consts.volumeClass.TPV) {
		var cdvStatus = volume._parentCDVStatus || consts.volumeStatuses.UNAVAILABLE;
		var hasClient = !!(volume.tpvConfig && volume.tpvConfig.exclusiveClient);

		if (oldAction === consts.volumeActions.MARKED_FOR_DELETION || oldAction === consts.volumeActions.DELETING) {
			newStatus = oldStatus;
			newAction = oldAction;
		} else if (cdvStatus !== consts.volumeStatuses.ONLINE) {
			// Parent CDV is not healthy — TPV inherits its status
			newStatus = cdvStatus;
			newAction = consts.volumeActions.NONE;
		} else if (hasClient) {
			newStatus = consts.volumeStatuses.ONLINE;
			newAction = consts.volumeActions.NONE;
		} else {
			newStatus = consts.volumeStatuses.UNAVAILABLE;
			newAction = consts.volumeActions.NONE;
		}

		newHealth = getVolumeHealth(newStatus, newAction);

		return {
			newStatus: newStatus,
			newAction: newAction,
			newHealth: newHealth,
			oldStatus: oldStatus,
			oldAction: oldAction,
			oldHealth: oldHealth,
			changedStatus: !!newStatus && newStatus != oldStatus,
			changedAction: newAction != oldAction,
			changedHealth: newHealth != oldHealth,
			eventsToEmit: (function() {
				if (newHealth != oldHealth) { eventsToEmit.push(getHealthEvent(newHealth).name); volume.health_old = oldHealth; }
				if (newStatus && newStatus != oldStatus) eventsToEmit.push(objectNotifier.events.volumeStatusChangeEvent.name);
				if (newAction != oldAction) eventsToEmit.push(objectNotifier.events.volumeActionChangeEvent.name);
				return eventsToEmit;
			})()
		};
	}

	var pRaidsStatusAction = getPRaidStatusesAndActions(volume);
	var groupBy = groupPRaidsByStatusAndAction(pRaidsStatusAction);
	var groupByStatuses = groupBy.statuses;
	var groupByActions = groupBy.actions;

	var actionFromEncryption = scope.getActionByEncryptionCommand(volume);

	if (actionFromEncryption)
		groupByActions[actionFromEncryption] = 1;

	var statusesInDecreasingImportance = [
		consts.volumeStatuses.TO_BE_DELETED,
		consts.volumeStatuses.UNAVAILABLE,
		consts.volumeStatuses.OFFLINE,
		consts.volumeStatuses.DEGRADED,
		consts.volumeStatuses.ONLINE
	];

	var actionsInDecreasingImportance = [
		consts.volumeActions.DELETING,
		consts.volumeActions.MARKED_FOR_DELETION,
		consts.volumeActions.EXTENDING,
		consts.volumeActions.INITIALIZING,
		consts.volumeActions.BOOTING,
		consts.volumeActions.REBUILD_REQUIRED,
		consts.volumeActions.INIT_ENCRYPTION_REQUIRED,
		consts.volumeActions.INITIALIZING_ENCRYPTION,
		consts.volumeActions.ADDING_PASSPHRASE,
		consts.volumeActions.DELETING_PASSPHRASE,
		consts.volumeActions.ROTATING_PASSPHRASE,
		consts.volumeActions.REBUILDING,
		consts.diskSegmentStatuses.MARKED_FOR_REBUILD
	];

	newStatus = getMostImportantState(statusesInDecreasingImportance, groupByStatuses);

	if (oldAction === consts.volumeActions.MARKED_FOR_DELETION) {
		newAction = oldAction;
	} else {
		newAction = getMostImportantState(actionsInDecreasingImportance, groupByActions);

		// check if any of the segments status is REMAP as this is not reflected by the Praid Status (pRaid could be online with remap)
		volume.chunks.forEach(
			c=>c.pRaids.forEach(
				p=>p.diskSegments.forEach(s=>{
					if (s.status == consts.diskSegmentStatuses.REMAP)
						newAction = consts.volumeActions.REBUILD_REQUIRED;
				})
			)
		);

		if (!newAction)
			if (shouldOverrideCurrentActionWithNone(oldAction, newStatus)) {
				newAction = volume.isEncrypted && !volume.encryption.isInitialized ?
					consts.volumeActions.INIT_ENCRYPTION_REQUIRED :
					consts.volumeActions.NONE;
			} else {
				newAction = oldAction;
			}
	}

	var changedStatus = !!newStatus && newStatus != oldStatus;
	var changedAction = newAction != oldAction;

	// calculate health
	newHealth = getVolumeHealth(newStatus, newAction);
	var changedHealth = newHealth != oldHealth;

	// check what changed and collect events to emit
	if (changedHealth) {
		eventsToEmit.push(getHealthEvent(newHealth).name);
		volume.health_old = oldHealth;
	}

	if (changedStatus)
		eventsToEmit.push(objectNotifier.events.volumeStatusChangeEvent.name);

	if (changedAction)
		eventsToEmit.push(objectNotifier.events.volumeActionChangeEvent.name);

	return {
		newStatus: newStatus,
		newAction: newAction,
		newHealth: newHealth,
		oldStatus: oldStatus,
		oldAction: oldAction,
		oldHealth: oldHealth,
		changedStatus: changedStatus,
		changedAction: changedAction,
		changedHealth: changedHealth,
		eventsToEmit: eventsToEmit
	};
};

scope.updatePRaidDiskSegments = function(volume, pRaidToUpdate, user, lockedZones, callback) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');
	var rootVolume = volume;

	var dbChunk;
	var dbPRaid;
	var shouldIncVolumeVersion = false;
	var chunks = zoneModule.getAllVolumeChunks(volume);
	chunks.forEach(function(chunk) {
		chunk.pRaids.forEach(function(pRaid) {
			if (pRaid.uuid === pRaidToUpdate.uuid) {
				dbChunk = chunk;
				dbPRaid = pRaid;
			}
		});
	});

	//Update the object we're going to save with the statuses came from the report.
	pRaidToUpdate.segments.forEach((reportSegment) => {
		var dbSegment = dbPRaid.diskSegments.filter((seg) => { return seg.uuid === reportSegment.segmentID; })[0];

		if (!dbSegment) {
			return;
		}

		const persistentSegmentStatuses = [
			consts.diskSegmentStatuses.REMAP,
			consts.diskSegmentStatuses.MARKED_FOR_REBUILD,
			consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD
		];

		if (reportSegment.status === consts.diskSegmentStatuses.DEPRECATED) {
			dbPRaid.diskSegments = dbPRaid.diskSegments.filter((segment) => { return segment._id !== reportSegment.segmentID; });
			shouldIncVolumeVersion = true;
		} else if (reportSegment.status != consts.diskSegmentStatuses.DEAD) {
			// this logic is a duplication of the logic in calculateAndUpdateVolumeStatus
			const isPersistentSegmentStatus = (status) => persistentSegmentStatuses.includes(status);
			const isTransitionFromMarkedForRebuildToUnderRecovery = (status, pendingStatus) =>
				status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD && pendingStatus === consts.diskSegmentStatuses.UNDER_RECOVERY_TOMA;
				// update segment status with status from reported segment
			if (!isPersistentSegmentStatus(dbSegment.status) ||
					isTransitionFromMarkedForRebuildToUnderRecovery(dbSegment.status, reportSegment.status))
				dbSegment.status = reportSegment.status;

			zeroDirtyBitsUponSegmentStatus(dbSegment, consts.diskSegmentStatuses.NORMAL);
		}
	});

	if (!dbPRaid.diskSegments.length && scope.canDeleteVolume(rootVolume)) {
		return volumeCollection.findOneAndUpdate({ _id: rootVolume.name }, { $set: { status: consts.volumeStatuses.TO_BE_DELETED } }, function(err, result) {
			if (err)
				return handleError(err);

			if (result)
				scope.doAfterVolumeDeleted(volume, callback);
		});
	}

	var calcResult = scope.calculateVolumeStatus(rootVolume);

	var $set = {
		'chunks.$': dbChunk,
		status: calcResult.newStatus,
		action: calcResult.newAction,
		health: calcResult.newHealth
	};

	var $update = { $set: $set };
	var query = { _id: rootVolume.name, chunks: { $elemMatch: { _id: dbChunk._id } } };

	if (shouldIncVolumeVersion) {
		$update['$inc'] = { version: 1 };
		calcResult.eventsToEmit.push(objectNotifier.events.volumeVersionChangeEvent.name);
	}

	var shouldReport = calcResult.eventsToEmit.length > 0;

	function handleError(err) {
		new MongoError(err).log();
		callback(err);
	}

	volumeCollection.findOneAndUpdate(query, $update, { returnDocument: consts.mongoReturnDocument.AFTER }, function(err, result) {
		if (err)
			return handleError(err);

		if (result && shouldReport)
			scope.doAfterVolumeStatusChanged(result, calcResult, user, lockedZones, callback);
		else
			callback();
	});
};

scope.doAfterVolumeStatusChanged = function(volume, calcResult, user, lockedZones, callback) {
	if (calcResult.changedStatus) {
		let systemMessage;

		switch (calcResult.newStatus) {
			// YR: TODO: many of the statuses are missing. Something more systematic seems appropriate
			case consts.volumeStatuses.ONLINE:
				systemMessage = calcResult.oldAction === consts.volumeActions.INITIALIZING
					? systemMessages.VOLUME_STATUS_CHANGED_TO_ONLINE
					: systemMessages.VOLUME_STATUS_BACK_ONLINE;
				volumeOnlineTransition(calcResult.oldStatus, calcResult.oldAction, volume.name);
				break;
			case consts.volumeStatuses.OFFLINE:
				systemMessage = systemMessages.VOLUME_STATUS_CHANGED_TO_OFFLINE;
				break;
			case consts.volumeStatuses.DEGRADED:
				systemMessage = systemMessages.VOLUME_STATUS_CHANGED_TO_DEGRADED;
				break;
		}

		if (systemMessage)
			new SystemAdminMessage(systemMessage).addInfo(Entities.Volume.ID, volume.name).addInfo(Entities.Volume.UUID, volume.uuid).log();
	}

	volume.health_old = calcResult.oldHealth;

	// emit events
	calcResult.eventsToEmit.forEach((eventName) => {
		events.emitEvent([events.getVolumeID(volume.name)], objectNotifier.events[eventName], volume);
	});

	if (calcResult.changedAction) {
		if (calcResult.oldAction === consts.volumeActions.INITIALIZING && volume.version > 1)
			scope.sendVolumeUpdateToTomaByVolume(volume);

		if (calcResult.newAction === consts.volumeActions.REBUILDING)
			new SystemAdminMessage(systemMessages.VOLUME_UNDERGOING_REBUILD).addInfo(Entities.Volume.ID, volume.name).log();

		if (calcResult.newAction === consts.volumeActions.REBUILD_REQUIRED) {
			new SystemAdminMessage(systemMessages.VOLUME_STATUS_REBUILD_REQUIRED).addInfo(Entities.Volume.ID, volume.name).log();

			//Check if we should start the rebuild process automatically
			if (volume && ((volume.diskClasses && volume.diskClasses.length) ||
							(volume.serverClasses && volume.serverClasses.length) || volume.VPG)) {
				return utils.startVolumesRebuild([volume], user || volume.modifiedBy, lockedZones, () => callback());
			}
		}
	}

	callback(null);
};

function shouldOverrideCurrentActionWithNone(currentAction, newStatus) {
	if (newStatus == consts.volumeStatuses.ONLINE && currentAction == consts.volumeActions.MARKED_FOR_REBUILD)
		return true;

	return [
		consts.volumeActions.REBUILD_REQUIRED, consts.volumeActions.MARKED_FOR_REBUILD,
		consts.volumeActions.DELETING, consts.volumeActions.MARKED_FOR_DELETION
	].indexOf(currentAction) === -1;
}

function getPRaidStatusesAndActions(volume) {
	var pRaidsStatuses = [];
	var chunks = scope.getAllVolumeChunks(volume);

	chunks.forEach((chunk) => {
		chunk.pRaids.forEach((pRaid) => {
			pRaidsStatuses.push(scope.getPRaidStatusAndAction(volume, pRaid));
		});
	});

	return pRaidsStatuses;
}

function groupPRaidsByStatusAndAction(pRaidsStatuses) {
	var statuses = {};
	var actions = {};
	pRaidsStatuses.forEach(pRaid => {
		if (!statuses[pRaid.status])
			statuses[pRaid.status] = 1;
		else
			statuses[pRaid.status] += 1;

		if (!actions[pRaid.action])
			actions[pRaid.action] = 1;
		else
			actions[pRaid.action] += 1;
	});

	return { statuses: statuses, actions: actions };
}

function getMostImportantState(importanceRank, groupByStates) {
	var gotState;
	var result;

	importanceRank.forEach((state) => {
		if (gotState)
			return;

		if (groupByStates[state]) {
			result = state;
			gotState = true;
		}
	});
	return result;
}

function getVolumeHealth(volumeStatus, volumeAction) {
	// any logic changed here should be reflected also in monitoredObject.js monitoredObjects[scope.events.volumesCountChangeEvent.name]
	var isHealthChangeRequired = (statuses, actions) => { return statuses.indexOf(volumeStatus) !== -1 || actions.indexOf(volumeAction) !== -1; };

	var health = consts.targetHealth.HEALTHY;

	if (isHealthChangeRequired(
		[consts.volumeStatuses.DEGRADED, consts.volumeStatuses.QUORUM_FAILED], [consts.volumeActions.REBUILDING, consts.volumeActions.REBUILD_REQUIRED])) {
		health = consts.targetHealth.ALARM;
	}
	if (isHealthChangeRequired([consts.volumeStatuses.OFFLINE, consts.volumeStatuses.UNAVAILABLE], [consts.volumeActions.BOOTING])) {
		health = consts.targetHealth.CRITICAL;
	}

	return health;
}

function getHealthEvent(health) {
	var emitHealthEvent;

	switch (health) {
		case consts.targetHealth.ALARM:
		case consts.targetHealth.CRITICAL:
			emitHealthEvent = objectNotifier.events.volumeFailureEvent;
			break;
		default:
			emitHealthEvent = objectNotifier.events.volumeWentOnlineEvent;
	}

	return emitHealthEvent;
}

function volumeOnlineTransition(oldStatus, oldAction, volumeName) {
	if (oldStatus === consts.volumeStatuses.DEGRADED || oldAction == consts.volumeActions.REBUILDING || oldStatus === consts.volumeStatuses.OFFLINE)
		logModule.acknowledgeByQuery({
			'meta.id': volumeName,
			$or: [
				{ 'meta.header': 'Volume status is ' + consts.volumeStatuses.DEGRADED },
				{ 'meta.header': 'Volume status is ' + consts.volumeStatuses.OFFLINE }
			]
		}, consts.SYSTEM_USER);
}

scope.updateVolumeDiskSegmentsAfterEvict = function(diskSegments, user, lockedZones, callback) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');
	var volumeDiskSegments = (diskSegments || []).filter(function(seg) {
		return seg.type === consts.segmentTypes.DATA;
	});

	async.eachSeries(volumeDiskSegments, function(segment, callback) {
		volumeCollection.findOne(
			{ _id: segment.volumeName },
			function(err, volume) {
				var matchedSegmentChunk;
				var matchedSegmentPRaid;
				var matchedSegment;

				if (!volume) {
					logger.sysDEBUG('Segment not exist in the system', segment);
					return callback();
				}

				var chunks = volume.chunks;
				var chunksPath = 'chunks';

				chunks.forEach(function(chunk) {
					chunk.pRaids.forEach(function(pRaid) {
						var diskSegments = pRaid.diskSegments;

						diskSegments.forEach(function(volumeSegment) {
							if (volumeSegment._id === segment._id) {
								matchedSegmentChunk = chunk;
								matchedSegmentPRaid = pRaid;
								matchedSegment = volumeSegment;

							}
						});
					});
				});

				if (matchedSegment) {
					if (segment.status !== consts.diskSegmentStatuses.DEPRECATED) {
						var matchedChunkDiskSegments = getDiskSegmentsByChunk(matchedSegmentChunk);
						matchedChunkDiskSegments.forEach(function(seg) {
							//Take the status only if the segment is not Dead.
							if (seg._id === segment._id) {
								if (segment.isDead) {
									seg.isDead = true;
									if (segment.status === consts.diskSegmentStatuses.REMAP)
										seg.status = consts.diskSegmentStatuses.REMAP;
								} else {
									if (seg.status !== consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD) {
										seg.status = segment.status;
									}

									zeroDirtyBitsUponSegmentStatus(seg, consts.diskSegmentStatuses.NORMAL);
									seg.isDead = false;
								}
							}
						});
					} else
						//Take all the segments but the deprecated one.
						matchedSegmentPRaid.diskSegments = matchedSegmentPRaid.diskSegments.filter(function(s) { return s._id !== segment._id; });

					var calcResult = scope.calculateVolumeStatus(volume);

					var $update = { $set: {
						status: calcResult.newStatus,
						action: calcResult.newAction,
						health: calcResult.newHealth,
					} };

					$update.$set[chunksPath + '.$'] = matchedSegmentChunk;

					var query = { _id: volume.name };
					query[chunksPath] = { $elemMatch: { _id: matchedSegmentChunk._id } };

					var shouldReport = calcResult.changedStatus || calcResult.changedAction;

					volumeCollection.findOneAndUpdate(
						query,
						$update,
						{ returnDocument: consts.mongoReturnDocument.AFTER },
						function(err, result) {
							if (err)
								new MongoError(err).log();

							if (result && shouldReport) {
								if (segment.status == consts.diskSegmentStatuses.DEPRECATED)
									events.emitEvent(null, objectNotifier.events.allocatedSpaceDirtyEvent, null);

								events.emitEvent([events.getVolumeID(volume.name)], objectNotifier.events.volumeStatusChangeEvent, result);
								return scope.doAfterVolumeStatusChanged(result, calcResult, user, lockedZones, callback);
							}

							callback();
						}
					);
				} else
					callback();
			}
		);
	}, function() {
		callback();
	});
};

function emitDirtyBitsChangeEvent(volume) {
	var totalDirtyBits = 0;

	//Sum all the dirty bits in the volume.
	var chunks = scope.getAllVolumeChunks(volume);
	chunks.forEach((chunk) => {
		chunk.pRaids.forEach((pRaid) => {
			pRaid.diskSegments.forEach((segment) => {
				totalDirtyBits += segment.remainingDirtyBits || 0;
			});
		});
	});

	events.emitEvent(
		[events.getVolumeID(volume._id)],
		objectNotifier.events.dirtyBitsChangeEvent,
		totalDirtyBits
	);
}

scope.emitDirtyBitsChangeEventIfNeeded = (volume) => {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	if (volume.lastDirtyBitsChangeEventEmit && (new Date() - volume.lastDirtyBitsChangeEventEmit) < consts.VOLUME_REBUILDING_PROGRESS_INTERVAL) return;

	volumeCollection.findOneAndUpdate({
		_id: volume._id,
		$or: [{ lastDirtyBitsChangeEventEmit: { $exists: false } },
			{ lastDirtyBitsChangeEventEmit: volume.lastDirtyBitsChangeEventEmit }
		]
	}, {
		$set: { lastDirtyBitsChangeEventEmit: new Date() }
	}, {
		returnDocument: consts.mongoReturnDocument.AFTER
	}, (err, result) => {
		if (err)
			new MongoError(err).log();

		if (result)
			emitDirtyBitsChangeEvent(result);
	});
};

function generateSegmentFilter(segmentID, reappearingCounter, tomaToken, messageSequence, idPrefix = '') {
	return {
		[`${idPrefix}uuid`]: segmentID,
		$or: [{
			[`${idPrefix}reappearingCounter`]: { $exists: false }
		}, {
			[`${idPrefix}reappearingCounter`]: { $lt: reappearingCounter }
		}, {
			$and: [{
				[`${idPrefix}reappearingCounter`]: reappearingCounter,
			}, {
				$or: [{
					[`${idPrefix}tomaToken`]: { $exists: false }
				}, {
					[`${idPrefix}tomaToken`]: { $lt: tomaToken }
				}, {
					$and: [{
						[`${idPrefix}tomaToken`]: tomaToken,
					}, {
						$or: [{
							[`${idPrefix}kafkaMessageSequence`]: { $exists: false }
						}, {
							[`${idPrefix}kafkaMessageSequence`]: { $lt: messageSequence }
						}]
					}]
				}]
			}]
		}]
	};
}

scope.updateDiskSegmentsDirtyBits = (message, mainCallback) => {
	let db = app.get('db');
	let volumeCollection = db.collection('volume');

	async.eachSeries(message.payload.segmentsDirtyBitsUpdate, (segment, callback) => {
		let segmentSetter = 'chunks.$[].pRaids.$[].diskSegments.$[segment]';
		let pRaidsPath = 'chunks.pRaids';

		let $set = {
			[`${segmentSetter}.remainingDirtyBits`]: segment.remainingDirtyBits,
			[`${segmentSetter}.reappearingCounter`]: segment.reappearingCounter,
			[`${segmentSetter}.tomaToken`]: message.tomaToken,
			[`${segmentSetter}.kafkaMessageSequence`]: message.messageSequence
		};

		let segmentMatch = generateSegmentFilter(segment.segmentID, segment.reappearingCounter, message.tomaToken, message.messageSequence);
		let arrayFilter = generateSegmentFilter(segment.segmentID, segment.reappearingCounter, message.tomaToken, message.messageSequence, 'segment.');

		let matchQuery = {};
		matchQuery[pRaidsPath] = {
			$elemMatch: {
				diskSegments: { $elemMatch: segmentMatch },
				$or: [
					{ 'version.major': { $lt: segment.pRaidMajorVersion } },
					{
						'version.major': segment.pRaidMajorVersion,
						'version.minor': { $lte: segment.pRaidMinorVersion }
					}
				]
			}
		};

		if (segment.pRaidUUID)
			matchQuery[pRaidsPath]['$elemMatch']['uuid'] = segment.pRaidUUID;

		let options = { returnDocument: consts.mongoReturnDocument.AFTER, arrayFilters: [arrayFilter] };

		volumeCollection.findOneAndUpdate(matchQuery, { $set: $set }, options, (err, result) => {
			if (err)
				err = new MongoError(err).log();

			if (result)
				scope.emitDirtyBitsChangeEventIfNeeded(result);

			callback(err);
		});
	}, (err) => {
		mainCallback(err);
	});
};

scope.getAllVolumeChunks = function(volume) {
	return zoneModule.getAllVolumeChunks(volume);
};

scope.getAttachedClientsForVolume = function(volume, callback) {
	const db = app.get('db');
	const clientCollection = db.collection('client');

	const query = {
		$or: [
			{ [`attachments.${volume.uuid}.action`]: consts.volumeAttachmentActions.ATTACHING },
			{ [`attachments.${volume.uuid}.pending.action`]: consts.volumeAttachmentActions.ATTACHING }
		]
	};

	clientCollection.find(query).toArray(function(err, results) {
		if (err) {
			err = new MongoError(err).log();
		}

		callback(err, results);
	});
};

function notifyDeletion(volume, callback) {
	let affectedZones = zoneModule.getZonesByVolume(volume);

	Array.from(affectedZones).forEach(zone =>
		kafkaModule.sendMessages(
			cb => kafkaModule.getIncrementalUpdatesTopic(zone, cb),
			[new DeleteVolume(volume._id, volume.uuid, volume.version)]
		)
	);

	callback();
}

scope.markVolumesForDeletion = function(volumes, cb) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');
	var serverCollection = db.collection('server');

	var messages = [];

	function handleDeleteVolumeError(sysMsgType, err, volume) {
		messages.push(new SystemAdminMessage(sysMsgType)
			.addInfo(Entities.Volume.ID, volume._id)
			.addInfo(Entities.Volume.UUID, volume.uuid)
			.addInfo(Entities.Error, err));
	}

	async.eachSeries(volumes, function(volume, callback) {
		var dbVolume;
		var lockedZones = new Set();
		var $query = { _id: volume._id, uuid: volume.uuid };
		const addVolumeInfo = systemMessage => systemMessage.addInfo(Entities.Volume.ID, volume._id).addInfo(Entities.Volume.UUID, volume.uuid);

		async.series([
			function fetchVolumeFromDB(callback) {
				volumeCollection.findOne($query, function(err, result) {
					if (err || !result) {
						let message = new SystemAdminMessage(systemMessages.VOLUME_DELETE_NOT_FOUND)
							.addInfo(Entities.Volume.ID, volume._id)
							.addInfo(Entities.Volume.UUID, volume.uuid);

						if (err) {
							new MongoError(err).log();
							message.addInfo(Entities.Error, err);
						}

						messages.push(message);
						return callback(true);
					}

					if (result.action === consts.volumeActions.INITIALIZING) {
						messages.push(addVolumeInfo(
							new SystemAdminMessage(systemMessages.CANT_DELETE_INITALIZING_VOLUME).addInfo(Entities.Volume.action, result.action)));

						return callback(true);
					}

					dbVolume = result;
					callback();
				});
			},
			function failIfCDVHasTPVs(callback) {
				if (dbVolume.volumeClass !== consts.volumeClass.CDV || !dbVolume.tpvCount)
					return callback();

				handleDeleteVolumeError(systemMessages.VOLUME_DELETE_FAILED,
					`CDV has ${dbVolume.tpvCount} TPV(s). Delete all TPVs before deleting the CDV.`, volume);
				return callback(true);
			},
			function detachCDVFromTomaNodes(callback) {
				// Auto-detach CDV from all TOMA nodes before deletion. CDV attachments are
				// auto-managed (toma: referenceIDs); clearing them here ensures the volume is
				// not blocked by lingering TOMA attachments in failIfAttached below.
				if (dbVolume.volumeClass !== consts.volumeClass.CDV) return callback();
				cdvTomaAutoAttach.detachCDVFromAllNodes(dbVolume)
					.then(() => callback())
					.catch(err => {
						logger.sysDEBUG(`cdvTomaAutoAttach.detachCDVFromAllNodes failed for CDV ${dbVolume._id}: ${err}`);
						callback(); // non-fatal; failIfAttached will catch if still attached
					});
			},
			function failIfAttached(callback) {
				scope.getAttachedClientsForVolume(volume, (err, clients) => {
					if (err) {
						messages.push(addVolumeInfo(new SystemAdminMessage(systemMessages.VOLUME_DELETE_CHECK_IN_USE)));
						return callback(true);
					}

					if (clients.length) {
						const MAX_ATTACHED_CLIENTS_TO_SHOW = 3;
						const numOfExtraVolumes = clients.length > MAX_ATTACHED_CLIENTS_TO_SHOW ? ' (' + (clients.length - MAX_ATTACHED_CLIENTS_TO_SHOW)
							+ ' more)' : '';
						let clientsOfVolume = [];

						for (var i = 0; i < MAX_ATTACHED_CLIENTS_TO_SHOW && i < clients.length; i++) {
							clientsOfVolume.push(clients[i]._id);
						}

						logger.sysDEBUG('Error in mark for deletion, volume is in use by clients', clients);

						let error = 'The volume is used by: ' + clientsOfVolume.join(', ') + numOfExtraVolumes + '. Please detach';
						messages.push(addVolumeInfo(new SystemAdminMessage(systemMessages.VOLUME_DELETE_IN_USE).addInfo(Entities.Error, error)));

						return callback(true);
					}

					callback();
				});
			},
			function failIfSourceVolumeInUse(callback) {
				if (!dbVolume.usedAsSourceCount || dbVolume.usedAsSourceCount == 0)
					return callback();

				volumeCollection.find({ sourceID: dbVolume._id }, { _id: 1 }).toArray(function(err, snapshotsUsingThisAsSource) {
					if (err) {
						messages.push(
							addVolumeInfo(new SystemAdminMessage(systemMessages.VOLUME_DELETE_CHECK_SOURCE_IN_USE_FAILED).addInfo(Entities.Error, err)));
						return callback(true);
					}

					if (snapshotsUsingThisAsSource && snapshotsUsingThisAsSource.length) {
						var snapshotNames = snapshotsUsingThisAsSource.map(v => v._id);
						logger.sysDEBUG('Error in mark for deletion, volume is used as Source volume for snapshots', snapshotNames);

						var error =	'The volume is used as a Source Volume by Snapshots: ' + snapshotNames.join(', ')
							+ '. Please remove the snapshot first';

						messages.push(addVolumeInfo(new SystemAdminMessage(systemMessages.VOLUME_DELETE_SOURCE_IN_USE).addInfo(Entities.Error, error)));
						return callback(error);
					}

					callback();
				});
			},
			function updateVolumeInDB(callback) {
				lockModule.acquireLockByVolume(dbVolume, (err, zones) => {
					if (err) {
						err = new MongoError(err).log();
						handleDeleteVolumeError(systemMessages.VOLUME_DELETE_FAILED, err, volume);
						return callback(err);
					}

					lockedZones = zones;

					var $set = { action: consts.volumeActions.MARKED_FOR_DELETION };

					volumeCollection.findOneAndUpdate(
						$query,
						{ $set: $set, $inc: { version: 1 } },
						{
							returnDocument: consts.mongoReturnDocument.AFTER,
							multi: true
						},
						function(err, updatedVolume) {
							if (err) {
								err = new MongoError(err).log();
								handleDeleteVolumeError(systemMessages.VOLUME_DELETE_FAILED, err, volume);
								return callback(err);
							} else {
								if (!updatedVolume || !updatedVolume.chunks) {
									logger.sysDEBUG(`We updated the volume ${volume._id} ${updatedVolume ? updatedVolume._id : ''} status to markedForDeletion,
									but the volume doesn't contain chunks, it was probably in a 'pending' state.`);

									handleDeleteVolumeError(systemMessages.VOLUME_DELETE_PENDING, err, volume);

									return callback(err);
								} else {
									events.emitEvent([events.getVolumeID(updatedVolume._id)], objectNotifier.events.volumeActionChangeEvent, updatedVolume);

									messages.push(addVolumeInfo(new SystemAdminMessage(systemMessages.VOLUME_MARKED_FOR_DELETION)));

									var volumeNodesUUIDs = getVolumeNodesUUIDs(updatedVolume);

									serverCollection.aggregate([
										{ $match: { uuid: { $in: volumeNodesUUIDs } } },
										{ $unwind: '$disks' },
										{ $match: { 'disks.isOutOfService': true } },
										{ $unwind: '$disks.diskSegments' },
										{ $match: { 'disks.diskSegments.volumeUUID': updatedVolume.uuid } },
										{ $project: { 'disks.diskSegments.uuid': 1 } }
									]).toArray((err, results) => {
										if (err)
											logger.sysERROR('Failed to fetch volume segments that reside on an evicted drive', err);

										if (!results.length) {
											notifyDeletion(updatedVolume, callback);
										} else {
											var volType = updatedVolume.type;
											var segmentsIdsToDeprecate = results.map(result => {
												return { id: result.disks.diskSegments.uuid, volType: volType, pRaidUUID: result.disks.diskSegments.pRaidUUID };
											});

											scope.deprecateSegments(segmentsIdsToDeprecate, Array.from(zoneModule.getZonesByVolume(updatedVolume))[0], null,
												err => {
													if (err)
														logger.sysERROR(err);

													notifyDeletion(updatedVolume, callback);
												});
										}
									});
								}
							}
						}
					);
				});
			},
			function releaseLockPerVolume(callback) {
				lockModule.releaseLockByZones(lockedZones, () => {
					lockedZones.clear();
					callback();
				});
			}
		], () => {
			if (lockedZones.size)
				lockModule.releaseLockByZones(lockedZones, () => {
					lockedZones.clear();
				});

			return callback();
		}
		);
	}, () => cb(messages));
};

function getVolumeNodesUUIDs(volume) {
	var volumeNodesUUIDs = [];

	for (var chunk of volume.chunks) {
		for (var praid of chunk.pRaids) {
			for (var segment of praid.diskSegments) {
				volumeNodesUUIDs.push(segment.nodeUUID);
			}
		}
	}

	return volumeNodesUUIDs;
}

scope.deleteVolumes = (volumes, cb) => {
	utils.executeOnVolumes(
		volumes,
		scope.markVolumesForDeletion,
		scope.deleteSnapshots,
		deleteMDVolumeNotSupportedResponse,
		cb
	);
};

scope.deleteSnapshot = (snapshot, cb) => {
	const volumesToDelete = [
		{ _id: snapshot.metadataVolumeID, uuid: snapshot.metadataVolumeUUID },
		{ _id: snapshot._id, uuid: snapshot.uuid },
	];

	logger.sysDEBUG(`deleteSnapshot: deleting snapshot data and metadata volumes for snapshot ${snapshot._id} ${snapshot.uuid}`);

	scope.markVolumesForDeletion(volumesToDelete, logs => { // todo snapshot
		let message;

		if (logs.some(l => l.systemMessage.id !== systemMessages.VOLUME_MARKED_FOR_DELETION.id))
			return cb(logs[0]);

		message = new SystemAdminMessage(systemMessages.SNAPSHOT_MARKED_FOR_DELETION)
			.addInfo(Entities.Volume.ID, snapshot._id)
			.addInfo(Entities.Volume.UUID, snapshot.uuid);

		scope.incSourceVolumeUses(-1, snapshot.sourceID, () => cb(message));
	});
};

scope.deleteSnapshots = function(snapshotsToDelete, callback) {
	let messages = [];

	async.each(snapshotsToDelete, (snapshot, cb) => {
		scope.deleteSnapshot(snapshot, message => {
			messages.push(message);

			cb();
		});
	}, () => callback(messages));
};

function generateNotSupportedResponsesBySystemMessage(entities, systemMessage, cb) {
	let messages = [];

	entities.forEach(entity => {
		let systemAdminMessage = new SystemAdminMessage(systemMessage)
			.addInfo(Entities.Volume.ID, entity._id)
			.addInfo(Entities.Volume.ID, entity.uuid);

		messages.push(systemAdminMessage);
	});

	cb(messages);
}

function snapshotOperationNotSupportedResponse(snapshots, cb) {
	generateNotSupportedResponsesBySystemMessage(snapshots, systemMessages.OPERATION_NOT_SUPPORTED_FOR_SNAPSHOTS, cb);
}

scope.mdVolumeOperationNotSupportedResponse = function(mdVolumes, cb) {
	generateNotSupportedResponsesBySystemMessage(mdVolumes, systemMessages.SNAPSHOT_OPERATION_NOT_PERMITTED_FOR_MD_VOLUME, cb);
};

function deleteMDVolumeNotSupportedResponse(mdVolumes, cb) {
	generateNotSupportedResponsesBySystemMessage(mdVolumes, systemMessages.SNAPSHOT_CANNOT_DELETE_METADATA_VOLUME, cb);
}

function modifyVolumes(volumes, user, modifyingFunction, cb) {
	utils.executeOnVolumes(
		volumes,
		(volumes, callback) => { modifyingFunction(volumes, user, callback); },
		snapshotOperationNotSupportedResponse,
		scope.mdVolumeOperationNotSupportedResponse,
		cb
	);
}
scope.extendVolumes = (volumes, user, cb) => {
	modifyVolumes(volumes, user, utils.extendVolumes, cb);
};

scope.updateVolumes = (volumes, user, cb) => {
	const cdvVolumes = volumes.filter(v => v.volumeClass === consts.volumeClass.CDV);
	const otherVolumes = volumes.filter(v => v.volumeClass !== consts.volumeClass.CDV);
	const messages = [];

	async.series([
		next => {
			if (!cdvVolumes.length) return next();
			async.each(cdvVolumes, (v, eachCb) => {
				updateCDV(v, user, msg => { messages.push(msg); eachCb(); });
			}, next);
		},
		next => {
			if (!otherVolumes.length) return next();
			modifyVolumes(otherVolumes, user, utils.updateVolumes, msgs => { messages.push(...msgs); next(); });
		}
	], () => cb(messages));
};

scope.createSnapshots = function(snapshots, user, callback) {
	var messages = [];

	async.each(snapshots,
		function(snapshot, cb) {
			scope.createSnapshot(snapshot, user, message => {
				messages.push(message);
				cb();
			});
		},
		() => {
			callback(messages);
		}
	);
};

function updateSnapshotVolumesAfterMDVCreated(snapshot, metadataVolume, callback) {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');
	const query = { _id: { $in: [snapshot._id, metadataVolume._id] } };
	const update = { $set: { status: consts.volumeStatuses.UNAVAILABLE } };

	volumeCollection.updateMany(query, update, (err, res) => {
		if (err)
			return callback(new MongoError(err));

		if (!res || res.modifiedCount !== 2)
			return callback(new SystemMessage(systemMessages.FAILED_TO_UPDATE_SNAPSHOT_AFTER_MDV_CREATED)
				.addInfo(Entities.Volume.ID, snapshot.name)
				.addInfo(Entities.Volume.ID, snapshot.sourceID));

		async.each([snapshot, metadataVolume], (v, eachCb) => utils.sendAddVolumeAfterVolumeSaved(v, eachCb), callback);
	});
}

scope.incSourceVolumeUses = function(incValue, sourceVolumeID, callback) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	volumeCollection.updateOne(
		{ _id: sourceVolumeID },
		{ $inc: { usedAsSourceCount: incValue } },
		callback);
};

scope.fetchAndValidateSourceVolume = function(snapshot, cb) {
	var sourceVolumeName = snapshot.sourceID;
	var db = app.get('db');
	var volumeCollection = db.collection('volume');
	var projection = {
		name: 1,
		uuid: 1,
		isReadOnly: 1,
		type: 1,
	};
	volumeCollection.findOne({ _id: sourceVolumeName }, projection, function(err, sourceVolume) {
		validateSourceVolume(err, sourceVolume, snapshot, cb);
	});
};

function validateSourceVolume(err, sourceVolume, snapshot, cb) {
	if (err) {
		err = new MongoError(err).log();
		return cb(new SystemAdminMessage(systemMessages.SNAPSHOT_SOURCE_VOLUME_ERROR)
			.addInfo(Entities.Error, err)
			.addInfo(Entities.Volume.ID, snapshot.name)
			.addInfo(Entities.Volume.UUID, snapshot.uuid)
			.addInfo(Entities.Volume.ID, snapshot.sourceID));
	}

	if (!sourceVolume)
		return cb(new SystemAdminMessage(systemMessages.SNAPSHOT_SOURCE_VOLUME_NOT_FOUND)
			.addInfo(Entities.Error, err)
			.addInfo(Entities.Volume.ID, snapshot.name)
			.addInfo(Entities.Volume.UUID, snapshot.uuid)
			.addInfo(Entities.Volume.ID, snapshot.sourceID));

	if (!sourceVolume.isReadOnly) {
		return cb(new SystemAdminMessage(systemMessages.SNAPSHOT_SOURCE_VOLUME_NOT_READ_ONLY)
			.addInfo(Entities.Volume.ID, snapshot.name)
			.addInfo(Entities.Volume.UUID, snapshot.uuid)
			.addInfo(Entities.Volume.ID, sourceVolume.name)
			.addInfo(Entities.Volume.UUID, sourceVolume.uuid));
	}

	cb(null, sourceVolume);
}

scope.validateSourceVolumeAndIncUses = function(snapshot, cb) {
	const { sourceID, sourceUUID } = snapshot;
	const db = app.get('db');
	const volumeCollection = db.collection('volume');
	const $query = { _id: sourceID, uuid: sourceUUID, status: { $nin: [consts.volumeStatuses.PENDING, consts.volumeStatuses.TO_BE_DELETED] } };

	volumeCollection.findOneAndUpdate($query,
		{ $inc: { usedAsSourceCount: 1 } },
		{ returnDocument: consts.mongoReturnDocument.AFTER },
		(err, sourceVolume) => validateSourceVolume(err, sourceVolume, snapshot, cb));
};

function calculateMDVCapacity(dataVolume) {
	const totalClusters = Math.floor(dataVolume.blocks / consts.SNAPSHOT_CLUSTER_SIZE_IN_BLOCKS);
	const mdLen = totalClusters + 2;
	const mdPages1 = 2 * (Math.ceil((5 + Math.ceil(mdLen / 8)) / consts.BLOCK_SIZE));
	const mdPages2 = Math.ceil((5 + Math.ceil(totalClusters / 8)) / consts.BLOCK_SIZE);
	const minimalMDSizeIn4kBlocks = mdLen + mdPages1 + mdPages2;
	const mdvCapacityInBLKTSET = Math.ceil(minimalMDSizeIn4kBlocks / consts.BLOCK_SET_SIZE);
	const mdvCapacityInBlocks = mdvCapacityInBLKTSET * consts.BLOCK_SET_SIZE;
	const mdvCapacity = mdvCapacityInBlocks * utils.BtoGB(consts.BLOCK_SIZE);

	return Math.ceil(mdvCapacity * 10000) / 10000;
}

scope.createMetadataVolume = function(snapshot, user, allocationCallback) {
	const isMdvSpecProvided = snapshot.mdvSpec && !utils.isEmpty(snapshot.mdvSpec);
	const mdvSpecs = isMdvSpecProvided ? snapshot.mdvSpec : { VPG: consts.defaultMetadataVPG };

	let mdv = {
		_id: snapshot.metadataVolumeID,
		name: snapshot.metadataVolumeID,
		uuid: snapshot.metadataVolumeUUID,
		capacity: calculateMDVCapacity(snapshot),
		type: consts.volumeTypes.METADATA_VOLUME,
		snapshotID: snapshot._id,
		snapshotUUID: snapshot.uuid,
		RAIDLevel: consts.defaultMetadataRAIDLevel,
		numberOfMirrors: 1,
		handledBy: snapshot.handledBy,
		...mdvSpecs
	};

	utils.createVolume(mdv, user, allocationCallback);
};

scope.createSnapshot = function(snapshot, user, callback) {
	let sourceVolume, metadataVolume;

	async.series([
		function sourceVolumeValidation(cb) {
			scope.validateSourceVolumeAndIncUses(snapshot, function(err, sourceVolumeFromDB) {
				if (err)
					return cb(err);

				sourceVolume = sourceVolumeFromDB;
				cb();
			});
		},
		function populateSnapshotFields(cb) {
			snapshot.modifiedBy = snapshot.createdBy = user.email;
			snapshot.dateModified = snapshot.dateCreated = new Date();
			snapshot.metadataVolumeID = snapshot.name + consts.MetadataVolumeEnding;
			snapshot.metadataVolumeUUID = uuid.v1();

			// Copy fields from Source Volume
			snapshot.sourceID = sourceVolume._id;
			snapshot.sourceUUID = sourceVolume.uuid;
			//snapshot.type = consts.volumeTypes.DATA_VOLUME;

			if (!snapshot.RAIDLevel) {
				snapshot.RAIDLevel = sourceVolume.RAIDLevel;
				snapshot.numberOfMirrors = sourceVolume.numberOfMirrors;
			}

			const minimumCapacity = sourceVolume.capacity + consts.SNAPSHOT_CLUSTER_SIZE;
			if (snapshot.capacity && snapshot.capacity < minimumCapacity)
				return cb(new SystemAdminMessage(systemMessages.SNAPSHOT_DATA_VOLUME_CAPACITY_LOWER_THAN_SOURCE_VOLUME_CAPACITY)
					.addInfo(Entities.Volume.ID, snapshot._id)
					.addInfo(Entities.Volume.ID, snapshot.sourceID)
					.addInfo(Entities.Volume.minimumCapacity, minimumCapacity));


			snapshot.capacity = snapshot.capacity || minimumCapacity;
			snapshot.relativeRebuildPriority = snapshot.relativeRebuildPriority || sourceVolume.relativeRebuildPriority;

			cb();
		},
		function tryCreateDataVolume(cb) {
			utils.createVolume(snapshot, user, function(createError, allocatedVolume, systemAdminMessage) {
				if (createError || systemAdminMessage.systemMessage.id !== systemMessages.VOLUME_SAVED.id) {
					var err = new SystemAdminMessage(systemMessages.SNAPSHOT_CREATE_DATA_VOLUME_FAILURE)
						.addInfo(Entities.Volume.ID, snapshot.name)
						.addInfo(Entities.Volume.ID, snapshot.sourceID)
						.addInfo(Entities.Error, systemAdminMessage);
					return scope.incSourceVolumeUses(-1, sourceVolume._id, () => cb(err));
				}

				snapshot.uuid = allocatedVolume.uuid;
				snapshot.blocks = allocatedVolume.blocks;
				cb();
			});
		},
		function tryCreateMetadataVolume(cb) {
			scope.createMetadataVolume(snapshot, user, (createMDVError, allocatedVolume, systemAdminMessage) => {
				metadataVolume = allocatedVolume;

				if (systemAdminMessage.systemMessage.id === systemMessages.VOLUME_SAVED.id)
					return cb();

				// Failed to allocate MDV - Roll back Data Volume
				utils.forceDeleteVolume(snapshot, null, false, function() {

					// revert source volume increment of the "usedAsSource" field
					scope.incSourceVolumeUses(-1, sourceVolume._id, err => {
						if (err)
							logger.sysDEBUG(`Failed to decrease snapshot uses counter on source volume ${sourceVolume._id} for Snapshot ${snapshot._id}`);

						logger.sysDEBUG('Data volume rollback completed');
						var sysMessage = new SystemAdminMessage(systemMessages.SNAPSHOT_CREATE_MDV_FAILURE)
							.addInfo(Entities.Error, createMDVError)
							.addInfo(Entities.Volume.ID, snapshot.name)
							.addInfo(Entities.Volume.ID, snapshot.sourceID);
						cb(sysMessage);
					});
				});
			});
		},
		function updateDataVolumeAndSendConfiguration(cb) {
			// Data/MD volume is still in status pending - we are updating the status to UNAVAILABLE and sending configuration
			return updateSnapshotVolumesAfterMDVCreated(snapshot, metadataVolume, cb);
		}
	], function(err) {
		const message = (err || new SystemAdminMessage(systemMessages.SNAPSHOT_SAVED))
			.addInfo(Entities.Volume.ID, snapshot.name)
			.addInfo(Entities.Volume.sourceVolumeID, snapshot.sourceID)
			.addInfo(Entities.Volume.UUID, snapshot.uuid);
		callback(message, snapshot);
	});
};

scope.saveVolumes = (requestVolumes, user, cb) => {
	requestVolumes.forEach(volume => {
		volume.modifiedBy = volume.createdBy = user.email;
		volume.dateModified = volume.dateCreated = new Date();
	});

	const tpvVolumes = requestVolumes.filter(v => v.volumeClass === consts.volumeClass.TPV);
	const otherVolumes = requestVolumes.filter(v => v.volumeClass !== consts.volumeClass.TPV);
	const cdvNames = otherVolumes.filter(v => v.volumeClass === consts.volumeClass.CDV).map(v => v.name);

	otherVolumes.forEach(volume => {
		if (volume.volumeClass === consts.volumeClass.CDV) {
			prepareCDVForCreate(volume);
		} else {
			delete volume.cdvConfig;
			delete volume.tpvConfig;
		}
	});

	const messages = [];

	async.series([
		cb => {
			if (!tpvVolumes.length) return cb();
			createTPVs(tpvVolumes, user, msgs => { messages.push(...msgs); cb(); });
		},
		cb => {
			if (!otherVolumes.length) return cb();
			const categorizedVolumes = utils.splitVolumesAndSnapshots(otherVolumes);
			utils.executeFunctionsOnVolumes(
				categorizedVolumes,
				(volumes, callback) => { utils.createVolumes(volumes, user, callback); },
				(snapshots, callback) => { scope.createSnapshots(snapshots, user, callback); },
				(mdVolumes, callback) => callback(),
				otherVolumes,
				msgs => { messages.push(...msgs); cb(); }
			);
		},
		cb => {
			if (!cdvNames.length) return cb();
			const db = app.get('db');
			db.collection('volume').find(
				{ _id: { $in: cdvNames }, volumeClass: consts.volumeClass.CDV, chunks: { $exists: true, $not: { $size: 0 } } }
			).toArray((err, cdvDocs) => {
				if (err) {
					logger.sysDEBUG(`saveVolumes: failed to fetch CDVs for TOMA auto-attach: ${err}`);
					return cb();
				}
				Promise.all(cdvDocs.map(cdv => cdvTomaAutoAttach.attachCDVToAllTomaNodes(cdv)))
					.then(() => cb())
					.catch(err => {
						logger.sysDEBUG(`saveVolumes: cdvTomaAutoAttach.attachCDVToAllTomaNodes failed: ${err}`);
						cb();
					});
			});
		},
	], () => cb(messages));
};

function startRebuildVolumes(volumes, user, cb) {
	utils.startVolumeRebuildByIdsAndUUIDs(volumes, user.email, (logs) => {
		cb(logs);
	});
}

scope.rebuildVolumes = (requestVolumes, user, cb) => {
	utils.executeOnVolumes(
		requestVolumes,
		(volumes, callback) => { startRebuildVolumes(volumes, user, callback); },
		snapshotOperationNotSupportedResponse,
		scope.mdVolumeOperationNotSupportedResponse,
		cb
	);
};

// ─── Thin Provisioning ───────────────────────────────────────────────────────

function prepareCDVForCreate(volume) {
	volume.tpvCount = 0;
	const cfg = volume.cdvConfig || {};
	volume.cdvConfig = {
		cdvExtentSizeMB: cfg.cdvExtentSizeMB,
		allocatorSizeGB: cfg.allocatorSizeGB != null ? cfg.allocatorSizeGB : 1,
		maxTPVs: cfg.maxTPVs != null ? cfg.maxTPVs : 512,
	};
	delete volume.tpvConfig;

	// Trim blocks so the data region is an exact multiple of cdvExtentSizeMB.
	// Management allocates using decimal GB but the kernel measures allocator and
	// extent sizes in binary GiB/MiB, so a raw allocation often ends with a
	// fractional extent.  Use explicit binary constants here so the calculation
	// remains correct if consts.GB is ever changed to GiB.
	if (volume.blocks && volume.cdvConfig.cdvExtentSizeMB > 0) {
		const extentBytes = volume.cdvConfig.cdvExtentSizeMB * consts.MiB;
		const allocBytes = volume.cdvConfig.allocatorSizeGB * consts.GiB;
		const totalBytes = volume.blocks * consts.BLOCK_SIZE;
		const dataBytes = totalBytes > allocBytes ? totalBytes - allocBytes : 0;
		const fullExtents = Math.floor(dataBytes / extentBytes);
		volume.blocks = Math.floor((allocBytes + fullExtents * extentBytes) / consts.BLOCK_SIZE);
	}
}

function createTPV(volume, user, cb) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');
	var message;
	var cdv;

	const { cdvId, tpvExtentSizeKB, virtualSizeGB } = volume.tpvConfig || {};

	async.series([
		function fetchAndValidateCDV(next) {
			volumeCollection.findOne({ _id: cdvId, volumeClass: consts.volumeClass.CDV }, (err, doc) => {
				if (err) {
					message = new SystemAdminMessage(systemMessages.VOLUME_SAVE_FAILED)
						.addInfo(Entities.Volume.name, volume.name)
						.addInfo(Entities.Error, new MongoError(err).log());
					return next(true);
				}
				if (!doc) {
					message = new SystemAdminMessage(systemMessages.VOLUME_SAVE_FAILED)
						.addInfo(Entities.Volume.name, volume.name)
						.addInfo(Entities.Error, `Parent CDV '${cdvId}' not found`);
					return next(true);
				}
				if (doc.tpvCount >= doc.cdvConfig.maxTPVs) {
					message = new SystemAdminMessage(systemMessages.VOLUME_SAVE_FAILED)
						.addInfo(Entities.Volume.name, volume.name)
						.addInfo(Entities.Error, `CDV is at capacity (${doc.cdvConfig.maxTPVs} TPVs)`);
					return next(true);
				}
				if (virtualSizeGB > doc.capacity) {
					message = new SystemAdminMessage(systemMessages.VOLUME_SAVE_FAILED)
						.addInfo(Entities.Volume.name, volume.name)
						.addInfo(Entities.Error, 'virtualSizeGB cannot exceed parent CDV capacity');
					return next(true);
				}
				if (tpvExtentSizeKB > doc.cdvConfig.cdvExtentSizeMB * 1024) {
					const maxKB = doc.cdvConfig.cdvExtentSizeMB * 1024;
					message = new SystemAdminMessage(systemMessages.VOLUME_SAVE_FAILED)
						.addInfo(Entities.Volume.name, volume.name)
						.addInfo(Entities.Error, `tpvExtentSizeKB (${tpvExtentSizeKB}) cannot exceed cdvExtentSizeMB * 1024 (${maxKB})`);
					return next(true);
				}
				cdv = doc;
				next();
			});
		},
		function insertTPVRecord(next) {
			const tpv = {
				_id: volume.name,
				name: volume.name,
				description: volume.description || '',
				uuid: uuid.v1(),
				version: 1,
				isReserved: false,
				isReady: true,
				status: consts.volumeStatuses.UNAVAILABLE,
				health: consts.targetHealth.HEALTHY,
				volumeClass: consts.volumeClass.TPV,
				// Fields required by managementCM VolumeMessage serialization.
				// Several numeric fields are repurposed to carry TPV/CDV geometry
				// that the kernel needs to call nvmeibc_tpv_attach() — the binary
				// protocol has no dedicated TPV fields yet.
				blockSize: consts.BLOCK_SIZE,
				// Virtual size in 4 KiB management blocks (matches kernel MGMT2CLNT_SHIFT).
				blocks: Math.floor(virtualSizeGB * 1024 * 1024 * 1024 / 4096),
				RAIDLevel: consts.RAIDLevel.CONCATENATED,
				numberOfMirrors: 0,
				stripeWidth: 1,
				// Repurposed: TPV extent size in KiB (passed to nvmeibc_tpv_attach).
				stripeSize: tpvExtentSizeKB,
				// Repurposed: CDV extent size in MiB (from parent CDV config).
				dataBlocks: (cdv.cdvConfig && cdv.cdvConfig.cdvExtentSizeMB) || 64,
				// Repurposed: allocator size in GiB (from parent CDV config).
				parityBlocks: Math.floor((cdv.cdvConfig && cdv.cdvConfig.allocatorSizeGB) || 1),
				relativeRebuildPriority: 0,
				enableCrcCheck: false,
				use_debug_di: false,
				// 'thin' encodes to 4 (AUTO_EXTEND_VOLUME) via the CM's MultiValCodec
				// in clnt_scheme.json.  The kernel checks this bit to identify TPV and
				// route the attach request to nvmeibc_tpv_attach().
				type: 'thin',
				// mdvUUID is repurposed to carry the parent CDV's UUID so the kernel
				// can look it up in the attached volumes list.
				mdvUUID: cdv.uuid,
				// sourceUUID is repurposed for TPVs to carry the L1 flush mode.
				// 'sync_flush' = flush L1 metadata before forwarding data bios
				// (default, safe); '' = deferred background flush (fast, risky).
				sourceUUID: 'sync_flush',
				chunks: [], // TPV has no physical disk chunks; backed by CDV
				capacity: virtualSizeGB,
				createdBy: user.email,
				modifiedBy: user.email,
				dateCreated: volume.dateCreated || new Date(),
				dateModified: volume.dateModified || new Date(),
				reservation: {
					mode: consts.reservationModes.NONE,
					version: 1,
					reservedBy: null,
					attachedClients: [],
					lastTransitionDate: null,
				},
				tpvConfig: {
					cdvId: cdvId,
					cdvUUID: cdv.uuid,
					tpvExtentSizeKB: tpvExtentSizeKB,
					virtualSizeGB: virtualSizeGB,
					exclusiveClient: null,
					exclusiveClientUUID: null,
				},
			};

			volumeCollection.insertOne(tpv, err => {
				if (err) {
					message = new SystemAdminMessage(systemMessages.VOLUME_SAVE_FAILED)
						.addInfo(Entities.Volume.name, volume.name)
						.addInfo(Entities.Error, new MongoError(err).log());
					return next(true);
				}
				volume.uuid = tpv.uuid;
				next();
			});
		},
		function incrementTpvCount(next) {
			volumeCollection.updateOne({ _id: cdvId }, { $inc: { tpvCount: 1 } }, err => {
				if (err)
					sysERROR(`createTPV: failed to increment tpvCount for CDV ${cdvId}: ${err}`);
				next(); // non-fatal — TPV was created; any discrepancy is caught by NVCK
			});
		},
	], () => {
		if (!message)
			message = new SystemAdminMessage(systemMessages.VOLUME_SAVED)
				.addInfo(Entities.Volume.ID, volume.name)
				.addInfo(Entities.Volume.UUID, volume.uuid);
		cb(message);
	});
}

function createTPVs(tpvVolumes, user, cb) {
	const messages = [];
	async.each(tpvVolumes, (volume, next) => {
		createTPV(volume, user, msg => { messages.push(msg); next(); });
	}, () => cb(messages));
}

function updateCDV(updateObj, user, cb) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');
	var $set = {};

	if ('description' in updateObj)
		$set.description = updateObj.description;

	// cdvConfig.maxTPVs is the only mutable CDV-specific config field;
	// cdvExtentSizeMB and allocatorSizeGB are immutable after creation.
	if (updateObj.cdvConfig && 'maxTPVs' in updateObj.cdvConfig)
		$set['cdvConfig.maxTPVs'] = updateObj.cdvConfig.maxTPVs;

	$set.modifiedBy = user.email;
	$set.dateModified = new Date();

	volumeCollection.findOneAndUpdate(
		{ _id: updateObj._id, uuid: updateObj.uuid, volumeClass: consts.volumeClass.CDV },
		{ $set },
		{ returnDocument: consts.mongoReturnDocument.AFTER },
		(err, result) => {
			var message;
			if (err || !result) {
				message = new SystemAdminMessage(systemMessages.VOLUME_FAILED_TO_UPDATE)
					.addInfo(Entities.Volume.ID, updateObj._id);
				if (err)
					message.addInfo(Entities.Error, new MongoError(err).log());
			} else {
				message = new SystemAdminMessage(systemMessages.VOLUME_UPDATED)
					.addInfo(Entities.Volume.ID, updateObj._id)
					.addInfo(Entities.Volume.UUID, updateObj.uuid);
			}
			cb(message);
		}
	);
}

scope.updateTPV = (updateObj, user, cb) => {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');
	var $set = {};

	// Mutable: description
	// volumeClass and tpvConfig.cdvId are immutable — ignored if present
	if ('description' in updateObj)
		$set.description = updateObj.description;

	$set.modifiedBy = user.email;
	$set.dateModified = new Date();

	volumeCollection.findOneAndUpdate(
		{ _id: updateObj._id, volumeClass: consts.volumeClass.TPV },
		{ $set },
		{ returnDocument: consts.mongoReturnDocument.AFTER },
		(err, result) => {
			var message;
			if (err || !result) {
				message = new SystemAdminMessage(systemMessages.VOLUME_FAILED_TO_UPDATE)
					.addInfo(Entities.Volume.ID, updateObj._id);
				if (err)
					message.addInfo(Entities.Error, new MongoError(err).log());
			} else {
				message = new SystemAdminMessage(systemMessages.VOLUME_UPDATED)
					.addInfo(Entities.Volume.ID, updateObj._id);
			}
			cb(message);
		}
	);
};

scope.deleteTPVs = (tpvIds, user, cb) => {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');
	const messages = [];

	async.each(tpvIds, ({ _id }, next) => {
		var message;
		var tpv;

		async.series([
			function fetchAndValidateTPV(step) {
				volumeCollection.findOne({ _id, volumeClass: consts.volumeClass.TPV }, (err, doc) => {
					if (err || !doc) {
						message = new SystemAdminMessage(systemMessages.VOLUME_FAILED_TO_UPDATE)
							.addInfo(Entities.Volume.ID, _id);
						if (err)
							message.addInfo(Entities.Error, new MongoError(err).log());
						return step(true);
					}
					if (doc.tpvConfig.exclusiveClient) {
						message = new SystemAdminMessage(systemMessages.VOLUME_FAILED_TO_UPDATE)
							.addInfo(Entities.Volume.ID, _id)
							.addInfo(Entities.Error, 'TPV must be detached before deletion');
						return step(true);
					}
					tpv = doc;
					kafkaModule.sendCDVAllocatorFreeAll(tpv.tpvConfig.cdvUUID, tpv.uuid, () => step());
				});
			},
			function deleteTPVRecord(step) {
				volumeCollection.findOneAndDelete({ _id, volumeClass: consts.volumeClass.TPV }, (err, deleted) => {
					if (err || !deleted) {
						message = new SystemAdminMessage(systemMessages.VOLUME_FAILED_TO_UPDATE)
							.addInfo(Entities.Volume.ID, _id);
						if (err)
							message.addInfo(Entities.Error, new MongoError(err).log());
						return step(true);
					}
					step();
				});
			},
			function decrementTpvCount(step) {
				const cdvId = tpv.tpvConfig.cdvId;
				volumeCollection.updateOne({ _id: cdvId }, { $inc: { tpvCount: -1 } }, err => {
					if (err)
						sysERROR(`deleteTPVs: failed to decrement tpvCount for CDV ${cdvId}: ${err}`);
					step(); // non-fatal
				});
			},
		], () => {
			if (!message) {
				message = new SystemAdminMessage(systemMessages.VOLUME_MARKED_FOR_DELETION)
					.addInfo(Entities.Volume.ID, _id);
				events.emitEvent([events.getVolumeID(tpv.name)], objectNotifier.events.volumeRemovedEvent, tpv);
			}
			messages.push(message);
			next();
		});
	}, () => cb(messages));
};

scope.extendTPV = ({ tpvId, newSizeGB }, user, cb) => {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	volumeCollection.findOne({ _id: tpvId, volumeClass: consts.volumeClass.TPV }, (err, tpv) => {
		if (err || !tpv)
			return cb(new SystemAdminMessage(systemMessages.VOLUME_FAILED_TO_UPDATE)
				.addInfo(Entities.Volume.ID, tpvId));

		if (newSizeGB <= tpv.tpvConfig.virtualSizeGB)
			return cb(new SystemAdminMessage(systemMessages.VOLUME_FAILED_TO_UPDATE)
				.addInfo(Entities.Volume.ID, tpvId)
				.addInfo(Entities.Error, 'newSizeGB must be greater than current virtualSizeGB'));

		const $set = {
			capacity: newSizeGB,
			blocks: Math.floor(newSizeGB * 1024 * 1024 * 1024 / 4096),
			'tpvConfig.virtualSizeGB': newSizeGB,
			modifiedBy: user.email,
			dateModified: new Date(),
		};

		volumeCollection.findOneAndUpdate(
			{ _id: tpvId },
			{ $set },
			{ returnDocument: consts.mongoReturnDocument.AFTER },
			(err, updated) => {
				if (err || !updated)
					return cb(new SystemAdminMessage(systemMessages.VOLUME_FAILED_TO_UPDATE)
						.addInfo(Entities.Volume.ID, tpvId));

				const respond = () => cb(new SystemAdminMessage(systemMessages.VOLUME_UPDATED)
					.addInfo(Entities.Volume.ID, tpvId));

				if (tpv.tpvConfig.exclusiveClient) {
					const clientModule = require('./client');
					clientModule.sendUpdateVolumesToClient(updated, respond);
				} else {
					respond();
				}
			}
		);
	});
};

// ─────────────────────────────────────────────────────────────────────────────

// Called by kafkaRouter when TOMA reports a CDV is near capacity (< 10% free extents).
scope.handleCDVCapacityWarning = (message, callback) => {
	sysERROR(`CDV capacity warning received for CDV ${message.cdvUUID}: ${message.usedExtents}/${message.totalExtents} extents used`);

	// Auto-extend disabled for now. When enabled, extend the CDV by 25% of its current capacity (minimum 1 GB).
	// const db = app.get('db');
	// const volumeCollection = db.collection('volume');
	// volumeCollection.findOne({ uuid: message.cdvUUID, volumeClass: consts.volumeClass.CDV }, (err, cdv) => {
	// 	if (err || !cdv) return callback();
	// 	const increaseGB = Math.max(1, Math.ceil(cdv.capacity * 0.25));
	// 	const newCapacity = cdv.capacity + increaseGB;
	// 	const systemUser = { email: consts.SYSTEM_USER };
	// 	scope.extendVolumes([{ _id: cdv._id, uuid: cdv.uuid, capacity: newCapacity }], systemUser, () => callback());
	// });

	callback();
};

// Called by kafkaRouter when TOMA reports current CDV allocation counters
// (published after every CDV_ALLOC_EXTENT and CDV_FREE_EXTENT).
scope.handleCDVAllocatorStats = (message, callback) => {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');
	const { cdvUUID, allocatedExtents, totalDataExtents } = message.payload;

	volumeCollection.updateOne(
		{ uuid: cdvUUID, volumeClass: consts.volumeClass.CDV },
		{ $set: {
			'runtimeStats.allocatedExtents': allocatedExtents,
			'runtimeStats.totalDataExtents': totalDataExtents,
			'runtimeStats.lastUpdated': new Date(),
		} },
		() => {}
	);

	callback();
};

// Called by kafkaRouter when a client management agent reports per-TPV allocator
// statistics read from /proc/nvmeibc/tpv/*/allocator.
scope.handleTPVStats = (message, callback) => {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');
	const now = new Date();

	for (const entry of (message.payload.tpvs || [])) {
		volumeCollection.updateOne(
			{ uuid: entry.tpvUUID, volumeClass: consts.volumeClass.TPV },
			{ $set: {
				'runtimeStats.cdvExtents': entry.cdvExtents,
				'runtimeStats.tpvExtentsInUse': entry.tpvExtentsInUse,
				'runtimeStats.tpvExtentsTotal': entry.tpvExtentsTotal,
				'runtimeStats.lastUpdated': now,
			} },
			() => {}
		);
	}

	callback();
};

// ─────────────────────────────────────────────────────────────────────────────

scope.fetchVolumeVersionByUUID = function fetchVolumeVersionByUUID(uuid, cb) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	volumeCollection.findOne({ uuid: uuid }, { version: 1 }, (err, vol) => {
		cb(err, vol?.version);
	});
};

module.exports = scope;
