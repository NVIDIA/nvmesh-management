/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */
var scope = {};
module.exports = scope;
var async = require('async');
var fs = require('fs');
var path = require('path');
var uuid = require('uuid');

var config = require('./modules/config.js');
var zoneModule = require('./modules/zone.js');
var generalSettingsModule = require('./modules/generalSettings.js');
var consts = require('./consts.js');
var logger = require('./logger.js');
var utils = require('./utils');
const kafkaModule = require('./modules/kafka.js');

var { Entities, SystemMessage, MongoError, SystemAdminMessage } = require('./modules/error.js');
var systemMessages = require('./systemMessages.js');
const events = require('./events.js');

scope.afterModuleLoaded = () => {
	logger = require('./logger.js');
	({ Entities, SystemMessage, MongoError, SystemAdminMessage } = require('./modules/error.js'));
};

var monitoredObjects = {};

scope._waitTimeouts = {};

var countProjection = { alarm: 'alarm', critical: 'critical', total: 'total', updateType: 'updateType' };
scope.events = {
	backupChangeEvent: { name: 'backupChangeEvent' },
	newBackupEvent: { name: 'newBackupEvent' },
	backupRemovedEvent: { name: 'backupRemovedEvent' },

	serversCountChangeEvent: { name: 'serversCountChangeEvent', projection: countProjection },
	clientsCountChangeEvent: { name: 'clientsCountChangeEvent', projection: countProjection },
	volumesCountChangeEvent: { name: 'volumesCountChangeEvent' },
	zoneAvailabilityChangeEvent: { name: 'zoneAvailabilityChangeEvent' },

	nicsCountChangeEvent: { name: 'nicsCountChangeEvent', projection: countProjection },
	disksCountChangeEvent: { name: 'disksCountChangeEvent', projection: countProjection },
	allocatedSpaceChangeEvent: { name: 'allocatedSpaceChangeEvent' },
	allocatedSpaceDirtyEvent: { name: 'allocatedSpaceDirtyEvent' },
	largestVolumesChangeEvent: { name: 'largestVolumesChangeEvent' },
	dirtyBitsChangeEvent: { name: 'dirtyBitsChangeEvent' },
	volumeDeletedEvent: { name: 'volumeDeletedEvent' },
	volumesVersionsChangeEvent: { name: 'volumesVersionsChangeEvent' },
	zonesRanksChangeEvent: { name: 'zonesRanksChangeEvent' },
	targetZoneChange: { name: 'targetZoneChange' },

	canExportVolumeViaNvmfChangedEvent: { name: 'canExportVolumeViaNvmfChangedEvent',
		opcode: consts.webSocketMessages.CAN_EXPORT_VOLUME_VIA_NVMF },

	targetRemovedEvent: { name: 'targetRemovedEvent', projection: { nodeID: 'node_id', health: 'health', disks: 'disks' } },
	newTargetEvent: { name: 'newTargetEvent', projection: { nodeID: 'node_id', disks: { diskID: 'diskID' }, nics: { nicID: 'nicID', protocol: 'protocol' } } },
	targetFailureEvent: {
		name: 'targetFailureEvent',
		projection: {
			nodeID: 'node_id',
			node_status: 'node_status',
			health_old: 'health_old',
			health: 'health'
		}
	},
	targetWentOnlineEvent: {
		name: 'targetWentOnlineEvent',
		projection: {
			nodeID: 'node_id',
			node_status: 'node_status',
			health_old: 'health_old',
			health: 'health'
		}
	},
	newDiskEvent: { name: 'newDiskEvent' },
	diskRemovedEvent: { name: 'diskRemovedEvent',
		projection: { diskID: 'diskID', uuid: 'uuid', autoRemove: 'autoRemove', status: 'status', isExcluded: 'isExcluded' } },
	diskReappearEvent: { name: 'diskReappearEvent', opcode: consts.webSocketMessages.DISK_REAPPEAR_EVENT },
	diskStatusChangeEvent: {
		name: 'diskStatusChangeEvent',
		projection: {
			diskID: 'diskID',
			status: 'status',
			isPendingFormat: 'isPendingFormat',
			isExcluded: 'isExcluded',
			isOutOfService: 'isOutOfService',
			blocks: 'blocks',
			block_size: 'block_size',
			metadata_size: 'metadata_size'
		}
	},
	segmentsChangedOnDiskEvent: { name: 'segmentsChangedOnDiskEvent', opcode: consts.webSocketMessages.SEGMENTS_CHANGES_ON_DISK_EVENT },
	driveZeroingProgressChangeEvent: { name: 'driveZeroingProgressChangeEvent' },
	drivePoolChangeEvent: {
		name: 'drivePoolChangeEvent',
		projection: {
			uuid: 'uuid',
			diskID: 'diskID',
			status: 'status',
			isExcluded: 'isExcluded',
			wentIntoPool: 'wentIntoPool',
			nodeID: 'nodeID'
		}
	},
	volumeDeletionZeroingProgressChangeEvent: { name: 'volumeDeletionZeroingProgressChangeEvent' },
	diskFailureEvent: {
		name: 'diskFailureEvent',
		projection: {
			diskID: 'diskID',
			status: 'status',
			isOutOfService: 'isOutOfService',
			health_old: 'health_old',
			health: 'health',
			nodeID: 'nodeID'
		}
	},
	diskWentOnlineEvent: {
		name: 'diskWentOnlineEvent',
		projection: {
			diskID: 'diskID',
			status: 'status',
			health_old: 'health_old',
			health: 'health',
			nodeID: 'nodeID',
			isOutOfService: 'isOutOfService'
		}
	},
	diskEvictedEvent: {
		name: 'diskEvictedEvent',
		projection: {
			diskID: 'diskID',
			isOutOfService: 'isOutOfService',
			nodeID: 'nodeID',
			automaticallyEvicted: 'automaticallyEvicted',
			status: 'status',
			health_old: 'health_old',
			health: 'health',
			autoEvictReason: 'autoEvictReason'
		}
	},

	newNicEvent: { name: 'newNicEvent', opcode: consts.webSocketMessages.NEW_NIC },
	nicRemovedEvent: { name: 'nicRemovedEvent', opcode: consts.webSocketMessages.DELETE_NIC, projection: { _id: '_id', uuid: 'uuid', nicID: 'nicID' } },
	nicReappearEvent: { name: 'nicReappearEvent', opcode: consts.webSocketMessages.REAPPEAR_NIC },
	nicChangeEvent: { name: 'nicChangeEvent', opcode: consts.webSocketMessages.CHANGE_NIC },
	nicFailureEvent: {
		name: 'nicFailureEvent',
		projection: {
			nicID: 'nicID',
			status: 'status',
			nodeID: 'nodeID',
			health_old: 'health_old',
			health: 'health',
			mtu: 'mtu'
		}
	},
	nicWentOnlineEvent: {
		name: 'nicWentOnlineEvent',
		projection: {
			nicID: 'nicID',
			status: 'status',
			nodeID: 'nodeID',
			health_old: 'health_old',
			health: 'health',
			mtu: 'mtu'
		}
	},

	clientRemovedEvent: { name: 'clientRemovedEvent', projection: { clientID: 'clientID', status: 'status', health: 'health' } },
	newClientEvent: { name: 'newClientEvent', projection: { clientID: 'clientID' } },
	clientFailureEvent: {
		name: 'clientFailureEvent',
		projection: {
			clientID: 'clientID',
			client_status: 'client_status',
			health: 'health',
			health_old: 'health_old'
		}
	},
	clientWentOnlineEvent: {
		name: 'clientWentOnlineEvent',
		projection: {
			clientID: 'clientID',
			client_status: 'client_status',
			health: 'health',
			health_old: 'health_old'
		}
	},

	volumeRemovedEvent: {
		name: 'volumeRemovedEvent',
		projection: {
			volumeID: '_id',
			uuid: 'uuid',
			health: 'health',
			isReserved: 'isReserved'
		},
		opcode: consts.webSocketMessages.VOLUME_REMOVED_EVENT
	},
	newVolumeEvent: { name: 'newVolumeEvent' },

	attachVolumesEvent: { name: 'attachVolumesEvent', opcode: consts.webSocketMessages.ATTACH_VOLUMES_EVENT },
	restartClientEvent: { name: 'restartClientEvent', opcode: consts.webSocketMessages.RESTART_VOLUME_EVENT },
	formatDiskEvent: { name: 'formatDiskEvent', opcode: consts.webSocketMessages.FORMAT_DISK_EVENT },
	DiskFinishedFormatEvent: { name: 'DiskFinishedFormatEvent', opcode: consts.webSocketMessages.DISK_FINISHED_FORMAT_EVENT },

	volumeRemapEvent: { name: 'volumeRemapEvent', opcode: consts.webSocketMessages.VOLUME_REMAP_EVENT },
	volumeExtendedEvent: { name: 'volumeExtendedEvent', opcode: consts.webSocketMessages.VOLUME_EXTENDED_EVENT },

	volumeStatusChangeEvent: { name: 'volumeStatusChangeEvent', projection: { volumeID: '_id', health_old: 'health_old', health: 'health', status: 'status' } },
	volumeActionChangeEvent: { name: 'volumeActionChangeEvent', projection: { volumeID: '_id', health_old: 'health_old', health: 'health', action: 'action' } },
	volumeFailureEvent: { name: 'volumeFailureEvent', projection: { volumeID: '_id', status: 'status', health_old: 'health_old', health: 'health' } },
	volumeWentOnlineEvent: { name: 'volumeWentOnlineEvent', projection: { volumeID: '_id', status: 'status', health_old: 'health_old', health: 'health' } },
	newManagementInClusterEvent: { name: 'newManagementInClusterEvent' },

	newLogEvent: { name: 'newLogEvent' },
	logChangedEvent: { name: 'logChangedEvent' },
	allLogsAcknowledgedEvent: { name: 'allLogsAcknowledgedEvent' },
	volumeVersionChangeEvent: { name: 'volumeVersionChangeEvent', opcode: consts.webSocketMessages.VOLUME_VERSION_CHANGED },

	sendConfigurationResponse: { name: 'sendConfigurationResponse', opcode: consts.webSocketMessages.SEND_CONFIGURATION_RESPONSE },
	clientConfigProfileUpdated: { name: 'clientConfigProfileUpdated' },
	targetConfigProfileUpdated: { name: 'targetConfigProfileUpdated' },
	restartRequiredChanged: { name: 'restartRequiredChanged' },
	configProfileUserOverrideChanged: { name: 'configProfileUserOverrideChanged' },

	//newNodeEvent: { name: 'newNodeEvent' },
	nodeRemovedEvent: { name: 'nodeRemovedEvent' },
	generalSettingsChangeEvent: { name: 'generalSettingsChangeEvent' },

	newPlatformEvent: { name: 'newPlatformEvent' },
	platformRemovedEvent: { name: 'platformRemovedEvent' },
	platformChangedEvent: { name: 'platformChangedEvent' },

	newArtifactEvent: { name: 'newArtifactEvent' },
	artifactRemovedEvent: { name: 'artifactRemovedEvent' },
	artifactChangedEvent: { name: 'artifactChangedEvent' },

	newUpgradeAgentEvent: { name: 'newUpgradeAgentEvent' },
	upgradeAgentChangedEvent: { name: 'upgradeAgentChangedEvent' },
	upgradeAgentRemovedEvent: { name: 'upgradeAgentRemovedEvent', projection: { _id: '_id', uuid: 'uuid', status: 'status', hostname: 'hostname' } },

	newUpgradeScenarioEvent: { name: 'newUpgradeScenarioEvent' },
	upgradeScenarioRemovedEvent: { name: 'upgradeScenarioRemovedEvent' },
	upgradeScenarioChangedEvent: { name: 'upgradeScenarioChangedEvent' },

	newUpgradeStepScenarioEvent: { name: 'newUpgradeStepScenarioEvent' },
	upgradeStepScenarioRemovedEvent: { name: 'upgradeStepScenarioRemovedEvent' },
	upgradeStepScenarioChangedEvent: { name: 'upgradeStepScenarioChangedEvent' },

	newUpstreamTopicEvent: { name: 'newUpstreamTopicEvent' },
	removedUpstreamTopicEvent: { name: 'removedUpstreamTopicEvent' },
	upstreamTopicChangeEvent: { name: 'upstreamTopicChangeEvent' },

	upgradeStatusChangedEvent: { name: 'upgradeStatusChangedEvent', projection: { _id: '_id', status: 'status' } },
	upgradeRemovedEvent: { name: 'upgradeRemovedEvent' },
	newUpgradeEvent: { name: 'newUpgradeEvent' },
	upgradeStepStatusChangedEvent: {
		name: 'upgradeStepStatusChangedEvent',
		projection: {
			_id: '_id',
			upgradeID: 'upgradeID',
			status: 'status',
			response: 'response',
			lastExecTryError: 'lastExecTryError'
		}
	},

	newReleaseEvent: { name: 'newReleaseEvent' },
	releaseRemovedEvent: { name: 'releaseRemovedEvent' },
	releaseChangedEvent: { name: 'releaseChangedEvent' },

	newKernelEvent: { name: 'newKernelEvent' },
	kernelChangedEvent: { name: 'kernelChangedEvent' },
	kernelRemovedEvent: { name: 'kernelRemovedEvent' },

	newOfedEvent: { name: 'newOfedEvent' },
	ofedChangedEvent: { name: 'ofedChangedEvent' },
	ofedRemovedEvent: { name: 'ofedRemovedEvent' },

	newOperatingSystemEvent: { name: 'newOperatingSystemEvent' },
	operatingSystemChangedEvent: { name: 'operatingSystemChangedEvent' },
	operatingSystemRemovedEvent: { name: 'operatingSystemRemovedEvent' },

	interopDBVersionChangedEvent: { name: 'interopDBVersionChangedEvent' },
};

scope.getEventByName = function(eventName) {
	for (var event in scope.events)
		if (scope.events[event].name == eventName)
			return scope.events[event];

	return null;
};

function countObjectsWithHealth(collectionName, callback) {
	var db = app.get('db');
	var collection = db.collection(collectionName);

	collection.aggregate([
		{ $project: { health: 1 } },
		{ $group: { _id: '$health', count: { $sum: 1 } } }
	]).toArray(function(err, results) {
		if (err)
			new MongoError(err).log();
		else {
			var count = { total: 0, alarm: 0, critical: 0 };

			results.forEach(function(result) {
				if (result._id !== consts.targetHealth.HEALTHY)
					count[result._id] = result.count;

				count.total += result.count;
			});
		}

		if (callback)
			callback(err, count);
	});
}

function readBackupsFromFS(callback) {
	var allBackups = {};

	if (!fs.existsSync(config.get('Backup.backupPath')))
		return callback('backup directory not exist');

	fs.readdir(config.get('Backup.backupPath'), function(err, files) {
		if (err) {
			new SystemAdminMessage(systemMessages.OBJ_NOTIFIER_FAILED_TO_READ_BACKUPS_DIR)
				.addInfo(Entities.Path, config.get('Backup.backupPath')).addInfo(Entities.Error, err).log();
			return callback(null, allBackups);
		}

		async.each(files, function(file, callback) {
			const mongoConnection = config.get('mongoConnection');
			var backupRegex = new RegExp('^(' + consts.backupTypes.HOURLY + '|' + consts.backupTypes.DAILY + ')_' + mongoConnection.dbName + '_.*\\.gz$');

			if (!file.match(backupRegex))
				return callback();

			var backup = {};
			var backupPath = path.join(config.get('Backup.backupPath'), file);
			var separator = file.indexOf('_');
			var backupType = file.substring(0, separator);
			var backupId = file.substring(separator + 1);

			fs.stat(backupPath, function(err, stats) {
				if (err) {
					new SystemAdminMessage(systemMessages.OBJ_NOTIFIER_FAILED_TO_READ_BACKUP)
						.addInfo(Entities.Path, backupPath).addInfo(Entities.Error, err).log();
					return callback();
				}

				backup.backup_id = backupId;
				backup.fileName = file;
				backup.dateCreated = stats.ctime;
				backup.size = stats.size;
				backup.type = backupType;

				allBackups[file] = backup;
				callback();
			});
		}, function() {
			var backupsWrapper = { 'backups': allBackups };
			callback(null, backupsWrapper);
		});
	});
}

monitoredObjects[scope.events.generalSettingsChangeEvent.name] = {
	getUpdatedObj: function(callback) {
		generalSettingsModule.load({}, () => {}, false);
		callback();
	}
};

monitoredObjects[scope.events.backupChangeEvent.name] = {
	getUpdatedObj: function(callback) {
		readBackupsFromFS(callback);
	}
};

monitoredObjects[scope.events.serversCountChangeEvent.name] = {
	getUpdatedObj: function(callback) {
		countObjectsWithHealth('server', callback);
	}
};

monitoredObjects[scope.events.clientsCountChangeEvent.name] = {
	getUpdatedObj: function(callback) {
		countObjectsWithHealth('client', callback);
	}
};

monitoredObjects[scope.events.nicsCountChangeEvent.name] = {
	getUpdatedObj: function(callback) {
		var db = app.get('db');
		var serverCollection = db.collection('server');

		async.parallel({
			total: function(cb) {
				serverCollection.aggregate([
					{ $project: { numberOfNics: { $size: '$nics' } } },
					{ $group: { _id: null, totalNics: { $sum: '$numberOfNics' } } }
				]).toArray(function(err, results) {
					if (err)
						new MongoError(err).log();

					cb(err, results ? results.length ? results[0].totalNics : 0 : 0);
				});
			},
			alarm: function(cb) {
				serverCollection.aggregate([
					{ $project: { 'nics.health': 1 } },
					{ $unwind: '$nics' },
					{ $match: { 'nics.health': consts.targetHealth.ALARM } },
					{ $group: { _id: null, count: { $sum: 1 } } }
				]).toArray(function(err, results) {
					if (err)
						new MongoError(err).log();

					cb(err, results && results.length ? results[0].count : 0);
				});
			},
			critical: function(cb) {
				serverCollection.aggregate([
					{ $project: { 'nics.health': 1 } },
					{ $unwind: '$nics' },
					{ $match: { 'nics.health': consts.targetHealth.CRITICAL } },
					{ $group: { _id: null, count: { $sum: 1 } } }
				]).toArray(function(err, results) {
					if (err)
						new MongoError(err).log();

					cb(err, results.length ? results[0].count : 0);
				});
			}
		}, function(err, results) {
			if (err)
				logger.sysDEBUG('Failed to count nics', err);

			callback(err, results);
		});
	}
};

monitoredObjects[scope.events.disksCountChangeEvent.name] = {
	getUpdatedObj: function(callback) {
		var db = app.get('db');
		var serverCollection = db.collection('server');

		async.parallel({
			total: function(cb) {
				serverCollection.aggregate([
					{ $project: { _id: 1, 'disks.uuid': 1 } },
					{ $unwind: '$disks' },
					{ $group: { _id: null, totalDisks: { $sum: 1 } } }
				]).toArray(function(err, results) {
					if (err)
						new MongoError(err).log();

					cb(err, results.length ? results[0].totalDisks : 0);
				});
			},
			alarm: function(cb) {
				serverCollection.aggregate([
					{ $project: { 'disks.health': 1 } },
					{ $unwind: '$disks' },
					{ $match: { 'disks.health': consts.targetHealth.ALARM } },
					{ $group: { _id: null, count: { $sum: 1 } } }
				]).toArray(function(err, results) {
					if (err)
						new MongoError(err).log();

					cb(err, results.length ? results[0].count : 0);
				});
			},
			critical: function(cb) {
				serverCollection.aggregate([
					{ $project: { 'disks.health': 1 } },
					{ $unwind: '$disks' },
					{ $match: { 'disks.health': consts.targetHealth.CRITICAL } },
					{ $group: { _id: null, count: { $sum: 1 } } }
				]).toArray(function(err, results) {
					if (err)
						new MongoError(err).log();

					cb(err, results?.length ? results[0].count : 0);
				});
			}
		}, function(err, results) {
			if (err)
				logger.sysDEBUG('Failed to count disks', err);

			callback(err, results);
		});
	}
};

monitoredObjects[scope.events.allocatedSpaceChangeEvent.name] = {
	getUpdatedObj: function(callback) {
		utils.getSpaceAllocation({}, {}, (err, results) => {
			return callback(err, results);
		});
	}
};

monitoredObjects[scope.events.largestVolumesChangeEvent.name] = {
	getUpdatedObj: function(callback) {
		var db = app.get('db');
		var volumeCollection = db.collection('volume');

		volumeCollection
			.find({ status: { $ne: 'pending' }, isReserved: false })
			.project({ name: 1, capacity: 1 })
			.sort({ capacity: -1 })
			.limit(4)
			.toArray(function(err, results) {
				if (err)
					new MongoError(err).log();

				if (results)
					return callback(err, results);

				callback(err, null);
			});
	}
};

monitoredObjects[scope.events.zonesRanksChangeEvent.name] = {
	getUpdatedObj: function(callback) {
		var GLOBAL_SETTINGS = app.get('globalSettings');
		if (!GLOBAL_SETTINGS.enableZones)
			return callback(null, { '1': 100 });

		zoneModule.getZones([], (err, zones) => {
			if (!err && zones && zones.length) {
				zones.forEach((zone) => zone.targetsInZone = zone.targetsInZone?.length || 0);
				return callback(err, zoneModule.getZonesRanks(zones));
			}

			callback(err, {});
		});
	}
};

monitoredObjects[scope.events.targetZoneChange.name] = {
	getUpdatedObj: function(callback) {
		zoneModule.getTargetToZone(callback);
	}
};

monitoredObjects[scope.events.volumesVersionsChangeEvent.name] = {
	getUpdatedObj: function(callback) {
		var db = app.get('db');
		var volumeCollection = db.collection('volume');

		volumeCollection
			.aggregate([
				{ $match: { status: { $nin: [consts.volumeStatuses.PENDING, consts.volumeStatuses.TO_BE_DELETED] } } },
				{ $project: { _id: 0, uuid: 1, version: 1 } },
				{ $group: { _id: '', sumOfVersions: { $sum: '$version' }, volumes: { $push: { 'uuid': '$uuid', 'version': '$version' } } } }
			]).toArray((err, results) => {
				if (err)
					logger.sysDEBUG('Failed to get sum of volumes versions', err);

				if (results && results.length) {
					var versionsObj = { sumOfVersions: results[0].sumOfVersions };

					for (var i = 0; i < results[0].volumes.length; i++)
						versionsObj[results[0].volumes[i].uuid] = results[0].volumes[i].version;

					return callback(err, versionsObj);
				}

				callback(err, {});
			});
	}
};

monitoredObjects[scope.events.removedUpstreamTopicEvent.name] = {
	getUpdatedObj: function(callback) {
		callback();
	}
};

monitoredObjects[scope.events.newUpstreamTopicEvent.name] = {
	getUpdatedObj: function(callback) {
		callback();
	}
};

monitoredObjects[scope.events.upstreamTopicChangeEvent.name] = {
	getUpdatedObj: function(callback) {
		kafkaModule.getSubscribableTopics((err, topics) => {
			if (err)
				return callback(err);

			const currentSubscribableTopics = kafkaModule.subscribableTopics;
			const newSubscribableTopics = new Set(topics);

			if (!utils.isEqualSet(currentSubscribableTopics, newSubscribableTopics)) {
				const current = [...currentSubscribableTopics].join(', ');
				const next = [...newSubscribableTopics].join(', ');
				logger.sysDEBUG(`subscribable topics changed, current: ${current}, new: ${next}`);

				kafkaModule.subscribableTopics = newSubscribableTopics;
				events.emitEvent(null, scope.events.upstreamTopicChangeEvent);
			}

			callback();
		});
	}
};

monitoredObjects[scope.events.interopDBVersionChangedEvent.name] = {
	getUpdatedObj: function(callback) {
		callback();
	}
};

scope.updateObject = function(eventName, callback) {
	var obj = monitoredObjects[eventName];

	monitoredObjects[eventName].getUpdatedObj(function(err, data) {
		if (err)
			new SystemMessage(systemMessages.OBJ_NOTIFIER_UPDATE_OBJ).addInfo(Entities.Event.name, eventName).log();
		else {
			obj.value = data;
			scope.notifyChange(eventName, consts.updateTypes.FULL);
		}

		if (callback)
			callback(err, obj.value);
	});
};

scope.waitAndUpdateObject = function(eventName, timeToWait, callback) {
	if (scope._waitTimeouts[eventName])
		// timer already running for this one
		return;

	scope._waitTimeouts[eventName] = setTimeout(function() {
		delete scope._waitTimeouts[eventName];
		scope.updateObject(eventName, callback);
	}, timeToWait);
};

scope.clearObjectCache = function(eventName) {
	var obj = monitoredObjects[eventName];
	obj.value = null;
};

scope.getObject = function(event, callback) {
	var obj = monitoredObjects[event];
	if (obj) {
		if (!obj.value && obj.getUpdatedObj)
			obj.getUpdatedObj(function(err, results) {
				if (!err) {
					obj.value = results;

					callback(err, obj.value);
				} else
					callback(err, null);
			});
		else {
			callback(null, obj.value);
		}
	} else
		callback();
};

/*
* This function probably redundant for none scalar values.
* But we may need it, so comment till the framework mature, and we'll know for sure.
scope.setObject = function(event, value) {
	var obj = monitoredObjects[event];
	if (!equals(obj.value, value)) {
		obj.value = value;
		emit(event, obj.value);
	}
};
*/

scope.notifyChange = function(event, updateType) {
	var obj = monitoredObjects[event];

	if (obj && obj.value || obj.value === 0) {
		if (updateType)
			obj.value.updateType = updateType;

		emit(event, obj.value);
	}
};

scope.init = function(callback) {
	const db = app.get('db');
	const confCollection = db.collection('configurationVersion');
	const GLOBAL_SETTINGS = app.get('globalSettings');
	const cacheUpdateInterval = GLOBAL_SETTINGS.cacheUpdateInterval * 1000 || 1000 * 60;
	const managementId = app.get('managementId');
	const mongoSafeManagementId = managementId.replace(/\./g, '_');
	let dbUUID = uuid.v1();

	try {
		if (fs.existsSync(consts.DBUUID_FILE_PATH)) {
			var predefinedUUID = fs.readFileSync(consts.DBUUID_FILE_PATH, 'utf8');

			if (predefinedUUID)
				dbUUID = predefinedUUID.trim();
		}
	} catch (err) {
		logger.sysERROR(`Failed to get DB UUID from file: ${consts.DBUUID_FILE_PATH}. error: ${err}`);
	}


	async.series([
		function insertClusterDoc(cb) {
			confCollection.findOneAndUpdate(
				{ _id: consts.CONFIG_VER_CLUSTER_ID },
				{
					$setOnInsert: {
						_id: consts.CONFIG_VER_CLUSTER_ID,
						dbUUID: dbUUID,
						protocolVersion: 1,
						supportedMCSVersions: ['1.0'],
						managements: {}
					}
				},
				{ upsert: true, returnDocument: consts.mongoReturnDocument.AFTER },
				err => {
					if (err) {
						logger.sysERROR(new MongoError(err));
					}

					return cb(err);
				});
		},
		function updateManagementBootVersion(cb) {
			confCollection.findOneAndUpdate(
				{ _id: consts.CONFIG_VER_CLUSTER_ID },
				[
					{
						$set: {
							[`managements.${mongoSafeManagementId}`]: {
								$ifNull: [
									`$managements.${mongoSafeManagementId}`,
									{
										managementId: managementId,
										bootVersion: 0
									}

								]
							}
						}
					},
					{
						$set: {
							[`managements.${mongoSafeManagementId}.bootVersion`]: {
								$add: [`$managements.${mongoSafeManagementId}.bootVersion`, 1]
							}
						}
					}
				],
				{ returnDocument: consts.mongoReturnDocument.AFTER },
				(err, result) => {
					if (err) {
						logger.sysERROR(new MongoError(err));
						return cb(err);
					}

					const dbUUID = result.dbUUID;
					app.set('dbUUID', dbUUID);
					app.set('protocolVersion', result.protocolVersion);
					app.set('supportedMCSVersions', result.supportedMCSVersions);
					app.set('bootVersion', result.managements[mongoSafeManagementId].bootVersion);
					logger.sysDEBUG('mgmt DB UUID: ' + dbUUID);

					cb();
				});
		},
		function updateCacheAndSetInterval(cb) {
			scope.updateCache(function(err) {
				if (err)
					new SystemMessage(systemMessages.OBJ_NOTIFIER_UPDATE_CACHE).addInfo(Entities.Error, err).log();

				if (config.get('productionEnvironment') !== false) {
					setInterval(function() {
						scope.updateCache();
					}, cacheUpdateInterval);
				}

				cb();
			});
		}
	],
	err => callback(err)
	);
};

function emit(event, data) {
	var socket = app.get('socket');

	if (socket)
		socket.emit(event, { eventName: event, payload: data });
}

scope.isEmpty = function(obj) {
	for (var prop in obj) {
		if (Object.prototype.hasOwnProperty.call(obj, prop))
			return false;
	}

	return true;
};

scope.updateCache = function(cb) {
	logger.sysDEBUG('Updating all monitored objects cache');
	async.each(Object.keys(monitoredObjects), scope.updateObject, cb || function() {});
};

scope.monitoredObjects = monitoredObjects;
