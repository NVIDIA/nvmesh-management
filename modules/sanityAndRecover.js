/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

var async = require('async');
const uuid = require('uuid');

var logger = require('../logger.js');
var utils = require('../utils.js');
var consts = require('../consts.js');
var diskModule = require('./disk.js');
var zoneModule = require('./zone.js');
var targetModule = require('./target.js');
var volumeModule = require('./volume.js');
var clientModule = require('./client.js');
var kafkaModule = require('./kafka.js');
var lockModule = require('./lock.js');
var upgradeModule = require('./upgrade.js');
var dbUpgradeModule = require('./dbUpgrade.js');
var encryptionModule = require('./volumeEncryption.js');
var config = require('./config.js');
var { Entities, Differentiators, SystemMessage, SystemAdminMessage, MongoError, getDriveID } = require('./error.js');
var { AddVolume } = require('../models/kafkaMessages/AddVolume');
var { DeleteVolume } = require('../models/kafkaMessages/DeleteVolume');
var { UpdateVolume } = require('../models/kafkaMessages/UpdateVolume');
var systemMessages = require('../systemMessages.js');
const objectNotifier = require('../objectNotifier.js');
const events = require('../events.js');

var scope = {};

scope.afterModuleLoaded = function() {
	logger = require('../logger.js');
	({ Entities, Differentiators, SystemMessage, SystemAdminMessage, MongoError, getDriveID } = require('./error.js'));
};

scope.tryToAcquireLock = function(configurationVersionCluster, cb) {
	const db = app.get('db');
	const managementClusterCollection = db.collection('managementCluster');
	const configurationVersionCollection = db.collection('configurationVersion');

	const managementId = app.get('managementId');
	const bootVersion = app.get('bootVersion');
	let currentMgmtClusterStateChangeVersion = null;

	managementClusterCollection.find({}).toArray(function(err, mgmtCluster) {
		if (err)
			new MongoError(err).log();

		if (!mgmtCluster || !mgmtCluster.length) {
			logger.sysDEBUG('No management cluster found, can not run sanity and recover.');
			return cb(currentMgmtClusterStateChangeVersion);
		}

		const managementsState = utils.getMgmtClusterState(mgmtCluster);
		const managementsStateHash = utils.getHash(JSON.stringify(managementsState));

		// run if one of the mgmts in the cluster changed state and no other mgmt handled it
		// or check that handledBy is me before I crashed or other mgmt which is DOWN
		let query = {
			_id: consts.CONFIG_VER_CLUSTER_ID,
			$or: [
				{ mgmtClusterStateHash: { $ne: managementsStateHash } },
				{ forceSanityAndRecover: true }
			],
			$and: [
				{
					$or: [
						{ mgmtClusterStateChangeVersion: configurationVersionCluster.mgmtClusterStateChangeVersion },
						{ mgmtClusterStateChangeVersion: { $exists: false } }
					]
				}
			]
		};

		if (configurationVersionCluster.stateChangeStatus !== consts.clusterStateChangeStatuses.HANDLING) {
			query.$and.push(
				{
					$or: [
						{ stateChangeStatus: consts.clusterStateChangeStatuses.FINISHED },
						{ stateChangeStatus: { $exists: false } }
					]
				}
			);
		} else {
			const handlingMgmt = configurationVersionCluster.handledBy;
			const isThisMgmtCrashed = handlingMgmt.managementId === managementId && handlingMgmt.bootVersion < bootVersion;

			const handlingMgmtState = managementsState[handlingMgmt.managementId];
			const isHandlingMgmtDown = handlingMgmtState === undefined || handlingMgmtState.status === consts.managementStatuses.DOWN
				&& handlingMgmtState.bootVersion === handlingMgmt.bootVersion;


			if (isThisMgmtCrashed || isHandlingMgmtDown) {
				query.$and.push({ 'handledBy.managementId': handlingMgmt.managementId });
				query.$and.push({ 'handledBy.bootVersion': handlingMgmt.bootVersion });
			}
		}

		configurationVersionCollection.findOneAndUpdate(
			query,
			{
				$set: {
					mgmtClusterStateHash: managementsStateHash,
					dateModified: new Date(),
					handledBy: {
						managementId: managementId,
						bootVersion: bootVersion
					},
					stateChangeStatus: consts.clusterStateChangeStatuses.HANDLING,
					forceSanityAndRecover: false,
				},
				$inc: { mgmtClusterStateChangeVersion: 1 }
			},
			{ returnDocument: consts.mongoReturnDocument.AFTER },
			(err, result) => {
				if (err)
					new MongoError(err).log();
				else if (!result)
					logger.sysDEBUG('Mgmt cluster state change counter not updated, probably there is no need to');
				else
					currentMgmtClusterStateChangeVersion = result.mgmtClusterStateChangeVersion;

				cb(currentMgmtClusterStateChangeVersion);
			});
	});
};

scope.releaseLock = (mgmtClusterStateChangeVersion, cb) => {
	const db = app.get('db');
	const configurationVersionCollection = db.collection('configurationVersion');

	configurationVersionCollection.updateOne(
		{ mgmtClusterStateChangeVersion: mgmtClusterStateChangeVersion },
		{
			$set: {
				dateModified: new Date(),
				stateChangeStatus: consts.clusterStateChangeStatuses.FINISHED
			}
		},
		(err) => {
			if (err)
				new MongoError(err).log();

			cb();
		});
};

scope.run = cb => {
	const startTime = new Date();

	// !!! IMPORTANT !!!
	// Before adding a new function below, consider whether it could interfere with another management in the cluster.
	//
	// Example: `checkAndRemovePendingVolumes` was designed to remove stale volumes stuck in a pending state.
	// However, it previously had a flaw where it could mistakenly delete a pending volume that was in a creation process by another management in the cluster.
	//
	// To prevent this, we introduced an infrastructure to verify whether an entity can be modified.
	// This ensures that only entities created by this management (in a previous boot) or by a different management that is now down are modified.
	//
	// How to use:
	// - Store the creating management info on the entity using `utils.getHandlingMgmtParams`.
	// - Use `categorizeStaleEntities` and `getDeleteStaleEntitiesQuery` to properly classify and delete stale entities.
	//
	// Examples where it's used: `checkAndRemovePendingVolumes`, `checkAndRemoveToBeExtendedVolumes`, `checkPendingAttachments`, `checkForIncompleteSnapshots`
	async.series([
		checkForUnusedTopics,
		scope.checkAndRemovePendingUpgrades,
		scope.checkAndRemovePendingVolumes,
		scope.checkAndRemoveToBeExtendedVolumes,
		scope.checkAndRemoveOrphanDiskSegments,
		scope.checkForZeroedLargestSegmentAvailable,
		scope.checkServerDiskSegments,
		scope.checkVolumesDiskSegments,
		scope.checkForStaleVolumes,
		scope.checkDriveAllocationParams,
		scope.checkForBadVolumes,
		scope.checkForOverlappingVolumes,
		scope.checkForZonesCounters,
		scope.checkForTargetAddition,
		scope.checkForTargetsDeletion,
		scope.checkForVolumesDeletion,
		scope.checkForUncompletedSegmentUpdateOnReappearing,
		scope.checkForIncompleteSnapshots,
		scope.resendKafkaMessages,
		scope.checkAndRecoverNodeConfiguration,
		scope.checkPendingAttachments,
		scope.checkLastReservationVersionSentToTOMA,
		scope.checkLastEmulationAttachmentsVersionSentToClient,
		scope.checkAndResumeStuckUpgrades,
		cleanupUnusedTopics,
		dbUpgradeModule.upgradeDBIfNeeded,
		scope.addAvailableSpaceZoneRankingCriteriaToDB,
		scope.checkForNotUpdatedVolumesAfterEvict
	], err => {
		if (err)
			logger.sysDEBUG(`Sanity and Recover encountered an error: ${err}`);

		const duration = new Date() - startTime;
		logger.sysDEBUG(`Sanity and Recover finished after ${duration / 1000} seconds`);

		cb();
	});
};

let checkForUnusedTopicsTime, topicsToOffsetsInfoFound;

function checkForUnusedTopics(callback) {
	if (app.get('nonLatestVersion')) {
		logger.sysDEBUG('This management is not the latest version, skipping checkForUnusedTopics');
		return callback();
	}

	let unusedTopicsFound;
	let skip;

	async.series([
		cb => {
			const db = app.get('db');
			const upgradeCollection = db.collection('upgrade');

			upgradeCollection.findOne({ status: consts.upgradeStatuses.IN_PROGRESS }, { _id: 1 }, (err, upgrade) => {
				if (err)
					return cb(new MongoError(err));

				if (upgrade) {
					logger.sysDEBUG(`Upgrade ${upgrade._id} is in progress, skipping checkForUnusedTopics`);
					skip = true;
					return cb();
				}

				cb();
			});
		},
		cb => {
			if (skip)
				return cb();

			kafkaModule.getUnusedTopics((err, unusedTopics) => {
				if (err)
					return cb(err);

				if (!unusedTopics.length) {
					logger.sysDEBUG('No unused topics found, skipping checkForUnusedTopics');
					skip = true;
					return cb();
				}

				unusedTopicsFound = unusedTopics;
				cb();
			});
		},
		cb => {
			if (skip)
				return cb();

			kafkaModule.getOffsetsInformationByTopics(unusedTopicsFound, (err, offsetsInfo) => {
				if (err)
					return cb(err);

				if (!Object.keys(offsetsInfo).length) {
					logger.sysDEBUG('No offsets info found, skipping checkForUnusedTopics');
					skip = true;
					return cb();
				}

				logger.sysDEBUG(`Found ${Object.keys(offsetsInfo).length} potential topics to delete`);
				topicsToOffsetsInfoFound = offsetsInfo;
				checkForUnusedTopicsTime = new Date();
				cb();
			});
		}
	], err => {
		if (err)
			new SystemMessage(systemMessages.CHECK_FOR_UNUSED_TOPICS_FAILED).addInfo(Entities.Error, err).log();

		callback();
	});
}

function cleanupUnusedTopics(callback) {
	let unusedTopicsFound;
	let skip;

	async.series([
		cb => {
			if (!checkForUnusedTopicsTime) {
				logger.sysDEBUG('checkForUnusedTopics was skipped, skipping cleanupUnusedTopics');
				skip = true;
				return cb();
			}

			async.whilst(
				whilstCb => {
					const timeDiff = new Date() - checkForUnusedTopicsTime;
					const shouldWait = timeDiff < consts.SECONDS_TO_WAIT_BETWEEN_CHECK_AND_CLEANUP_UNUSED_TOPICS * 1000;
					logger.sysDEBUG(`checkForUnusedTopics was called ${timeDiff / 1000} seconds ago, ${shouldWait ? 'waiting' : 'starting'} cleanup`);
					whilstCb(null, shouldWait);
				},
				whilstCb => setTimeout(() => whilstCb(null, true), consts.SECONDS_INTERVAL_BETWEEN_CLEANUP_UNUSED_TOPICS_TIME_PASSED * 1000),
				() => {
					checkForUnusedTopicsTime = null;
					cb();
				}
			);
		},
		cb => {
			if (!skip && app.get('nonLatestVersion')) {
				logger.sysDEBUG('This management is not the latest version, skipping cleanupUnusedTopics');
				skip = true;
			}

			if (skip)
				return cb();

			kafkaModule.getUnusedTopics((err, unusedTopics) => {
				if (err)
					return cb(err);

				if (!unusedTopics.length) {
					logger.sysDEBUG('No unused topics found, skipping cleanupUnusedTopics');
					skip = true;
					return cb();
				}

				unusedTopicsFound = unusedTopics;
				cb();
			});
		},
		cb => {
			if (skip)
				return cb();

			kafkaModule.getOffsetsInformationByTopics(unusedTopicsFound, (err, offsetsInfo) => {
				if (err)
					return cb(err);

				if (!Object.keys(offsetsInfo).length) {
					logger.sysDEBUG('No offsets info found, skipping cleanupUnusedTopics');
					skip = true;
					return cb();
				}

				// find all topics where offsets did not change since last check
				const topicsToDelete = Object.keys(topicsToOffsetsInfoFound)
					.filter(topic => {
						const topicPartitions = Object.keys(offsetsInfo[topic] || {});
						if (!topicPartitions.length) {
							logger.sysDEBUG(`${topic} was detected in checkForUnusedTopics but is missing or has no partitions during cleanupUnusedTopics`);
							return false;
						}

						return topicPartitions.every(partition => topicsToOffsetsInfoFound[topic][partition] === offsetsInfo[topic][partition]);
					});

				if (!topicsToDelete.length) {
					logger.sysDEBUG('No topics to delete, skipping cleanupUnusedTopics');
					skip = true;
					return cb();
				}

				kafkaModule.deleteTopics(topicsToDelete, err => {
					if (err)
						return cb(err);

					const deletedUpstreamTopics = topicsToDelete.filter(kafkaModule.isUpstreamTopicByName);
					if (deletedUpstreamTopics.length) {
						const ids = deletedUpstreamTopics
							.filter(topic => topic.includes(consts.topicPrefix.ZONE)) // default/management topics don't require an ID
							.map(topic => events.getZoneID(topic.slice(consts.topicPrefix.ZONE.length, topic.indexOf('.'))));

						events.emitEvent(ids, objectNotifier.events.removedUpstreamTopicEvent, { topics: deletedUpstreamTopics });
					}

					cb();
				});
			});
		}
	], err => {
		if (err)
			new SystemMessage(systemMessages.CLEANUP_UNUSED_TOPICS_FAILED).addInfo(Entities.Error, err).log();

		callback();
	});
}


function getDeletedVolumesWithExistingDiskSegmentsPipeline(segmentUUIDS) {
	return [
		{
			$unwind: '$disks'
		},
		{
			$unwind: '$disks.diskSegments'
		},
		{
			$match: segmentUUIDS ? { 'disks.diskSegments.uuid': { $in: segmentUUIDS } } : { 'disks.diskSegments.type': { $eq: consts.segmentTypes.DATA } }
		},
		{
			$lookup: {
				from: 'volume',
				localField: 'disks.diskSegments.volumeUUID',
				foreignField: 'uuid',
				as: 'volumeMatches'
			}
		},
		{
			$match: {
				volumeMatches: { $eq: [] }
			}
		},
		{
			$group: {
				_id: { uuid: '$disks.diskSegments.volumeUUID', name: '$disks.diskSegments.volumeName' },
				segments: { $addToSet: '$disks.diskSegments' }
			}
		},
		{
			$project: {
				uuid: '$_id.uuid',
				name: '$_id.name',
				segments: '$segments'
			}
		}
	];
}

// Checking if there are data segments on disks with no volumes.
// These segments should be deleted from the disk and saved to the autoRemovedSegments collection.
scope.checkAndRemoveOrphanDiskSegments = callback => {
	const db = app.get('db');
	const serverCollection = db.collection('server');
	let deletedVolumesWithExistingDiskSegments;
	let segmentsWithDeletedVolumes;
	let zoneToSegments;

	async.series([
		function getDeletedVolumesWithExistingDiskSegments(cb) {
			const pipeline = getDeletedVolumesWithExistingDiskSegmentsPipeline();
			serverCollection.aggregate(pipeline).toArray((err, results) => {
				if (err)
					return cb(new MongoError(err));

				if (!results.length)
					return callback();

				zoneToSegments = results
					.flatMap(volume => volume.segments)
					.reduce((acc, currSeg) => { (acc[currSeg.zone] = acc[currSeg.zone] || []).push(currSeg); return acc; }, {});

				cb();
			});
		},
		function handleSegmentsInZone(cb) {
			// for each zone, check which segs are still relevant with same query as before
			// then delete the relevant segs
			async.eachSeries(Object.keys(zoneToSegments), (zone, zoneEachSeriesCB) => {
				async.series([
					function acquireLock(zoneSeriesCB) {
						lockModule.acquireLockByZone(zone, err => zoneSeriesCB(err));
					},
					function validateSegments(zoneSeriesCB) {
						const pipeline = getDeletedVolumesWithExistingDiskSegmentsPipeline(zoneToSegments[zone].map(seg => seg.uuid));
						serverCollection.aggregate(pipeline).toArray((err, results) => {
							if (err)
								return zoneSeriesCB(new MongoError(err));

							deletedVolumesWithExistingDiskSegments = results;
							if (!deletedVolumesWithExistingDiskSegments.length)
								return lockModule.releaseLockByZone(zone, err => zoneEachSeriesCB(err));

							segmentsWithDeletedVolumes = deletedVolumesWithExistingDiskSegments.flatMap(volume => volume.segments);

							zoneSeriesCB();
						});
					},
					function issueWarning(zoneSeriesCB) {
						let warningMsg = new SystemMessage(systemMessages.SANITY_SEGMENTS_WITHOUT_VOLUMES);
						segmentsWithDeletedVolumes.forEach(seg => warningMsg.addInfo(Entities.DiskSegment.UUID, seg.uuid));
						warningMsg.log();

						zoneSeriesCB();
					},
					function insertSegmentsIntoAutoRemovedCollection(zoneSeriesCB) {
						async.parallel(
							deletedVolumesWithExistingDiskSegments.map(volume => {
								return callback => utils.saveAutoRemovedDiskSegments(volume.segments, volume, callback);
							}),
							err => zoneSeriesCB(err)
						);
					},
					function forceDeleteDiskSegments(zoneSeriesCB) {
						utils.forceDeleteDiskSegments(segmentsWithDeletedVolumes, err => zoneSeriesCB(err));
					},
				], err => {
					if (err)
						logger.sysERROR(err);

					lockModule.releaseLockByZone(zone, err => zoneEachSeriesCB(err));
				});
			}, err => cb(err));
		}
	], err => {
		if (err)
			logger.sysERROR(err);

		callback(err);
	});
};

//checking if there is a drive with a zeroed largestSegmentAvailable - this situation can occur if the management crashed/was shut down
//during a forceDeleteVolume (Rollback for example) since we set the largestSegmentAvailable of the affected drives to zero before starting
scope.checkForZeroedLargestSegmentAvailable = function(cb) {
	var db = app.get('db');
	var serverCollection = db.collection('server');

	serverCollection.aggregate([
		{ $project: { node_id: 1, disks: '$disks' } },
		{ $unwind: '$disks' },
		{ $project: {
			node_id: '$node_id',
			diskID: '$disks.diskID',
			diskSegments: '$disks.diskSegments',
			largestSegmentAvailable: '$disks.largestSegmentAvailable',
			usableBlocks: '$disks.usableBlocks'
		} },
		{ $match: {
			'largestSegmentAvailable.lbs': 0,
			'largestSegmentAvailable.lbe': 0,
			'largestSegmentAvailable.blocks': 0
		} },
		{ $unwind: {
			'path': '$diskSegments',
			'preserveNullAndEmptyArrays': true
		} },
		{ $match: {
			$or: [
				{ 'diskSegments.type': consts.segmentTypes.DATA },
				{ 'diskSegments.type': { $exists: false } }
			]
		} },
		{ $project: {
			diskID: '$diskID',
			node_id: '$node_id',
			usableBlocks: '$usableBlocks',
			segmentUUID: '$diskSegments.uuid',
			segBlocks: { $add: [1, { $subtract: ['$diskSegments.lbe', '$diskSegments.lbs'] }] }
		} },
		{ $group: {
			_id: '$diskID',
			diskID: { $first: '$diskID' },
			node_id: { $first: '$node_id' },
			usableBlocks: { $first: '$usableBlocks' },
			segmentBlocks: { $sum: '$segBlocks' },
		} },
		{ $addFields: {
			expectedAvailable: { $subtract: ['$usableBlocks', '$segmentBlocks'] }
		} },
		{ $match: { expectedAvailable: { $ne: 0 } } }
	]).toArray(function(err, results) {
		if (err)
			new MongoError(err).log();

		var warnings = [];

		if (results && results.length)
			results.forEach(function(res) {
				// largest segment was zeroed but the total sum of segments didn't not occupy all disk blocks
				warnings.push(new SystemMessage(systemMessages.SANITY_ZEROED_LARGEST_SEGMENT)
					.addInfo(Entities.Drive.ID, getDriveID(res.diskID, res.node_id))
					.addInfo(Entities.Target.ID, res.node_id));
			});

		warnings.forEach(warning => warning.log());
		cb(null, { warnings: warnings });
	});
};

function resendVolumeMessagesByQuery(query, projection, generateMessageFunction, callback) {
	let db = app.get('db');
	let volumeCollection = db.collection('volume');
	let successfullySentVolumes = [];

	query.isReserved = false;

	volumeCollection.find(query).project(projection).toArray((err, results) => {
		if (err)
			new MongoError(err).log();

		if (results.length)
			logger.sysDEBUG(`Found ${results.length} volumes with query '${query}', re-sending kafka messages`);

		async.eachSeries(results, (volume, eachVolumeCallback) => {
			let affectedZones = zoneModule.getZonesByVolume(volume);

			async.eachSeries(Array.from(affectedZones), (zone, eachZoneCallback) => {
				kafkaModule.sendMessages(
					cb => kafkaModule.getIncrementalUpdatesTopic(zone, cb),
					generateMessageFunction(volume),
					err => {
						if (!err)
							successfullySentVolumes.push(volume);

						eachZoneCallback();
					}
				);
			}, eachVolumeCallback);
		}, () => callback(successfullySentVolumes));
	});
}

function resendVolumeMessagesByAction(action, projection, generateMessageFunction, callback) {
	resendVolumeMessagesByQuery({ action: action }, projection, generateMessageFunction, callback);
}

function resendVolumeUpdateConfigurationToClient(callback) {
	let db = app.get('db');
	let volumeCollection = db.collection('volume');

	let query = { lastVersionSentToClientViaKafka: { $exists: 1 }, $expr: { $ne: ['$lastVersionSentToClientViaKafka', '$version'] } };

	volumeCollection.find(query).project(utils.volumeProjection).toArray((err, results) => {
		if (err)
			new MongoError(err).log();

		if (results.length)
			logger.sysDEBUG(`Found ${results.length} volumes with lastVersionSentToClientViaKafka that differs from volume version, re-sending kafka messages`);

		async.each(results, (v, eachCB) => {
			clientModule.sendUpdateVolumesToClient(v, () => eachCB());
		}, () => callback());
	});
}

scope.resendKafkaMessages = function(cb) {
	async.series([
		function checkForNewVolumes(callback) {
			resendVolumeMessagesByAction(consts.volumeActions.INITIALIZING, utils.volumeProjection, (v) => [new AddVolume(v)], () => { callback(); });
		},
		function checkForMarkedForDeletionVolumes(callback) {
			let projection = { _id: 1, uuid: 1, version: 1, 'chunks.pRaids.zone': 1 };

			resendVolumeMessagesByAction(
				consts.volumeActions.MARKED_FOR_DELETION,
				projection,
				(v) => [new DeleteVolume(v._id, v.uuid, v.version)], () => { callback(); }
			);
		},
		function checkForMarkedForRebuildVolumes(callback) {
			resendVolumeMessagesByAction(consts.volumeActions.MARKED_FOR_REBUILD, utils.volumeProjection, (v) => [new UpdateVolume(v)], () => { callback(); });
		},
		function checkForUpdatedVolumes(callback) {
			resendUpdatedVolume(callback);
		},
		function checkForDrivesDuringFormat(callback) {
			targetModule.resendFormatDriveMessages(callback);
		},
		function checkForReappearingDriveSegmentsChangedTarget(callback) {
			resendVolumeUpdateConfigurationToClient(callback);
		},
		function checkForStaleEncryptionCommands(callback) {
			encryptionModule.resendStaleEncryptionCommands(callback);
		}
	], cb);
};

function resendUpdatedVolume(callback) {
	const db = app.get('db');
	const versionCollection = db.collection('configurationVersion');
	const versionCursor = versionCollection.find({ topics: { $exists: true } }).project({ topics: 1 });

	utils.asyncIterCursor(versionCursor, (versionDocument, cb) => {
		const incrementalUpdateTopic = versionDocument.topics[consts.topicSuffix.LEADER_INCREMENTAL_UPDATES];
		const query = {
			$or: [
				{ lastVersionSentToTomaViaKafka: { $exists: 1 }, $expr: { $ne: ['$lastVersionSentToTomaViaKafka', '$version'] } },
				{ lastVersionSentToTomaTopicName: { $exists: 1 }, $expr: { $ne: ['$lastVersionSentToTomaTopicName', incrementalUpdateTopic] } },
			]
		};

		resendVolumeMessagesByQuery(
			query,
			utils.volumeProjection,
			volume => [new UpdateVolume(volume)],
			volumes => {
				if (volumes.length)
					volumeModule.updateVolumesForSentVersionByEntityField(volumes, 'lastVersionSentToTomaViaKafka', incrementalUpdateTopic, cb);
				else
					cb();
			}
		);
	}, callback);
}

scope.checkVolumesDiskSegments = function(cb) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');
	var serverCollection = db.collection('server');

	var volumeCursor = volumeCollection.find({}).project({
		_id: 1,
		name: 1,
		node_id: 1,
		'chunks.pRaids.diskSegments._id': 1,
		'chunks.pRaids.diskSegments.node_id': 1,
		'chunks.pRaids.diskSegments.diskID': 1,
		'chunks.pRaids.diskSegments.volumeName': 1
	});

	utils.asyncIterCursor(volumeCursor, function(volume) {
		(volume.chunks || []).forEach(function(chunk) {
			chunk.pRaids.forEach(function(pRaid) {
				pRaid.diskSegments.forEach(function(segment) {
					var serversCursor = serverCollection
						.find({
							_id: segment.node_id,
							'disks.diskID': segment.diskID,
							'disks.diskSegments.uuid': segment._id
						}).project({
							node_id: 1,
							'disks.diskID': 1,
							'disks.diskSegments._id': 1,
							'disks.diskSegments.volumeName': 1
						});

					serversCursor.toArray(function(err, results) {
						if (err)
							new MongoError(err).log();

						if (results.length < 1) {
							new SystemMessage(systemMessages.SANITY_SEGMENT_NOT_FOUND_ON_ANY_SERVER)
								.addInfo(Entities.DiskSegment.UUID, segment._id).addInfo(Entities.Volume.ID, volume.name).log();

						} else if (results.length > 1) {
							const msg = new SystemMessage(systemMessages.SANITY_SEGMENT_FOUND_ON_MULTIPLE_SERVER)
								.addInfo(Entities.DiskSegment.UUID, segment._id)
								.addInfo(Entities.Volume.ID, volume.name);

							results.forEach(target=>msg.addInfo(Entities.Target.ID, target.node_id));
							msg.log();
						}
					});
				});
			});
		});
		cb();
	}, cb);
};

// Check that there aren't any stale volumes
// volumes that were deleted from server document
// in case management failed during deletion of volume

// in delete volume we first remove the disk segments from the Server document, and afterwards remove the volume.
// so we need to search for volumes without disk segments in the servers
scope.checkForStaleVolumes = function(cb) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');
	var serverCollection = db.collection('server');

	var volumeCursor = volumeCollection
		.find(getMongoTimeoutQuery())
		.project({ _id: 1, name: 1, 'chunks.pRaids.diskSegments._id': 1 });

	utils.asyncIterCursor(volumeCursor, function(volume, cb) {
		serverCollection.find({ 'disks.diskSegments.volumeName': volume._id }).project({
			node_id: 1,
			'disks.diskID': 1,
			'disks.diskSegments._id': 1,
			'disks.diskSegments.volumeName': 1
		}).toArray(function(err, results) {
			if (err)
				new MongoError(err).log();

			if (results.length == 0)
				new SystemMessage(systemMessages.SANITY_VOLUME_SEGMENTS_NOT_ON_ANY_SERVER).addInfo(Entities.Volume.ID, volume._id).log();
		});
		cb();
	}, cb);
};

scope.checkServerDiskSegments = function(cb) {
	var db = app.get('db');
	var serverCollection = db.collection('server');

	var cursor = serverCollection.aggregate(
		[
			{
				disks: { $exists: 1 },
				nics: { $exists: 1 }
			},
			{
				$project: {
					_id: 1,
					node_id: 1,
					disks: {
						diskID: 1,
						diskSegments: {
							_id: 1,
							uuid: 1,
							diskID: 1,
							node_id: 1,
							volumeName: 1,
							type: 1
						}
					}
				}
			},
			{ $unwind: '$disks' },
			{ $unwind: '$disks.diskSegments' },
			{ $match: { 'disks.diskSegments.type': { $ne: consts.segmentTypes.EXCELERO_METADATA } } },
			{
				$group: {
					_id: '$disks.diskSegments.uuid',
					occurrences: {
						$push: {
							node_id: '$node_id',
							diskID: '$disks.diskID',
							volume: '$disks.diskSegments.volumeName',
							segmentNodeID: '$disks.diskSegments.node_id',
							segmentDiskID: '$disks.diskSegments.diskID'
						}
					}
				}
			}
		],
		{ allowDiskUse: true }
	);

	cursor.forEach(function(segment) {
		// 7.Check for diskSegments that appear in two disks simultaneously
		//  (In case the machine shut down in the middle of segments migration).
		if (segment.occurrences.length > 1) {
			const msg = new SystemMessage(systemMessages.SANITY_DUPLICATE_SEGMENTS);
			segment.occurrences.forEach(disk=>msg.addInfo(Entities.Drive.UUID, disk.diskID));
			msg.addInfo(Entities.DiskSegment.UUID, segment._id).log();
		} else {
			// 1.Validate that all the segments node_id and diskID
			// 	 match the containing disk id and node_id of the document it is in.
			if (segment.occurrences[0].segmentNodeID && segment.occurrences[0].node_id !== segment.occurrences[0].segmentNodeID) {
				new SystemMessage(systemMessages.SANITY_SEGMENT_WRONG_NODE_ID)
					.addInfo(Entities.DiskSegment.UUID, segment._id)
					.addInfo(Entities.Target.ID, segment.occurrences[0].node_id)
					.addInfo(Entities.DiskSegment.nodeID, segment.occurrences[0].segmentNodeID)
					.log();
			}

			if (segment.occurrences[0].segmentDiskID && segment.occurrences[0].diskID != segment.occurrences[0].segmentDiskID) {
				new SystemMessage(systemMessages.SANITY_SEGMENT_WRONG_DISK_ID)
					.addInfo(Entities.DiskSegment.UUID, segment._id)
					.addInfo(Entities.Target.ID, segment.occurrences[0].node_id)
					.addInfo(Entities.Drive.ID, getDriveID(segment.occurrences[0].diskID, segment.occurrences[0].node_id))
					.addInfo(Entities.DiskSegment.diskID, segment.occurrences[0].segmentDiskID)
					.log();
			}
		}
	}, () => {
		cb();
	});
};

function deleteVolumesByQuery(query, onErrorMessage, onDeletionMessage, cb) {
	let db = app.get('db');
	let volumeCollection = db.collection('volume');

	volumeCollection.find(query).toArray((err, volumes) => {
		async.eachSeries(volumes, (volume, callback) => {
			logger.sysDEBUG(`Deleting volume ${volume._id} that was found with query ${JSON.stringify(query)} on startup`);

			utils.forceDeleteVolume(volume, null, { volumeQuery: query }, (err) => {
				if (err)
					new SystemMessage(onErrorMessage).addInfo(Entities.Volume.ID, volume._id).log();
				else
					new SystemMessage(onDeletionMessage).addInfo(Entities.Volume.ID, volume._id).log();

				callback();
			});
		}, () => cb());
	});
}

function getMongoTimeoutQuery() {
	return {
		dateModified: { $lt: new Date(new Date() - config.get('mongoConnectOptions').connectTimeoutMS) }
	};
}

/*
This function determines whether an entity was:
1. Created by the current management in a previous boot.
2. Created by a now inactive management.
*/
function categorizeStaleEntities(entities, cb, getHandledBy = entity => entity.handledBy) {
	utils.loadCollection('managementCluster', {}, (err, mgmtCluster) => {
		if (err)
			return cb(err);

		const managementsState = utils.getMgmtClusterState(mgmtCluster);

		const isCreatedByMeInPrevBoot = handledBy =>
			handledBy.managementId === app.get('managementId') &&
			handledBy.bootVersion < app.get('bootVersion');

		const isCreatedByDeadMgmt = handledBy =>
			managementsState[handledBy.managementId] === undefined ||
			managementsState[handledBy.managementId].status === consts.managementStatuses.DOWN &&
			managementsState[handledBy.managementId].bootVersion === handledBy.bootVersion;


		let entitiesToDeleteCreatedByThisMgmt = [];
		let entitiesToDeleteCreatedByOtherMgmt = [];

		entities.forEach(entity => {
			const handledBy = getHandledBy(entity);
			if (!handledBy) {
				new SystemMessage(systemMessages.SANITY_ENTITY_HAS_NO_HANDLED_BY)
					.addInfo(Entities.DocumentID, entity._id)
					.addInfo(Entities.Content, entity).log();
				return;
			}
			if (isCreatedByMeInPrevBoot(handledBy))
				entitiesToDeleteCreatedByThisMgmt.push(entity);
			else if (isCreatedByDeadMgmt(handledBy))
				entitiesToDeleteCreatedByOtherMgmt.push(entity);
		});

		cb(entitiesToDeleteCreatedByThisMgmt, entitiesToDeleteCreatedByOtherMgmt);
	});
}

scope.checkAndRemovePendingUpgrades = function(cb) {
	async.waterfall([
		function getPendingUpgrades(callback) {
			utils.loadCollection('upgrade', { filter: { isPending: true } }, callback);
		},
		function categorizeUpgrades(pendingUpgrades, callback) {
			if (!pendingUpgrades.length)
				return callback(null, [], []);

			categorizeStaleEntities(pendingUpgrades,
				(upgradesToDeleteCreatedByThisMgmt, upgradesToDeleteCreatedByOtherMgmt) => {
					callback(null, upgradesToDeleteCreatedByThisMgmt, upgradesToDeleteCreatedByOtherMgmt);
				});
		},
		function deletePendingUpgrades(upgradesToDeleteCreatedByThisMgmt, upgradesToDeleteCreatedByOtherMgmt, callback) {
			const defaultQuery = upgrade => ({ _id: upgrade._id, isPending: true });
			const query = getDeleteStaleEntitiesQuery(defaultQuery, upgradesToDeleteCreatedByThisMgmt, upgradesToDeleteCreatedByOtherMgmt);

			if (!query)
				return callback();

			utils.loadCollection('upgrade', { filter: query }, (err, upgrades) => {
				if (err)
					return callback(err);

				if (!upgrades.length)
					return callback();

				upgradeModule.deleteUpgrades(upgrades, callback);
			});
		}
	], cb);
};

scope.checkAndResumeStuckUpgrades = function(cb) {
	const db = app.get('db');
	const confVersionCollection = db.collection('configurationVersion');
	const upgradeCollection = db.collection('upgrade');

	async.waterfall([
		function getRunningUpgradeConfVersions(callback) {
			confVersionCollection.find({ runningUpgrade: { $exists: true } }).toArray((err, confVersions) => {
				if (err)
					return callback(new MongoError(err).log());

				callback(null, confVersions);
			});
		},
		function categorizeConfVersions(confVersions, callback) {
			if (!confVersions.length)
				return callback(null, [], []);

			const getHandledBy = entity => entity.runningUpgrade.createdBy;
			categorizeStaleEntities(confVersions,
				(confVersionsCreatedByThisMgmt, confVersionsCreatedByOtherMgmt) => {
					callback(null, confVersionsCreatedByThisMgmt, confVersionsCreatedByOtherMgmt);
				},
				getHandledBy);
		},
		function getStaleConfVersion(confVersionsCreatedByThisMgmt, confVersionsCreatedByOtherMgmt, callback) {
			const defaultQuery = confVersion => ({ _id: confVersion._id, runningUpgrade: { $exists: true } });
			const getHandledBy = entity => entity.runningUpgrade.createdBy;
			const query = getDeleteStaleEntitiesQuery(
				defaultQuery, confVersionsCreatedByThisMgmt, confVersionsCreatedByOtherMgmt,
				'runningUpgrade.createdBy', getHandledBy
			);

			if (!query)
				return callback(true);

			confVersionCollection.findOne(query, (err, confVersion) => {
				if (err)
					return callback(new MongoError(err).log());

				callback(null, confVersion);
			});
		},
		(confVersionDoc, cb) => {
			if (!confVersionDoc) return cb(true);

			upgradeCollection.findOne({ _id: confVersionDoc.runningUpgrade.upgradeID }, (err, upgradeDoc) => {
				if (err)
					err = new MongoError(err).log();

				cb(err, confVersionDoc, upgradeDoc);
			});
		},
		(confVersionDoc, upgradeDoc, cb) => {
			if (!upgradeDoc || upgradeDoc.status === consts.upgradeStatuses.COMPLETED || upgradeDoc.status === consts.upgradeStatuses.FAILED)
				return upgradeModule.releaseUpgradeLockByID([confVersionDoc.runningUpgrade.upgradeID], () => cb(true));

			cb(null, upgradeDoc);
		},
		(upgradeDoc, cb) => {
			if (!upgradeDoc) return cb();

			upgradeModule.tryToTakeUpgradeLock(upgradeDoc, true, (err, clusterDoc) => {
				if (err)
					err = new MongoError(err).log();

				cb(err, clusterDoc, upgradeDoc);
			});
		},
		(clusterDoc, upgradeDoc, cb) => {
			if (!clusterDoc) return cb();

			upgradeModule.checkUpgradeStatus(upgradeDoc._id);

			cb();
		}
	], () => cb());
};
//checks if there are pending volume in DB and deletes their server diskSegments and the volumes themselves
scope.checkAndRemovePendingVolumes = function(cb) {
	async.waterfall([
		function getPendingVolumes(callback) {
			const query = {
				filter: { status: consts.volumeStatuses.PENDING },
				projection: { handledBy: 1, uuid: 1 }
			};
			utils.loadCollection('volume', query, (err, pendingVolumes) => {
				if (err)
					return callback(err);

				callback(null, pendingVolumes);
			});
		},
		function categorizeVolumes(pendingVolumes, callback) {
			if (!pendingVolumes.length)
				return callback(null, [], []);

			categorizeStaleEntities(pendingVolumes,
				(volumesToDeleteCreatedByThisMgmt, volumesToDeleteCreatedByOtherMgmt) => {
					callback(null, volumesToDeleteCreatedByThisMgmt, volumesToDeleteCreatedByOtherMgmt);
				});
		},
		function deletePendingVolumes(volumesToDeleteCreatedByThisMgmt, volumesToDeleteCreatedByOtherMgmt, callback) {
			const defaultQuery = volume => ({
				uuid: volume.uuid,
				status: consts.volumeStatuses.PENDING
			});

			const query = getDeleteStaleEntitiesQuery(defaultQuery, volumesToDeleteCreatedByThisMgmt, volumesToDeleteCreatedByOtherMgmt);

			if (!query)
				return callback();

			deleteVolumesByQuery(
				query,
				systemMessages.SANITY_AUTO_REMOVE_PENDING_VOLUME_FAILED,
				systemMessages.SANITY_PENDING_VOLUME_AUTO_REMOVED,
				callback
			);
		}
	], err => cb(err));
};

function getDeleteStaleEntitiesQuery(
	defaultQuery,
	entitiesToDeleteCreatedByThisMgmt,
	entitiesToDeleteCreatedByOtherMgmt,
	handledByPath = 'handledBy',
	getHandledBy = entity => entity.handledBy) {
	if (!entitiesToDeleteCreatedByThisMgmt.length && !entitiesToDeleteCreatedByOtherMgmt.length)
		return null;

	const matchHandledBy = entity => {
		const handledBy = getHandledBy(entity);
		return {
			[`${handledByPath}.managementId`]: handledBy.managementId,
			[`${handledByPath}.bootVersion`]: handledBy.bootVersion
		};
	};

	const queryForEntityCreatedByThisMgmt = entity => ({
		...defaultQuery(entity),
		...matchHandledBy(entity)
	});

	const queryForEntityCreatedByOtherMgmt = entity => ({
		...queryForEntityCreatedByThisMgmt(entity),
		...getMongoTimeoutQuery()
	});

	return {
		$or: entitiesToDeleteCreatedByThisMgmt
			.map(queryForEntityCreatedByThisMgmt)
			.concat(entitiesToDeleteCreatedByOtherMgmt.map(queryForEntityCreatedByOtherMgmt))
	};
}

function getCheckAndRemoveToBeExtendedVolumesPipeline(diskSegmentsToRemove = null) {
	let targetsIDsMatch, disksUUIDsMatch, diskSegmentsUUIDsMatch;
	let isExtensionMatch = { 'disks.diskSegments.isExtension': true };

	if (diskSegmentsToRemove) {
		targetsIDsMatch = { ...isExtensionMatch, _id: { $in: diskSegmentsToRemove.map(d => d.node_id) } };
		disksUUIDsMatch = { ...isExtensionMatch, 'disks.uuid': { $in: diskSegmentsToRemove.map(d => d.diskUUID) } };
		diskSegmentsUUIDsMatch = { ...isExtensionMatch, 'disks.diskSegments.uuid': { $in: diskSegmentsToRemove.map(d => d.uuid) } };
	} else {
		targetsIDsMatch = disksUUIDsMatch = diskSegmentsUUIDsMatch = isExtensionMatch;
	}

	let pipeline = [
		{ $project: { 'disks.diskSegments': 1, 'disks.uuid': 1 } },
		{ $match: targetsIDsMatch },
		{ $unwind: '$disks' },
		{ $match: disksUUIDsMatch },
		{ $unwind: '$disks.diskSegments' },
		{ $match: diskSegmentsUUIDsMatch },
		{ $project: { diskSegments: '$disks.diskSegments' } },
		{
			$lookup: {
				from: 'volume',
				let: { diskSegmentUUID: '$diskSegments.uuid', volumeName: '$diskSegments.volumeName' },
				pipeline: [
					{ $match: { $expr: { $eq: ['$_id', '$$volumeName'] } } },
					{ $project: { 'chunks.pRaids.diskSegments._id': 1 } },
					{ $unwind: '$chunks' },
					{ $unwind: '$chunks.pRaids' },
					{ $unwind: '$chunks.pRaids.diskSegments' },
					{ $match: { $expr: { $eq: ['$chunks.pRaids.diskSegments._id', '$$diskSegmentUUID'] } } },
					{ $project: { _id: 0, exists: { $toBool: '$chunks.pRaids.diskSegments._id' } } }
				],
				as: 'fromVolume'
			}
		},
		{ $match: { 'fromVolume.exists': { $exists: false } } },
		{ $project: { _id: 0, diskSegments: 1 } }
	];

	return pipeline;
}

scope.checkAndRemoveToBeExtendedVolumes = function(cb) {
	let db = app.get('db');
	let serverCollection = db.collection('server');
	let diskSegmentsToRemove = [];
	let zone;
	let isLocked = false;

	async.series([
		function deleteExtensionVolumes(seriesCallback) {
			async.waterfall([
				function getExtentionVolumes(callback) {
					const query = {
						filter: { isExtension: true },
						projection: { handledBy: 1, uuid: 1 }
					};
					utils.loadCollection('volume', query, (err, extentionVolumes) => {
						if (err)
							return callback(err);

						callback(null, extentionVolumes);
					});
				},
				function categorizeVolumes(extentionVolumes, callback) {
					if (!extentionVolumes.length)
						return callback(null, [], []);

					categorizeStaleEntities(extentionVolumes,
						(volumesToDeleteCreatedByThisMgmt, volumesToDeleteCreatedByOtherMgmt) => {
							callback(null, volumesToDeleteCreatedByThisMgmt, volumesToDeleteCreatedByOtherMgmt);
						});
				},
				function deleteExtentionVolumes(volumesToDeleteCreatedByThisMgmt, volumesToDeleteCreatedByOtherMgmt, callback) {
					const defaultQuery = volume => ({
						uuid: volume.uuid,
						isExtension: true
					});

					const query = getDeleteStaleEntitiesQuery(defaultQuery, volumesToDeleteCreatedByThisMgmt, volumesToDeleteCreatedByOtherMgmt);

					if (!query)
						return callback();

					deleteVolumesByQuery(query,
						systemMessages.SANITY_AUTO_REMOVE_IS_EXTENSION_VOLUME_FAILED,
						systemMessages.SANITY_IS_EXTENSION_VOLUME_AUTO_REMOVED,
						callback
					);
				}
			], err => seriesCallback(err));
		},
		function findOrphanDiskSegments(callback) {
			let pipeline = getCheckAndRemoveToBeExtendedVolumesPipeline();

			serverCollection.aggregate(pipeline).toArray((err, orphanDiskSegmentsFromExtension) => {
				if (err) {
					new MongoError(err).log();
					return callback(err);
				}

				if (!orphanDiskSegmentsFromExtension.length) {
					logger.sysDEBUG('No orphan diskSegments from extension found');
					return callback(true);
				}

				diskSegmentsToRemove = orphanDiskSegmentsFromExtension.map(d => d.diskSegments);

				callback();
			});
		},
		function acquireLock(callback) {
			zone = diskSegmentsToRemove.map(d => d.zone)[0];
			lockModule.acquireLockByZone(zone, err => { isLocked = !err; callback(err); });
		},
		function validateOrphanDiskSegments(callback) {
			const pipeline = getCheckAndRemoveToBeExtendedVolumesPipeline(diskSegmentsToRemove);

			serverCollection.aggregate(pipeline).toArray((err, orphanDiskSegmentsFromExtension) => {
				if (err) {
					new MongoError(err).log();
					return callback(err);
				}

				if (!orphanDiskSegmentsFromExtension.length) {
					logger.sysDEBUG('No orphan diskSegments from extension found');
					return callback(true);
				}

				diskSegmentsToRemove = orphanDiskSegmentsFromExtension.map(d => d.diskSegments);
				callback();
			});
		},
		function forceDeleteDiskSegments(callback) {
			utils.forceDeleteDiskSegments(diskSegmentsToRemove, (err) => {
				if (err)
					logger.sysERROR(err);

				callback();
			});
		}
	], () => {
		if (isLocked)
			return lockModule.releaseLockByZone(zone, cb);

		cb();
	});
};

scope.checkDriveAllocationParams = function(cb) {
	const db = app.get('db');
	const serverCollection = db.collection('server');

	// verify (availableBlocks = usableBlocks - total segment's blocks)
	// validate that availableBlocks suits the usableBlocks - total segment's blocks (recalculate availableBlocks).
	// validate that there is no segment that was allocated outside of the drive GPT boundaries
	var serversCursor = serverCollection.find({}).project({ disks: 1, zone: 1 });
	let queryParamsByZone = {};

	utils.asyncIterCursor(serversCursor, function(server, cb) {
		server.disks.forEach(function(disk) {
			let availableBlocks = calculateDiskUsableBlocks(disk);

			if (availableBlocks != disk.availableBlocks) {
				new SystemMessage(systemMessages.SANITY_BLOCKS_CALC_MISMATCH)
					.addInfo(Entities.Target.zone, server.zone)
					.addInfo(Entities.Drive.ID, getDriveID(disk.diskID, disk.nodeID))
					.addInfo(Entities.Target.ID, disk.nodeID)
					.addInfo(Entities.Drive.availableBlocks, disk.availableBlocks, Differentiators.Existing)
					.addInfo(Entities.Drive.availableBlocks, availableBlocks, Differentiators.Calculated)
					.log();

				if (!queryParamsByZone[server.zone])
					queryParamsByZone[server.zone] = [];

				queryParamsByZone[server.zone].push(
					{
						node_id: disk.nodeID,
						diskID: disk.diskID,
						availableBlocks: availableBlocks,
						currentAvailableBlocks: disk.availableBlocks
					}
				);
			}

			const err = diskModule.validateGPTDriveBoundaries(disk);
			if (err)
				logger.sysDEBUG(`GPT boundaries check failed for drive ${disk.diskID}`, err);
		});

		cb();
	}, () => {
		if (utils.isEmpty(queryParamsByZone) || !app.get('globalSettings').fixInSanityAndRecover.availableBlocks)
			return cb();

		async.each(Object.keys(queryParamsByZone), (zone, eachCB) => {
			async.series([
				function lockByZone(seriesCB) {
					lockModule.acquireLockByZone(zone, err => {
						if (err)
							return seriesCB(err);

						seriesCB();
					});
				},
				function fixForZone(seriesCB) {
					async.each(queryParamsByZone[zone], (params, next) => {
						new SystemMessage(systemMessages.SANITY_AVAILABLE_BLOCKS_MISMATCH_FIX)
							.addInfo(Entities.Target.zone, zone)
							.addInfo(Entities.Drive.ID, getDriveID(params.diskID, params.node_id))
							.addInfo(Entities.Target.ID, params.node_id)
							.addInfo(Entities.Drive.availableBlocks, params.availableBlocks)
							.log();

						serverCollection.updateOne(
							{ node_id: params.node_id, 'disks.diskID': params.diskID, 'disks.availableBlocks': params.currentAvailableBlocks },
							{ $set: { 'disks.$.availableBlocks': params.availableBlocks } },
							(err, res) => {
								if (err)
									new MongoError(err).log();
								else if (!res.modifiedCount)
									new SystemMessage(systemMessages.SANITY_AVAILABLE_BLOCKS_MISMATCH_FIX_FAIL)
										.addInfo(Entities.Drive.ID, getDriveID(params.diskID, params.node_id))
										.addInfo(Entities.Target.ID, params.node_id)
										.log();

								next();
							});
					}, seriesCB);
				}
			], err => {
				if (err) {
					logger.sysERROR(err);
					return eachCB();
				}

				lockModule.releaseLockByZone(zone, eachCB);
			});
		}, cb);
	});
};

scope.checkForZonesViolation = function(cb) {
	var db = app.get('db');
	var serverCollection = db.collection('server');
	var volumeCollection = db.collection('volume');

	var targetsZones = {};

	serverCollection.find({}, { node_id: 1, zone: 1, _id: 0 }).toArray((err, servers) => {
		servers.forEach((server) => {
			targetsZones[server.node_id] = server.zone;
		});

		volumeCollection.aggregate([
			{ $match: { status: { $ne: consts.volumeStatuses.PENDING } } },
			{ $project: { 'chunks.pRaids.diskSegments.node_id': 1 } },
			{ $unwind: '$chunks' },
			{ $unwind: '$chunks.pRaids' }
		]).toArray((err, results) => {
			results.forEach((volume) => {
				var zone;

				volume.chunks.pRaids.diskSegments.forEach((ds) => {
					if (!zone)
						zone = targetsZones[ds.node_id].zone;
					else if (zone !== targetsZones[ds.node_id].zone)
						new SystemAdminMessage(systemMessages.SANITY_VOLUME_ZONE_VIOLATION)
							.addInfo(Entities.Volume.ID, volume._id).addInfo(Entities.PRaid.UUID, ds.pRaidUUID).log();
				});
			});

			cb();
		});
	});
};

scope.checkForBadVolumes = function(cb) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	volumeCollection.find(
		{
			status: { $ne: consts.volumeStatuses.PENDING },
			...getMongoTimeoutQuery(),
			$or: [
				{ capacity: NaN },
				{ blocks: NaN }
			]
		}).toArray(function(err, results) {

		results.forEach(volume => new SystemAdminMessage(systemMessages.SANITY_VOLUME_BAD_FIELD_VALUES).addInfo(Entities.Volume, volume).log());

		cb();
	});
};

scope.validateLargestSegment = function(cb) {
	let db = app.get('db');
	let serverCollection = db.collection('server');

	serverCollection.find({}).project({
		'disks.diskSegments': 1,
		'disks.largestSegmentAvailable': 1,
		'disks.diskID': 1,
		'disks.GPT': 1,
		'disks.usableBlocks': 1,
		'disks.nodeID': 1
	}).toArray((err, results) => {
		results.forEach((server) => {
			server.disks.forEach((disk) => {
				if (!disk.diskSegments)
					disk.diskSegments = [];

				if (!disk.GPT)
					return;

				let largestSegment = utils.getLargestSegment(disk);

				if (largestSegment.lbs !== disk.largestSegmentAvailable.lbs ||
					largestSegment.lbe !== disk.largestSegmentAvailable.lbe ||
					largestSegment.blocks !== disk.largestSegmentAvailable.blocks) {

					return cb(new SystemMessage(systemMessages.SANITY_LARGEST_SEGMENT_INCORRECT)
						.addInfo(Entities.Drive.ID, getDriveID(disk.diskID, disk.nodeID))
						.log());
				}
			});
		});

		cb();
	});
};

scope.checkForOverlappingVolumes = function(cb) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	var diskSegmentsCursor = volumeCollection.aggregate([
		{ $unwind: '$chunks' },
		{ $unwind: '$chunks.pRaids' },
		{ $unwind: '$chunks.pRaids.diskSegments' },
		{ $match: { 'chunks.pRaids.diskSegments.isReserved': { $ne: true }, 'chunks.pRaids.diskSegments.type': consts.segmentTypes.DATA } },
		{ $sort: { 'chunks.pRaids.diskSegments.diskID': 1, 'chunks.pRaids.diskSegments.lbs': 1 } }
	]);

	var shouldContinue = true;

	var firstSegment;
	var secondSegment;

	async.whilst(
		function(callback) { callback(null, shouldContinue); },
		function(callback) {
			async.series([
				function(callback) {
					if (firstSegment) return callback();

					getOneSegment(diskSegmentsCursor, function(err, segment) {
						if (err)
							return callback(err);

						firstSegment = segment;

						callback();
					});
				},
				function(callback) {
					if (secondSegment) return callback();

					getOneSegment(diskSegmentsCursor, function(err, segment) {
						if (err)
							return callback(err);

						secondSegment = segment;

						callback();
					});

				}
			], function(err) {
				if (err) return callback(err);

				if (!firstSegment || !secondSegment) {
					logger.sysDEBUG('No more segments, nothing to check');
					shouldContinue = false;
					return callback();
				}

				if (firstSegment['chunks']['pRaids']['diskSegments'].diskID === secondSegment['chunks']['pRaids']['diskSegments'].diskID)
					if (isFollowingSegmentsOverlapping(firstSegment['chunks']['pRaids']['diskSegments'], secondSegment['chunks']['pRaids']['diskSegments'])) {
						let err = new SystemAdminMessage(systemMessages.SANITY_OVERLAPPING_SEGMENTS)
							.addInfo(Entities.DiskSegment.UUID, firstSegment['chunks']['pRaids']['diskSegments'].uuid, Differentiators.First)
							.addInfo(Entities.DiskSegment.UUID, secondSegment['chunks']['pRaids']['diskSegments'].uuid, Differentiators.Second)
							.log();
						shouldContinue = false;
						return callback(err);
					}

				firstSegment = secondSegment;
				secondSegment = null;
				callback();
			});
		},
		function(err) {
			cb(err);
		}
	);
};

scope.checkForTargetAddition = function(cb) {
	const db = app.get('db');
	const serverCollection = db.collection('server');

	serverCollection.aggregate([
		{ $match: { addTargetMessageRequired: true } },
		{ $group: { _id: '$zone', targets: { $push: { node_id: '$node_id' } } } }
	]).toArray((err, results) => {
		if (err) {
			new MongoError(err).log();
			return cb(err);
		}

		async.each(results, (z, callback) => {
			zoneModule.newTargetsInZone(z._id, z.targets.map((t) => { return t.node_id; }), () => {
				callback();
			});
		}, () => {
			cb();
		});
	});
};

scope.checkForTargetsDeletion = function(cb) {
	let db = app.get('db');
	let serverCollection = db.collection('server');

	serverCollection.find({ node_status: consts.nodeStatus.DELETING }).toArray((err, results) => {
		if (err) {
			new MongoError(err).log();
			return cb(err);
		}

		if (results.length)
			return targetModule.deleteTargets(results.map((t) => { return t.node_id; }), false, messages => {
				messages.forEach(message => message.log());
				const errorMessages = messages.filter(m => m.systemMessage.id !== systemMessages.TARGET_MARKED_FOR_DELETION.id);
				if (errorMessages)
					cb(errorMessages);
			});

		cb();
	});
};

scope.checkForVolumesDeletion = (cb) => {
	let db = app.get('db');
	let volumeCollection = db.collection('volume');

	volumeCollection.find({ status: consts.volumeStatuses.TO_BE_DELETED }).toArray((err, results) => {
		if (err) {
			new MongoError(err).log();
			return cb(err);
		}

		if (results.length) {
			return async.eachSeries(results, (volume, callback) => {
				volumeModule.doAfterVolumeDeleted(volume, (err) => {
					callback(err);
				});
			}, (err) => {
				cb(err);
			});
		}

		cb();
	});
};

scope.checkForUncompletedSegmentUpdateOnReappearing = (cb) => {
	let db = app.get('db');
	let volumeCollection = db.collection('volume');
	let serverCollection = db.collection('server');

	serverCollection.find({ 'disks.reappearingCounter': { $gt: 1 } }).project({ node_id: 1, uuid: 1, 'disks.uuid': 1 }).toArray((err, results) => {
		if (err) {
			new MongoError(err).log();
			return cb(err);
		}

		if (results.length)
			async.eachSeries(results, (target, eachCB) => {
				if (!target.disks || !target.disks.length)
					return eachCB();

				target.disks = target.disks.map((disk) => { return disk.uuid; });

				volumeCollection.aggregate([
					{ $match: {
						'chunks.pRaids.diskSegments': {
							$elemMatch: {
								diskUUID: { $in: target.disks },
								node_id: { $ne: target.node_id }
							}
						}
					} },
					{ $project: { 'chunks.pRaids.diskSegments': 1 }	},
					{ $unwind: '$chunks' },
					{ $unwind: '$chunks.pRaids' },
					{ $unwind: '$chunks.pRaids.diskSegments' },
					{ $match: { // dual match since we used unwind only after first match to avoid unwinding the whole volume collection
						'chunks.pRaids.diskSegments.diskUUID': { $in: target.disks },
						'chunks.pRaids.diskSegments.node_id': { $ne: target.node_id }
					} },
					{
						$group: { _id: null, diskSegments: { $push: '$chunks.pRaids.diskSegments' } }
					}
				]).toArray((err, results) => {
					if (err) {
						new MongoError(err).log();
						return eachCB(err);
					}

					if (results.length && results[0].diskSegments.length) {
						targetModule.updateVolumeSegmentsNewNodeId(target, results[0].diskSegments, () => { eachCB(); });
					} else
						eachCB();
				});
			}, cb);
		else
			cb();
	});
};

function getTargetsAndSegmentsInZonePipelineForServer(zonesToCheck) {
	let $match = zonesToCheck && zonesToCheck.length ? { zone: { $in: zonesToCheck } } : {};
	$match.isTargetUpdateSequenceInc = true;

	return [
		{ $match: $match },
		{ $project: { zone: 1, 'disks.diskSegments._id': 1 } },
		{ $unwind: { path: '$disks', preserveNullAndEmptyArrays: true } },
		{ $unwind: { path: '$disks.diskSegments', preserveNullAndEmptyArrays: true } },
		{
			$group: {
				_id: '$_id',
				zone: { $first: '$zone' },
				// count segments, but if no segment present, treat as 0
				segmentsInServer: {
					$sum: {
						$cond: [{ $ifNull: ['$disks.diskSegments', false] }, 1, 0]
					}
				}
			}
		},
		{ $group: { _id: '$zone', targetsInZone: { $addToSet: '$_id' }, segmentsInZone: { $sum: '$segmentsInServer' } } },
	];
}

function checkForZonesCountersByZones(zonesToCheck, mainCallback) {
	const db = app.get('db');
	const lockCollection = db.collection('lock');
	const serverCollection = db.collection('server');
	let zonesToRetry = [];

	const logWithUUID = utils.getDebugLoggerWithPrefix(`checkForZonesCountersByZones [${uuid.v1()}]: `);
	logWithUUID('Starting for zones: ', zonesToCheck);

	async.waterfall([
		function getTargetAndSegmentsInZoneFromLockCollection(cb) {
			lockCollection.find(zonesToCheck && zonesToCheck.length ? { _id: { $in: zonesToCheck } } : {}).project({ segmentsInZone: 1, targetsInZone: 1 })
				.toArray((err, zonesFromLock) => {
					if (err) {
						new MongoError(err).log();
						return cb(err);
					}

					zonesFromLock = zonesFromLock.reduce((acc, currZone) => { acc[currZone._id] = currZone; return acc; }, {});
					logWithUUID('zonesFromLock:', zonesFromLock);
					cb(null, zonesFromLock);
				});
		},
		function getTargetAndSegmentsInZoneFromServerCollection(zonesFromLock, cb) {
			const serverPipeline = getTargetsAndSegmentsInZonePipelineForServer(zonesToCheck);
			serverCollection.aggregate(serverPipeline).toArray((err, zonesCalculatedFromServers) => {
				if (err) {
					new MongoError(err).log();
					return cb(err);
				}
				logWithUUID('zonesCalculatedFromServers:', zonesCalculatedFromServers);
				cb(null, zonesFromLock, zonesCalculatedFromServers);
			});
		},
		function updateLockCollectionWithCalculatedZones(zonesFromLock, zonesCalculatedFromServers, cb) {
			async.each(zonesCalculatedFromServers, function updateEachZone(calculatedZone, eachCallback) {
				const query = {
					_id: calculatedZone._id,
					segmentsInZone: zonesFromLock[calculatedZone._id].segmentsInZone,
					lastTargetUpdate: { $exists: false },
					$and: [
						{ targetsInZone: { $size: zonesFromLock[calculatedZone._id].targetsInZone.length } }
					]
				};

				if (zonesFromLock[calculatedZone._id].targetsInZone.length)
					query.$and.push({ targetsInZone: { $all: zonesFromLock[calculatedZone._id].targetsInZone } });

				const $set = { targetsInZone: calculatedZone.targetsInZone, segmentsInZone: calculatedZone.segmentsInZone };
				logWithUUID('Update lock', { query, $set });
				lockCollection.findOneAndUpdate(query, { $set: $set }, (err, res) => {
					if (err) {
						new MongoError(err).log();
						return eachCallback(err);
					}

					if (!res) {
						logWithUUID(`Failed to update lock collection in checkForZonesCounters for zone ${calculatedZone._id}, will retry`);
						zonesToRetry.push(calculatedZone._id);
					}

					logWithUUID(`checkForZonesCounters for zone: ${calculatedZone._id} completed, `
					+ `targetsInZone: ${calculatedZone.targetsInZone}, segmentsInZone: ${calculatedZone.segmentsInZone}`);

					eachCallback();
				});
			}, err => {
				if (err) {
					logger.sysERROR('Failed to update lock collection inc checkForZonesCounters, err: ', err);
					return cb(err);
				}

				if (zonesToRetry && zonesToRetry.length)
					checkForZonesCountersByZones(zonesToRetry, mainCallback);
				else
					cb();
			});
		}
	], err => {
		mainCallback(err);
	});
}

scope.checkForZonesCounters = function(cb) {
	checkForZonesCountersByZones([], cb);
};

function isSegmentSane(diskSegment) {
	['lbs', 'lbe', 'allocationIndex', 'pRaidTypeIndex', 'pRaidIndex'].forEach(function(key) {
		if (isNaN(diskSegment[key]) || diskSegment[key] === null) {
			new SystemAdminMessage(systemMessages.SANITY_SEGMENT_SANITY_FAILED)
				.addInfo(Entities.DiskSegment.attribute, diskSegment[key]).addInfo(Entities.DiskSegment.UUID, diskSegment._id).log();
			return false;
		}
	});

	if (diskSegment.lbe - diskSegment.lbs <= 0) {
		new SystemAdminMessage(systemMessages.SANITY_SEGMENT_RANGE_ERROR).addInfo(Entities.DiskSegment.UUID, diskSegment._id)
			.addInfo(Entities.DiskSegment.start, diskSegment.lbs).addInfo(Entities.DiskSegment.end, diskSegment.lbe).log();
		return false;
	}

	return true;
}

function getOneSegment(cursor, cb) {
	cursor.hasNext(function(err, hasNext) {
		if (hasNext)
			cursor.next(function(err, obj) {
				var diskSegment = obj['chunks']['pRaids']['diskSegments'];

				if (obj && !isSegmentSane(diskSegment)) {
					err = 'diskSegment sanity check failed!';
					obj = diskSegment;
				}

				setTimeout(function() { cb(err, obj); }, 0);
			});
		else
			cb();
	});
}

function isFollowingSegmentsOverlapping(firstSegment, secondSegment) {
	return firstSegment.lbs === secondSegment.lbs || secondSegment.lbs <= firstSegment.lbe;
}

function calculateDiskUsableBlocks(disk) {
	function sum(a, b) { return a + b; }
	function mapSegmentBlockSize(segment) { return segment.lbe - segment.lbs + 1; }
	// filter only nvmesh data segment and not from reserved
	function filterDataOnly(segment) {
		return (!segment.owner || segment.owner === consts.segmentOwners.NVMESH) && segment.type === consts.segmentTypes.DATA && !segment.fromReserved;
	}

	var nvmeshDataSegments = (disk.diskSegments || []).filter(filterDataOnly);
	var totalSegmentsBlocks = nvmeshDataSegments.map(mapSegmentBlockSize).reduce(sum, 0);
	return disk.usableBlocks - totalSegmentsBlocks;
}

/**
 * Checks for Snapshots where one volume is missing (Data or Metadata) and deletes them.
 * @param  {callback} cb [func(err) Callback]
 */
scope.checkForIncompleteSnapshots = function(cb) {
	let volumesToDelete = [];

	async.series([
		cb => {
			scope.checkForSnapshotsWithoutMetadata(snapshotsWithoutMD => {
				volumesToDelete = volumesToDelete.concat(snapshotsWithoutMD);
				cb();
			});
		},
		cb => {
			scope.checkForSnapshotsMetadataWithNoData(snapshotsMetadataWithoutData => {
				volumesToDelete = volumesToDelete.concat(snapshotsMetadataWithoutData);
				cb();
			});
		}
	], err => {
		if (err) return cb(err);

		// Remove volumes
		async.each(volumesToDelete, (v, cb) => {
			logger.sysDEBUG(`Deleting partial snpashots volume ${v._id}`);
			utils.forceDeleteVolume(v, null, false, cb);
		}, cb);
	});
};

function getIncompleteSnapshots(initialMatchQuery, pipeline, cb) {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');

	const incompleteSnapshotsPipeline = [
		{
			$match: initialMatchQuery
		},
		...pipeline
	];

	let incompleteSnapshotsIDs = [];

	async.waterfall([
		function getIncompleteSnapshots(callback) {
			volumeCollection.aggregate(incompleteSnapshotsPipeline).toArray((err, incompleteSnapshots) => {
				if (err)
					return callback(err);

				callback(null, incompleteSnapshots);
			});
		},
		function categorizeVolumes(incompleteSnapshots, callback) {
			if (!incompleteSnapshots.length)
				return callback(null, [], []);

			categorizeStaleEntities(incompleteSnapshots,
				(volumesToDeleteCreatedByThisMgmt, volumesToDeleteCreatedByOtherMgmt) => {
					callback(null, volumesToDeleteCreatedByThisMgmt, volumesToDeleteCreatedByOtherMgmt);
				});
		},
		function getStaleIncompleteSnapshots(volumesToDeleteCreatedByThisMgmt, volumesToDeleteCreatedByOtherMgmt, callback) {
			const defaultQuery = volume => ({
				uuid: volume.uuid,
				...initialMatchQuery
			});

			const query = getDeleteStaleEntitiesQuery(defaultQuery, volumesToDeleteCreatedByThisMgmt, volumesToDeleteCreatedByOtherMgmt);

			if (!query)
				return callback();

			const staleSnapshotsMatch = {
				$match: query
			};
			const staleSnapshotsPipeline = [staleSnapshotsMatch, ...incompleteSnapshotsPipeline.slice(1)];

			volumeCollection.aggregate(staleSnapshotsPipeline).toArray((err, incompleteSnapshots) => {
				if (err)
					return callback(err);

				incompleteSnapshotsIDs = incompleteSnapshots;

				callback();
			});
		}
	], err => cb(err, incompleteSnapshotsIDs));
}

/**
 * Checks for Snapshots volume (data volume) that have no metadataVolumeID -
 * meaning that the Snapshot creation process was interrupted
 * @param  {callback} cb [func(err) Callback]
 */
scope.checkForSnapshotsWithoutMetadata = function(cb) {
	const snapshotDataVolumeMatch = {
		sourceID: { $exists: true },
		metadataVolumeID: { $exists: true }
	};

	const snapshotsWithoutMetadataPipeline = [
		{
			$lookup: {
				from: 'volume',
				localField: 'metadataVolumeID',
				foreignField: '_id',
				as: 'snapshotMetadataVolume'
			}
		},
		{
			$match: { snapshotMetadataVolume: { $size: 0 } }
		},
		{
			$project: {
				snapshotMetadataVolume: 0
			}
		}
	];

	getIncompleteSnapshots(snapshotDataVolumeMatch, snapshotsWithoutMetadataPipeline, (err, snapshotsWithoutMD) => {
		if (err)
			return cb(err);

		snapshotsWithoutMD.forEach(
			snapshot => new SystemMessage(systemMessages.SANITY_SNAPSHOT_WITHOUT_METADATA).addInfo(Entities.Volume.ID, snapshot._id).log()
		);

		cb(snapshotsWithoutMD);
	});
};

/**
 * Checks for Snapshots Metadata volume which their snapshot volume is missing.
 * @param  {callback} cb [Callback]
 */
scope.checkForSnapshotsMetadataWithNoData = function(cb) {
	const snapshotMetadataVolumeMatch = {
		type: consts.volumeTypes.METADATA_VOLUME
	};

	const snapshotsMetadataWithoutDataPipeline = [
		{
			$lookup: {
				from: 'volume',
				localField: 'snapshotID',
				foreignField: '_id',
				as: 'snapshotDataVolume'
			}
		},
		{
			$match: { snapshotDataVolume: { $size: 0 } }
		},
		{
			$project: {
				snapshotDataVolume: 0
			}
		}
	];

	getIncompleteSnapshots(snapshotMetadataVolumeMatch, snapshotsMetadataWithoutDataPipeline, (err, snapshotsMetadataWithoutData) => {
		if (err)
			return cb(err);

		snapshotsMetadataWithoutData.forEach(
			snapshot => new SystemMessage(systemMessages.SANITY_SNAPSHOT_METADATA_WITH_NO_DATA)
				.addInfo(Entities.Volume.ID, snapshot._id).addInfo(Entities.Volume.ID, snapshot.snapshotID).log()
		);

		cb(snapshotsMetadataWithoutData);
	});
};

scope.checkLastReservationVersionSentToTOMA = cb => {
	utils.loadCollection(
		'volume',
		{
			filter: { 'reservation.mode': consts.reservationModes.NONE },
			projection: { uuid: 1, reservation: 1, lastReservationVersionSentToTomaByTargetVersion: 1, 'chunks.pRaids.zone': 1 }
		},
		(err, volumes) => {
			if (err)
				return cb(err);

			if (!volumes.length)
				return cb();

			const db = app.get('db');
			const serverCollection = db.collection('server');
			const pipeline = [
				{ $project: { _id: 0, featureCompatibilityVersion: 1 } },
				{ $group: { _id: '$_id', featureCompatibilityVersions: { $addToSet: '$featureCompatibilityVersion' } } }
			  ];

			serverCollection.aggregate(pipeline).toArray((err, res) => {
				if (err)
					return cb(new MongoError(err).log());

				const currentTargetCompatibilityVersions = res?.length ? res[0].featureCompatibilityVersions : [];

				const volumesWithRVMismatch = volumes.filter(volume => {
					const { lastReservationVersionSentToTomaByTargetVersion = {} } = volume;
					const sentTargetCompatibilityVersions = Object.keys(lastReservationVersionSentToTomaByTargetVersion);

					// If no target compatibility version exist, no mismatch exists.
					if (sentTargetCompatibilityVersions.length === 0)
						return false;

					const sentVolumeReservationVersion = lastReservationVersionSentToTomaByTargetVersion[sentTargetCompatibilityVersions[0]];

					return (
					  // Mismatch between last sent reservation version and current volume reservation version
					  (sentVolumeReservationVersion && sentVolumeReservationVersion !== volume.reservation.version) ||
					  // Case where messages were sent during upgrade and PART of those messages were sent to different target compatibility versions
					  (sentTargetCompatibilityVersions.length > 1) ||
					  // Case where messages were sent during upgrade and ALL of those messages where sent to old target compatibility version
					  (currentTargetCompatibilityVersions.length === 1 && !sentTargetCompatibilityVersions.includes(currentTargetCompatibilityVersions[0]))
					);
				});

				if (!volumesWithRVMismatch.length)
					return cb();

				clientModule.sendReservationModeChangeMessageToAllTargets(volumesWithRVMismatch, cb);
			});
		});
};

function getAttachDetachRecoveryPipeline() {
	const getFilter = isAttach => {
		const clientInAttachedClientsCond = {
			$in: ['$_id', '$$attachment.volume.reservation.attachedClients']
		};
		const pendingReservationModeMatchVolumeReservationMode = {
			$eq: ['$$attachment.pending.reservation.mode', '$$attachment.volume.reservation.mode']
		};

		const completedReservationCond = isAttach ?
			[
				clientInAttachedClientsCond,
				pendingReservationModeMatchVolumeReservationMode
			] :
			[
				{ $not: clientInAttachedClientsCond },
			];

		return {
			$filter: {
				input: '$pendingAttachments',
				as: 'attachment',
				cond: { $and: [
					{ $ifNull: ['$$attachment.volume.reservation.attachedClients', false] },
					{ $eq: ['$$attachment.pending.action', isAttach ? consts.volumeAttachmentActions.ATTACHING : consts.volumeAttachmentActions.DETACHING] },
					...completedReservationCond,
				] }
			}
		};
	};
	const getAttachingFilter = () => getFilter(true);
	const getDetachingFilter = () => getFilter(false);

	return [
		{
			$match: {
				'attachments': { $exists: true }
			}
		},
		{
			$addFields: {
				attachmentsArr: { $objectToArray: '$attachments' }
			}
		},
		{
			$addFields: {
				attachmentsArr: {
					$filter: {
						input: '$attachmentsArr',
						as: 'attachment',
						cond: { $ifNull: ['$$attachment.v.pending', false] }
					}
				}
			}
		},
		{
			$match: {
				$expr: { $gt: [{ $size: '$attachmentsArr' }, 0] }
			}
		},
		{
			$project: { attachmentsArr: 1 }
		},
		{
			$unwind: '$attachmentsArr'
		},
		{
			$lookup: {
				from: 'volume',
				localField: 'attachmentsArr.k',
				foreignField: 'uuid',
				as: 'volume'
			}
		},
		{
			$addFields: {
				'attachmentsArr.v.volume': { $arrayElemAt: ['$volume', 0] }
			}
		},
		{
			$group: {
				_id: '$_id',
				pendingAttachments: { $push: '$attachmentsArr.v' }
			}
		},
		{
			$addFields: {
				pendingAttachingCompletedReservation: getAttachingFilter()
			}
		},
		{
			$addFields: {
				pendingDetachingCompletedReservation: getDetachingFilter()
			}
		}
	];
}

function getRecoverPendingAttachmentsUpdatePipeline(pendingAttachmentsUUID, pendingAttachingCompletedReservation, pendingDetachingCompletedReservation) {
	let updatePipeline = [];
	const pendingAttachingCompletedReservationUUIDs = pendingAttachingCompletedReservation.map(attachment => attachment.uuid);
	pendingAttachmentsUUID[consts.volumeAttachmentActions.ATTACHING] = pendingAttachmentsUUID[consts.volumeAttachmentActions.ATTACHING]
		.filter(uuid => !pendingAttachingCompletedReservationUUIDs.includes(uuid));

	// clear pending
	if (pendingAttachmentsUUID[consts.volumeAttachmentActions.ATTACHING].length)
		updatePipeline = updatePipeline.concat(
			clientModule.getClearWishfulStatePendingAttachAttachmentsPipeline(
				pendingAttachmentsUUID[consts.volumeAttachmentActions.ATTACHING]
			)
		);

	if (pendingAttachmentsUUID[consts.volumeAttachmentActions.DETACHING].length)
		updatePipeline.push(
			{
				$unset: pendingAttachmentsUUID[consts.volumeAttachmentActions.DETACHING]
					.map(attachmentUUID => `attachments.${attachmentUUID}.pending`)
			}
		);

	// inc attachmentsVersion
	updatePipeline.push(
		{ $set: {
			attachmentsVersion: {
				$add: [
					'$attachmentsVersion',
					pendingDetachingCompletedReservation.length + pendingAttachingCompletedReservation.length
				]
			}
		} }
	);

	// update wishful state action for pending attachments which completed the reservation, save refIDs
	const attachingReferenceIDs = {};
	pendingAttachingCompletedReservation = pendingAttachingCompletedReservation.map(attachment => {
		let attachmentForDB = { ...attachment, ...attachment.pending };
		attachmentForDB.reservation.version = attachmentForDB.volume.reservation.version;
		attachingReferenceIDs[attachment.uuid] = attachmentForDB.referenceID;

		delete attachmentForDB.volume;
		delete attachmentForDB.handledBy;
		delete attachmentForDB.referenceID;

		return attachmentForDB;
	});

	if (pendingAttachingCompletedReservation.length) {
		const update = clientModule.getAttachUpdate(pendingAttachingCompletedReservation, attachingReferenceIDs);
		updatePipeline = updatePipeline.concat(
			[
				{ $set: update.setAttachments },
				{ $set: update.addRefIdToAttachments },
				{ $set: update.incAttachedAttachmentsVersion },
				{ $unset: update.unsetPendingAttachments }
			]
		);
	}

	// update wishful state action for pending detachments which completed the reservation,
	if (pendingDetachingCompletedReservation.length)
		updatePipeline = updatePipeline.concat(
			pendingDetachingCompletedReservation
				.map(detachment => {
					return clientModule.getDetachUpdateForAttachment(detachment, detachment.pending.referenceID);
				})
				.flatMap(detachUpdate => (
					[
						{ $set: detachUpdate.filterDetachedReferenceID },
						{ $set: detachUpdate.setDetachments },
						{ $set: detachUpdate.incDetachmentVersion },
						{ $unset: detachUpdate.unsetPendingDetachments }
					]
				))
		);

	return updatePipeline;
}

// Get all pending attachments
// If reservation not updated then remove the pending else remove pending and set wishful action
// Get clients that were preempted by an attach and detach them
scope.checkPendingAttachments = callback => {
	const db = app.get('db');
	const clientCollection = db.collection('client');

	let preemptedAttachments = {};
	let clientsWithAttachmentsForPotentialDetach = [];
	async.series([
		function recoverPendingAttachments(cb) {
			const pendingAttachDetachPipeline = getAttachDetachRecoveryPipeline();

			clientCollection.aggregate(pendingAttachDetachPipeline).toArray((err, clients) => {
				if (err)
					return cb(err);

				async.each(clients, (client, nextClient) => {
					async.waterfall([
						// we do this step to verify that we are not removing a pending attachment set by a mgmt which is alive
						function categorizeAttachments(callback) {
							const handledByGetter = attachment => attachment.pending.handledBy;

							categorizeStaleEntities(
								client.pendingAttachments,
								(pendingAttachmentsToDeleteCreatedByThisMgmt, pendingAttachmentsToDeleteCreatedByOtherMgmt) => {
									const pendingAttachments = pendingAttachmentsToDeleteCreatedByThisMgmt.concat(pendingAttachmentsToDeleteCreatedByOtherMgmt);
									const pendingAttachmentsUUIDs = pendingAttachments.map(pendingAttachment => pendingAttachment.uuid);
									const isStaleAttachment = attachment => pendingAttachmentsUUIDs.includes(attachment.uuid);

									const pendingAttachingCompletedReservation = client.pendingAttachingCompletedReservation.filter(isStaleAttachment);
									const pendingDetachingCompletedReservation = client.pendingDetachingCompletedReservation.filter(isStaleAttachment);

									// collect preempted attachments with isDetachOthers = true
									pendingAttachingCompletedReservation.forEach(attachment => {
										const pendingReservation = attachment.pending.reservation;

										if (pendingReservation.preempt === consts.reservationModePreempts.PREEMPT && pendingReservation.isDetachOthers)
											preemptedAttachments[attachment.uuid] = {
												uuid: attachment.uuid,
												preemptingReservationVersion: attachment.volume.reservation.version
											};
									});

									callback(null, pendingAttachments, pendingAttachingCompletedReservation, pendingDetachingCompletedReservation);
								},
								handledByGetter
							);
						},
						function updateClient(pendingAttachments, pendingAttachingCompletedReservation, pendingDetachingCompletedReservation, callback) {
							const shouldUpdate = pendingAttachments.length;
							const shouldResendAttachDetachMessages = pendingAttachingCompletedReservation.length || pendingDetachingCompletedReservation.length;

							if (!shouldUpdate)
								return callback(null, shouldResendAttachDetachMessages, null);

							let pendingAttachmentsUUID = { [consts.volumeAttachmentActions.ATTACHING]: [], [consts.volumeAttachmentActions.DETACHING]: [] };
							pendingAttachments.forEach(attachment => pendingAttachmentsUUID[attachment.pending.action].push(attachment.uuid));

							const updatePipeline = getRecoverPendingAttachmentsUpdatePipeline(
								pendingAttachmentsUUID,
								pendingAttachingCompletedReservation,
								pendingDetachingCompletedReservation
							);

							logger.sysDEBUG(`SanityAndRecover: updating client ${client._id} pending attachments ${pendingAttachments.map(a=>a.name)}`);

							// we don't check again the handledBy match since this attachments are under a pending lock
							// meaning that if we determined that an attachment can be modified it will not change in the mean time
							clientCollection.findOneAndUpdate(
								{ _id: client._id },
								updatePipeline,
								{ returnDocument: consts.mongoReturnDocument.AFTER },
								(err, dbClient) => {
									if (err)
										err = new MongoError(err);
									else if (!dbClient)
										err = new SystemMessage(systemMessages.CLIENT_NOT_FOUND).addInfo(Entities.Client.ID, client._id);

									if (err)
										err.log();

									callback(err, shouldResendAttachDetachMessages, dbClient);
								});
						},
						function resendAttachDetach(shouldResendAttachDetachMessages, dbClient, callback) {
							if (!shouldResendAttachDetachMessages)
								return callback();

							clientModule.resendClientAttachDetachCommands(dbClient, callback);
						}
					], nextClient);
				}, cb);
			});
		},
		function getPreemptedClients(cb) {
			if (utils.isEmpty(preemptedAttachments))
				return cb(true);

			clientModule.getPreemptedClientsByAttachments(preemptedAttachments, preemptedClients => {
				clientsWithAttachmentsForPotentialDetach = preemptedClients;
				cb();
			});
		},
		function detachClients(cb) {
			if (!clientsWithAttachmentsForPotentialDetach.length)
				return cb();

			clientModule.detachPreemptedClients(clientsWithAttachmentsForPotentialDetach, cb);
		}
	], () => {
		callback();
	});
};

scope.checkAndRecoverNodeConfiguration = function(cb) {
	// verify for each nodeConfiguration
	// 1. profile exists -> if not apply default
	// 2. profile version is latest -> if not update to latest version

	const db = app.get('db');
	const nodeConfigCollection = db.collection('nodeConfiguration');

	utils.loadCollection('configurationProfile', {}, (err, profilesArray) => {
		if (err)
			return cb(err);

		let profilesDict = {};
		profilesArray.forEach(p => profilesDict[p.uuid] = p);

		let defaultProfile = profilesArray.find(p => p.name == 'Cluster Default');

		function applyClusterDefault(nodeID, callback) {
			let defaultProfileAssign = {
				id: defaultProfile.uuid,
				name: defaultProfile.name,
				version: defaultProfile.version
			};

			nodeConfigCollection.updateOne({ _id: nodeID }, { $set: { 'desiredProfile': defaultProfileAssign } }, callback);
		}

		utils.loadCollection('nodeConfiguration', {}, (err, nodeConfigs) => {
			if (err)
				return cb(err);

			async.eachSeries(nodeConfigs, (nodeConfig, eachCB) => {
				let desProfile = nodeConfig.desiredProfile;
				if (!desProfile) {
					new SystemMessage(systemMessages.SANITY_NODE_CONFIG_PROFILE_NOT_FOUND)
						.addInfo(Entities.ConfigurationNode.ID, nodeConfig._id)
						.addInfo(Entities.ConfigurationProfile.name, desProfile)
						.log();
					return applyClusterDefault(nodeConfig._id, eachCB);
				}


				if (!profilesDict[desProfile.id]) {
					// nodeConfig with profile that was removed
					new SystemMessage(systemMessages.SANITY_NODE_CONFIG_PROFILE_NOT_FOUND)
						.addInfo(Entities.ConfigurationNode.ID, nodeConfig._id)
						.addInfo(Entities.ConfigurationProfile.name, desProfile.name)
						.addInfo(Entities.ConfigurationProfile.UUID, desProfile.id)
						.log();
					return applyClusterDefault(nodeConfig._id, eachCB);
				}

				if (profilesDict[desProfile.id].version != desProfile.version) {
					// The profile was updated to a newer version -> update nodeConfig -> keep alive will trigger the update
					new SystemMessage(systemMessages.SANITY_NODE_CONFIG_PROFLIE_VERSION_NOT_UPDATED)
						.addInfo(Entities.ConfigurationNode.ID, nodeConfig._id)
						.addInfo(Entities.ConfigurationProfile.name, desProfile.name)
						.addInfo(Entities.ConfigurationProfile.UUID, desProfile.id)
						.addInfo(Entities.ConfigurationProfile.version, desProfile.version)
						.addInfo(Entities.ConfigurationProfile.version, profilesDict[desProfile.id].version)
						.log();

					return nodeConfigCollection.updateOne(
						{ _id: nodeConfig._id },
						{ $set: { 'desiredProfile.version': profilesDict[desProfile.id].version } },
						eachCB);
				}

				eachCB();
			}, err => {
				cb(err);
			});
		});
	});
};

scope.checkLastEmulationAttachmentsVersionSentToClient = cb => {
	const db = app.get('db');
	const clientCollection = db.collection('client');

	clientCollection.find({ isUmClient: 1 }, { attachments: 1, clientOriginID: 1, topics: 1 }).toArray((err, umClients) => {
		if (err) {
			new MongoError(err).log();
			return cb(err);
		}

		async.each(umClients, (umClient, nextClient) => {
			const wishfulStateAttachments = Object.values(umClient.attachments);
			if (!wishfulStateAttachments.length)
				return nextClient();

			const currentTopicName = umClient.topics[consts.topicSuffix.CLIENT_MAIN];
			const attachmentsForUpdateEmulationMessage = wishfulStateAttachments
				.filter(attachment => attachment.lastMessageSentToClient &&
					(attachment.lastMessageSentToClient.version < attachment.version ||
							attachment.lastMessageSentToClient.topic !== currentTopicName));

			if (!attachmentsForUpdateEmulationMessage.length)
				return nextClient();

			clientModule.sendUpdateVolumeEmulationMessagesToClient(umClient, attachmentsForUpdateEmulationMessage, (err) => {
				if (err) {
					new SystemAdminMessage(systemMessages.FAILED_UPDATE_EMULATION).addInfo(Entities.Client.ID, umClient._id).log();
					return nextClient();
				}

				clientModule.updateLastMessageSentToClient(umClient, currentTopicName, attachmentsForUpdateEmulationMessage, nextClient);
			});
		}, cb);
	});
};

// this code should only run and exists on 3.4.0
scope.addAvailableSpaceZoneRankingCriteriaToDB = (cb) => {
	var db = app.get('db');
	var globalSettingsCollection = db.collection('globalSettings');

	globalSettingsCollection.updateOne(
		{ 'zoneRanking.criterias.availableSpace': { $exists: 0 } },
		{ $set: { 'zoneRanking.criterias.availableSpace': 100 }, $inc: { version: 1 } },
		(err, result) => {
			if (err) {
				new MongoError(err).log();
			} else if (result.modifiedCount) {
				events.emitEvent(null, objectNotifier.events.generalSettingsChangeEvent);
			}

			cb(err);
		}
	);
};

// Look for volume segments that were not updated after disk eviction and fix it
scope.checkForNotUpdatedVolumesAfterEvict = (callback) => {
	const db = app.get('db');
	const serverCollection = db.collection('server');
	const validDiskSegmentStatusesAfterEvict = [consts.diskSegmentStatuses.REMAP, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD];

	// This pipeline find evicted disks with:
	// 1. volume segments that are not in validDiskSegmentStatusesAfterEvict
	// 2. volume segments from volumes that are marked for deletion
	// Expected results structure will look like this:
	// [{
	// 		zone: '1',
	// 		disks: [{
	// 			_id: 'diskID',
	// 			serverDisk: {<disk from server collection>},
	// 			volumeDiskSegments: { withInvalidStatuses: ['uuid1'], toDeprecate: [{id: 'uuid2', volType: 'data', pRaidUUID: 'uuid3'}] }
	// 		}]
	// 	}]
	const pipeline = [
		{ $match: { 'disks.isOutOfService': true } },
		// keep only isOutOfService disks to avoid unnecessary unwinds
		{ $project: { disks: { $filter: { input: '$disks', as: 'disk', cond: { $eq: ['$$disk.isOutOfService', true] } } } } },
		{ $unwind: '$disks' },
		{ $addFields: { serverDisk: '$disks' } },
		{ $unwind: '$disks.diskSegments' },
		{ $match: { 'disks.diskSegments.type': consts.segmentTypes.DATA } },
		{
			$lookup: {
				from: 'volume',
				let: { volumeID: '$disks.diskSegments.volumeName', diskSegmentID: '$disks.diskSegments._id' },
				pipeline: [
					{ $match: { $expr: { $eq: ['$_id', '$$volumeID'] } } },
					{ $project: { 'chunks.pRaids.diskSegments': 1, action: 1, type: 1 } },
					{ $unwind: '$chunks' },
					{ $unwind: '$chunks.pRaids' },
					{ $unwind: '$chunks.pRaids.diskSegments' },
					{ $match: { $expr: { $eq: ['$chunks.pRaids.diskSegments._id', '$$diskSegmentID'] } } },
					{
						$project: {
							segmentData: {
								_id: '$chunks.pRaids.diskSegments._id',
								pRaidUUID: '$chunks.pRaids.diskSegments.pRaidUUID',
								volType: '$type'
							},
							isInvalid: { $not: { $in: ['$chunks.pRaids.diskSegments.status', validDiskSegmentStatusesAfterEvict] } },
							isDeprecate: { $eq: ['$action', consts.volumeActions.MARKED_FOR_DELETION] }
						}
					},
					// keep only results that requires update
					{ $match: { $or: [{ isInvalid: true }, { isDeprecate: true }] } }
				],
				as: 'volumeLookupResult'
			}
		},
		{ $unwind: '$volumeLookupResult' },
		// group by diskID
		{
			$group: {
				_id: '$serverDisk.diskID',
				serverDisk: { $first: '$serverDisk' },
				zone: { $first: '$disks.diskSegments.zone' },
				// push only segment IDs with invalid status to match format of diskModule.updateVolumesAfterEvict
				withInvalidStatuses: { $push: { $cond: ['$volumeLookupResult.isInvalid', '$volumeLookupResult.segmentData._id', '$$REMOVE'] } },
				// push segment data to deprecate to match format of volumeModule.deprecateSegments
				toDeprecate: {
					$push: {
						$cond: [
							'$volumeLookupResult.isDeprecate',
							{
								id: '$volumeLookupResult.segmentData._id',
								volType: '$volumeLookupResult.segmentData.volType',
								pRaidUUID: '$volumeLookupResult.segmentData.pRaidUUID'
							},
							'$$REMOVE'
						]
					}
				}
			}
		},
		// group by zone
		{
			$group: {
				_id: '$zone',
				disks: {
					$push: {
						_id: '$_id',
						serverDisk: '$serverDisk',
						volumeDiskSegments: { withInvalidStatuses: '$withInvalidStatuses', toDeprecate: '$toDeprecate' }
					}
				}
			}
		},
		{ $project: { _id: 0, zone: '$_id', disks: 1 } }
	];

	serverCollection.aggregate(pipeline).toArray((err, disksByZones) => {
		if (err)
			return callback(new MongoError(err).log());

		async.eachSeries(disksByZones, (disksByZone, nextDisksByZone) => {
			const { zone, disks } = disksByZone;

			logger.sysDEBUG(`Found ${disks.length} evicted disks with volume in zone ${zone} that need to be updated`);

			async.series([
				cb => lockModule.acquireLockByZone(zone, cb),
				cb => {
					async.eachSeries(disks, (disk, nextDisk) => {
						const { _id, serverDisk, volumeDiskSegments } = disk;
						const { withInvalidStatuses, toDeprecate } = volumeDiskSegments;

						logger.sysDEBUG(`Disk ${_id} in zone ${zone} has ${withInvalidStatuses.length} segments `
							+ `with invalid statuses and ${toDeprecate.length} segments to deprecate`);

						async.series([
							(cb) => {
								if (!withInvalidStatuses || !withInvalidStatuses.length)
									return cb();

								withInvalidStatuses.reduce(
									(acc, segmentUUID) => acc.addInfo(Entities.DiskSegment.UUID, segmentUUID),
									new SystemAdminMessage(systemMessages.SANITY_SEGMENTS_WITH_INVALID_STATUS_FOUND)
										.addInfo(Entities.Drive.ID, _id)
										.addInfo(Entities.Target.zone, zone)).log();

								diskModule.updateVolumesAfterEvict(serverDisk, withInvalidStatuses, new Set([zone]), () => cb());
							},
							(cb) => {
								if (!toDeprecate || !toDeprecate.length)
									return cb();

								toDeprecate.reduce(
									(acc, segment) => acc
										.addInfo(Entities.DiskSegment.UUID, segment.id)
										.addInfo(Entities.Volume.type, segment.volType)
										.addInfo(Entities.PRaid.UUID, segment.pRaidUUID),
									new SystemAdminMessage(systemMessages.SANITY_SEGMENTS_TO_DEPRECATE_FOUND)
										.addInfo(Entities.Drive.ID, _id)
										.addInfo(Entities.Target.zone, zone)).log();

								volumeModule.deprecateSegments(toDeprecate, zone, consts.SYSTEM_USER, cb);
							},
						], nextDisk);
					}, cb);
				}
			], err => lockModule.releaseLockByZone(zone, () => nextDisksByZone(err)));
		}, callback);
	});
};

module.exports = scope;
