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
var encryptionModule = require('./volumeEncryption.js');
var config = require('./config.js');
var { Entities, Differentiators, SystemMessage, SystemAdminMessage, MongoError, getDriveID } = require('./error.js');
var { AddVolume } = require('../models/kafkaMessages/AddVolume');
var { DeleteVolume } = require('../models/kafkaMessages/DeleteVolume');
var { UpdateVolume } = require('../models/kafkaMessages/UpdateVolume');
var systemMessages = require('../systemMessages.js');

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
		scope.checkAndRemovePendingUpgrades,
		scope.checkAndRemovePendingVolumes,
		scope.checkAndRemoveToBeExtendedVolumes,
		scope.checkAndResumeStuckReinstate,
		scope.checkAndRemoveOrphanDiskSegments,
		scope.checkAndRecoverReclaimingReservedVolumes,
		scope.checkVPGReservedVolumeCapacitySync,
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
		scope.checkLastUpdateReferenceIDsSentToClient,
		scope.checkAndResumeStuckUpgrades,
		scope.checkForResendReport,
		scope.verifySegmentStatusAfterEvict
	], err => {
		if (err)
			logger.sysDEBUG(`Sanity and Recover encountered an error: ${err}`);

		const duration = new Date() - startTime;
		logger.sysDEBUG(`Sanity and Recover finished after ${duration / 1000} seconds`);

		cb();
	});
};

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
		// Deduplicate by LBA range: reinstate twin pairs (Phase 1: PENDING+OLD, Phase 2: MFR+OLD)
		// share the same LBA range — collapsing them here ensures each range is counted only once.
		{ $group: {
			_id: { diskID: '$diskID', lbs: '$diskSegments.lbs', lbe: '$diskSegments.lbe' },
			diskID: { $first: '$diskID' },
			node_id: { $first: '$node_id' },
			usableBlocks: { $first: '$usableBlocks' },
			lbs: { $first: '$diskSegments.lbs' },
			lbe: { $first: '$diskSegments.lbe' }
		} },
		{ $project: {
			diskID: 1,
			node_id: 1,
			usableBlocks: 1,
			segBlocks: { $add: [1, { $subtract: ['$lbe', '$lbs'] }] }
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
		},
		function checkForMissingZonesHardwareConfiguration(callback) {
			zoneModule.resendMissingZonesHardwareConfiguration(callback);
		},
		function checkForFailedToSendUpdateTargetsNICs(callback) {
			const db = app.get('db');
			const clientCollection = db.collection('client');

			clientCollection.find({ 'failedToSendUpdateTargetsNICs': true }).toArray((err, clients) => {
				if (err) {
					new MongoError(err).log();
					return callback(err);
				}
				async.eachSeries(clients, (client, eachCB) => {
					clientModule.resendFailedToSendUpdateTargetsNICs(client, eachCB);
				}, callback);
			});
		},
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
1. Created by the current management in a previous boot or by another management in previous boot.
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

		const isCreatedByOtherDeadMgmt = handledBy =>
			managementsState[handledBy.managementId] === undefined ||
			managementsState[handledBy.managementId].status === consts.managementStatuses.DOWN &&
			managementsState[handledBy.managementId].bootVersion === handledBy.bootVersion;

		const isCreatedByOtherMgmtInPrevBoot = handledBy =>
			managementsState[handledBy.managementId].bootVersion > handledBy.bootVersion;

		let entitiesToDeleteCreatedByThisMgmt = [];
		let entitiesToDeleteCreatedByOtherDeadMgmt = [];
		let entitiesToDeleteCreatedByOtherMgmtInPrevBoot = [];

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
			else if (isCreatedByOtherDeadMgmt(handledBy))
				entitiesToDeleteCreatedByOtherDeadMgmt.push(entity);
			else if (isCreatedByOtherMgmtInPrevBoot(handledBy))
				entitiesToDeleteCreatedByOtherMgmtInPrevBoot.push(entity);
		});

		const entitiesToDeleteCreatedByMgmtInPrevBoot = [...entitiesToDeleteCreatedByThisMgmt, ...entitiesToDeleteCreatedByOtherMgmtInPrevBoot];
		cb(entitiesToDeleteCreatedByMgmtInPrevBoot, entitiesToDeleteCreatedByOtherDeadMgmt);
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
				(upgradesToDeleteCreatedByMgmtInPrevBoot, upgradesToDeleteCreatedByOtherDeadMgmt) => {
					callback(null, upgradesToDeleteCreatedByMgmtInPrevBoot, upgradesToDeleteCreatedByOtherDeadMgmt);
				});
		},
		function deletePendingUpgrades(
			upgradesToDeleteCreatedByMgmtInPrevBoot,
			upgradesToDeleteCreatedByOtherDeadMgmt,
			callback
		) {
			const defaultQuery = upgrade => ({ _id: upgrade._id, isPending: true });
			const query = getStaleEntitiesQuery(
				defaultQuery,
				upgradesToDeleteCreatedByMgmtInPrevBoot,
				upgradesToDeleteCreatedByOtherDeadMgmt
			);

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
	], () => cb());
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
				(confVersionsCreatedByMgmtInPrevBoot, confVersionsCreatedByOtherDeadMgmt) => {
					callback(null, confVersionsCreatedByMgmtInPrevBoot, confVersionsCreatedByOtherDeadMgmt);
				},
				getHandledBy);
		},
		function getStaleConfVersion(confVersionsCreatedByMgmtInPrevBoot, confVersionsCreatedByOtherDeadMgmt, callback) {
			const defaultQuery = confVersion => ({ _id: confVersion._id, runningUpgrade: { $exists: true } });
			const getHandledBy = entity => entity.runningUpgrade.createdBy;
			const query = getStaleEntitiesQuery(
				defaultQuery, confVersionsCreatedByMgmtInPrevBoot, confVersionsCreatedByOtherDeadMgmt,
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
				(volumesToDeleteCreatedByMgmtInPrevBoot, volumesToDeleteCreatedByOtherDeadMgmt) => {
					callback(null, volumesToDeleteCreatedByMgmtInPrevBoot, volumesToDeleteCreatedByOtherDeadMgmt);
				});
		},
		function deletePendingVolumes(
			volumesToDeleteCreatedByMgmtInPrevBoot,
			volumesToDeleteCreatedByOtherDeadMgmt,
			callback
		) {
			const defaultQuery = volume => ({
				uuid: volume.uuid,
				status: consts.volumeStatuses.PENDING
			});

			const query = getStaleEntitiesQuery(
				defaultQuery,
				volumesToDeleteCreatedByMgmtInPrevBoot,
				volumesToDeleteCreatedByOtherDeadMgmt
			);

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

function getStaleEntitiesQuery(
	defaultQuery,
	entitiesToDeleteCreatedByMgmtInPrevBoot,
	entitiesToDeleteCreatedByOtherDeadMgmt,
	handledByPath = 'handledBy',
	getHandledBy = entity => entity.handledBy) {
	if (!entitiesToDeleteCreatedByMgmtInPrevBoot.length && !entitiesToDeleteCreatedByOtherDeadMgmt.length)
		return null;

	const matchHandledBy = entity => {
		const handledBy = getHandledBy(entity);
		return {
			[`${handledByPath}.managementId`]: handledBy.managementId,
			[`${handledByPath}.bootVersion`]: handledBy.bootVersion
		};
	};

	const queryForEntityCreatedByMgmtInPrevBoot = entity => ({
		...defaultQuery(entity),
		...matchHandledBy(entity)
	});

	const queryForEntityCreatedByOtherDeadMgmt = entity => ({
		...queryForEntityCreatedByMgmtInPrevBoot(entity),
		...getMongoTimeoutQuery()
	});

	return {
		$or: entitiesToDeleteCreatedByMgmtInPrevBoot
			.map(queryForEntityCreatedByMgmtInPrevBoot)
			.concat(entitiesToDeleteCreatedByOtherDeadMgmt.map(queryForEntityCreatedByOtherDeadMgmt))
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
						(volumesToDeleteCreatedByMgmtInPrevBoot, volumesToDeleteCreatedByOtherDeadMgmt) => {
							callback(
								null,
								volumesToDeleteCreatedByMgmtInPrevBoot,
								volumesToDeleteCreatedByOtherDeadMgmt
							);
						});
				},
				function deleteExtentionVolumes(
					volumesToDeleteCreatedByMgmtInPrevBoot,
					volumesToDeleteCreatedByOtherDeadMgmt,
					callback
				) {
					const defaultQuery = volume => ({
						uuid: volume.uuid,
						isExtension: true
					});

					const query = getStaleEntitiesQuery(
						defaultQuery,
						volumesToDeleteCreatedByMgmtInPrevBoot,
						volumesToDeleteCreatedByOtherDeadMgmt
					);

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
			if (!zone)
				return callback(new SystemMessage(systemMessages.SANITY_AUTO_REMOVE_IS_EXTENSION_SEGMENT_FAILED)
					.addInfo(Entities.Error, 'No zone found for diskSegment')
					.addInfo(Entities.DiskSegment.UUID, diskSegmentsToRemove[0].uuid)
					.log());

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

				const firstDS = firstSegment['chunks']['pRaids']['diskSegments'];
				const secondDS = secondSegment['chunks']['pRaids']['diskSegments'];

				if (firstDS.diskID === secondDS.diskID)
					if (isFollowingSegmentsOverlapping(firstDS, secondDS) && !utils.areReinstateTwinSegments(firstDS, secondDS)) {
						let err = new SystemAdminMessage(systemMessages.SANITY_OVERLAPPING_SEGMENTS)
							.addInfo(Entities.DiskSegment.UUID, firstDS.uuid, Differentiators.First)
							.addInfo(Entities.DiskSegment.UUID, secondDS.uuid, Differentiators.Second)
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

	const allDiskSegments = disk.diskSegments || [];
	const nvmeshDataSegments = allDiskSegments
		.filter(filterDataOnly)
		.filter(seg => !utils.isReinstateReplacementSegment(seg, allDiskSegments));
	const totalSegmentsBlocks = nvmeshDataSegments.map(mapSegmentBlockSize).reduce(sum, 0);
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
				(volumesToDeleteCreatedByMgmtInPrevBoot, volumesToDeleteCreatedByOtherDeadMgmt) => {
					callback(
						null,
						volumesToDeleteCreatedByMgmtInPrevBoot,
						volumesToDeleteCreatedByOtherDeadMgmt
					);
				});
		},
		function getStaleIncompleteSnapshots(
			volumesToDeleteCreatedByMgmtInPrevBoot,
			volumesToDeleteCreatedByOtherDeadMgmt,
			callback
		) {
			const defaultQuery = volume => ({
				uuid: volume.uuid,
				...initialMatchQuery
			});

			const query = getStaleEntitiesQuery(
				defaultQuery,
				volumesToDeleteCreatedByMgmtInPrevBoot,
				volumesToDeleteCreatedByOtherDeadMgmt
			);

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
						{ $set: detachUpdate.setUpdateRefIDsMarker },
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
								(
									pendingAttachmentsToDeleteCreatedByMgmtInPrevBoot,
									pendingAttachmentsToDeleteCreatedByOtherDeadMgmt
								) => {
									const pendingAttachments = pendingAttachmentsToDeleteCreatedByMgmtInPrevBoot
										.concat(pendingAttachmentsToDeleteCreatedByOtherDeadMgmt);
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

function checkAndResendStaleMessagesToClients({ clientQuery, projection, getTracker, resend }, cb) {
	const db = app.get('db');
	const clientCollection = db.collection('client');

	clientCollection.find(clientQuery, { projection }).toArray((err, clients) => {
		if (err) {
			new MongoError(err).log();
			return cb(err);
		}

		async.each(clients, (client, nextClient) => {
			const currentTopicName = client.topics && client.topics[consts.topicSuffix.CLIENT_MAIN];
			if (!currentTopicName)
				return nextClient();

			const staleAttachments = Object.values(client.attachments || {}).filter(attachment => {
				const tracker = getTracker(attachment);
				if (!tracker)
					return false;

				return !tracker.version || tracker.version < attachment.version || tracker.topic !== currentTopicName;
			});

			if (!staleAttachments.length)
				return nextClient();

			resend(client, staleAttachments, currentTopicName, nextClient);
		}, cb);
	});
}

scope.checkLastEmulationAttachmentsVersionSentToClient = cb => {
	const msgType = consts.kafkaMessageTypes.ManagementToClient.updateVolumeEmulation;

	checkAndResendStaleMessagesToClients({
		clientQuery: { isUmClient: 1 },
		projection: { attachments: 1, clientOriginID: 1, topics: 1 },
		getTracker: attachment => {
			if (!attachment.lastMessageSentToClient)
				return null;

			return attachment.lastMessageSentToClient[msgType]
				// old flat format migration: lastMessageSentToClient = { version, topic }
				|| (attachment.lastMessageSentToClient.version !== undefined ? attachment.lastMessageSentToClient : null);
		},
		resend: (client, staleAttachments, currentTopicName, nextClient) => {
			logger.sysDEBUG(`SanityAndRecover: resending ${msgType} for client ${client._id}, `
				+ `${staleAttachments.length} attachment(s): ${staleAttachments.map(a => a.name)}`);

			async.each(staleAttachments, (attachment, nextAttachment) => {
				clientModule.sendUpdateVolumeEmulationToClient(client, attachment, err => {
					if (err)
						new SystemAdminMessage(systemMessages.FAILED_UPDATE_EMULATION).addInfo(Entities.Client.ID, client._id).log();

					nextAttachment();
				});
			}, nextClient);
		}
	}, cb);
};

scope.checkLastUpdateReferenceIDsSentToClient = cb => {
	const msgType = consts.kafkaMessageTypes.ManagementToClient.updateReferenceIDs;

	checkAndResendStaleMessagesToClients({
		clientQuery: { attachments: { $exists: true } },
		projection: { attachments: 1, clientOriginID: 1, topics: 1, clientID: 1, attachmentsVersion: 1 },
		getTracker: attachment => {
			return attachment.lastMessageSentToClient && attachment.lastMessageSentToClient[msgType];
		},
		resend: (client, staleAttachments, currentTopicName, nextClient) => {
			logger.sysDEBUG(`SanityAndRecover: resending ${msgType} for client ${client._id}, `
				+ `${staleAttachments.length} attachment(s): ${staleAttachments.map(a => a.name)}`);

			async.each(staleAttachments, (attachment, nextAttachment) => {
				clientModule.sendUpdateReferenceIDsToClient(client, attachment, client.clientOriginID, err => {
					if (err)
						err.log();

					nextAttachment();
				});
			}, nextClient);
		}
	}, cb);
};

const getVerifySegmentStatusAfterEvictByZonePipeline = (zone) => {
	const validDiskSegmentStatusesAfterEvict = [
		consts.diskSegmentStatuses.REMAP,
		consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD,
		consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING
	];
	const redundantRaidLevels = [
		consts.RAIDLevel.MIRRORED_RAID_1,
		consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10,
		consts.RAIDLevel.ERASURE_CODING,
		consts.RAIDLevel.STRIPED_ERASURE_CODING
	];

	const pipeline = [
		{ $match: { zone, 'disks.isOutOfService': true } },
		// keep only isOutOfService disks to avoid unnecessary unwinds and map only diskSegments that are data segments
		{
			$project: {
				disks: {
					$map: {
						input: { $filter: { input: '$disks', as: 'disk', cond: { $eq: ['$$disk.isOutOfService', true] } } },
						as: 'disk',
						in: {
							diskID: '$$disk.diskID',
							diskSegments: {
								$map: {
									input: {
										$filter: {
											input: '$$disk.diskSegments',
											as: 'segment',
											cond: { $eq: ['$$segment.type', consts.segmentTypes.DATA] }
										}
									},
									as: 'segment',
									in: { _id: '$$segment._id', volumeName: '$$segment.volumeName', zone: '$$segment.zone' }
								}
							}
						}
					}
				}
			}
		},
		{ $unwind: '$disks' },
		{ $addFields: { diskID: '$disks.diskID' } },
		// remove disks with no relevant segments
		{ $match: { $expr: { $gt: [{ $size: '$disks.diskSegments' }, 0] } } },
		{
			$lookup: {
				from: 'volume',
				let: { volumeNames: { $setUnion: ['$disks.diskSegments.volumeName', []] }, segmentIDs: '$disks.diskSegments._id' },
				pipeline: [
					{ $match: { $expr: { $in: ['$_id', '$$volumeNames'] } } },
					{
						$project: {
							// flatten chunks.pRaids.diskSegments and filter by segmentIDs
							relevantSegments: {
								$reduce: {
									input: '$chunks',
									initialValue: [],
									in: {
										$concatArrays: ['$$value', {
											$reduce: {
												input: '$$this.pRaids',
												initialValue: [],
												in: {
													$concatArrays: ['$$value', {
														$filter: {
															input: '$$this.diskSegments',
															as: 'ds',
															cond: { $in: ['$$ds._id', '$$segmentIDs'] }
														}
													}]
												}
											}
										}]
									}
								}
							},
							action: 1,
							type: 1,
							RAIDLevel: 1
						}
					},
					// keep only segments that requires update
					{
						$project: {
							processedSegments: {
								$filter: {
									input: {
										$map: {
											input: '$relevantSegments',
											as: 'seg',
											in: {
												$let: {
													vars: { isDeprecate: { $eq: ['$action', consts.volumeActions.MARKED_FOR_DELETION] } },
													in: {
														$let: {
															vars: {
																isInvalid: {
																	$and: [
																		{ $not: '$$isDeprecate' },
																		{ $not: { $in: ['$$seg.status', validDiskSegmentStatusesAfterEvict] } },
																		{ $in: ['$RAIDLevel', redundantRaidLevels] }
																	]
																}
															},
															in: { isInvalid: '$$isInvalid', isDeprecate: '$$isDeprecate', segmentData: '$$seg' }
														}
													}
												}
											}
										}
									},
									as: 'processedSegment',
									// keep only segments that requires update
									cond: { $or: ['$$processedSegment.isInvalid', '$$processedSegment.isDeprecate'] }
								}
							}
						}
					},
					// remove volumes with no segments to update
					{ $match: { $expr: { $gt: [{ $size: '$processedSegments' }, 0] } } }
				],
				as: 'volumeLookupResult'
			}
		},
		// remove disks where no updates are needed
		{ $match: { $expr: { $gt: [{ $size: '$volumeLookupResult' }, 0] } } },
		{
			$project: {
				diskID: 1,
				volumeDiskSegments: {
					$reduce: {
						input: '$volumeLookupResult',
						initialValue: { withInvalidStatuses: [], toDeprecate: [] },
						in: {
							withInvalidStatuses: {
								$concatArrays: [
									'$$value.withInvalidStatuses',
									{
										$map: {
											input: { $filter: { input: '$$this.processedSegments', as: 'seg', cond: '$$seg.isInvalid' } },
											as: 'item',
											in: '$$item.segmentData'
										}
									}
								]
							},
							toDeprecate: {
								$concatArrays: [
									'$$value.toDeprecate',
									{
										$map: {
											input: { $filter: { input: '$$this.processedSegments', as: 'seg', cond: '$$seg.isDeprecate' } },
											as: 'item',
											in: '$$item.segmentData'
										}
									}
								]
							}
						}
					}
				}
			}
		}
	];

	return pipeline;
};

// Look for volume segments that were not updated after disk eviction and fix it
scope.verifySegmentStatusAfterEvict = (callback) => {
	zoneModule.getZones([], (err, zones) => {
		if (err)
			return callback(err);

		const db = app.get('db');
		const serverCollection = db.collection('server');

		async.eachSeries(zones.map(zone => zone._id), (zone, nextZone) => {
			async.series([
				cb => lockModule.acquireLockByZone(zone, cb),
				cb => {
					const pipeline = getVerifySegmentStatusAfterEvictByZonePipeline(zone);

					serverCollection.aggregate(pipeline).toArray((err, disks) => {
						if (err)
							return cb(new MongoError(err).log());

						if (!disks.length)
							return cb();

						logger.sysDEBUG(`Handling ${disks.length} evicted disks with volume in zone ${zone} that need to be updated`);

						async.eachSeries(disks, (disk, nextDisk) => {
							const { diskID, volumeDiskSegments } = disk;
							const { withInvalidStatuses, toDeprecate } = volumeDiskSegments;

							logger.sysDEBUG(`Disk ${diskID} in zone ${zone} has ${withInvalidStatuses.length} segments `
								+ `with invalid statuses and ${toDeprecate.length} segments to deprecate`);

							async.series([
								(cb) => {
									if (!withInvalidStatuses || !withInvalidStatuses.length)
										return cb();

									const invalidStatusSegmentIDs = withInvalidStatuses.map(segment => segment._id);

									invalidStatusSegmentIDs.reduce(
										(acc, segmentID) => acc.addInfo(Entities.DiskSegment.UUID, segmentID),
										new SystemAdminMessage(systemMessages.SANITY_SEGMENTS_WITH_INVALID_STATUS_FOUND)
											.addInfo(Entities.Drive.ID, diskID)
											.addInfo(Entities.Target.zone, zone)).log();

									diskModule.updateVolumesAfterEvict(
										{ diskSegments: withInvalidStatuses },
										invalidStatusSegmentIDs,
										new Set([zone]),
										() => cb()
									);
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
											.addInfo(Entities.Drive.ID, diskID)
											.addInfo(Entities.Target.zone, zone)).log();

									volumeModule.deprecateSegments(toDeprecate, zone, consts.SYSTEM_USER, cb);
								},
							], nextDisk);
						}, cb);
					});
				}
			], err => lockModule.releaseLockByZone(zone, () => nextZone(err)));
		}, callback);
	});
};

// Recovers reserved volumes left in IN_PROGRESS or COMMITTING state by a crashed management.
// Path 1 (COMMITTING): volume was updated but pending disk changes weren't applied. Complete them.
// Path 2 (IN_PROGRESS): volume was NOT updated, disk has pending flags only. Roll back by clearing flags.
scope.checkAndRecoverReclaimingReservedVolumes = function(cb) {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');
	const serverCollection = db.collection('server');

	async.series([
		function commitPendingReclaims(callback) {
			findAndRecoverStaleVolumes(consts.reservedVolumeReclaimActions.COMMITTING, commitPendingForVPG, callback);
		},
		function rollbackPendingReclaims(callback) {
			findAndRecoverStaleVolumes(consts.reservedVolumeReclaimActions.IN_PROGRESS, rollbackPendingForVPG, callback);
		}
	], () => cb());

	function findAndRecoverStaleVolumes(reclaimAction, recoverFn, done) {
		async.waterfall([
			function findVolumes(callback) {
				volumeCollection.find(
					{ isReserved: true, reclaimAction },
					{ projection: { handledBy: 1, uuid: 1, _id: 1 } }
				).toArray((err, volumes) => {
					if (err)
						return callback(new MongoError(err).log());

					callback(null, volumes);
				});
			},
			function categorize(volumes, callback) {
				if (!volumes.length)
					return callback(true);

				categorizeStaleEntities(volumes,
					(byMgmtInPrevBoot, byOtherDeadMgmt) => {
						callback(null, byMgmtInPrevBoot, byOtherDeadMgmt);
					});
			},
			function buildQueryAndRecover(byMgmtInPrevBoot, byOtherDeadMgmt, callback) {
				const defaultQuery = volume => ({
					_id: volume._id,
					isReserved: true,
					reclaimAction
				});

				const query = getStaleEntitiesQuery(defaultQuery, byMgmtInPrevBoot, byOtherDeadMgmt);
				if (!query)
					return callback(true);

				volumeCollection.find(query).toArray((err, staleVolumes) => {
					if (err)
						return callback(new MongoError(err).log());

					if (!staleVolumes.length)
						return callback(true);

					async.eachSeries(staleVolumes, (volume, nextVolume) => {
						new SystemMessage(systemMessages.SANITY_RECLAIMING_RESERVED_VOLUME_FOUND)
							.addInfo(Entities.VPG.ID, volume._id).log();

						let zone;
						async.series([
							function acquireLock(next) {
								lockModule.acquireLockByVPG(volume._id, (err, lockedZone) => {
									if (err)
										return next(err);

									zone = lockedZone;
									next();
								});
							},
							function recover(next) {
								recoverFn(volume, next);
							}
						], (err) => {
							if (err && err !== true)
								new SystemMessage(systemMessages.SANITY_RECLAIMING_RESERVED_VOLUME_RECOVERY_FAILED)
									.addInfo(Entities.VPG.ID, volume._id)
									.addInfo(Entities.Error, err).log();


							lockModule.releaseLockByZone(zone, nextVolume);
						});
					}, callback);
				});
			}
		], () => done());
	}


	function commitPendingForVPG(reservedVolume, callback) {
		const vpgId = reservedVolume._id;
		serverCollection.aggregate([
			{ $unwind: '$disks' },
			{ $unwind: '$disks.diskSegments' },
			{ $match: { 'disks.diskSegments.pendingReclaim.vpgId': vpgId } },
			{ $project: { diskID: '$disks.diskID', diskSegment: '$disks.diskSegments' } }
		]).toArray((err, results) => {
			if (err)
				return callback(new MongoError(err).log());

			const steps = [];

			if (results.length) {
				const removalSegments = results
					.filter(r => r.diskSegment.pendingReclaim.type === consts.segmentPendingReclaimTypes.REMOVAL)
					.map(r => r.diskSegment);

				const replacementItems = results
					.filter(r => r.diskSegment.pendingReclaim.type === consts.segmentPendingReclaimTypes.REPLACE)
					.map(r => ({
						diskID: r.diskID,
						originalDiskSegmentID: r.diskSegment._id,
						replacements: r.diskSegment.pendingReclaim.replacements,
						freedBlocks: r.diskSegment.pendingReclaim.freedBlocks
					}));

				const affectedDiskIds = [...new Set(results.map(r => r.diskID))];

				steps.push(
					cb => utils.commitReclaimRemovals(removalSegments, cb),
					cb => utils.commitReclaimReplacements(replacementItems, cb),
					cb => utils.recalculateLargestSegmentForDisks(affectedDiskIds, cb)
				);
			}

			if (reservedVolume.reclaimUUIDMap)
				steps.push(cb => utils.updateReservedUUIDsOnDerivedVolumes(vpgId, reservedVolume.reclaimUUIDMap, cb));

			steps.push(cb => clearReclaimAction(vpgId, cb));

			async.series(steps, (err) => {
				if (!err)
					new SystemMessage(systemMessages.SANITY_RECLAIMING_RESERVED_VOLUME_RECOVERED)
						.addInfo(Entities.VPG.ID, vpgId).log();

				callback(err);
			});
		});
	}

	// Rollback pending flags for a VPG whose reserved volume was not yet updated (IN_PROGRESS)
	function rollbackPendingForVPG(reservedVolume, callback) {
		const vpgId = reservedVolume._id;
		async.series([
			function clearPendingFlags(cb) {
				// Find all segments with pending flags, then clear each one individually
				serverCollection.aggregate([
					{ $unwind: '$disks' },
					{ $unwind: '$disks.diskSegments' },
					{ $match: { 'disks.diskSegments.pendingReclaim.vpgId': vpgId } },
					{ $project: { diskID: '$disks.diskID', segmentId: '$disks.diskSegments._id' } }
				]).toArray((err, diskSegments) => {
					if (err)
						return cb(new MongoError(err).log());

					async.eachSeries(diskSegments, (diskSegment, next) => {
						serverCollection.updateOne(
							{ 'disks.diskID': diskSegment.diskID },
							{ $unset: { 'disks.$.diskSegments.$[seg].pendingReclaim': 1 } },
							{ arrayFilters: [{ 'seg._id': diskSegment.segmentId }] },
							(err) => {
								if (err)
									new MongoError(err).log();
								next();
							}
						);
					}, cb);
				});
			},
			cb => clearReclaimAction(vpgId, cb)
		], (err) => {
			if (!err)
				new SystemMessage(systemMessages.SANITY_RECLAIMING_RESERVED_VOLUME_ROLLED_BACK)
					.addInfo(Entities.VPG.ID, vpgId).log();

			callback(err);
		});
	}

	function clearReclaimAction(vpgId, cb) {
		volumeCollection.updateOne(
			{ _id: vpgId, isReserved: true },
			{ $unset: { reclaimAction: 1, reclaimUUIDMap: 1 } },
			(err) => {
				if (err)
					return cb(new MongoError(err).log());

				cb();
			}
		);
	}
};

// Detects VPGs whose capacity is out of sync with their reserved volume
// (management crashed after shrinkReservedSpaceVolume completed but before updateVPGCapacity ran in reclaimVPGs).
// Syncs the VPG capacity to match the reserved volume, which is the source of truth.
scope.checkVPGReservedVolumeCapacitySync = function(cb) {
	const db = app.get('db');
	const vpgCollection = db.collection('volumeProvisioningGroup');

	vpgCollection.aggregate([
		{ $match: { capacity: { $gt: 0 } } },
		{
			$lookup: {
				from: 'volume',
				let: { vpgId: '$_id' },
				pipeline: [
					{ $match: { $expr: { $and: [{ $eq: ['$_id', '$$vpgId'] }, { $eq: ['$isReserved', true] }] } } },
					{ $project: { capacity: 1 } }
				],
				as: 'reservedVolume'
			}
		},
		{ $unwind: { path: '$reservedVolume', preserveNullAndEmptyArrays: true } },
		{
			$match: {
				$expr: {
					$and: [
						{ $ne: [{ $ifNull: ['$reservedVolume', null] }, null] },
						{ $ne: ['$capacity', '$reservedVolume.capacity'] }
					]
				}
			}
		},
		{ $project: { vpgCapacity: '$capacity', reservedVolumeCapacity: '$reservedVolume.capacity' } }
	]).toArray((err, mismatches) => {
		if (err) {
			new MongoError(err).log();
			return cb();
		}

		if (!mismatches.length)
			return cb();

		async.eachSeries(mismatches, (mismatch, eachCb) => {
			new SystemMessage(systemMessages.SANITY_VPG_CAPACITY_MISMATCH_FIXED)
				.addInfo(Entities.VPG.ID, mismatch._id)
				.addInfo(Entities.VPG.capacity, mismatch.reservedVolumeCapacity)
				.log();

			vpgCollection.updateOne(
				{ _id: mismatch._id },
				{ $set: { capacity: mismatch.reservedVolumeCapacity } },
				(err) => {
					if (err)
						new MongoError(err).log();

					eachCb();
				}
			);
		}, cb);
	});
};

scope.checkForResendReport = (cb) => {
	var db = app.get('db');
	var serverCollection = db.collection('server');

	serverCollection.find({ shouldSendResendReport: true })
		.project({ node_id: 1, tomaToken: 1, topics: 1, kafkaMessageSequence: 1 })
		.toArray((err, targets) => {
			if (err) {
				new MongoError(err).log();
				return cb();
			} else if (targets && targets.length) {
				async.each(targets, (target, callback) => {
					logger.sysDEBUG(`Sanity And Recover: asking for resend report for Target: ${target.node_id}`);
					// send resend report with empty drives so Toma will resend a new full report which will recalculate and trigger the ResendReport again
					targetModule.askForTomaReport(
						target.node_id,
						target.tomaToken,
						target.kafkaMessageSequence[consts.kafkaMessageTypes.TOMAToManagament.reportTarget],
						target.topics[consts.topicSuffix.TOMA_COMMANDS],
						[],
						'sanity and recover');
					callback();
				}, cb);
			} else
				return cb();
		});
};

scope.checkAndResumeStuckReinstate = function(callback) {
	const db = app.get('db');
	const serverCollection = db.collection('server');
	const volumeCollection = db.collection('volume');
	const debug = (msg) => logger.sysDEBUG(`checkAndResumeStuckReinstate: ${msg}`);
	const debugDisk = (disk, msg) => debug(`disk ${disk.diskID} (uuid: ${disk.uuid}) ${msg}`);

	async.series([
		function reservedVolumeCheck(cb) {
			// Sync VPG volume segments to match their disk counterpart before disk-based recovery runs.
			// If the volume update failed during phase 1 (disk PENDING, VPG still REMAP) or phase 2
			// (disk NORMAL, VPG still REMAP/PENDING), this resets the VPG segment to match the disk.
			const stuckStatuses = [consts.diskSegmentStatuses.REMAP, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING];
			const syncableStatuses = [consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING, consts.diskSegmentStatuses.NORMAL];

			function buildPipeline(volumeIds) {
				const idFilter = volumeIds ? { _id: { $in: volumeIds } } : {};

				return [
					{ $match: { ...idFilter, isReserved: true, 'chunks.pRaids.diskSegments.status': { $in: stuckStatuses } } },
					{ $project: {
						'chunks.pRaids.diskSegments._id': 1,
						'chunks.pRaids.diskSegments.diskID': 1,
						'chunks.pRaids.diskSegments.node_id': 1,
						'chunks.pRaids.diskSegments.status': 1
					} },
					{ $unwind: '$chunks' },
					{ $unwind: '$chunks.pRaids' },
					{ $unwind: '$chunks.pRaids.diskSegments' },
					{ $match: { 'chunks.pRaids.diskSegments.status': { $in: stuckStatuses } } },
					{
						$lookup: {
							from: 'server',
							let: {
								segId: '$chunks.pRaids.diskSegments._id',
								diskID: '$chunks.pRaids.diskSegments.diskID',
								nodeId: '$chunks.pRaids.diskSegments.node_id',
								volStatus: '$chunks.pRaids.diskSegments.status'
							},
							pipeline: [
								{ $match: { $expr: { $eq: ['$_id', '$$nodeId'] } } },
								{ $unwind: '$disks' },
								{ $match: { $expr: { $eq: ['$disks.diskID', '$$diskID'] } } },
								{ $unwind: '$disks.diskSegments' },
								{ $match: { $expr: { $and: [
									{ $eq: ['$disks.diskSegments._id', '$$segId'] },
									{ $in: ['$disks.diskSegments.status', syncableStatuses] },
									{ $ne: ['$disks.diskSegments.status', '$$volStatus'] }
								] } } },
								{ $project: { _id: 0, zone: '$zone', diskUUID: '$disks.uuid', newStatus: '$disks.diskSegments.status' } },
								{ $limit: 1 }
							],
							as: 'diskMatch'
						}
					},
					{ $match: { 'diskMatch.0': { $exists: true } } },
					{ $project: {
						_id: 0,
						volumeId: '$_id',
						segmentId: '$chunks.pRaids.diskSegments._id',
						zone: { $arrayElemAt: ['$diskMatch.zone', 0] },
						newStatus: { $arrayElemAt: ['$diskMatch.newStatus', 0] },
						newDiskUUID: { $arrayElemAt: ['$diskMatch.diskUUID', 0] }
					} }
				];
			}

			volumeCollection.aggregate(buildPipeline()).toArray((err, stuckSegments) => {
				if (err)
					return cb(new MongoError(err));

				if (!stuckSegments.length)
					return cb();

				debug(`found ${stuckSegments.length} VPG volume segments out of sync with disk`);

				const segmentsByZone = stuckSegments.reduce((acc, seg) => {
					if (!acc[seg.zone])
						acc[seg.zone] = [];

					acc[seg.zone].push(seg);
					return acc;
				}, {});

				async.eachSeries(Object.keys(segmentsByZone), (zone, eachCb) => {
					const candidateVolumeIds = [...new Set(segmentsByZone[zone].map(s => s.volumeId))];

					lockModule.acquireLockByZone(zone, (err) => {
						if (err)
							return eachCb(err);

						const done = (err) => lockModule.releaseLockByZone(zone, () => eachCb(err));

						volumeCollection.aggregate(buildPipeline(candidateVolumeIds)).toArray((err, validatedSegments) => {
							if (err)
								return done(new MongoError(err));

							if (!validatedSegments.length) {
								debug(`zone ${zone}: no reserved segments still out of sync after recheck under lock`);
								return done();
							}

							const reservedSegmentsByVolume = validatedSegments.reduce((acc, { volumeId, segmentId, newStatus, newDiskUUID }) => {
								if (!acc[volumeId])
									acc[volumeId] = [];

								debug(`syncing reserved segment ${segmentId} on VPG volume ${volumeId} to ${newStatus}`);
								acc[volumeId].push({ segmentId, newStatus, newDiskUUID });
								return acc;
							}, {});

							diskModule.updateVolumesAfterReinstate({}, reservedSegmentsByVolume, done);
						});
					});
				}, cb);
			});
		},
		function diskBasedCheck(cb) {
			const interestDiskSegmentsStatuses = [
				consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING,
				consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD,
				consts.diskSegmentStatuses.MARKED_FOR_REBUILD
			];

			const stuckReinstateMatch = {
				'disks.diskSegments.status': {
					$in: [consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD]
				}
			};

			const pipeline = [
				{ $match: stuckReinstateMatch },
				{ $unwind: '$disks' },
				{ $match: stuckReinstateMatch },
				{
					$project: {
						node_id: '$_id',
						zone: 1,
						'disks.diskID': 1,
						'disks.uuid': 1,
						'disks.isOutOfService': 1,
						'disks.formatInProgress': 1,
						'disks.isPendingFormat': 1,
						'disks.diskSegments': {
							$filter: {
								input: '$disks.diskSegments',
								as: 'seg',
								cond: { $in: ['$$seg.status', interestDiskSegmentsStatuses] }
							}
						}
					}
				}
			];

			serverCollection.aggregate(pipeline).toArray((err, results) => {
				if (err)
					return cb(new MongoError(err));

				if (!results || !results.length)
					return cb();

				debug(`found ${results.length} disks with reinstate segments`);

				async.eachSeries(results, (server, done) => {
					const disk = server.disks;
					const zone = server.zone;

					if (disk.formatInProgress || disk.isPendingFormat) {
						debugDisk(disk, 'format in progress/pending, deferring');
						return done();
					}

					const { pendingSegments, oldSegments, rebuildSegments } = categorizeReinstateSegments(disk.diskSegments);

					if (disk.isOutOfService && oldSegments.length && pendingSegments.length)
						return handleReinstateIncompleteReplacement(disk, zone, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING, done);
					else if (disk.isOutOfService && !oldSegments.length && pendingSegments.length)
						return handleReinstateReadyForFormat(disk, pendingSegments.length, done);
					else if (!disk.isOutOfService && pendingSegments.length)
						return handleReinstateStuckAfterFormat(disk, pendingSegments.length, done);
					else if (!disk.isOutOfService && oldSegments.length && rebuildSegments.length)
						return handleReinstateIncompleteReplacement(disk, zone, consts.diskSegmentStatuses.MARKED_FOR_REBUILD, done);

					done();
				}, cb);
			});
		},
	], callback);

	function categorizeReinstateSegments(diskSegments) {
		return diskSegments.reduce((acc, seg) => {
			if (seg.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING)
				acc.pendingSegments.push(seg);
			else if (seg.type === consts.segmentTypes.DATA && seg.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD)
				acc.oldSegments.push(seg);
			else if (seg.type === consts.segmentTypes.DATA && seg.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD)
				acc.rebuildSegments.push(seg);

			return acc;
		}, { pendingSegments: [], oldSegments: [], rebuildSegments: [] });
	}

	function handleReinstateIncompleteReplacement(unlockedDisk, zone, newSegmentStatus, callback) {
		debugDisk(unlockedDisk, `has old + ${newSegmentStatus} segments, checking again under lock`);

		lockModule.acquireLockByZone(zone, (err) => {
			if (err)
				return callback(err);

			const done = (err) => lockModule.releaseLockByZone(zone, () => callback(err));

			fetchDisk(unlockedDisk.diskID, unlockedDisk.uuid, (err, disk) => {
				if (err)
					return done(err);

				if (!disk) {
					debugDisk(unlockedDisk, 'no longer present, skipping');
					return done();
				}

				const { pendingSegments, oldSegments, rebuildSegments } = categorizeReinstateSegments(disk.diskSegments);
				const newSegments = newSegmentStatus === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING ? pendingSegments : rebuildSegments;
				const expectedIsOutOfService = newSegmentStatus === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING;

				if (disk.isOutOfService !== expectedIsOutOfService || !oldSegments.length || !newSegments.length) {
					debugDisk(disk, 'state changed under lock, skipping');
					return done();
				}

				debugDisk(disk, 'pushing missing pairs to volumes');
				pushMissingPairsToVolumes(disk, newSegments, oldSegments, newSegmentStatus, done);
			});
		});
	}

	function fetchDisk(diskID, diskUUID, cb) {
		const refetchPipeline = [
			{ $match: { 'disks.diskID': diskID, 'disks.uuid': diskUUID } },
			{ $unwind: '$disks' },
			{ $match: { 'disks.diskID': diskID, 'disks.uuid': diskUUID } },
			{
				$project: {
					'disks.diskID': 1,
					'disks.uuid': 1,
					'disks.isOutOfService': 1,
					'disks.diskSegments': 1
				}
			}
		];

		serverCollection.aggregate(refetchPipeline).toArray((err, results) => {
			if (err)
				return cb(new MongoError(err));

			if (!results.length)
				return cb();

			cb(null, results[0].disks);
		});
	}

	function pushMissingPairsToVolumes(disk, newSegments, oldSegments, newSegmentStatus, callback) {
		getMissingPairsByVolume(newSegments, oldSegments, newSegmentStatus, (err, missingPairsByVolume) => {
			if (err)
				return callback(err);

			const missingVolumeNames = Object.keys(missingPairsByVolume);
			if (!missingVolumeNames.length)
				return callback();

			debugDisk(disk, `completing volume update for volumes: ${missingVolumeNames.join(', ')}`);
			diskModule.updateVolumesAfterReinstate(missingPairsByVolume, {}, callback);
		});
	}

	function getMissingPairsByVolume(newSegments, oldSegments, newSegmentStatus, callback) {
		const isMatchingOldSegment = (old, current) => old.lbs === current.lbs && old.lbe === current.lbe;
		const segmentPairsByVolume = newSegments.reduce((acc, newSegment) => {
			const matchingOld = oldSegments.find(oldSegment => isMatchingOldSegment(oldSegment, newSegment));
			if (matchingOld) {
				if (!acc[newSegment.volumeName])
					acc[newSegment.volumeName] = [];

				acc[newSegment.volumeName].push({ oldSegment: matchingOld, newSegment });
			}

			return acc;
		}, {});

		const missingPairsByVolume = {};

		async.eachSeries(Object.keys(segmentPairsByVolume), (volumeName, cb) => {
			volumeCollection.findOne({ _id: volumeName }, (err, volume) => {
				if (err)
					return cb(new MongoError(err));

				if (!volume)
					return cb();

				const volumeNewSegmentIds = new Set();
				volume.chunks.forEach(chunk =>
					chunk.pRaids.forEach(pRaid =>
						pRaid.diskSegments
							.filter(seg => seg.status === newSegmentStatus)
							.forEach(seg => volumeNewSegmentIds.add(seg._id))));

				const missingPairs = segmentPairsByVolume[volumeName].filter(pair => !volumeNewSegmentIds.has(pair.newSegment._id));
				if (missingPairs.length)
					missingPairsByVolume[volumeName] = missingPairs;

				cb();
			});
		}, (err) => callback(err, missingPairsByVolume));
	}

	function handleReinstateReadyForFormat(disk, pendingCount, callback) {
		debugDisk(disk, `has ${pendingCount} pending segments, no old segments, auto-triggering format`);
		diskModule.formatDiskByIDsAndUUIDs([{ _id: disk.diskID, uuid: disk.uuid }], null, true, () => callback());
	}

	function handleReinstateStuckAfterFormat(disk, pendingCount, callback) {
		debugDisk(disk, `has ${pendingCount} pending segments after format, resuming reinstate`);
		diskModule.resumeReinstateAfterFormat(disk, () => callback());
	}
};

module.exports = scope;
