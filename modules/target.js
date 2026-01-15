/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

var async = require('async');
var uuid = require('uuid');
var utils = require('../utils.js');
var events = require('../events.js');
var logger = require('../logger.js');
var queue = require('../queue.js');
var objectNotifier = require('../objectNotifier.js');
var consts = require('../consts.js');
var volumeModule = require('./volume.js');
var clientModule = require('./client.js');
var diskModule = require('./disk.js');
var lockModule = require('./lock.js');
var zoneModule = require('./zone.js');
var kafkaModule = require('./kafka.js');
var configurationProfile = require('./configurationProfiles');
var { ExecutionTimer } = require('../models/executionTimer.js');
var { Entities, SystemMessage, MongoError, SystemAdminMessage, Differentiators, getNICID, getDriveID } = require('./error.js');
var { logWithRequestUUID, acknowledgeByQuery } = require('./log.js');
var systemMessages = require('../systemMessages.js');
const { tomaStatuses } = require('../consts.js');

var { UpdateTomaKeepaliveToken } = require('../models/kafkaMessages/UpdateTomaKeepaliveToken');
var { UpdateLeaderKeepaliveToken } = require('../models/kafkaMessages/UpdateLeaderKeepaliveToken');
var { ResendReport } = require('../models/kafkaMessages/ResendReport');
var { FormatDrive } = require('../models/kafkaMessages/FormatDrive');
const { AddVolume } = require('../models/kafkaMessages/AddVolume.js');
var lastMessageLog = require('./lastMessageLog.js');

var scope = {};

scope.afterModuleLoaded = function() {
	lastMessageLog = require('./lastMessageLog.js');
	clientModule = require('./client.js');
	events = require('../events.js');
	logger = require('../logger.js');
	({ Entities, SystemMessage, MongoError, SystemAdminMessage, Differentiators, getNICID, getDriveID } = require('./error.js'));
};

var reportsQueue = {};

function enqueueReport(nodeID, cb) {
	while (reportsQueue[nodeID].size()) {
		reportsQueue[nodeID].dequeue().value(true);
	}

	reportsQueue[nodeID].enqueue(cb);
}

function dequeueReport(nodeID) {
	if (!Object.prototype.hasOwnProperty.call(reportsQueue, nodeID))
		return;

	var reportsInQueue = reportsQueue[nodeID].size();

	if (!reportsInQueue)
		return delete reportsQueue[nodeID];

	(reportsQueue[nodeID].dequeue().value)();

	if (reportsInQueue === 1)
		delete reportsQueue.nodeID;
}

function fetchOneAndHandleReport(message, cb) {
	let db = app.get('db');
	let server = db.collection('server');

	let nodeID = message.hostname;

	const done = err => {
		dequeueReport(nodeID);
		cb(err);
	};

	server.findOne({ _id: nodeID }, function(err, lastServer) {
		if (err)
			return done(new MongoError(err).log());

		if (!lastServer) {
			logger.sysDEBUG(`Received a report for a target with nodeID ${nodeID}, the target could not be found in the DB. Dropping the report.`);
			return done();
		}

		const lastMessageSequence = lastServer.kafkaMessageSequence?.[message.type];

		if (lastServer.tomaToken === message.tomaToken && lastMessageSequence && lastMessageSequence >= message.messageSequence) {
			logger.sysDEBUG('An irrelevant report target was received, dropping it. ', {
				nodeID: nodeID,
				lastServer: { kafkaMessageSequence: lastMessageSequence, tomaToken: lastServer.tomaToken },
				reportedServer: { kafkaMessageSequence: message.messageSequence, tomaToken: message.tomaToken }
			});

			return done();
		}

		const executionTimer = new ExecutionTimer('handleServerReport');
		handleServerReport(message, lastServer, false, (err) => {
			if (err)
				new SystemMessage(systemMessages.SERVER_REPORT_FINISHED_WITH_ERROR).addInfo(Entities.Error, err);

			executionTimer.stop();
			return done(err);
		});
	});
}

scope.report = function(message, callback) {
	var nodeID = message.hostname;

	if (!message.payload.node.disks)
		message.payload.node.disks = [];

	if (!message.payload.node.nics)
		message.payload.node.nics = [];

	handleDuplicates(message.payload.node);

	if (nodeID && Object.prototype.hasOwnProperty.call(reportsQueue, nodeID))
		return enqueueReport(nodeID, function(skipExecute) {
			if (skipExecute) {
				return callback();
			}
			fetchOneAndHandleReport(message, callback);
		});

	reportsQueue[nodeID] = new queue.Queue();

	fetchOneAndHandleReport(message, callback);
};

function deleteTarget(serverID, serverUUID, logs, affectedZones, callback) {
	const db = app.get('db');
	const serverCollection = db.collection('server');
	let result = {};

	const query = {
		_id: serverID,
		uuid: serverUUID,
		tomaStatus: { $ne: consts.tomaStatuses.UP }
	};

	const update = { $set: {
		node_status: consts.nodeStatus.DELETING
	} };

	async.series([
		(callback) => {
			serverCollection.findOneAndUpdate(query, update, (err, originalServer) => {
				let errMsg;
				if (err) {
					new MongoError(err).addInfo(Entities.Target.ID, serverID).log();
					errMsg = err.message;
				} else if (!originalServer)
					errMsg = new SystemMessage(systemMessages.CANT_DELETE_TARGET);

				if (errMsg) {
					logs.push(new SystemAdminMessage(systemMessages.SERVER_DELETE_FAILED)
						.addInfo(Entities.Target.ID, serverID).addInfo(Entities.Target.UUID, serverUUID).addInfo(Entities.Error, errMsg));
				} else {
					serverUUID = serverUUID || originalServer.uuid;
					logs.push(new SystemAdminMessage(systemMessages.TARGET_MARKED_FOR_DELETION)
						.addInfo(Entities.Target.ID, serverID).addInfo(Entities.Target.UUID, serverUUID));
				}

				result = originalServer;

				callback(err ? err : errMsg);
			});
		},
		(callback) => {
			utils.incZonesConfigurationVersion([result.zone], () => {
				callback();
			});
		},
		(callback) => {
			if (result.zone)
				zoneModule.removeTargetsFromZone(result.zone, [serverID], callback);
			else
				callback();
		},
		(callback) => {
			if (result.zone) {
				if (!affectedZones[result.zone])
					affectedZones[result.zone] = 0;

				affectedZones[result.zone]--;
			}

			serverCollection.findOneAndDelete({ node_id: serverID }, function(err, deletedTarget) {
				if (err) {
					err = new MongoError(err).addInfo(Entities.Target.ID, serverID).log();
				}

				// make sure we have the last deleted token (used to deleted LastMessageLog)
				result.tomaToken = deletedTarget.tomaToken;
				callback(err);
			});
		},
		(callback) => {
			lastMessageLog.deleteComponentLastMessageLog(consts.originTypes.TOMA, serverID, result.tomaToken, callback);
		}
	], (err) => {
		callback(err);
	});
}

scope.deleteTargetIfAllowed = function(targetID, targetUUID, evictAllDrives, logs, affectedZones, callback) {
	var db = app.get('db');
	var serverCollection = db.collection('server');
	var target;

	class messageForREST extends Error{}

	async.series([
		function fetchTarget(cb) {
			var project = { node_id: 1, zone: 1, 'disk.diskID': 1, 'disk.diskSegments.type': 1 };
			serverCollection.findOne({ 'node_id': targetID, uuid: targetUUID }, project, (err, targetDoc) => {
				if (err || !targetDoc) {
					if (err)
						new MongoError(err).log();

					return cb(new messageForREST('Cannot find the target in the DB'));
				}

				target = targetDoc;
				cb();
			});
		},
		function evictAllDrivesIfRequired(cb) {
			if (!evictAllDrives)
				return cb();

			var disksForEvict = target.disks.filter(disk => !(disk.isOutOfService || disk.isExcluded || disk.status === consts.diskStatus.NOT_INITIALIZED))
				.map(disk => {
					return {
						diskID: disk.diskID,
						uuid: disk.uuid,
						zone: target.zone
					};
				});

			diskModule.evictDiskByDiskIDsAndUUIDs(disksForEvict, consts.SYSTEM_USER, false, new Set(target.zone), [], null, evictLogs => {
				let err;
				let drivesFailedToEvict = evictLogs
					.filter(l => l.systemMessage.id === systemMessages.DISK_EVICT_FAILED.id)
					.map(l => l.getAdditionalInfoByKey(Entities.Drive.ID));

				if (drivesFailedToEvict.length)
					err = new messageForREST(`Failed to evict Drive(s) ${drivesFailedToEvict}`);

				cb(err);
			});
		},
		function skipIfHasDiskSegments(cb) {
			if (evictAllDrives)
				// we already evicted all drives or returned with an error
				return cb();

			serverCollection
				.find({
					'node_id': targetID,
					'disks.diskSegments.type': { $in: [consts.segmentTypes.DATA] }
				})
				.project({ node_id: 1 })
				.toArray(function(err, targetWithSegments) {
					if (err) {
						return cb(new messageForREST('The server has disk segments!'));
					}

					if (targetWithSegments && targetWithSegments.length) {
						return cb(new messageForREST('The server has disk segments!'));
					}

					cb();
				});
		},
		function deleteTheTarget(cb) {
			deleteTarget(targetID, targetUUID, logs, affectedZones, () => cb());
		},
	], err => {
		if (err) {
			err = err instanceof messageForREST ? err.message : 'Failed to delete Target';
			logs.push(new SystemAdminMessage(systemMessages.SERVER_DELETE_FAILED)
				.addInfo(Entities.Target.ID, targetID).addInfo(Entities.Target.UUID, targetUUID).addInfo(Entities.Error, err));
		}

		callback(err);
	});
};

scope.deleteTargets = function(targets, evictAllDrives, cb) {
	let messages = [];

	//Check if the servers has diskSegments, if so don't delete them.
	var affectedZones = {};
	var zonesToLock = [];
	var zoneToTarget = {};
	var pendingTargets = [];

	async.series([
		function getTargetZones(cb) {
			zoneModule.getZonesByTargetIDs(targets.map(t => t._id), (err, targetZones) => {
				if (err) {
					messages.push(new SystemAdminMessage(systemMessages.SERVER_DELETE_MISSING).addInfo(Entities.Error, err));
				} else {
					zonesToLock = targetZones.getZonesList();
					zoneToTarget = targetZones.zones;
					pendingTargets = targetZones.pendingTargets;
				}

				cb(err);
			});
		},
		function runForEachZone(cb) {
			async.eachSeries(zonesToLock, (zone, eachZoneCB) => {
				lockModule.acquireLockByZone(zone, () => {
					async.eachSeries(zoneToTarget[zone], (targetID, eachTargetCB) => {
						const targetUUID = targets.find(t => t._id === targetID).uuid;
						scope.deleteTargetIfAllowed(targetID, targetUUID, evictAllDrives, messages, affectedZones, () => eachTargetCB());
					}, () => {
						// check and delete zone if all targets under this zone were deleted
						deleteZoneIfNeeded(zone, (zoneDeleted) => {
							if (zoneDeleted)
								delete affectedZones[zone];
							else
								lockModule.releaseLockByZone(zone);

							eachZoneCB();
						});
					});
				});
			}, function() {
				cb();
			});
		},
		function deletePendingTargets(cb) {
			async.eachSeries([...pendingTargets], (serverID, callback) => {
				const targetUUID = targets.find(t => t._id === serverID).uuid;
				deleteTarget(serverID, targetUUID, messages, affectedZones, () => callback());
			}, () => cb());
		}
	], () => cb(messages));
};

function deleteZoneIfNeeded(zoneID, cb) {
	const isZoneOne = zoneID === '1';
	let shouldDeleteZone = false;
	// check if zone needs to be deleted
	zoneModule.getSingleZone(zoneID, (err, dbZone) => {
		// check if last target of zone
		if (!err && dbZone)
			shouldDeleteZone = dbZone.targetsInZone.length === 0;

		if (!shouldDeleteZone)
			return cb();

		if (!isZoneOne)
			return zoneModule.deleteZone(zoneID, (err) => {
				if (err)
					return cb();

				// the callback should return true if the zone was deleted
				lockModule.deleteZoneLock(zoneID, err => cb(!err));
			});

		// Zone 1 should always exists
		const db = app.get('db');
		const lockCollection = db.collection('lock');
		const versionCollection = db.collection('configurationVersion');

		async.parallel([
			cb => lockCollection.updateOne({ _id: zoneID }, { $unset: { lastKafkaTopicsVersionCreated: 1 } }, cb),
			// we keep the topics by purpose to not break other management flows
			cb => versionCollection.updateOne({ _id: zoneID }, { $unset: { featureCompatibilityVersion: 1 } }, cb),
		], err => {
			if (err)
				new MongoError(err).log();

			cb();
		});
	});
}

scope.getAllocationByTarget = function(callback) {
	var db = app.get('db');
	var serverCollection = db.collection('server');

	serverCollection.aggregate([
		{
			$match: {
				node_status: { $ne: consts.nodeStatus.DELETING }
			}
		},
		{
			$project: {
				'node_id': 1,
				'disks.usableBlocks': 1,
				'disks.availableBlocks': 1,
				'disks.isExcluded': 1,
				'disks.isOutOfService': 1
			}
		}, {
			$unwind: '$disks'
		}, {
			$match: {
				'disks.isExcluded': false,
				'disks.isOutOfService': { $in: [null, false] }
			}
		}, {
			$group: {
				'_id': '$node_id',
				'sumAvailable': {
					'$sum': '$disks.availableBlocks'
				},
				'sumUsable': {
					'$sum': '$disks.usableBlocks'
				}
			}
		}, {
			$project: {
				'percent': { $subtract: [100,
					{ $multiply: [{ $divide: ['$sumAvailable', '$sumUsable'] },
						100
					] }] }
			}
		}
	]).toArray(function(err, results) {
		if (err)
			new MongoError(err).log();

		if (!results || !results.length)
			return callback([]);

		return callback(results);
	});
};

// Returns vpg total reserved space, if exists, Otherwise, returns null
// vpg total reserved space is the total space of a vpg that was set with allowOverflow=false
scope.getVPGTotalReservedSpace = function(vpgId, callback) {
	utils.getVPGByID(vpgId, (err, vpgs)=> {
		if (err)
			logger.sysDEBUG('Failed to get vpg', err);

		if (!vpgs || vpgs.length !== 1)
			return callback(null);

		const vpg = vpgs[0];

		if (!vpg.allowOverflow) {
			const redundancyRatio = utils.getRedundancyRatio(vpg);
			const totalSpace = vpg.capacity * (redundancyRatio + 1);
			return callback(totalSpace);
		}
		callback(null);
	});
};

// Returns the total space in the system (Only available servers and disks)
scope.getTotalSpace = function(limitNodes, limitDisks, vpg, onlyEC, allowAllocationOnOfflineDrives, callback) {
	async.series([
		cb => {
			if (!vpg) {
				return cb();
			}
			return scope.getVPGTotalReservedSpace(vpg, cb);
		},
		cb => {
			const nodeMatch = utils.getAllocatableNodesMatch(allowAllocationOnOfflineDrives, limitNodes);
			const diskMatch = utils.getAllocatableDrivesMatch(onlyEC, allowAllocationOnOfflineDrives, limitDisks);

			zoneModule.getSpaceAllocation(nodeMatch, diskMatch, false, (err, results) => {
				if (err)
					logger.sysDEBUG('Failed to get space allocation', err);

				cb(results?.totalCapacity);
			});
		},
	], (result) => {
		callback(result);
	});
};

// Returns the allocated space in the system.
scope.getAllocatedSpace = function(limitNodes, limitDisks, vpg, onlyEC, allowAllocationOnOfflineDrives, callback) {
	let vpgTotalReservedSpace;

	async.series({
		vpgTotalSpace: cb => {
			if (!vpg) {
				return cb();
			}
			return scope.getVPGTotalReservedSpace(vpg, vpgTotalSpace => {
				vpgTotalReservedSpace = vpgTotalSpace;
				cb(null, vpgTotalSpace);
			});
		},
		totalSpace: cb => {
			// skip if we have a vpgTotalReservedSpace already
			if (vpgTotalReservedSpace) {
				return cb();
			}

			const nodeMatch = utils.getAllocatableNodesMatch(allowAllocationOnOfflineDrives, limitNodes);
			const diskMatch = utils.getAllocatableDrivesMatch(onlyEC, allowAllocationOnOfflineDrives, limitDisks);

			zoneModule.getSpaceAllocation(nodeMatch, diskMatch, false, (err, results) => {
				if (err)
					logger.sysDEBUG('Failed to get space allocation', err);

				if (!results)
					return cb();

				const totalSpace = results.totalCapacity - results.availableSpace;
				cb(null, totalSpace);
			});
		},
		availableReserved: cb => {
			if (!vpg) {
				return cb(null, null);
			}
			getAvailableReserved(limitNodes, limitDisks, vpg, allowAllocationOnOfflineDrives, function(err, availableReserved) {
				cb(null, availableReserved);
			});
		}
	}, (_, { vpgTotalSpace, totalSpace, availableReserved }) => {
		if (!vpg) {
			return callback(totalSpace);
		}
		if (vpgTotalSpace) {
			return callback(vpgTotalSpace - availableReserved);
		}

		callback(totalSpace - availableReserved);
	});
};

scope.getAvailableMirrorsCount = function(capacity, limitNodes, limitDisks, vpg, allowAllocationOnOfflineDrives, cb) {
	var db = app.get('db');
	var serverCollection = db.collection('server');

	var blocks = Math.ceil(capacity / utils.BtoGB(consts.BLOCK_SIZE));

	const nodeMatch = utils.getAllocatableNodesMatch(allowAllocationOnOfflineDrives, limitNodes);
	const diskMatch = utils.getAllocatableDrivesMatch(false, allowAllocationOnOfflineDrives, limitDisks);
	var nodeWithFreeReserved = {};

	async.series([
		function(callback) {
			if (!vpg) return callback();
			//Get all the disks that have reserved space.
			diskMatch['disks.diskSegments'] = { $elemMatch: { isReserved: true } };

			serverCollection.aggregate([{ $match: nodeMatch },
				{ $project: { disks: 1, node_id: 1 } },
				{ $unwind: '$disks' },
				{ $match: diskMatch }]).toArray(function(err, results) {
				if (err) {
					err = new MongoError(err).log();
				}

				results.forEach(function(diskObj) {
					var segments = diskObj.disks.diskSegments;

					if (!segments || !segments.length) return;

					var availableReservedSegments = utils.getReservedSegments(diskObj.disks, vpg);

					if (!availableReservedSegments || !availableReservedSegments.length) return;

					var availableReservedSpaceInDisk = getBlocksBySegments(availableReservedSegments);

					if (diskObj.node_id in nodeWithFreeReserved)
						nodeWithFreeReserved[diskObj.node_id] += availableReservedSpaceInDisk;
					else
						nodeWithFreeReserved[diskObj.node_id] = availableReservedSpaceInDisk;
				});

				callback(err);
			}
			);
		},
		function(callback) {
			delete diskMatch['disks.diskSegments'];

			var aggregationPipeline = [{ $match: nodeMatch },
				{ $project: { disks: 1, node_id: 1 } },
				{ $unwind: '$disks' },
				{ $match: diskMatch },
				{ $group: { _id: '$node_id', totalBlocksAvailable: { $sum: '$disks.availableBlocks' } } },
				{ $sort: { totalBlocksAvailable: 1 } }];

			serverCollection.aggregate(aggregationPipeline).toArray(function(err, results) {
				if (err)
					new MongoError(err).log();

				var availableMirrors = 0;
				var tempBlocks = blocks;

				results.forEach(function(node) {
					tempBlocks -= vpg ? node.totalBlocksAvailable + (nodeWithFreeReserved[node._id] || 0) : node.totalBlocksAvailable;

					if (tempBlocks <= 0) {
						tempBlocks = blocks;
						availableMirrors++;
					}
				});

				//Minus one as one for the result is the copy
				callback(err, availableMirrors - 1);
			});
		}
	], function(err, results) {
		cb(results[1]);
	});
};

scope.deleteNICs = (targets, callback) => {
	const messages = [];

	async.each(targets, ({ targetID, targetUUID, nicID }, cb) => {
		scope.deleteNICByIDAndUUID(targetID, targetUUID, nicID, message => {
			messages.push(message);
			cb();
		});
	}, () => callback(messages));
};

scope.deleteNICByIDAndUUID = function(_id, uuid, nicID, cb) {
	var db = app.get('db');
	var serverCollection = db.collection('server');
	var targetZone;

	function success() {
		done();
	}

	function failed(systemError) {
		done(systemError);
	}

	function done(systemError) {
		lockModule.releaseLockByZone(targetZone);
		return cb((systemError ?
			new SystemAdminMessage(systemMessages.NIC_DELETE_FAILED).addInfo(Entities.Error, systemError) :
			new SystemAdminMessage(systemMessages.NIC_DELETED))
			.addInfo(Entities.Target.ID, _id).addInfo(Entities.Target.UUID, uuid).addInfo(Entities.NIC.ID, getNICID(nicID, _id)));
	}

	lockModule.acquireLockByTarget(_id, function(err, zone) {
		if (err)
			return failed('Something went wrong', err);

		targetZone = zone;
		serverCollection.aggregate([
			{ $match: { _id, uuid } },
			{ $unwind: '$nics' },
			{ $match: { 'nics.nicID': nicID } },
			{ $project: { nicID: '$nics.nicID', status: '$nics.status' } }
		]).toArray(function(err, nics) {
			if (err)
				return failed(err, new MongoError(err));

			var nic;
			if (!nics.length)
				return failed(new SystemMessage(systemMessages.TARGET_DELETE_NIC_NOT_FOUND));
			else
				nic = nics[0];

			if (nic.status !== consts.nicStatus.MISSING)
				return failed(new SystemMessage(systemMessages.TARGET_DELETE_NIC_MISSING));

			serverCollection.updateOne(
				{ _id, uuid },
				{
					$inc: { nicsVersion: 1 },
					$pull: { nics: { nicID: nicID } }
				},
				function(err) {
					if (err)
						return failed(new MongoError(err));

					var eventIds = [events.getNicID(nicID), events.getTargetID(_id)];
					events.emitEvent(eventIds, objectNotifier.events.nicRemovedEvent, { _id, uuid, nicID });

					let zones = [targetZone];

					utils.incZonesConfigurationVersion(zones, () => {
						zoneModule.dispatchZonesHardwareConfigurationByZones(zones, () => {
							lockModule.releaseLockByZone(targetZone);
							clientModule.updateClientsOnNicsVersionChange(_id, () =>{
								success();
							});
						});
					});
				});
		});
	});
};

function handleDuplicates(node) {
	function checkForDuplicates(entity) {
		var pluralEntity = entity + 's';
		var entityID = entity + 'ID';
		var duplicates = [];
		var ids = node[pluralEntity].map(e => { return e[entityID]; });

		node[pluralEntity] = node[pluralEntity].filter((e, i) => {
			var isDuplicate = ids.lastIndexOf(e[entityID]) !== i;
			if (isDuplicate)
				duplicates.push(e[entityID]);

			return !isDuplicate;
		});

		return { isDuplicates: ids.length !== node[pluralEntity].length, duplicates: duplicates };

	}

	//Handle duplicate nics.
	var result = checkForDuplicates('nic');
	if (result.isDuplicates) {
		var nicDupMsg = new SystemAdminMessage(systemMessages.TARGET_MULTIPLE_NICS_WITH_SAME_ID).addInfo(Entities.Target.ID, node.node_id);
		result.duplicates.forEach(nicID=> nicDupMsg.addInfo(Entities.NIC.UUID, nicID));
		nicDupMsg.log();
	}

	//Handle duplicate disks
	result = checkForDuplicates('disk');
	if (result.isDuplicates) {
		var driveDupMsg = new SystemAdminMessage(systemMessages.TARGET_MULTIPLE_DRIVES_WITH_SAME_ID);
		result.duplicates.forEach(diskID=> driveDupMsg.addInfo(Entities.Drive.ID, getDriveID(diskID, node.node_id)));
		driveDupMsg.addInfo(Entities.Target.ID, node.node_id).addInfo(Entities.Error, result).log();
	}
}

function updateDiskProperties(disk, diskExists) {
	this.updateDisk(disk, disk.uuid, 'Completion_Queues', diskExists.Completion_Queues);
	this.updateDisk(disk, disk.uuid, 'Available_Spare', diskExists.Available_Spare);
	this.updateDisk(disk, disk.uuid, 'MSIX_Interrupts', diskExists.MSIX_Interrupts);
	this.updateDisk(disk, disk.uuid, 'Percentage_Used', diskExists.Percentage_Used);
	this.updateDisk(disk, disk.uuid, 'Controller_Busy_Time', diskExists.Controller_Busy_Time);
	this.updateDisk(disk, disk.uuid, 'Numa_Node', diskExists.Numa_Node);
	this.updateDisk(disk, disk.uuid, 'Number_of_Error_Information_Log_Entries', diskExists.Number_of_Error_Information_Log_Entries);
	this.updateDisk(disk, disk.uuid, 'Unsafe_Shutdowns', diskExists.Unsafe_Shutdowns);
	this.updateDisk(disk, disk.uuid, 'Media_Errors', diskExists.Media_Errors);
	this.updateDisk(disk, disk.uuid, 'Power_Cycles', diskExists.Power_Cycles);
	this.updateDisk(disk, disk.uuid, 'pci_root', diskExists.pci_root);
	this.updateDisk(disk, disk.uuid, 'pci_address', diskExists.pci_address);
	this.updateDisk(disk, disk.uuid, 'Available_Spare_Threshold', diskExists.Available_Spare_Threshold);
	this.updateDisk(disk, disk.uuid, 'Model', diskExists.Model);
	this.updateDisk(disk, disk.uuid, 'Submission_Queues', diskExists.Submission_Queues);
	this.updateDisk(disk, disk.uuid, 'Power_On_Hours', diskExists.Power_On_Hours);
	this.updateDisk(disk, disk.uuid, 'Critical_Warning', diskExists.Critical_Warning);
	this.updateDisk(disk, disk.uuid, 'blocks', diskExists.blocks);
	this.updateDisk(disk, disk.uuid, 'block_size', diskExists.block_size);
	this.updateDisk(disk, disk.uuid, 'writeCounter', diskExists.writeCounter);
	this.updateDisk(disk, disk.uuid, 'metadata_size', diskExists.metadata_size);

	if (!disk.excludedByManagement) {
		this.updateDisk(disk, disk.uuid, 'isExcluded', diskExists.isExcluded);
		this.updateDisk(disk, disk.uuid, 'excludeReason', diskExists.excludeReason);
	}

	this.updateDisk(disk, disk.uuid, 'formatOptions', diskExists.formatOptions);
	this.updateDisk(disk, disk.uuid, 'metadataCapabilities', diskExists.metadataCapabilities);

	if (diskExists.activeFormatRequestCounter && diskExists.activeFormatRequestCounter >= 0)
		this.updateDisk(disk, disk.uuid, 'activeFormatRequestCounter', diskExists.activeFormatRequestCounter);
}

function updateGPTProperties(oldDisk, newDisk, calcDelta) {
	if (newDisk.GPT && oldDisk.GPT) {
		// using the new reported GPT but keeping the old calculated first and last usable lba
		var oldFirstUsableLba = oldDisk.GPT.firstUsableLba;
		var oldLastUsableLba = oldDisk.GPT.lastUsableLba;
		this.updateDisk(oldDisk, oldDisk.uuid, 'GPT', newDisk.GPT);
		this.updateDiskSecondLevel(oldDisk, oldDisk.uuid, 'GPT', 'firstUsableLba', oldFirstUsableLba);
		this.updateDiskSecondLevel(oldDisk, oldDisk.uuid, 'GPT', 'lastUsableLba', oldLastUsableLba);

	} else if (newDisk.GPT && !oldDisk.GPT) {
		// updating old disk to support reported GPT (happens on Toma upgrade for known disk)
		this.updateDisk(oldDisk, oldDisk.uuid, 'GPT', newDisk.GPT);

		// recalculate disk size limitations
		diskModule.setDiskInfo.bind(calcDelta)(oldDisk, true);

		var err = diskModule.validateGPTDriveBoundaries(oldDisk);
		if (err) {
			new SystemMessage(systemMessages.TARGET_UPDATE_GPT_PROPERTIES_FAILED).addInfo(Entities.Error, err).log();
			this.updateDisk(oldDisk, oldDisk.uuid, 'autoEvictReason', consts.autoEvictReason.SEGMENT_OUT_OF_BOUND);
			this.updateDisk(oldDisk, oldDisk.uuid, 'isOutOfService', true);
			return false;
		}
	}

	return true;
}

function addDriveToResendReport(drive, resendReportDrives) {
	var driveInfo = {
		'diskID': drive.diskID,
		'vendor': drive.Vendor,
		'reappearingCounter': drive.reappearingCounter,
		'reappearingOutOfSync': drive.reappearingOutOfSync || false
	};

	resendReportDrives.push(driveInfo);
}

function updateReappearingDriveAndAddToResendReport(drive, resendReportDrives, reappearingOutOfSync) {
	if (!reappearingOutOfSync)
		drive.reappearingCounter++;

	addDriveToResendReport(drive, resendReportDrives);
}

function updateDriveAndAddToResendReport(drive, resendReportDrives, reappearingOutOfSync) {
	var reappearingIncremented = false;

	if (!drive.reappearingCounter) {
		this.updateDisk(drive, drive.uuid, 'reappearingCounter', 1);
		reappearingIncremented = true;
	} else if (!reappearingOutOfSync) {
		this.incDiskField(drive, drive.uuid, 'reappearingCounter');
		reappearingIncremented = true;
	}

	this.updateDisk(drive, drive.uuid, 'reappearingOutOfSync', true);
	var msg = reappearingIncremented ? 'incrementing to: ' : 'expecting to receive: ';
	logger.sysDEBUG('reappearingCounter is out of sync for drive ' + drive.diskID + ', ' + msg + drive.reappearingCounter);

	addDriveToResendReport(drive, resendReportDrives);
}

function increaseOriginTargetReappearingCounter(resendReportReappearingDrives, callback) {
	var db = app.get('db');
	var serverCollection = db.collection('server');

	var successfullyUpdatedDrives = [];

	async.each(resendReportReappearingDrives, function(driveInfo, callback) {
		if (driveInfo.reappearingOutOfSync) {
			successfullyUpdatedDrives.push(driveInfo);
			return callback();
		}

		serverCollection.findOneAndUpdate({
			disks: {
				$elemMatch: {
					diskID: driveInfo.diskID,
					Vendor: driveInfo.vendor,
					$or: [{ reappearingCounter: { $exists: 0 } }, { reappearingCounter: driveInfo.reappearingCounter - 1 }]
				}
			}
		},
		{
			$inc: {
				'disks.$.reappearingCounter': 1
			}
		},
		{ returnDocument: consts.mongoReturnDocument.AFTER },
		function(err, res) {
			if (err) {
				err = new MongoError(err).log();
			} else if (res)
				// send events
				successfullyUpdatedDrives.push(driveInfo);
			else
				logger.sysDEBUG('Could not increase reappearingCounter on drive: ' + driveInfo.diskID + ', NOT emitting resend report for that drive');

			callback(err);
		});
	}, function(err) {
		resendReportReappearingDrives = successfullyUpdatedDrives;

		callback(err);
	});
}

function sendResendReportMessageIfNeeded(resendReportDrives, targetID, tomaToken, topic) {
	resendReportDrives.forEach(function(driveInfo) {
		// convert vendor to hex value
		driveInfo.vendor = consts.diskVendorNameToHex[driveInfo.vendor] || driveInfo.vendor;
		delete driveInfo.reappearingOutOfSync;
	});

	if (resendReportDrives.length) {
		askForTomaReport(targetID, tomaToken, topic, resendReportDrives, 'reappearing counter out of sync');
	}
}

function getNicProtocol(nic) {
	var protocol;

	switch (nic.protocol) {
		case -1:
			protocol = consts.nicProtocol.UNKNOWN;
			break;
		case 0:
			protocol = consts.nicProtocol.INFINIBAND;
			break;
		case 1:
			protocol = consts.nicProtocol.ROCE;
			break;
		case 2:
			protocol = consts.nicProtocol.TCP;
			break;
		case 3:
			protocol = consts.nicProtocol.MULTI;
			break;
		default:
			protocol = nic.protocol;
	}

	return protocol;
}

function getNicStatus(nic) {
	var status;

	switch (nic.status) {
		case 0:
			status = consts.nicStatus.LINK_DOWN;

			break;
		case 1:
			status = consts.nicStatus.OK;

			break;
		case 2:
			status = consts.nicStatus.MISSING;

			break;
		default:
			status = nic.status;
	}

	return status;
}

function checkAndExcludeIfDriveChangedZone(dbDrive, driveToSave, oldZone, newZone, logsToEmitOnInsert) {
	// in case drive switched zone or does not belong to its original zone, exclude it
	if ((dbDrive.originalZone && dbDrive.originalZone != newZone) || (!dbDrive.originalZone && oldZone != null && newZone != oldZone)) {
		driveToSave.isExcluded = true;
		driveToSave.excludedByManagement = true;
		driveToSave.excludeReason = consts.driveExcludeReasons.SWITCHED_ZONE;
		driveToSave.originalZone = oldZone;

		var prevZone = dbDrive.originalZone ? dbDrive.originalZone : oldZone;
		logsToEmitOnInsert.push({ logLevel: consts.logsLevel.ERROR,
			logMsg: 'The drive: ' + dbDrive.diskID
			+ ' has been automatically excluded due to zone mismatch between the drive and its current target (moved from zone '
			+ prevZone + ' to ' + (newZone == null ? ' a target without a zone' : newZone) + ')',
			logHeader: 'Automatically excluded drive' });
	}
}

function askForTomaReport(targetID, tomaToken, topic, resendReportDrives, reason) {
	logger.sysDEBUG('Asking toma: ' + targetID + ' to send full report with the tomaToken: ' + tomaToken + ' reason: ' + reason);

	const message = new ResendReport(resendReportDrives ? resendReportDrives : [], tomaToken);

	kafkaModule.sendMessages(topic, [message]);
}

function validateLeaderKeepAlive(message) {
	const missingKeys = [];

	if (!message.leaderToken && message.leaderToken !== 0)
		missingKeys.push('leaderToken');

	if (!message.keepaliveInterval && message.keepaliveInterval !== 0)
		missingKeys.push('keepaliveInterval');

	if (!message.payload.raftTerm && message.payload.raftTerm !== 0)
		missingKeys.push('raftTerm');

	const errorMessage = missingKeys.length && `${missingKeys.map(k => `missing ${k}`)} from message ${JSON.stringify(message)}`;

	if (errorMessage)
		new SystemMessage(systemMessages.LEADER_KEEPALIVE_VALIDATION_FAILURE).addInfo(Entities.Error, errorMessage).log();

	return errorMessage;
}

function handleLeaderFeatureCompatibilityVersionChanged(zoneID, versions, handleLeaderKeepaliveUpdateQuery, callback) {
	const { oldFeatureCompatibilityVersion, newFeatureCompatibilityVersion } = versions;
	const db = app.get('db');
	let dbTopics;

	logger.sysDEBUG(`Leader featureCompatibilityVersion changed to ${newFeatureCompatibilityVersion} for ${zoneID}!` +
		`FeatureCompatibilityVersion Before: ${oldFeatureCompatibilityVersion}, New ${newFeatureCompatibilityVersion}`);

	async.series([
		cb => {
			kafkaModule.getZoneTopicsToCreate(newFeatureCompatibilityVersion, zoneID, false, topics => {
				dbTopics = kafkaModule.mapTopicNamesToTopicSuffix(topics.map(topic => topic.name));

				const versionCollection = db.collection('configurationVersion');
				const update = {
					$set: {
						featureCompatibilityVersion: newFeatureCompatibilityVersion,
						topics: dbTopics
					}
				};

				versionCollection.updateOne(handleLeaderKeepaliveUpdateQuery, update, (err, result) => {
					if (err)
						return cb(new MongoError(err).log());

					if (result.modifiedCount !== 1)
						return cb(true);

					cb();
				});

			});
		},
		cb => {
			kafkaModule.getTopicChangesBetweenCompatibilityVersions(consts.FEATURE_COMPATIBILITY_TYPES.LEADER, null, zoneID,
				newFeatureCompatibilityVersion, oldFeatureCompatibilityVersion, (newTopics, deprecatedTopics) => {
					const newUpstreamTopics = newTopics.filter(kafkaModule.isUpstreamTopicByName);
					if (newUpstreamTopics.length)
						events.emitEvent([events.getZoneID(zoneID)], objectNotifier.events.newUpstreamTopicEvent, { topics: newUpstreamTopics });

					const deprecatedUpstreamTopics = deprecatedTopics.filter(kafkaModule.isUpstreamTopicByName);
					if (deprecatedUpstreamTopics.length)
						events.emitEvent([events.getZoneID(zoneID)], objectNotifier.events.removedUpstreamTopicEvent, { topics: deprecatedUpstreamTopics });

					cb();
				});
		},
	], err => {
		if (!err)
			new SystemAdminMessage(systemMessages.COMPONENT_VERSION_CHANGED)
				.addInfo(Entities.TomaLeader.Zone, zoneID)
				.addInfo(Entities.TomaLeader.FeatureCompatibilityVersion, newFeatureCompatibilityVersion)
				.addInfo(Entities.Target.featureCompatibilityVersion, oldFeatureCompatibilityVersion, Differentiators.Old)
				.addInfo(Entities.Target.featureCompatibilityVersion, newFeatureCompatibilityVersion, Differentiators.New)
				.log();

		callback(err, dbTopics);
	});
}

scope.handleLeaderKeepAlive = function(message, mainCallback) {
	const db = app.get('db');
	const versionCollection = db.collection('configurationVersion');
	var GLOBAL_SETTINGS = app.get('globalSettings');
	const keepaliveInterval = GLOBAL_SETTINGS.keepaliveIntervals.TOMA_LEADER;

	const firstLeaderToken = 1;

	let executionTimer = new ExecutionTimer('handleLeaderKeepalive');
	let saveLeaderKeepaliveFailed, shouldSendUpdateKeepaliveToken, dbLeaderToken, dbMessageSequence, dbRaftTerm,
		dbFeatureCompatibilityVersion, dbTopics, shouldUpdateKeepaliveInterval, shouldUpdateFeatureCompatibilityVersion;

	if (keepaliveInterval !== message.keepaliveInterval) {
		logger.sysDEBUG('Toma Leader keepalive interval differ from the configured interval, configured: '
			+ keepaliveInterval + ' actual: ' + message.keepaliveInterval);
		shouldUpdateKeepaliveInterval = true;
	}

	const getHandleLeaderKeepaliveUpdateQuery = (leaderToken, messageSequence, raftTerm, shouldMessageSequenceMatch) => {
		let messageSequenceQueryPart = shouldMessageSequenceMatch ? '$eq' : '$lt';

		return {
			_id: message.payload.zone,
			leaderToken: leaderToken,
			$or: [
				{ raftTerm: { $exists: 0 } },
				{ raftTerm: { $lt: raftTerm } },
				{
					raftTerm: { $eq: raftTerm },
					kafkaMessageSequence: { [messageSequenceQueryPart]: messageSequence }
				}
			]
		};
	};

	async.series([
		function handleLeaderKeepaliveValidations(callback) {
			callback(validateLeaderKeepAlive(message));
		},
		function handleLeaderKeepAliveSave(callback) {
			const $query = getHandleLeaderKeepaliveUpdateQuery(message.leaderToken, message.messageSequence, message.payload.raftTerm, false);
			$query.featureCompatibilityVersion = message.payload.featureCompatibilityVersion;

			const $update = {
				$set: {
					leaderToken: message.leaderToken,
					isUnavailable: false,
					kafkaMessageSequence: message.messageSequence,
					raftTerm: message.payload.raftTerm,
					lastReceivedLeaderKeepAlive: new Date(),
					stopSendingKeepaliveToken: false
				}
			};

			versionCollection.findOneAndUpdate($query, $update, { returnDocument: consts.mongoReturnDocument.BEFORE }, (err, result) => {
				if (err)
					return callback(new MongoError(err).log());

				if (!result)
					saveLeaderKeepaliveFailed = true;
				else {
					dbLeaderToken = result.leaderToken || message.leaderToken;
					dbTopics = result.topics;
					if (result.isUnavailable)
						events.emitEvent(null, objectNotifier.events.zoneAvailabilityChangeEvent);
				}

				callback();
			});
		},
		function handleLeaderKeepaliveFetchZone(callback) {
			if (!saveLeaderKeepaliveFailed)
				return callback();

			versionCollection.findOne({ _id: message.payload.zone }, (err, versionDocument) => {
				if (err)
					return callback(new MongoError(err).log());

				if (!versionDocument) {
					new SystemMessage(systemMessages.LEADER_KEEPALIVE_ZONE_NOT_FOUND).addInfo(Entities.Target.zone, message.payload.zone).log();
					return callback(true);
				}

				const isValidToken = versionDocument.leaderToken === message.leaderToken;
				const isLeaderChanged = versionDocument.raftTerm < message.payload.raftTerm;

				shouldSendUpdateKeepaliveToken = !isValidToken && (isLeaderChanged || !versionDocument.stopSendingKeepaliveToken);

				dbLeaderToken = versionDocument.leaderToken || firstLeaderToken;
				dbMessageSequence = versionDocument.kafkaMessageSequence;
				dbRaftTerm = versionDocument.raftTerm;
				dbFeatureCompatibilityVersion = versionDocument.featureCompatibilityVersion;
				dbTopics = versionDocument.topics;

				const isNewFeatureCompatibilityVersion = dbFeatureCompatibilityVersion &&
					utils.compareVersionRelease(message.payload.featureCompatibilityVersion, dbFeatureCompatibilityVersion) > 0;
				const isFeatureCompatibilityVersionMismatch = !dbFeatureCompatibilityVersion || isNewFeatureCompatibilityVersion;

				shouldUpdateFeatureCompatibilityVersion = isValidToken && isFeatureCompatibilityVersionMismatch;

				if (isNewFeatureCompatibilityVersion) {
					const lockCollection = db.collection('lock');

					return lockCollection.findOne({ _id: message.payload.zone }, { projection: { lastKafkaTopicsVersionCreated: 1 } }, (err, lock) => {
						if (err)
							return callback(new MongoError(err).log());

						// drop the keepalive if the topics are not created yet
						if (!lock.lastKafkaTopicsVersionCreated ||
							utils.compareVersionRelease(lock.lastKafkaTopicsVersionCreated, message.payload.featureCompatibilityVersion) < 0) {
							logger.sysDEBUG(`Topics for ${message.payload.zone} are not created yet, skipping this leader keepalive`);
							return callback(true);
						}

						kafkaModule.getZoneTopicsToCreate(message.payload.featureCompatibilityVersion, message.payload.zone, false, topics => {
							dbTopics = kafkaModule.mapTopicNamesToTopicSuffix(topics.map(topic => topic.name));
							callback();
						});

					});
				}

				callback();
			});
		},
		function handleFeatureCompatibilityVersionMismatch(callback) {
			if (!shouldUpdateFeatureCompatibilityVersion)
				return callback();

			const query = getHandleLeaderKeepaliveUpdateQuery(dbLeaderToken, dbMessageSequence, dbRaftTerm, true);

			if (!dbFeatureCompatibilityVersion) {
				const update = { $set: { featureCompatibilityVersion: message.payload.featureCompatibilityVersion } };

				return versionCollection.updateOne(query, update, err => {
					if (err)
						return callback(new MongoError(err).log());

					callback();
				});
			}

			const versions = {
				oldFeatureCompatibilityVersion: dbFeatureCompatibilityVersion,
				newFeatureCompatibilityVersion: message.payload.featureCompatibilityVersion
			};

			handleLeaderFeatureCompatibilityVersionChanged(message.payload.zone, versions, query, (err, topics) => {
				dbTopics = topics;
				callback(err);
			});
		},
		function sendUpdateKeepaliveTokenIfNeeded(callback) {
			if (!shouldSendUpdateKeepaliveToken && !shouldUpdateKeepaliveInterval)
				return callback();

			const msg = new UpdateLeaderKeepaliveToken(dbLeaderToken, keepaliveInterval);

			kafkaModule.sendMessages(dbTopics[consts.topicSuffix.LEADER_INCREMENTAL_UPDATES], [msg], err => {
				if (err) {
					new SystemMessage(systemMessages.KAFKA_SEND_MESSAGE_ERROR).addInfo(Entities.Error, err).log();
					return callback(err);
				}

				const $query = getHandleLeaderKeepaliveUpdateQuery(dbLeaderToken, dbMessageSequence, dbRaftTerm, true);
				const $update = {
					$set: {
						kafkaMessageSequence: message.messageSequence,
						raftTerm: message.payload.raftTerm,
						stopSendingKeepaliveToken: true
					}
				};

				versionCollection.updateOne($query, $update, (error, result) => {
					if (error)
						return callback(new MongoError(error).log());

					if (result.modifiedCount !== 1)
						return callback(true);

					callback();
				});
			}
			);
		}
	], error => {
		const isCriticalError = error instanceof MongoError;

		if (isCriticalError)
			error.log();

		executionTimer.stop(!isCriticalError);

		mainCallback(isCriticalError ? error : null);
	});
};

function sendUpdateTomaKeepaliveTokenWithDebouncer(targetID, zone, token, topic, callback) {
	let debouncerID = `${targetID}_askForTOMAKeepAlive`;
	utils.callFunctionWithDebouncer(
		() => { sendUpdateTomaKeepaliveTokenMessage(targetID, zone, token, topic); },
		debouncerID,
		consts.MINIMAL_TIME_BETWEEN_TOME_KEEPALIVE_REQUESTS
	);

	callback();
}

function sendUpdateTomaKeepaliveTokenMessage(targetID, zone, token, topic) {
	const GLOBAL_SETTINGS = app.get('globalSettings');
	const message = new UpdateTomaKeepaliveToken(targetID, token, GLOBAL_SETTINGS.keepaliveIntervals.TOMA, zone);

	kafkaModule.sendMessages(topic, [message]);
}

function handleTargetFeatureCompatibilityVersionChanged(message, target, callback) {
	const { featureCompatibilityVersion: oldFeatureCompatibilityVersion, zone } = target;
	const { hostname, payload: { featureCompatibilityVersion: newFeatureCompatibilityVersion } } = message;
	const db = app.get('db');
	const lockCollection = db.collection('lock');
	let results;

	logger.sysDEBUG(`Target featureCompatibilityVersion changed for ${hostname}!` +
		`Before: ${oldFeatureCompatibilityVersion}, New ${newFeatureCompatibilityVersion}`);

	async.series([
		cb => {
			const query = { _id: zone };
			const options = { projection: { _id: 1, lastKafkaTopicsVersionCreated: 1 } };

			lockCollection.findOne(query, options, (err, result) => {
				if (err)
					return cb(new MongoError(err).log());

				if (result.lastKafkaTopicsVersionCreated &&
					utils.compareVersionRelease(result.lastKafkaTopicsVersionCreated, newFeatureCompatibilityVersion) > 0)
					return cb();

				kafkaModule.getTopicChangesBetweenCompatibilityVersions(consts.FEATURE_COMPATIBILITY_TYPES.LEADER, null, zone,
					newFeatureCompatibilityVersion, oldFeatureCompatibilityVersion, toCreate => {
						if (toCreate.length)
							return kafkaModule.createZoneTopics(zone, newFeatureCompatibilityVersion, false, cb);

						scope.setTopicsCreated('lock', zone, 'lastKafkaTopicsVersionCreated', newFeatureCompatibilityVersion, cb);
					});
			});
		},
		cb => kafkaModule.createTargetTopics(hostname, zone, newFeatureCompatibilityVersion, false, (err, topics) => { results = topics; cb(); })
	], err => callback(err, results));
}

function handleNewTarget(newTarget, dbZone, callback) {
	kafkaModule.createTargetTopics(newTarget._id, dbZone, newTarget.featureCompatibilityVersion, false, (err, topics) => {
		if (err)
			return callback(err);

		newTarget.topics = topics;

		const db = app.get('db');
		const serverCollection = db.collection('server');

		serverCollection.insertOne(newTarget, (err) => {
			if (err) {
				const mongoError = new MongoError(err);

				if (mongoError.isDuplicateKeyError) {
					logger.sysDEBUG(`${newTarget._id} already exists - message may have been handled by another management`);
					return callback();
				}

				return callback(mongoError.log());
			}

			events.emitEvent([events.getTargetID(newTarget._id)], objectNotifier.events.newTargetEvent, newTarget);

			if (!dbZone)
				return callback();

			// happen only if zones disabled
			const lockCollection = db.collection('lock');
			const query = { _id: dbZone };
			const options = { projection: { _id: 1, lastKafkaTopicsVersionCreated: 1 } };

			lockCollection.findOne(query, options, (err, result) => {
				if (err)
					return callback(new MongoError(err).log());

				async.series([
					cb => {
						if (result.lastKafkaTopicsVersionCreated &&
							utils.compareVersionRelease(result.lastKafkaTopicsVersionCreated, newTarget.featureCompatibilityVersion) === 0)
							return cb();

						kafkaModule.createZoneTopics(dbZone, newTarget.featureCompatibilityVersion, false, cb);
					},
					cb => {
						sendUpdateTomaKeepaliveTokenWithDebouncer(
							newTarget._id,
							dbZone,
							newTarget.tomaToken,
							newTarget.topics[consts.topicSuffix.TOMA_COMMANDS],
							cb
						);
					}
				], () => callback());
			});
		});
	});
}

scope.handleKeepAlive = function(message, mainCallback) {
	let db = app.get('db');
	let serverCollection = db.collection('server');
	let executionTimer = new ExecutionTimer('targetHandleKeepAlive');
	const GLOBAL_SETTINGS = app.get('globalSettings');
	const keepaliveInterval = GLOBAL_SETTINGS.keepaliveIntervals.TOMA;

	if (!message.tomaToken && message.tomaToken !== 0) {
		new SystemMessage(systemMessages.TOMA_KEEPALIVE_WITHOUT_TOKEN).addInfo(Entities.Target.hostname, message.hostname).log();
		return mainCallback();
	}

	let isZonesEnabled = app.get('globalSettings').enableZones;
	let shouldCreateTarget = false;
	let shouldUpdateTarget = true;
	let fullTargetID = message.hostname;
	const { version, featureCompatibilityVersion, tomaSoftwareVersion, leaderUUID, bootTime } = message.payload;

	let currentTime = new Date();
	let dbTomaToken = 1;
	let dbIsPending;
	let dbZone = isZonesEnabled ? null : '1';
	let dbFeatureCompatibilityVersion;
	let dbTopics;
	let shouldUpdateKeepaliveInterval = false;

	if (keepaliveInterval !== message.keepaliveInterval) {
		logger.sysDEBUG('Toma keepalive interval differ from the configured interval, configured: '
			+ keepaliveInterval + ' actual: ' + message.keepaliveInterval);
		shouldUpdateKeepaliveInterval = true;
	}

	async.series([
		function lookForExistingTarget(callback) {
			serverCollection.findOne({ _id: fullTargetID }, { tomaToken: 1, isPending: 1, zone: 1, topics: 1, featureCompatibilityVersion: 1 },
				(err, result) => {
					if (err)
						return callback(new MongoError(err).log());

					if (result) {
						dbTomaToken = result.tomaToken;
						dbIsPending = result.isPending;
						dbZone = dbZone || result.zone;
						dbFeatureCompatibilityVersion = result.featureCompatibilityVersion;
						dbTopics = result.topics;

						if (!dbZone)
							shouldUpdateTarget = false;

					} else {
						// accept Toma token from message only if the target does not exist and the Token > 0
						// hanldes a case that the target was deleted while Toma was up
						// in case we use TOMA token, we must inc it by one otherwise we will send an update token to TOMA with a token it
						// already have (and then will not follow by reportTarget from TOMA)
						dbTomaToken = message.tomaToken > 0 ? message.tomaToken + 1 : dbTomaToken;
						shouldCreateTarget = true;
					}

					callback();
				});
		},
		function createTargetIfNeeded(callback) {
			if (!shouldCreateTarget)
				return callback();

			const newTarget = {
				_id: fullTargetID,
				node_id: message.hostname,
				uuid: uuid.v1(),
				disks: [],
				nics: [],
				isPending: true,
				restartRequired: true,
				lastReceivedTomaKeepAlive: currentTime,
				dateCreated: currentTime,
				dateModified: currentTime,
				tomaStatus: consts.tomaStatuses.UP,
				node_status: consts.nodeStatus.OK,
				kafkaMessageSequence: { [message.type]: message.messageSequence },
				health: consts.targetHealth.CRITICAL,
				tomaToken: dbTomaToken,
				bootTime: bootTime,
				nicsVersion: 0,
				version,
				featureCompatibilityVersion,
				tomaSoftwareVersion
			};

			handleNewTarget(newTarget, dbZone, callback);
		},
		function checkForTOMARestart(callback) {
			if (shouldCreateTarget || !shouldUpdateTarget || message.tomaToken !== -1)
				return callback();

			const increaseTokenAndSend = () => {
				shouldUpdateTarget = false;
				logger.sysDEBUG('Received tomaToken -1, increasing the tomaToken');
				scope.setTomaStatus(fullTargetID, consts.tomaStatuses.UNAVAILABLE, dbTomaToken, (err, target) => {
					if (!err && target)
						return sendUpdateTomaKeepaliveTokenWithDebouncer(
							fullTargetID,
							dbZone,
							++target.tomaToken,
							dbTopics[consts.topicSuffix.TOMA_COMMANDS],
							callback
						);

					callback();
				});
			};

			const comparisonVersionResult = dbFeatureCompatibilityVersion &&
				utils.compareVersionRelease(featureCompatibilityVersion, dbFeatureCompatibilityVersion);

			if (comparisonVersionResult > 0) {
				const target = { featureCompatibilityVersion: dbFeatureCompatibilityVersion, zone: dbZone };
				return handleTargetFeatureCompatibilityVersionChanged(message, target, (err, newTopics) => {
					if (err)
						return callback(err);

					dbTopics = newTopics;
					increaseTokenAndSend();
				});
			}

			// old message - can be ignored
			if (comparisonVersionResult < 0)
				return callback();

			increaseTokenAndSend();
		},
		function updateTargetIfNeeded(callback) {
			if (shouldCreateTarget || !shouldUpdateTarget)
				return callback();

			const updateTarget = newTopics => {
				const query = {
					_id: fullTargetID,
					$and: [{
						$or: [
							{ tomaToken: { $exists: false } },
							{ tomaToken: message.tomaToken, [`kafkaMessageSequence.${message.type}`]: { $lt: message.messageSequence } }
						]
					}, {
						$or: [{ zone: { $exists: 0 } }, { zone: message.payload.zone }]
					}]
				};

				const update = {
					$set: {
						lastReceivedTomaKeepAlive: currentTime,
						dateModified: currentTime,
						tomaStatus: consts.tomaStatuses.UP,
						node_status: consts.nodeStatus.OK,
						bootTime,
						leaderUUID,
						[`kafkaMessageSequence.${message.type}`]: message.messageSequence,
						version,
						featureCompatibilityVersion,
						tomaSoftwareVersion,
						rebuildStats: message.payload.rebuildStats
					}
				};

				if (newTopics)
					update.$set.topics = newTopics;

				serverCollection.updateOne(query, update, (err) => {
					if (err)
						return callback(new MongoError(err).log());

					// In case we couldnt save due to 1 of the following options:
					// 1. tomaToken increased
					// 2. enableZone === false + first keepalive after TOMA restart
					// or we need to udpdate the keepalive interval due to a change
					if (dbTomaToken > message.tomaToken ||
						(!isZonesEnabled && !dbIsPending && dbZone !== message.payload.zone) ||
						shouldUpdateKeepaliveInterval)
						return sendUpdateTomaKeepaliveTokenWithDebouncer(
							message.hostname,
							dbZone,
							dbTomaToken,
							(newTopics || dbTopics)[consts.topicSuffix.TOMA_COMMANDS],
							callback
						);

					if (newTopics)
						new SystemAdminMessage(systemMessages.COMPONENT_VERSION_CHANGED)
							.addInfo(Entities.Target.ID, fullTargetID)
							.addInfo(Entities.Target.featureCompatibilityVersion, dbFeatureCompatibilityVersion, Differentiators.Old)
							.addInfo(Entities.Target.featureCompatibilityVersion, featureCompatibilityVersion, Differentiators.New)
							.log();

					if (newTopics && newTopics[consts.topicSuffix.TOMA_HARDWARE_CONF] !== dbTopics[consts.topicSuffix.TOMA_HARDWARE_CONF])
						zoneModule.dispatchZonesHardwareConfigurationByZones([dbZone]);

					callback();
				});
			};

			if (utils.compareVersionRelease(featureCompatibilityVersion, dbFeatureCompatibilityVersion) > 0)
				return kafkaModule.getTargetTopicsToCreate(featureCompatibilityVersion, fullTargetID, dbZone, false, topics =>
					updateTarget(kafkaModule.mapTopicNamesToTopicSuffix(topics.map(topic => topic.name))));

			updateTarget();

		}], error => {
		const isCriticalError = error instanceof MongoError;

		if (isCriticalError)
			logger.sysERROR(error);

		executionTimer.stop(!isCriticalError);

		mainCallback(isCriticalError ? error : null);
	});
};

function isFirstReportHandled(target) {
	return app.get('globalSettings').enableZones && target.isPending || !!target.zone;
}

// calcDelta is an object that saves all the changes needed to be save by set / push / pull and generates the right query
// PAY ATTENTION that push and pull cannot be done together for the same entitiy (nic/disk/diskSegment) at the same query,
// therefore nics are always saved by using set (overriding), and we do not remove disks, so disk can be pushed
function handleServerReport(message, lastServer, isPartialReportSave, cb) {
	var GLOBAL_SETTINGS = app.get('globalSettings');
	var GLOBAL_SETTINGS_HIDDEN = app.get('globalSettingsHidden');
	var db = app.get('db');
	var serverCollection = db.collection('server');
	var savedToDB = false;
	var shouldStartVolumeRebuild = false;
	var updateConfiguration;
	var diskOldPresence = [];
	var nicOldPresence = [];
	var eventsToEmitOnInsert = [];
	var logsToEmitOnInsert = [];
	var disksToAutoEvict = [];
	var diskIDsAndUUIDsToAutoFormat = [];
	var resendReportNewDrives = [];
	var resendReportExistingDrives = [];
	var resendReportReappearingDrives = [];
	var affectedZones = {};
	var targetZoneChanged = false;
	var outdatedReappearingDrives = [];
	var reappearingDiskSegments = [];
	var shouldIncreaseNicsVersion = false;

	var node = message.payload.node;

	node.node_id = message.hostname;
	node.tomaToken = message.tomaToken;

	logger.sysDEBUG(`handleServerReport for ${node.node_id} with node_status: ${node.node_status}`);

	var calcDelta = new utils.calcDelta();

	var isZonesMode = GLOBAL_SETTINGS.enableZones;
	var isNewTarget = !isFirstReportHandled(lastServer);

	if (isNewTarget) {
		if (!isZonesMode) {
			calcDelta.updateTarget(lastServer, 'zone', '1');
			calcDelta.updateTarget(lastServer, 'isPending', false);
			calcDelta.updateTarget(lastServer, 'isTargetUpdateSequenceInc', false);
			calcDelta.updateTarget(lastServer, 'addTargetMessageRequired', true);

			targetZoneChanged = true;
		} else
			calcDelta.updateTarget(lastServer, 'isPending', true);
	}

	updateServerStatus.bind(calcDelta)(lastServer, node);

	function increaseNicsVersion() {
		lastServer.nicsVersion += 1;
		calcDelta.updateTarget(lastServer, 'nicsVersion', lastServer.nicsVersion);
	}

	var newDisks = [];
	var newNics = [];

	async.series([
		function(callback) {
			// handle new drives on first phase
			if (isPartialReportSave)
				return callback();

			var oldDisksIds = lastServer.disks.map(function(d) { return d.diskID; });
			// filter only new disks
			// for backward compatibility - stop supporting Dummy drive and avoid adding it as a new drive
			newDisks = node.disks.filter(function(disk) { return oldDisksIds.indexOf(disk.diskID) == -1 && disk.Model !== consts.DUMMY_DRIVE_MODEL; });

			async.eachSeries(newDisks, function(newDisk, callback) {

				portOldSegmentsOnReappearing.bind(calcDelta)(node, newDisk, eventsToEmitOnInsert, calcDelta,
					function(data, oldPresence, isOutdatedDriveReport, shouldAutoEvict) {
						if (data)
							newDisk = data;

						// checking if drive report is outdated (reappearingCounter is not synced)
						if (isOutdatedDriveReport) {
							diskModule.printOutdatedDriveReportMsgToDEBUG(newDisk, oldPresence.disks);
							updateReappearingDriveAndAddToResendReport.bind(calcDelta)(oldPresence.disks, resendReportReappearingDrives
								, oldPresence.disks.reappearingOutOfSync);
							outdatedReappearingDrives.push(newDisk.diskID);
							return callback();
						}

						var isReappear = false;
						var dbDisk = null;

						if (oldPresence && oldPresence.disks) {
							if (newDisk.diskSegments && newDisk.diskSegments.length)
								reappearingDiskSegments = reappearingDiskSegments.concat(newDisk.diskSegments);

							dbDisk = oldPresence.disks;
							isReappear = true;
							newDisk.version++;

							eventsToEmitOnInsert.push({
								ids: [events.getTargetID(node.node_id), events.getDiskID(newDisk.diskID)],
								event: objectNotifier.events.diskReappearEvent,
								payload: newDisk
							});

							diskOldPresence.push({ diskID: newDisk.diskID, reappearingCounter: newDisk.reappearingCounter });
							affectedZones[oldPresence.zone] = 1;
							affectedZones[lastServer.zone] = 1;

							checkAndExcludeIfDriveChangedZone(dbDisk, newDisk, oldPresence.zone, lastServer.zone, logsToEmitOnInsert);
						} else {
							diskModule.parseDriveVendor(newDisk);
							diskModule.setDiskInfo.bind(calcDelta)(newDisk, false);
							newDisk.version = 1;
							newDisk.formatRequestCounter = 0;
							affectedZones[lastServer.zone] = 1;
							updateDriveAndAddToResendReport.bind(calcDelta)(newDisk, resendReportNewDrives, null);
						}

						diskModule.handleDriveFormatProcessIfNeeded.bind(calcDelta)(
							dbDisk,
							newDisk,
							isReappear,
							eventsToEmitOnInsert,
							node.node_id,
							node.bootTime,
							calcDelta,
							function(formatDone, driveEvictionNeeded) {
								if (driveEvictionNeeded || (formatDone && !diskModule.handleFormatDone.bind(calcDelta)(newDisk, null, calcDelta))
									|| shouldAutoEvict)
									disksToAutoEvict.push(newDisk);
								else if (formatDone && GLOBAL_SETTINGS_HIDDEN.autoFormatDrive)
									shouldStartVolumeRebuild = true;

								if (!diskModule.checkDiskStatus.bind(calcDelta)(null, newDisk, eventsToEmitOnInsert, node, calcDelta)
										&& node.health !== consts.targetHealth.CRITICAL)
									calcDelta.updateTarget(node, 'health', consts.targetHealth.ALARM);

								// process gpt and validate size if needed
								diskModule.processAndValidateDrive.bind(calcDelta)(newDisk, oldPresence ? oldPresence.disks : null,
									isReappear, lastServer, disksToAutoEvict, formatDone, eventsToEmitOnInsert, calcDelta);

								updateConfiguration = true;
								calcDelta.pushDiskToTarget(lastServer, newDisk);

								if (dbDisk && dbDisk.isPendingFormat && dbDisk.formatDetails && newDisk.isPendingFormat !== false) {
									// calling createFormatDriveEvent without bind calcDelta and bootTime since it is a newly added drive
									// it will not be udpated but pushed, therefore we add the bootTime in the next line
									eventsToEmitOnInsert.push(diskModule.createFormatDriveEvent(null, dbDisk, node.node_id, null));
									newDisk.formatDetails.bootTime = node.bootTime;
								}

								if (!isReappear && GLOBAL_SETTINGS_HIDDEN.autoFormatDrive && newDisk.status === consts.diskStatus.NOT_INITIALIZED)
									diskIDsAndUUIDsToAutoFormat.push({ _id: newDisk.diskID, uuid: newDisk.uuid });

								callback();
							}
						);
					});
			}, function() {
				if (outdatedReappearingDrives.length) {
					// remove the outdated reappearingDrive so we won't stuck in a loop of partial report since the drive is not saved on the new target yet
					node.disks = node.disks.filter(function(disk) { return outdatedReappearingDrives.indexOf(disk.diskID) == -1; });
				}
				callback();
			});
		},
		function handleNewNicsOnFirstPhase(callback) {
			if (isPartialReportSave)
				return callback();

			var oldNics = lastServer.nics.map(function(n) { return n.nicID; });
			newNics = node.nics.filter(function(nic) { return oldNics.indexOf(nic.nicID) == -1; });

			async.eachSeries(newNics, function(newNic, callback) {
				getNicOldPresence(newNic, function(oldPresence) {
					if (oldPresence && oldPresence.nics) {
						newNic.uuid = oldPresence.nics.uuid;
						newNic.version = oldPresence.nics.version + 1;
						affectedZones[oldPresence.zone] = 1;
						affectedZones[lastServer.zone] = 1;

						eventsToEmitOnInsert.push({
							ids: [events.getTargetID(node.node_id), events.getNicID(newNic.nicID)],
							event: objectNotifier.events.nicReappearEvent,
							payload: newNic
						});

						nicOldPresence.push(oldPresence.nics);
					} else {
						newNic.version = 1;
						affectedZones[lastServer.zone] = 1;

						eventsToEmitOnInsert.push({
							ids: [events.getTargetID(node.node_id), events.getNicID(newNic.nicID)],
							event: objectNotifier.events.newNicEvent,
							payload: newNic
						});

						newNic.uuid = uuid.v1();
					}

					newNic.status = getNicStatus(newNic);
					newNic.protocol = getNicProtocol(newNic);
					newNic.pkey = parseInt(newNic.pkey, 16);
					newNic.nodeUUID = lastServer.uuid;

					checkNicStatus.bind(calcDelta)(null, newNic, eventsToEmitOnInsert, node, calcDelta);

					setNicsCount(newNic.status == 1 ? 0 : 1, 1);
					updateConfiguration = true;

					calcDelta.pushNicToTarget(lastServer, newNic);
					shouldIncreaseNicsVersion = true;

					callback();
				});
			}, function() {
				if (shouldIncreaseNicsVersion)
					increaseNicsVersion();

				callback();
			});
		}
	], function() {
		if (newDisks.length || newNics.length) {
			// save partial report with kafkaMessageSequence-0.5 and re-handleServerReport with the original kafkaMessageSequence
			// to avoid push and set in one query
			var originalReportedKafkaMessageSequence = message.messageSequence;
			message.messageSequence = message.messageSequence - 0.5;

			saveTargetReport(false, function(err) {
				if (err)
					logger.sysDEBUG(`Something went wrong while trying to save partial report of target: ${node.node_id}, err: `, err);

				message.messageSequence = originalReportedKafkaMessageSequence;
				handleServerReport(message, lastServer, true, cb);
			});
		} else
			handleExistingEntitiesReportChanges(isPartialReportSave, cb);
	});

	function handleExistingEntitiesReportChanges(isPartialReportSave, callback) {
		affectedZones[lastServer.zone] = 1;

		// handle everything but new drives or new nics
		lastServer.disks.forEach(function(oldDisk) {
			var existingReportDisk = null;
			//Check if the existing disk presented in the new server report object.
			node.disks.forEach(function(newDisk) {
				if (newDisk.diskID === oldDisk.diskID) {
					existingReportDisk = newDisk;
					return false;
				}
			});

			var shouldReport = true;
			//The disks is there
			if (existingReportDisk) {
				// checking if drive report is outdated (reappearingCounter is not synced)
				if (diskModule.shouldResendReport(existingReportDisk, oldDisk)) {
					diskModule.printOutdatedDriveReportMsgToDEBUG(existingReportDisk, oldDisk);
					updateDriveAndAddToResendReport.bind(calcDelta)(oldDisk, resendReportExistingDrives, oldDisk.reappearingOutOfSync);
				} else {
					if (oldDisk.reappearingOutOfSync) {
						calcDelta.updateDisk(oldDisk, oldDisk.uuid, 'reappearingOutOfSync', false);
					}

					diskModule.handleDriveFormatProcessIfNeeded.bind(calcDelta)(oldDisk, existingReportDisk, false, eventsToEmitOnInsert,
						node.node_id, node.bootTime, calcDelta, function(formatDone, driveEvictionNeeded) {
							if (formatDone) {
								updateConfiguration = true;

								if (GLOBAL_SETTINGS_HIDDEN.autoFormatDrive)
									shouldStartVolumeRebuild = true;

								if (!diskModule.handleFormatDone.bind(calcDelta)(oldDisk, existingReportDisk, calcDelta))
									disksToAutoEvict.push(oldDisk);
							} else if (!updateGPTProperties.bind(calcDelta)(oldDisk, existingReportDisk, calcDelta) || driveEvictionNeeded)
								disksToAutoEvict.push(oldDisk);

							// process gpt and validate size if needed
							diskModule.processAndValidateDrive.bind(calcDelta)(existingReportDisk, oldDisk, false, lastServer,
								disksToAutoEvict, formatDone, eventsToEmitOnInsert, calcDelta);

							if (!diskModule.checkDiskStatus.bind(calcDelta)(oldDisk, existingReportDisk, eventsToEmitOnInsert, node, calcDelta)
								&& node.health !== consts.targetHealth.CRITICAL)
								node.health = consts.targetHealth.ALARM;

							updateDiskProperties.bind(calcDelta)(oldDisk, existingReportDisk);

							calcDelta.updateDisk(oldDisk, oldDisk.uuid, 'status', existingReportDisk.status);

							if (existingReportDisk.isPendingFormat || existingReportDisk.isPendingFormat === false)
								calcDelta.updateDisk(oldDisk, oldDisk.uuid, 'isPendingFormat', existingReportDisk.isPendingFormat);

							if (oldDisk.isPendingFormat && oldDisk.formatDetails)
								eventsToEmitOnInsert.push(diskModule.createFormatDriveEvent.bind(calcDelta)(oldDisk, oldDisk, node.node_id, node.bootTime));
						});
				}
			} else {
				// disk doesn't exists on new report
				var volumeSegments = oldDisk.diskSegments ? oldDisk.diskSegments.filter(function(seg) {
					return !seg.owner || (seg.owner === consts.segmentOwners.NVMESH && seg.type !== consts.segmentTypes.EXCELERO_METADATA);
				}) : [];

				// Check if we already know that the disk is missing
				if (oldDisk.status === consts.diskStatus.MISSING)
					shouldReport = false;
				else {
					if (volumeSegments.filter(function(seg) { return seg.remainingDirtyBits > 0; }).length) {
						logsToEmitOnInsert.push({ logLevel: consts.logsLevel.WARNING,
							logMsg: 'The drive: ' + oldDisk.diskID + ' is missing and has segments with dirty bits, rebuild stopped.',
							logHeader: 'Drive missing during rebuild' });
					}

					if (oldDisk.isOutOfService && volumeSegments.length) {
						logsToEmitOnInsert.push({ logLevel: consts.logsLevel.ERROR,
							logMsg: 'The drive: ' + oldDisk.diskID + ' has been removed from the system before rebuild is done',
							logHeader: 'Incomplete rebuild' });
					}
				}

				if (shouldReport) {
					var diskClone = utils.extend(true, diskClone, oldDisk);
					diskClone.status = consts.diskStatus.MISSING;
					diskModule.checkDiskStatus.bind(calcDelta)(oldDisk, diskClone, eventsToEmitOnInsert, node, calcDelta);
					calcDelta.updateDisk(oldDisk, oldDisk.uuid, 'status', consts.diskStatus.MISSING);
					calcDelta.updateDisk(oldDisk, oldDisk.uuid, 'missingSince', new Date());
				}

				if (node.health !== consts.targetHealth.CRITICAL)
					calcDelta.updateTarget(node, 'health', consts.targetHealth.ALARM);
			}
		});

		lastServer.nics.forEach(function(oldNic) {
			var existingReportNic = null;

			node.nics.forEach(function(newNic) {
				if (newNic.nicID === oldNic.nicID) {
					existingReportNic = newNic;
					existingReportNic.health = oldNic.health;
					existingReportNic.version = oldNic.version;
					return false;
				}
			});

			if (!existingReportNic) {
				//If the nic status was "Missing" no need to report.
				if (oldNic.status !== consts.nicStatus.MISSING) {
					setNicsCount(1, 0);
					let newNic = utils.extend(true, {}, oldNic);
					calcDelta.updateNic(newNic, newNic.uuid, 'status', consts.nicStatus.MISSING);
					checkNicStatus.bind(calcDelta)(oldNic, newNic, eventsToEmitOnInsert, node, calcDelta);
					shouldIncreaseNicsVersion = true;
				}
			} else {
				parseNicAttributes(existingReportNic);

				if (oldNic.status !== existingReportNic.status) {
					setNicsCount(oldNic.status === consts.nicStatus.OK ? -1 : 1, 0);
					shouldIncreaseNicsVersion = true;
				}

				if (isNicChanged.bind(calcDelta)(oldNic, existingReportNic, eventsToEmitOnInsert, node)) {
					updateConfiguration = true;
					shouldIncreaseNicsVersion = true;
				}

				checkNicStatus.bind(calcDelta)(oldNic, existingReportNic, eventsToEmitOnInsert, node, calcDelta);

				updateNicAttributes.bind(calcDelta)(oldNic, existingReportNic);
			}
		});

		if (shouldIncreaseNicsVersion)
			increaseNicsVersion();

		saveTargetReport(isPartialReportSave, callback);
	}

	function saveTargetReport(isPartialReportSave, mainCallback) {
		var allNics = lastServer.nics.concat(newNics);
		if (isPartialReportSave) {
			if (allNics.length && lastServer.health === consts.targetHealth.HEALTHY)
				if (allNics.some(function(e) { return e.status !== consts.nicStatus.OK; }))
					node.health = consts.targetHealth.ALARM;
		} else {
			if (allNics.length) {
				if (allNics.every(function(e) { return e.status !== consts.nicStatus.OK; }))
					node.health = consts.targetHealth.CRITICAL;
				else if (allNics.some(function(e) { return e.status !== consts.nicStatus.OK; }) && node.health !== consts.targetHealth.CRITICAL)
					node.health = consts.targetHealth.ALARM;
			} else
				node.health = consts.targetHealth.CRITICAL;
		}

		var currentTime = new Date();
		calcDelta.updateTarget(lastServer, 'node_status', node.node_status);
		calcDelta.updateTarget(lastServer, 'dateModified', currentTime);

		//If software is down, don't save the version info (might change when upgrading the target)
		if (node.node_status !== consts.nodeStatus.DOWN) {
			calcDelta.updateTarget(lastServer, 'version', node.version);
			calcDelta.updateTarget(lastServer, 'branch', node.branch);
			calcDelta.updateTarget(lastServer, 'commit', node.commit);
		}

		async.series([
			function(callback) {
				node.health_old = lastServer.health;

				if (node.health !== node.health_old) {
					switch (node.health) {
						case consts.targetHealth.ALARM:
							addEventOrEditOldHealth(eventsToEmitOnInsert,
								[events.getTargetID(node.node_id), 'emitted_from_server_report_ALARM'],
								objectNotifier.events.targetFailureEvent,
								node);

							break;
						case consts.targetHealth.HEALTHY:
							addEventOrEditOldHealth(eventsToEmitOnInsert,
								[events.getTargetID(node.node_id)],
								objectNotifier.events.targetWentOnlineEvent,
								node);

							break;
						case consts.targetHealth.CRITICAL:
							addEventOrEditOldHealth(eventsToEmitOnInsert,
								[events.getTargetID(node.node_id), 'emitted_from_server_report_CRITICAL'],
								objectNotifier.events.targetFailureEvent,
								node);

							break;
					}

				}
				calcDelta.updateTarget(lastServer, 'health', node.health);
				callback();
			},
			function handleServerConfigurationProfile(callback) {
				calcDelta.updateTarget(lastServer, 'configProfile', node.configProfile);
				if (!lastServer.restartRequired)
					return callback();
				else {
					configurationProfile.handleComponentConfigProfileReport('target', node.node_id, node.configProfile,
						function(err, canRemoveRestartRequired) {
							if (err)
								logger.sysDEBUG('Error updating config profile version from target report');

							if (canRemoveRestartRequired) {
								calcDelta.updateTarget(lastServer, 'restartRequired', false);

								eventsToEmitOnInsert.push({
									ids: [events.getTargetID(node.node_id)],
									event: objectNotifier.events.restartRequiredChanged,
									payload: { nodeID: node.node_id, restartRequired: false }
								});
							}

							callback();
						});
				}
			},
			function(callback) {
				var query = { '_id': lastServer._id };
				var messageSequenceQuery = {
					$or: [{
						[`kafkaMessageSequence.${message.type}`]: { $exists: 0 }
					}, {
						tomaToken: { $exists: false }
					}, {
						tomaToken: message.tomaToken,
						[`kafkaMessageSequence.${message.type}`]: lastServer.kafkaMessageSequence?.[message.type],
						[`kafkaMessageSequence.${message.type}`]: { $lt: message.messageSequence }
					}]
				};

				if (node.zone)
					query['$and'] = [messageSequenceQuery, { $or: [{ zone: { $exists: 0 } }, { zone: node.zone }] }];
				else
					query['$or'] = messageSequenceQuery['$or'];

				calcDelta.updateObjectInTarget(lastServer, 'kafkaMessageSequence', message.type, message.messageSequence);
				calcDelta.updateTarget(lastServer, 'lastReceivedReport', currentTime);

				var queryParts = calcDelta.generateQueryParts();

				serverCollection.updateOne(
					query,
					queryParts.update, {
						arrayFilters: queryParts.arrayFilters
					},
					function(err, results) {
						if (err)
							return callback(new MongoError(err).log());

						if (results.modifiedCount == 0) {
							callback(new SystemMessage(systemMessages.REPORT_NOT_SAVED)
								.addInfo(Entities.Target.ID, node.node_id)
								.addInfo(Entities.Target.reportID, node.reportID)
								.addInfo(Entities.Target.tomaToken, node.tomaToken));
						} else {
							savedToDB = true;

							if (targetZoneChanged)
								return scope.incZoneTargetsForNewTarget('1', node.node_id, () => {
									objectNotifier.updateObject(objectNotifier.events.targetZoneChange.name);
									callback();
								});

							callback(null);
						}
					});
			},
			//increase reappearingCounter for disks old presence (reappearing drives) before emitting resendReport events
			function(callback) {
				if (resendReportReappearingDrives.length)
					increaseOriginTargetReappearingCounter(resendReportReappearingDrives, function() {
						callback();
					});
				else
					callback();
			},
			function(callback) {
				removeDisksOldPresence(diskOldPresence, node.node_id, function() {
					callback();
				});
			},
			function(callback) {
				removeNicsOldPresence(nicOldPresence, node.node_id, function() {
					callback();
				});
			},
			function(callback) {
				// update volume segments of reappearing drives with new node id and sending update volume messages to the relevant Toma's & clients
				if (savedToDB && reappearingDiskSegments.length)
					scope.updateVolumeSegmentsNewNodeId(node, reappearingDiskSegments, (err) => {
						if (err)
							new SystemMessage(systemMessages.TARGET_SAVE_NEW_NODE_ID_ON_VOLUMES_FAILED).addInfo(Entities.Error, err).log();

						callback();
					});
				else
					callback();
			},
			function(callback) {
				if (savedToDB && updateConfiguration) {
					let zones = Object.keys(affectedZones);

					utils.incZonesConfigurationVersion(zones, () => {
						zoneModule.dispatchZonesHardwareConfigurationByZones(zones, callback);
					});
				} else
					callback(null);
			},
			function(callback) {
				if (savedToDB && shouldIncreaseNicsVersion) {
					clientModule.updateClientsOnNicsVersionChange(node.node_id, callback);
				} else
					callback(null);
			}],
		function(err) {
			if (!err) {
				eventsToEmitOnInsert.forEach(function(event) {
					events.emitEvent(event.ids, event.event, event.payload);

					// should we still be sending twice the same message, if eventsToEmitOnInsert includes multiple instances of it ?
					if (event.event.name === objectNotifier.events.formatDiskEvent.name)
						kafkaModule.sendMessages(lastServer.topics[consts.topicSuffix.TOMA_COMMANDS], [new FormatDrive(event.payload)]);
				});

				logsToEmitOnInsert.forEach(function(logEvent) {
					logger[logEvent.logLevel](logEvent.logMsg, { header: logEvent.logHeader });
				});

				var resendReportDrives = resendReportNewDrives.concat(resendReportReappearingDrives, resendReportExistingDrives);

				sendResendReportMessageIfNeeded(
					resendReportDrives,
					node.node_id,
					lastServer.tomaToken || node.tomaToken,
					lastServer.topics[consts.topicSuffix.TOMA_COMMANDS]
				);

				async.series([
					function(callback) {
						// auto evict disks that didn't pass gpt or size checks
						if (savedToDB && disksToAutoEvict.length) {
							disksToAutoEvict.forEach(function(drive) {
								logger.sysDEBUG('Going to auto evict drive: ' + drive.diskID + ' for the following reason: ' +
									drive.autoEvictReason || consts.autoEvictReason.DEFAULT);
							});

							diskModule.evictDiskByDiskIDsAndUUIDs(disksToAutoEvict, consts.SYSTEM_USER, true, null, null, null, evictLogs => {
								logWithRequestUUID(evictLogs);
								callback();
							});
						} else
							callback();
					},
					function(callback) {
						// auto format new disks with not_initialzied status
						if (savedToDB && diskIDsAndUUIDsToAutoFormat.length) {
							diskModule.formatDiskByIDsAndUUIDs(diskIDsAndUUIDsToAutoFormat, null, true, () => callback());
						} else
							callback();
					},
					function(callback) {
						// start volume rebuild for relevant volumes if needed
						if (savedToDB && shouldStartVolumeRebuild) {
							utils.startVolumeRebuildForAllRelevantVolumes(consts.SYSTEM_USER);
						}

						callback();
					}
				], function() {
					mainCallback();
				});
			} else {
				logger.sysERROR(err);

				if (err instanceof MongoError)
					mainCallback(err);
				else
					mainCallback();
			}
		});
	}
}

function addEventOrEditOldHealth(eventsToEmitOnInsert, ids, eventToAdd, payload) {
	var exists;

	eventsToEmitOnInsert.forEach(function(e) {
		if (e.event.name === eventToAdd.name) {
			e.ids = utils.uniqueUnion([e.ids, ids]);
			e.payload.health = payload.health;
			exists = true;
		}
	});

	if (!exists)
		eventsToEmitOnInsert.push({ ids: ids, event: eventToAdd, payload: payload });
}

function removeNicsOldPresence(nicsToRemove, nodeID, callback) {
	var db = app.get('db');
	var serverCollection = db.collection('server');

	if (nicsToRemove && nicsToRemove.length)
		serverCollection.updateMany({ node_id: { $ne: nodeID } }, { $pull: { nics: { nicID: { $in: nicsToRemove } } } }, function(err) {
			if (err)
				new MongoError(err).log();

			callback(err);
		});
	else
		callback();
}

function getNicOldPresence(nic, callback) {
	var db = app.get('db');
	var server = db.collection('server');

	server.aggregate([{ $unwind: '$nics' }, { $match: { 'nics.nicID': nic.nicID } }]).toArray(function(err, results) {
		if (err)
			new MongoError(err).log();

		var oldNICPresence;

		if (results && results.length)
			oldNICPresence = results[0];

		callback(oldNICPresence);
	});
}

function getDiskOldPresence(disk, callback) {
	var db = app.get('db');
	var server = db.collection('server');

	server.aggregate([{ $unwind: '$disks' }, { $match: { 'disks.diskID': disk.diskID } }]).toArray(function(err, results) {
		if (err)
			new MongoError(err).log();

		var oldDiskPresence;
		if (results && results.length)
			oldDiskPresence = results[0];

		callback(oldDiskPresence);
	});
}

function portOldSegmentsOnReappearing(newServer, disk, eventsList, calcDelta, callback) {
	getDiskOldPresence(disk, function(oldPresence) {
		disk.nodeID = newServer.node_id;
		disk.nodeUUID = newServer.uuid;

		if (oldPresence && oldPresence.disks) {
			var shouldAutoEvict = false;
			// checking if drive report is outdated (reappearingCounter is not synced)
			if (diskModule.shouldResendReport(disk, oldPresence.disks))
				return callback(disk, oldPresence, true);

			disk.formatRequestCounter = oldPresence.disks.formatRequestCounter;
			disk.isOutOfService = oldPresence.disks.isOutOfService || false;
			disk.automaticallyEvicted = oldPresence.disks.automaticallyEvicted || false;
			if (oldPresence.disks.autoEvictReason)
				disk.autoEvictReason = oldPresence.disks.autoEvictReason;
			disk.diskSegments = oldPresence.disks.diskSegments || [];
			disk.uuid = oldPresence.disks.uuid;
			disk.version = oldPresence.disks.version;
			disk.vendorID = oldPresence.disks.vendorID;
			disk.Vendor = oldPresence.disks.Vendor;

			disk.diskSegments.forEach(function(ds) {
				ds.node_id = newServer.node_id;
				ds.nodeUUID = newServer.uuid;
			});

			disk.largestSegmentAvailable = oldPresence.disks.largestSegmentAvailable;
			disk.usableBlocks = oldPresence.disks.usableBlocks;
			disk.availableBlocks = oldPresence.disks.availableBlocks;

			if (oldPresence.disks.formatInProgress)
				disk.formatInProgress = oldPresence.disks.formatInProgress;

			if (oldPresence.disks.formatDetails)
				disk.formatDetails = oldPresence.disks.formatDetails;

			if (disk.GPT && oldPresence.disks.GPT) {
				disk.GPT.firstUsableLba = oldPresence.disks.GPT.firstUsableLba;
				disk.GPT.lastUsableLba = oldPresence.disks.GPT.lastUsableLba;
			} else if (disk.GPT && !oldPresence.disks.GPT) {
				diskModule.setDiskInfo.bind(calcDelta)(disk, true); // happens on upgrading Toma for known disk
				var err = diskModule.validateGPTDriveBoundaries(disk);
				if (err) {
					logger.sysERROR(err);
					disk.autoEvictReason = consts.autoEvictReason.SEGMENT_OUT_OF_BOUND;
					disk.isOutOfService = true;
					shouldAutoEvict = true;
				}
			}

			if (disk.automaticallyEvicted)
				disk.health = consts.targetHealth.CRITICAL;

			alertOnMirrorViolation(newServer.node_id, disk.diskSegments);

			callback(disk, oldPresence, false, shouldAutoEvict);
		} else {
			eventsList.push({
				ids: [events.getTargetID(newServer.node_id), events.getDiskID(disk.diskID)],
				event: objectNotifier.events.newDiskEvent,
				payload: disk
			});

			callback(disk);
		}
	});
}

scope.updateVolumeSegmentsNewNodeId = (newServer, diskSegments, callback) => {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	var diskSegmentsByVolume = {};
	var volumeDiskSegments = diskSegments.filter(function(ds) {
		return !ds.owner || (ds.owner === consts.segmentOwners.NVMESH && ds.type !== consts.segmentTypes.EXCELERO_METADATA);
	});

	volumeDiskSegments.forEach(function(ds) {
		if (!diskSegmentsByVolume[ds.volumeName])
			diskSegmentsByVolume[ds.volumeName] = [];

		diskSegmentsByVolume[ds.volumeName].push(ds);
	});

	volumeCollection.find({ _id: { $in: Object.keys(diskSegmentsByVolume) } })
		.project({ chunks: 1, 'mdv.chunks': 1 })
		.toArray(function(err, volumes) {
			if (err)
				return callback(new MongoError(err));

			async.each(volumes, (volume, eachCB) => {
				var chunks = volumeModule.getAllVolumeChunks(volume);
				chunks.forEach(function(chunk) {
					chunk.pRaids.forEach(function(pRaid) {
						pRaid.diskSegments.forEach(function(volumeSegment) {
							diskSegmentsByVolume[volume._id].forEach(function(segment) {
								if (volumeSegment._id === segment._id) {
									volumeSegment.node_id = newServer.node_id;
									volumeSegment.nodeUUID = newServer.uuid;
								}
							});
						});
					});
				});

				let $update = utils.setUpdateOperators(volume);
				$update['$inc'] = { version: 1 };
				let options = { returnDocument: consts.mongoReturnDocument.AFTER, projection: utils.volumeProjection };

				volumeCollection.findOneAndUpdate({ _id: volume._id, action: { $ne: consts.volumeActions.MARKED_FOR_DELETION } }, $update, options,
					(err, result) => {
						if (err)
							new MongoError(err).log();
						else if (result)
							events.emitEvent([events.getVolumeID(volume._id)], objectNotifier.events.volumeVersionChangeEvent, result);

						eachCB(err);
					}
				);
			}, () => {
				callback(err);
			});
		});
};

// TODO: When supporting more than 1 mirror change this logic
function alertOnMirrorViolation(newServerID, diskSegments) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	if (!diskSegments) return;

	var volumeDiskSegments = diskSegments.filter(function(seg) {
		return !seg.owner || (seg.owner === consts.segmentOwners.NVMESH && seg.type !== consts.segmentTypes.EXCELERO_METADATA);
	});

	volumeDiskSegments.forEach(function(segment) {
		volumeCollection.aggregate([
			{ $match: { _id: segment.volumeName, RAIDLevel: { $in: [consts.RAIDLevel.MIRRORED_RAID_1, consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10] } } },
			{ $unwind: '$chunks' },
			{ $unwind: '$chunks.pRaids' },
			{ $match: { 'chunks.pRaids.diskSegments': { $elemMatch: { _id: segment._id } } } }])
			.toArray(function(err, volumeChunks) {
				if (err) {
					new MongoError(err).log();
					return;
				}

				if (!volumeChunks.length)
					return;

				var volumeChunk = volumeChunks[0];
				var mirrorViolationDetected = false;

				var dataMirroredDiskSegments = volumeChunk.chunks.pRaids.diskSegments.filter(function(seg) {
					return seg.type === consts.segmentTypes.DATA && seg._id !== segment._id;
				});

				if (dataMirroredDiskSegments.length) {

					dataMirroredDiskSegments.forEach(function(mirroredSeg) {
						if (mirroredSeg.node_id === newServerID) {
							new SystemAdminMessage(systemMessages.TARGET_DRIVE_RELOCATION_CAUSED_MIRROR_VIOLATION)
								.addInfo(Entities.Volume.ID, volumeChunk._id).addInfo(Entities.DiskSegment.UUID, segment._id).log();

							mirrorViolationDetected = true;
						}
					});
				}

				if (!mirrorViolationDetected) {
					acknowledgeByQuery({
						'meta.id': segment._id,
						'meta.header': 'Mirror violation detected'
					}, consts.SYSTEM_USER, function(result) {
						if (result.success) {
							new SystemAdminMessage(systemMessages.TARGET_DRIVE_RELOCATION_RESOLVED_MIRROR_VIOLATION)
								.addInfo(Entities.Volume.ID, volumeChunk._id).addInfo(Entities.DiskSegment.UUID, segment._id).log();
						}
					});
				}

			}
			);
	});
}

function removeDisksOldPresence(disksInfo, nodeID, callback) {
	var db = app.get('db');
	var server = db.collection('server');

	var disksCondArr = [];

	if (!disksInfo || !disksInfo.length)
		return callback();

	disksInfo.forEach(function(diskInfo) {
		var singleDiskCondition = { 'diskID': diskInfo.diskID, 'reappearingCounter': { $lte: diskInfo.reappearingCounter } };
		disksCondArr.push(singleDiskCondition);
	});

	//Removes the disks from all other servers and report
	server.updateMany({ node_id: { $ne: nodeID } }, { $pull: { disks: { $or: disksCondArr } } }, function(err) {
		if (err)
			new MongoError(err).log();

		callback();
	});
}

function updateServerStatus(oldReport, newReport) {
	if (oldReport) {
		newReport.uuid = oldReport.uuid;
		if (oldReport.health) {
			this.updateTarget(newReport, 'health_old', oldReport.health);
		}
	}

	this.updateTarget(newReport, 'tomaStatus', tomaStatuses.UP);
	this.updateTarget(newReport, 'health', consts.targetHealth.HEALTHY);
	this.updateTarget(newReport, 'node_status', consts.nodeStatus.OK);

	return true;
}

function addNicEvent(nicToUpdate, nicToUpdateHealth, newNicReport, eventsList, node, nicEvent) {
	var nicToUpdateClone;
	this.updateNic(nicToUpdate, nicToUpdate.uuid, 'health', nicToUpdateHealth);
	nicToUpdateClone = utils.extend(true, nicToUpdateClone, nicToUpdate);
	nicToUpdateClone.status = newNicReport.status;

	eventsList.push({
		ids: [events.getTargetID(node.node_id), events.getNicID(newNicReport.nicID)],
		event: nicEvent,
		payload: nicToUpdateClone
	});
}

function checkNicStatus(oldNicReport, newNicReport, eventsList, node, calcDelta) {
	var nicToUpdate = oldNicReport || newNicReport;
	var nicStatusOk = true;

	this.updateNic(nicToUpdate, nicToUpdate.uuid, 'nodeID', node.node_id);
	this.updateNic(nicToUpdate, nicToUpdate.uuid, 'nodeUUID', node.uuid);

	if ((oldNicReport && (newNicReport.status != oldNicReport.status || newNicReport.mtu != oldNicReport.mtu)) || !oldNicReport) {
		if (oldNicReport)
			nicToUpdate.health_old = oldNicReport.health;

		var isNewNicMtuHigh = newNicReport.mtu > consts.NIC_MTU_THRESHOLD;

		if (isNewNicMtuHigh && ((oldNicReport && oldNicReport.mtu <= consts.NIC_MTU_THRESHOLD) || !oldNicReport)) {
			new SystemAdminMessage(systemMessages.TARGET_NIC_MTU_TOO_HIGH_FOR_ROCE_OR_IB)
				.addInfo(Entities.NIC.ID, getNICID(nicToUpdate.nicID, nicToUpdate.nodeID))
				.addInfo(Entities.NIC.MTU, newNicReport.mtu, Differentiators.New)
				.addInfo(Entities.NIC.MTU, consts.NIC_MTU_THRESHOLD, Differentiators.Max)
				.log();
		}

		this.updateNic(nicToUpdate, nicToUpdate.uuid, 'mtu', newNicReport.mtu);

		if (newNicReport.status !== 'Ok') {
			addNicEvent.bind(calcDelta)(nicToUpdate, consts.targetHealth.CRITICAL, newNicReport, eventsList, node, objectNotifier.events.nicFailureEvent);
			nicStatusOk = false;
		} else if (isNewNicMtuHigh) {
			if (oldNicReport && nicToUpdate.health_old === consts.targetHealth.HEALTHY) {
				addNicEvent.bind(calcDelta)(nicToUpdate, consts.targetHealth.ALARM, newNicReport, eventsList, node, objectNotifier.events.nicFailureEvent);
			} else {
				addNicEvent.bind(calcDelta)(nicToUpdate, consts.targetHealth.ALARM, newNicReport, eventsList, node, objectNotifier.events.nicWentOnlineEvent);
			}

		} else {
			addNicEvent.bind(calcDelta)(nicToUpdate, consts.targetHealth.HEALTHY, newNicReport, eventsList, node, objectNotifier.events.nicWentOnlineEvent);
		}

		delete nicToUpdate.health_old;
	}

	return nicStatusOk;
}

function setNicsCount(withBadStatus, total) {
	var eventName = objectNotifier.events.nicsCountChangeEvent.name;

	objectNotifier.getObject(eventName, function(err, nicsCount) {
		if (!err) {
			nicsCount.withBadStatus += withBadStatus;
			nicsCount.total += total;

			objectNotifier.notifyChange(eventName);
		}
	});
}

//Return the total available reserved bytes.
function getAvailableReserved(limitNodes, limitDisks, vpg, allowAllocationOnOfflineDrives, cb) {
	var db = app.get('db');
	var server = db.collection('server');

	const nodeMatch = utils.getAllocatableNodesMatch(allowAllocationOnOfflineDrives, limitNodes);
	const diskMatch = utils.getAllocatableDrivesMatch(false, allowAllocationOnOfflineDrives, limitDisks);

	server.aggregate([
		{ $match: nodeMatch },
		{ $project: { 'disks.diskSegments': 1, 'disks.diskID': 1, 'disks.status': 1, 'disks.availableBlocks': 1, 'disks.block_size': 1, 'disks.blocks': 1 } },
		{ $unwind: '$disks' },
		{ $match: diskMatch },
		{ $match: { 'disks.diskSegments': { $elemMatch: { volumeName: vpg } } } }])
		.toArray(function(err, disksWithReservedSegment) {
			if (err) {
				err = new MongoError(err).log();
			}

			let totalAvailableReserved = 0;
			if (disksWithReservedSegment) {
				disksWithReservedSegment.forEach(diskObj => {
					const segments = utils.getReservedSegments(diskObj.disks, vpg);

					segments.forEach(segment => {
						const delta = segment.lbe - segment.lbs;
						if (delta) {
							totalAvailableReserved += utils.BtoGB((delta + 1) * 4096);
						}
					});
				});
			}

			cb(err, totalAvailableReserved);
		}
		);
}

function getBlocksBySegments(segments) {
	if (!segments || !segments.length) return 0;

	var counter = 0;

	segments.forEach(function(segment) {
		var delta = segment.lbe - segment.lbs;
		counter += delta === 0 ? 0 : delta + 1;
	});

	return counter;
}

function filterDoomedRequests(targets, cb) {
	const db = app.get('db');
	const serverCollection = db.collection('server');
	const messages = [];
	const filteredIDs = [];
	const query = { $or: targets.map(({ _id, uuid }) => ({ _id, uuid })) };

	serverCollection.find(query, { projection: { node_id: 1, uuid: 1, zone: 1, featureCompatibilityVersion: 1 } }).toArray((err, results) => {
		if (err) {
			messages.push(new MongoError(err).log());
			return cb(filteredIDs, messages);
		}

		results.forEach((target) => {
			// populate compatibility version to request targets
			targets
				.find(requestTarget => requestTarget._id === target._id)
				.featureCompatibilityVersion = target.featureCompatibilityVersion;

			if (target.zone) {
				filteredIDs.push(target.node_id);
				messages.push(new SystemMessage(systemMessages.ZONE_ALREADY_ASSIGNED)
					.addInfo(Entities.Target.ID, target.node_id).addInfo(Entities.Target.UUID, target.uuid));
			}
		});

		const dbTargetIDs = results.map(t => t.node_id);
		const notExistsTargets = targets.filter(t => !dbTargetIDs.includes(t._id));

		notExistsTargets.forEach((target) => {
			filteredIDs.push(target._id);
			messages.push(new SystemMessage(systemMessages.SET_ZONE_TARGET_NOT_FOUND)
				.addInfo(Entities.Target.ID, target._id).addInfo(Entities.Target.UUID, target.uuid));
		});

		cb(filteredIDs, messages);
	});
}

function ensureZoneExistsAndIncVersion(zoneID, callback) {
	var db = app.get('db');
	var versionCollection = db.collection('configurationVersion');

	versionCollection.updateOne({ _id: zoneID }, { $setOnInsert: {
		configurationVersion: 2,
		leaderToken: 1
	} }, { upsert: true }, (err) => {
		if (err)
			new MongoError(err).log();

		utils.incZonesConfigurationVersion([zoneID], callback);
	});
}

scope.setZone = (targets, zoneID, cb) => {
	const db = app.get('db');
	const serverCollection = db.collection('server');

	const messages = [];
	let zone;
	let successTargets = [];

	async.series([
		(callback) => {
			lockModule.acquireLockByZone(zoneID, (err, lockedZone) => {
				zone = lockedZone;
				callback();
			});
		},
		(callback) => {
			filterDoomedRequests(targets, (filteredIDs, newMessages) => {
				targets = targets.filter(t => !filteredIDs.includes(t._id));

				newMessages.forEach(l => messages.push(new SystemAdminMessage(systemMessages.SET_ZONE_FAILED)
					.addInfo(Entities.Target.zone, zoneID)
					.addInfo(Entities.Error, l.error)
					.addInfo(Entities.Target.ID, l.getAdditionalInfoByKey(Entities.Target.ID))
					.addInfo(Entities.Target.UUID, l.getAdditionalInfoByKey(Entities.Target.UUID))));

				if (!targets.length)
					return callback(messages);

				async.each(targets, (target, eachCb) => {
					kafkaModule.createTargetTopics(target._id, zone, target.featureCompatibilityVersion, true, (err, topics) => {
						if (err) {
							messages.push(new SystemAdminMessage(systemMessages.SET_ZONE_FAILED)
								.addInfo(Entities.Target.zone, zoneID)
								.addInfo(Entities.Error, err)
								.addInfo(Entities.Target.ID, target._id)
								.addInfo(Entities.Target.UUID, target.uuid));
							return eachCb();
						}

						const query = {
							_id: target._id,
							zone: { $exists: 0 }
						};
						const update = {
							$set: {
								zone: zoneID,
								isPending: false,
								addTargetMessageRequired: true,
								isTargetUpdateSequenceInc: false,
								topics
							}
						};

						serverCollection.updateOne(query, update, (err) => {
							if (!err)
								successTargets.push(target);

							const systemAdminMessage = new SystemAdminMessage(err ? systemMessages.SET_ZONE_FAILED_DB : systemMessages.SET_ZONE_SUCCESS)
								.addInfo(Entities.Target.ID, target._id)
								.addInfo(Entities.Target.UUID, target.uuid)
								.addInfo(Entities.Target.zone, zoneID);

							if (err)
								systemAdminMessage.addInfo(Entities.Error, new MongoError(err).log());

							messages.push(systemAdminMessage);
							eachCb();
						});
					});
				}, () => {
					if (!successTargets.length)
						return callback(true);

					callback();
				});
			});
		},
		(callback) => {
			ensureZoneExistsAndIncVersion(zoneID, () => {
				const targetFeatureCompatibilityVersion = successTargets[0].featureCompatibilityVersion;

				if (zone.lastKafkaTopicsVersionCreated &&
					utils.compareVersionRelease(zone.lastKafkaTopicsVersionCreated, targetFeatureCompatibilityVersion) <= 0)
					return callback();

				kafkaModule.createZoneTopics(zoneID, targetFeatureCompatibilityVersion, true, callback);
			});

		},
		(callback) => {
			zoneModule.newTargetsInZone(zoneID, successTargets.map(t => t._id), callback);
		}
	], () => {
		objectNotifier.updateObject(objectNotifier.events.targetZoneChange.name, () => {
			lockModule.releaseLockByZone(zoneID, () => {
				cb(messages);
			});
		});
	});
};

scope.incZoneTargetsForNewTarget = function(zoneID, nodeID, callback) {
	async.series([
		function getLock(cb) {
			lockModule.acquireLockByZone(zoneID, cb);
		},
		function updateLockTargetCounter(cb) {
			zoneModule.newTargetsInZone(zoneID, [nodeID], cb);
		}
	], err => {
		lockModule.releaseLockByZone(zoneID, () => {
			callback(err);
		});
	});
};

scope.getZone = function(targetID, cb) {
	var db = app.get('db');
	var serverCollection = db.collection('server');

	serverCollection
		.find({ node_id: targetID })
		.project({ zone: 1 })
		.toArray((err, targets) => {
			if (err || !targets.length) {
				if (err)
					new MongoError(err).log();

				return cb();
			}

			cb(targets[0].zone);
		});
};


scope.setTomaStatus = function(targetID, tomaStatus, tomaToken, callback) {
	if (!callback)
		callback = () => {};

	let db = app.get('db');
	let serverCollection = db.collection('server');

	let isTOMAHealthy = !(tomaStatus == consts.tomaStatuses.DOWN || tomaStatus == consts.tomaStatuses.UNAVAILABLE);

	let $query = { _id: targetID };
	let $update = { $set: { tomaStatus: tomaStatus } };

	if (!isTOMAHealthy) {
		$query.tomaToken = tomaToken;
		$update.$set.tomaToken = { $add: ['$tomaToken', 1] };
		$update.$set.health = consts.targetHealth.CRITICAL;
		$update.$set.kafkaMessageSequence = {
			keepalive: 0,
			reportTarget: 0
		};
		$update.$set.node_status = {
			$cond: [
				{ $ne: ['$node_status', consts.nodeStatus.DELETING] },
				consts.nodeStatus.OFFLINE,
				'$node_status'
			]
		};
	}

	serverCollection.findOneAndUpdate(
		$query,
		[$update],
		function(err, server) {
			if (err)
				return callback(new MongoError(err).log());

			if (!server) {
				logger.sysDEBUG(`setTomaStatus(${targetID}, ${tomaToken}, ${tomaStatus}): tomaStatus was not saved to DB.`);
				return callback();
			}

			if (!isTOMAHealthy && server.health !== $update.$set.health) {
				server.health_old = server.health;
				server.health = $update.$set.health;
				events.emitEvent([events.getTargetID(targetID), 'emitted_from_setTomaStatus'], objectNotifier.events.targetFailureEvent, server);
			}

			callback(err, server);
		});
};

function getTopicsToDeleteRecordsForTargetsAndZone(zone, targetsInZoneToFeatureCompatibilityVersions, callback) {
	const topics = [];

	async.parallel([
		cb => {
			const db = app.get('db');
			const configVersion = db.collection('configurationVersion');

			configVersion.findOne({ _id: zone }, { featureCompatibilityVersion: 1 }, (err, versionDocument) => {
				if (err)
					return cb(new MongoError(err).log());

				kafkaModule.getZoneTopicsToCreate(versionDocument.featureCompatibilityVersion, zone, true, zoneTopics => {
					topics.push(...zoneTopics);
					cb();
				});
			});
		},
		cb => {
			async.each(targetsInZoneToFeatureCompatibilityVersions, ((target, eachCb) => {
				kafkaModule.getTargetTopicsToCreate(target.featureCompatibilityVersion, target.targetID, zone, true, targetTopics => {
					topics.push(...targetTopics);
					eachCb();
				});
			}, cb));
		}
	], (err) => callback(err ? [] : topics));
}

scope.resendFormatDriveMessages = (mainCallback) => {
	let db = app.get('db');
	let serverCollection = db.collection('server');

	let query = { disks: { $elemMatch: { isPendingFormat: true, formatInProgress: true, formatDetails: { $exists: true } } } };
	let projection = { _id: 0, node_id: 1, topics: 1, 'disks.formatDetails': 1, 'disks.nodeID': 1, 'disks.uuid': 1 };

	serverCollection.find(query).project(projection).toArray((err, servers) => {
		if (err) {
			new MongoError(err).log();
			return mainCallback(err);
		}

		if (servers.length)
			logger.sysDEBUG(`Found ${servers.length} servers with query '${JSON.stringify(query)}', re-sending kafka messages`);

		async.each(servers, (server, serverCallback) => {
			let disksWithFormatDetails = server.disks.filter(d => d.formatDetails && !utils.isEmpty(d.formatDetails));

			async.each(disksWithFormatDetails, (disk, diskCallback) => {
				kafkaModule.sendMessages(server.topics[consts.topicSuffix.TOMA_COMMANDS], [new FormatDrive(disk.formatDetails)], diskCallback);
			}, () => serverCallback());
		}, err => mainCallback(err));
	});
};

scope.regenerateTOMAMessages = (zone, cb) => {
	const db = app.get('db');
	const lockCollection = db.collection('lock');
	let targetsInZone = [];
	let currentTopics;
	let locked;
	let targetsInZoneToFeatureCompatibilityVersions;


	async.series([
		function getAllTargetsInZone(callback) {
			lockCollection.findOne({ _id: zone }, { targetsInZone: 1 }, (err, lock) => {
				if (err)
					return callback(new MongoError(err).log());

				if (!lock)
					return callback(new SystemMessage(systemMessages.REGEN_TOMA_MSGS_ZONE_NOT_FOUND));

				targetsInZone = lock.targetsInZone;
				callback();
			});
		},
		function acquireLock(callback) {
			lockModule.acquireLockByZone(zone, callback);
		},
		function validateAllTargetsAreDown(callback) {
			locked = true;
			const serverCollection = db.collection('server');
			const projection = { node_status: 1, node_id: 1, featureCompatibilityVersion: 1 };

			serverCollection.find({ node_id: { $in: targetsInZone } }).project(projection).toArray((err, targets) => {
				if (err)
					return callback(new MongoError(err).log());

				const tomaIsUpTargets = targets.filter(target => target.tomaStatus === consts.tomaStatuses.UP);
				if (tomaIsUpTargets.length) {
					err = new SystemMessage(systemMessages.TOMA_IS_UP_ERR);
					tomaIsUpTargets.forEach(target => err.addInfo(Entities.Target.ID, target.node_id));
				}

				targetsInZoneToFeatureCompatibilityVersions = targets.map(target =>
					({ targetID: target.node_id, featureCompatibilityVersion: target.featureCompatibilityVersion }));

				callback(err);
			});
		},
		function getAllTopics(callback) {
			kafkaModule.listTopics((err, topics) => {
				if (err)
					return callback(err);

				currentTopics = topics;
				callback();
			});
		},
		function deleteRecordsFromRelevantTopics(callback) {
			getTopicsToDeleteRecordsForTargetsAndZone(zone, targetsInZoneToFeatureCompatibilityVersions, potentialTopicsToDeleteRecords => {
				const topicsToDeleteRecords = potentialTopicsToDeleteRecords.filter(topic => currentTopics.includes(topic.name));

				async.each(topicsToDeleteRecords,
					(topic, nextTopic) => {
						topic = {
							topic: topic.name,
							partitions: Array.from({ length: topic.numPartitions }, (_, partitionIndex) => partitionIndex)
								.map(partitionIndex => { return { partition: partitionIndex, offset: '-1' }; })
						};

						kafkaModule.deleteTopicRecords(topic, nextTopic);
					},
					callback
				);
			});
		},
		function clearTargetsInZone(callback) {
			lockCollection.updateOne({ _id: zone }, { $set: { targetsInZone: [], targetUpdatesSequence: 0 } }, err => {
				if (err)
					new MongoError(err).log();

				callback(err);
			});
		},
		function sendAddTargetMessages(callback) {
			zoneModule.newTargetsInZone(zone, targetsInZone, callback);
		},
		function sendAddVolumeMessages(callback) {
			const volumeCollection = db.collection('volume');

			volumeCollection.find({ 'chunks.zone': zone, isReserved: false }).toArray((err, volumes) => {
				if (err)
					return callback(new MongoError(err).log());

				if (!volumes.length)
					return callback();

				const addVolumeMessages = volumes.map(volume => new AddVolume(volume));

				kafkaModule.sendMessages(
					cb => kafkaModule.getIncrementalUpdatesTopic(zone, cb),
					addVolumeMessages,
					callback
				);
			});
		},
		function sendFormatDriveMessages(callback) {
			scope.resendFormatDriveMessages(callback);
		}
	], err => {
		function done() {
			cb([(err ?
				new SystemAdminMessage(systemMessages.REGEN_TOMA_MSGS_FAILED).addInfo(Entities.Error, err)
				: new SystemAdminMessage(systemMessages.REGEN_TOMA_MSGS_SUCCESS))
				.addInfo(Entities.Target.zone, zone)]);
		}

		if (locked)
			return lockModule.releaseLockByZone(zone, done);

		done();
	});
};

function isNicChanged(nic, existingReportNic, eventsToEmitOnInsert, node) {
	if (existingReportNic.pkey !== nic.pkey ||
		existingReportNic.guid !== nic.guid ||
		existingReportNic.mtu !== nic.mtu ||
		existingReportNic.protocol !== nic.protocol) {

		this.incNicField(nic, nic.uuid, 'version');

		eventsToEmitOnInsert.push({
			ids: [events.getTargetID(node.node_id), events.getNicID(nic.nicID)],
			event: objectNotifier.events.nicChangeEvent,
			payload: nic
		});
		return true;
	}
}

function parseNicAttributes(nic){
	nic.status = getNicStatus(nic);
	nic.protocol = getNicProtocol(nic);
	nic.pkey = parseInt(nic.pkey, 16);
	nic.mtu = parseInt(nic.mtu, 10);
}

function updateNicAttributes(nic, existingReportNic){
	this.updateNic(nic, nic.uuid, 'status', existingReportNic.status);
	this.updateNic(nic, nic.uuid, 'protocol', existingReportNic.protocol);
	this.updateNic(nic, nic.uuid, 'pkey', existingReportNic.pkey);
	this.updateNic(nic, nic.uuid, 'mtu', existingReportNic.mtu);
	this.updateNic(nic, nic.uuid, 'guid', existingReportNic.guid);
	this.updateNic(nic, nic.uuid, 'deviceType', existingReportNic.deviceType);
}

scope.fetchServerByID = function(serverID, cb) {
	utils.fetchEntityByID('server', serverID, false, {}, systemMessages.TARGET_NOT_FOUND, cb);
};

module.exports = scope;
