/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* global app */

var async = require('async');

var utils = require('./utils.js');
var events = require('./events.js');
var logger = require('./logger.js');
var consts = require('./consts.js');
var objectNotifier = require('./objectNotifier.js');
var dbBackup = require('./dbBackup.js');
var websocket = require('./modules/websocket.js');
var websocketCommon = require('./modules/websocketCommon.js');
var lockModule = require('./modules/lock.js');
var kafkaModule = require('./modules/kafka.js');
var config = require('./modules/config.js');
var configurationProfileModule = require('./modules/configurationProfiles.js');
var validation = require('./modules/validation.js');
var zoneModule = require('./modules/zone.js');
var volumeModule = require('./modules/volume.js');
var diskModule = require('./modules/disk.js');
var diskClassModule = require('./modules/diskClass.js');
var nodeModule = require('./modules/node.js');
var generalSettingsModule = require('./modules/generalSettings.js');
var clientModule = require('./modules/client.js');
var targetModule = require('./modules/target.js');
var { Entities, SystemMessage, SystemAdminMessage, MongoError, Differentiators, InteropDBError } = require('./modules/error.js');
var systemMessages = require('./systemMessages.js');
var lastMessageLog = require('./modules/lastMessageLog.js');
var errorModule = require('./modules/error.js');
var logModule = require('./modules/log.js');
var sanityAndRecover = require('./modules/sanityAndRecover.js');
var volumeEncryptionModule = require('./modules/volumeEncryption.js');
var scope = {};

function setCounter(eventName, alarm, critical, total) {
	objectNotifier.getObject(eventName, function(err, counter) {
		if (err)
			return;

		var newAlarm = counter.alarm + alarm;
		var newCritical = counter.critical + critical;
		var newTotal = counter.total + total;

		if (newAlarm >= 0 && newCritical >= 0 && newTotal >= 0 && ((newAlarm + newCritical) <= newTotal)) {
			// valid counters
			counter.alarm += alarm;
			counter.critical += critical;
			counter.total += total;

			logger.sysVERBOSE('counters', 'Counters in ' + eventName
				+ ' total: ' + counter.total + ' alarm: ' + counter.alarm + ' critical: ' + counter.critical);
		} else {
			logger.sysVERBOSE('counters', 'Error in Counters for ' + eventName + ' total: ' + newTotal + ' alarm: ' + newAlarm + ' critical: ' + newCritical);

			if (config.get('productionEnvironment') !== false) {
				logger.sysDEBUG('updating counters cache from DB for ' + eventName + ' because of suspicious counters value');
				objectNotifier.updateObject(eventName);
			}
		}

		logger.sysVERBOSE('counters', 'Counters in ' + eventName + ' total: ' + counter.total + ' alarm: ' + counter.alarm + ' critical: ' + counter.critical);

		if (counter.alarm < 0 || counter.critical < 0 || counter.total < 0)
			logger.sysVERBOSE('counters', 'Negative Counters in ' + eventName
				+ ' total: ' + counter.total + ' alarm: ' + counter.alarm + ' critical: ' + counter.critical);

	});
}

function removeObjectWithHealth(countChangeEvent, health) {
	if (!health) {
		logger.sysDEBUG(countChangeEvent.name + ' got event with no health. Re-calculating counters');
		objectNotifier.updateObject(countChangeEvent.name);
		return;
	}

	switch (health) {
		case consts.targetHealth.HEALTHY:
			events.emitEvent(null, countChangeEvent, { alarm: 0, critical: 0, total: -1 });
			break;
		case consts.targetHealth.ALARM:
			events.emitEvent(null, countChangeEvent, { alarm: -1, critical: 0, total: -1 });
			break;
		case consts.targetHealth.CRITICAL:
			events.emitEvent(null, countChangeEvent, { alarm: 0, critical: -1, total: -1 });
			break;
	}
}

function objectWithHealthFailure(countChangeEvent, obj) {
	return objectHealthChanged(countChangeEvent, obj);
}

function objectWithHealthSuccess(countChangeEvent, obj) {
	return objectHealthChanged(countChangeEvent, obj);
}

function objectHealthChanged(countChangeEvent, obj) {
	var health = obj.health;
	var healthOld = obj.health_old;
	var nodeID = obj.nodeID;
	var ids = null;

	if (!health) {
		logger.sysDEBUG(countChangeEvent + ' got event with no health. Re-calculating counters');
		objectNotifier.updateObject(countChangeEvent.name);
		return;
	}

	if (health == healthOld)
		return;

	if (nodeID)
		ids = [events.getTargetID(nodeID)];

	let alarm = 0;
	let critical = 0;
	let total = 0;

	if (!healthOld)
		// Added new component!
		total = 1;

	// decrement old health
	switch (healthOld) {
		case consts.targetHealth.ALARM:
			alarm = -1;
			break;
		case consts.targetHealth.CRITICAL:
			critical = -1;
			break;
		case consts.targetHealth.HEALTHY:
			// Do nothing
			break;
	}

	// increment new health
	switch (health) {
		case consts.targetHealth.ALARM:
			alarm = 1;
			break;
		case consts.targetHealth.CRITICAL:
			critical = 1;
			break;
		case consts.targetHealth.HEALTHY:
			// Do nothing
			break;
	}

	events.emitEvent(ids, countChangeEvent, { alarm: alarm, critical: critical, total: total });
}


function registerToLogsHandlers(eventEmitter) {
	eventEmitter.on(objectNotifier.events.newBackupEvent.name, function(args) {
		objectNotifier.getObject(objectNotifier.events.backupChangeEvent.name, function(err, backupsWrapper) {
			if (err)
				return new SystemMessage(systemMessages.BOOTSTRAP_BACKUPS_LOAD_FROM_CACHE).addInfo(Entities.Error, err).log();

			var backups = backupsWrapper.backups;
			var newBackup = args.payload;
			backups[newBackup.fileName] = newBackup;
			objectNotifier.notifyChange(objectNotifier.events.backupChangeEvent.name);
		});

		logger.sysDEBUG('newBackupEvent triggered');
	});

	eventEmitter.on(objectNotifier.events.backupRemovedEvent.name, function(args) {
		objectNotifier.getObject(objectNotifier.events.backupChangeEvent.name, function(err, backupsWrapper) {
			if (err)
				return new SystemMessage(systemMessages.BOOTSTRAP_BACKUPS_LOAD_FROM_CACHE).addInfo(Entities.Error, err).log();

			var backups = backupsWrapper.backups;
			if (args.payload && backups[args.payload] != undefined) {
				delete backups[args.payload];
				objectNotifier.notifyChange(objectNotifier.events.backupChangeEvent.name);
			}
		});

		logger.sysDEBUG('backupRemovedEvent triggered');
	});

	//TODO::This handle can be smarter, and not going to the database for every trigger.
	eventEmitter.on(objectNotifier.events.largestVolumesChangeEvent.name, function() {
		objectNotifier.updateObject(objectNotifier.events.largestVolumesChangeEvent.name);

		logger.sysDEBUG('largestVolumesChangeEvent triggered');
	});

	//TODO::This handle can be smarter, and not going to the database for every trigger.
	eventEmitter.on(objectNotifier.events.allocatedSpaceDirtyEvent.name, function() {
		// clearing the cache so any call to objectNotifier.getObject() will initiate an objectNotifier.updateObject()
		objectNotifier.clearObjectCache(objectNotifier.events.allocatedSpaceChangeEvent.name);

		// this will cause the calculation work to be done only if someone is listening. 1 listener is always the bootstrap itself.
		// at the time of writing this code only the GUI allocationChart is listening to allocatedSpaceChangeEvent event
		var count = eventEmitter.listenerCount(objectNotifier.events.allocatedSpaceChangeEvent.name);
		if (count > 1)
			objectNotifier.waitAndUpdateObject(objectNotifier.events.allocatedSpaceChangeEvent.name, 1000, function(err, data) {
				if (!err)
					events.emitEvent(null, objectNotifier.events.allocatedSpaceChangeEvent, data);
			});

		logger.sysDEBUG('allocatedSpaceDirtyEvent triggered');
	});

	eventEmitter.on(objectNotifier.events.allocatedSpaceChangeEvent.name, function() {
		logger.sysDEBUG('allocatedSpaceChangeEvent triggered');
	});

	eventEmitter.on(objectNotifier.events.volumeRemapEvent.name, function(args) {
		new SystemAdminMessage(systemMessages.VOLUME_REBUILD_STARTED)
			.addInfo(Entities.Volume.ID, args.payload.name)
			.addInfo(Entities.Volume.UUID, args.payload.uuid)
			.log();

		events.emitEvent([events.getVolumeID(args.payload._id)], objectNotifier.events.volumeVersionChangeEvent, args.payload);
	});

	eventEmitter.on(objectNotifier.events.volumeStatusChangeEvent.name, function(args) {
		logger.sysDEBUG('volumeStatusChangeEvent triggered for volume: ' + args.payload.volumeID + ' new status: ', args.payload.status);
	});

	eventEmitter.on(objectNotifier.events.volumeActionChangeEvent.name, function(args) {
		logger.sysDEBUG('volumeActionChangeEvent triggered for volume: ' + args.payload.volumeID + ' new action: ', args.payload.action);
	});

	eventEmitter.on(objectNotifier.events.volumeRemovedEvent.name, function(args) {
		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			return;

		if (!args.payload.isReserved)
			events.emitEvent(null, objectNotifier.events.volumesCountChangeEvent, null);

		events.emitEvent(null, objectNotifier.events.allocatedSpaceDirtyEvent, null);
		events.emitEvent(null, objectNotifier.events.largestVolumesChangeEvent, null);

		clientModule.sendVolumeRemovedToClients(args.payload);
	});

	eventEmitter.on(objectNotifier.events.newVolumeEvent.name, function(args) {
		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			return;

		events.emitEvent(null, objectNotifier.events.allocatedSpaceDirtyEvent, null);
		events.emitEvent(null, objectNotifier.events.largestVolumesChangeEvent, null);

		if (!args.payload.isReserved && !args.payload.isExtension)
			events.emitEvent(null, objectNotifier.events.volumesCountChangeEvent);
	});

	eventEmitter.on(objectNotifier.events.volumeExtendedEvent.name, function(volume) {
		events.emitEvent(null, objectNotifier.events.allocatedSpaceDirtyEvent, null);
		events.emitEvent([events.getVolumeID(volume.payload._id)], objectNotifier.events.volumeVersionChangeEvent, volume.payload);
		events.emitEvent(null, objectNotifier.events.largestVolumesChangeEvent, null);
	});

	eventEmitter.on(objectNotifier.events.volumeFailureEvent.name, function(args) {
		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			return;

		logger.sysDEBUG('Volume failure event: ' + args.payload.volumeID + ' health: ' + args.payload.health + ' old_health: ' + args.payload.health_old);

		events.emitEvent(null, objectNotifier.events.volumesCountChangeEvent);
	});

	eventEmitter.on(objectNotifier.events.volumeWentOnlineEvent.name, function(args) {
		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			return;

		logger.sysDEBUG('Volume went online: ' + args.payload.volumeID + ' health: ' + args.payload.health + ' old_health: ' + args.payload.health_old);

		events.emitEvent(null, objectNotifier.events.volumesCountChangeEvent);
	});

	eventEmitter.on(objectNotifier.events.targetRemovedEvent.name, function(args) {
		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			return;

		removeObjectWithHealth(objectNotifier.events.serversCountChangeEvent, args.payload.health);

		if (args.payload.disks && args.payload.disks.length) {
			var totalDisks = args.payload.disks.length;
			var criticalDisks = args.payload.disks.filter((disk)=> disk.health == 'critical').length;
			var alarmDisks = args.payload.disks.filter((disk)=> disk.health == 'alarm').length;
			events.emitEvent(
				[events.getTargetID(args.payload.nodeID)],
				objectNotifier.events.disksCountChangeEvent,
				{ alarm: -alarmDisks, critical: -criticalDisks, total: -totalDisks }
			);
		}

		events.emitEvent(null, objectNotifier.events.allocatedSpaceDirtyEvent, null);

		nodeModule.checkIfNodeRemove(args.payload.nodeID);
	});

	eventEmitter.on(objectNotifier.events.serversCountChangeEvent.name, function(args) {
		setCounter(objectNotifier.events.serversCountChangeEvent.name, args.payload.alarm, args.payload.critical, args.payload.total);
	});

	eventEmitter.on(objectNotifier.events.newTargetEvent.name, function(args) {
		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			return;

		new SystemAdminMessage(systemMessages.TARGET_DETECTED).addInfo(Entities.Target.ID, args.payload.nodeID).log();

		events.emitEvent(null, objectNotifier.events.serversCountChangeEvent, getNewEntityEventPayloadForCounters());
	});

	eventEmitter.on(objectNotifier.events.targetFailureEvent.name, function(args) {
		logger.sysDEBUG('Target ' + args.payload.nodeID + ' failure event:  health: ' + args.payload.health + ' old_health: ' + args.payload.health_old);

		objectWithHealthFailure(objectNotifier.events.serversCountChangeEvent, args.payload);

		var systemMessage;

		switch (args.payload.node_status) {
			case 1:
				systemMessage = systemMessages.TARGET_UP_REQUIRES_ATTENTION;
				break;
			case 2:
				systemMessage = systemMessages.TARGET_UP_NVMESH_TARGET_DOWN;
				break;
			case 3:
				systemMessage = systemMessages.TARGET_UP_NVMESH_TOMA_DOWN;
				break;
			default:
				systemMessage = systemMessages.TARGET_DOWN;
		}

		new SystemAdminMessage(systemMessage).addInfo(Entities.Target.ID, args.payload.nodeID).log();
	});

	eventEmitter.on(objectNotifier.events.targetWentOnlineEvent.name, function(args) {
		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			return;

		logger.sysDEBUG('Target went online: ' + args.payload.nodeID + ' health: ' + args.payload.health + ' old_health: ' + args.payload.health_old);

		objectWithHealthSuccess(objectNotifier.events.serversCountChangeEvent, args.payload);

		new SystemAdminMessage(systemMessages.TARGET_WENT_ONLINE).addInfo(Entities.Target.ID, args.payload.nodeID).log();
	});

	eventEmitter.on(objectNotifier.events.diskRemovedEvent.name, function(args) {
		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			return;

		logger.sysDEBUG('Drive SN ' + args.payload.diskID + ' has been removed from ' + args.payload.nodeID);
		events.emitEvent([events.getTargetID(args.payload.nodeID)], objectNotifier.events.disksCountChangeEvent, { alarm: 0, critical: 0, total: -1 });

		if (args.payload.autoRemove)
			new SystemAdminMessage(systemMessages.DRIVE_AUTOMATICALLY_REMOVED)
				.addInfo(Entities.Drive.ID, errorModule.getDriveID(args.payload.diskID, args.payload.nodeID)).log();

		if (args.payload.status !== consts.diskStatus.NOT_INITIALIZED && !args.payload.isExcluded)
			events.emitEvent(null, objectNotifier.events.allocatedSpaceDirtyEvent, null);
	});

	eventEmitter.on(objectNotifier.events.newDiskEvent.name, function(args) {
		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			return;

		var GLOBAL_SETTINGS_HIDDEN = app.get('globalSettingsHidden');

		// start auto rebuild for every volume with remap segment when autoEvictMissingDrive is enabled
		if (GLOBAL_SETTINGS_HIDDEN.autoEvictMissingDrive)
			utils.startVolumeRebuildForAllRelevantVolumes(consts.SYSTEM_USER);

		new SystemAdminMessage(systemMessages.DRIVE_DETECTED)
			.addInfo(Entities.Drive.ID, errorModule.getDriveID(args.payload.diskID, args.payload.nodeID)).log();

		if (args.payload.status !== consts.diskStatus.NOT_INITIALIZED && !args.payload.isExcluded)
			events.emitEvent(null, objectNotifier.events.allocatedSpaceDirtyEvent, null);
	});

	eventEmitter.on(objectNotifier.events.diskReappearEvent.name, function(args) {
		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			return;

		new SystemAdminMessage(systemMessages.DRIVE_REAPPEARED)
			.addInfo(Entities.Drive.ID, errorModule.getDriveID(args.payload.diskID, args.payload.nodeID)).log();

		diskClassModule.updateDriveClassNodeIDFromReappearingDrive(args.payload);
	});

	eventEmitter.on(objectNotifier.events.diskFailureEvent.name, function(args) {
		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			return;

		var systemMessage;
		switch (args.payload.status) {
			case consts.diskStatus.FORMAT_ERROR:
				systemMessage = systemMessages.DRIVE_FAILURE_FORMAT_ERROR;
				break;
			case consts.diskStatus.INGESTING:
				systemMessage = systemMessages.DRIVE_FAILURE_OFFLINE;
				break;
			default:
				systemMessage = systemMessages.DRIVE_FAILURE;
				break;
		}

		objectWithHealthFailure(objectNotifier.events.disksCountChangeEvent, args.payload);

		new SystemAdminMessage(systemMessage).addInfo(Entities.Drive.ID, errorModule.getDriveID(args.payload.diskID, args.payload.nodeID))
			.addInfo(Entities.Drive.status, args.payload.status).addInfo(Entities.Drive.health, args.payload.health).log();
	});

	eventEmitter.on(objectNotifier.events.diskWentOnlineEvent.name, function(args) {
		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			return;

		objectWithHealthSuccess(objectNotifier.events.disksCountChangeEvent, args.payload);

		new SystemAdminMessage(systemMessages.DRIVE_WENT_ONLINE)
			.addInfo(Entities.Drive.ID, errorModule.getDriveID(args.payload.diskID, args.payload.nodeID)).log();
	});

	eventEmitter.on(objectNotifier.events.drivePoolChangeEvent.name, function(args) {
		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			return;

		events.emitEvent(null, objectNotifier.events.allocatedSpaceDirtyEvent, null);

		var systemMessage = args.payload.wentIntoPool ? systemMessages.DRIVE_ADDED_TO_NVMESH_POOL : systemMessages.DRIVE_REMOVED_FROM_NVMESH_POOL;

		new SystemAdminMessage(systemMessage)
			.addInfo(Entities.Drive.ID, errorModule.getDriveID(args.payload.diskID, args.payload.nodeID))
			.addInfo(Entities.Target.ID, args.payload.nodeID).log();
	});

	eventEmitter.on(objectNotifier.events.disksCountChangeEvent.name, function(args) {
		setCounter(objectNotifier.events.disksCountChangeEvent.name, args.payload.alarm, args.payload.critical, args.payload.total);
	});

	eventEmitter.on(objectNotifier.events.nicReappearEvent.name, function(args) {
		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			return;

		new SystemAdminMessage(systemMessages.NIC_REAPPEARED).addInfo(Entities.NIC.ID, errorModule.getDriveID(args.payload.nicID, args.payload.nodeID)).log();
	});

	eventEmitter.on(objectNotifier.events.nicChangeEvent.name, function(args) {
		logger.sysDEBUG(`NIC ${args.payload.nicID} Changed`);
	});

	eventEmitter.on(objectNotifier.events.newNicEvent.name, function(args) {
		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			return;

		new SystemAdminMessage(systemMessages.NIC_DETECTED).addInfo(Entities.NIC.ID, errorModule.getDriveID(args.payload.nicID, args.payload.nodeID)).log();
	});

	eventEmitter.on(objectNotifier.events.nicFailureEvent.name, function(args) {
		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			return;

		objectWithHealthFailure(objectNotifier.events.nicsCountChangeEvent, args.payload);

		if (args.payload.status !== consts.nicStatus.OK) {
			const systemMessage = args.payload.status === 'Error' ? systemMessages.NIC_FAILURE : systemMessages.NIC_MISSING;
			new SystemAdminMessage(systemMessage).addInfo(Entities.NIC.ID, errorModule.getDriveID(args.payload.nicID, args.payload.nodeID)).log();
		}
	});

	eventEmitter.on(objectNotifier.events.nicWentOnlineEvent.name, function(args) {
		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			return;

		objectWithHealthSuccess(objectNotifier.events.nicsCountChangeEvent, args.payload);

		new SystemAdminMessage(systemMessages.NIC_WENT_ONLINE).addInfo(Entities.NIC.ID, errorModule.getDriveID(args.payload.nicID, args.payload.nodeID))
			.addInfo(Entities.Target.ID, args.payload.nodeID).log();
	});

	eventEmitter.on(objectNotifier.events.diskEvictedEvent.name, function(args) {
		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			return;

		if (args.payload.automaticallyEvicted) {
			var autoEvictReason = args.payload.autoEvictReason ? args.payload.autoEvictReason : consts.autoEvictReason.DEFAULT;

			new SystemAdminMessage(systemMessages.DRIVE_AUTOMATICALLY_EVICTED)
				.addInfo(Entities.Drive.ID, errorModule.getDriveID(args.payload.diskID, args.payload.nodeID))
				.addInfo(Entities.Drive.autoEvictReason, autoEvictReason)
				.log();

			events.emitEvent(
				[events.getDiskID(args.payload.diskID), events.getTargetID(args.payload.nodeID)],
				objectNotifier.events.diskFailureEvent,
				args.payload);
		}

		events.emitEvent(null, objectNotifier.events.allocatedSpaceDirtyEvent, null);
	});

	eventEmitter.on(objectNotifier.events.clientRemovedEvent.name, function(args) {
		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			return;

		removeObjectWithHealth(objectNotifier.events.clientsCountChangeEvent, args.payload.health);

		nodeModule.checkIfNodeRemove(args.payload.clientID);
	});

	eventEmitter.on(objectNotifier.events.clientsCountChangeEvent.name, function(args) {
		setCounter(objectNotifier.events.clientsCountChangeEvent.name, args.payload.alarm, args.payload.critical, args.payload.total);
	});

	eventEmitter.on(objectNotifier.events.newClientEvent.name, function(args) {
		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			return;

		new SystemAdminMessage(systemMessages.CLIENT_DETECTED).addInfo(Entities.Client.ID, args.payload.clientID).log();

		events.emitEvent(null, objectNotifier.events.clientsCountChangeEvent, getNewEntityEventPayloadForCounters());
	});

	eventEmitter.on(objectNotifier.events.clientFailureEvent.name, function(args) {
		objectWithHealthFailure(objectNotifier.events.clientsCountChangeEvent, args.payload);
	});

	eventEmitter.on(objectNotifier.events.clientWentOnlineEvent.name, function(args) {
		objectWithHealthSuccess(objectNotifier.events.clientsCountChangeEvent, args.payload);
	});

	eventEmitter.on(objectNotifier.events.newManagementInClusterEvent.name, function(args) {
		logger.sysVERBOSE('HA', `newManagementInClusterEvent id: ${args.payload?.id} hostname: ${args.payload?.hostname} `
			+ `protocolVersion: ${args.payload?.protocolVersion}, describe: ${args.payload?.describe}`);

		var clusterManagemenet = args.payload;
		// if not connected to it already, connect to it.
		var outboundClusterConnections = app.get('mgmtOutboundClusterConnections');
		logger.sysVERBOSE('HA', 'cluster connections:', Object.keys(outboundClusterConnections));

		const shouldConnect = websocket.shouldConnectToRemoteManagement(clusterManagemenet);
		if (shouldConnect) {
			// connect back to management
			logger.sysVERBOSE('HA', 'newManagementInClusterEvent::connecting management', clusterManagemenet);
			websocket.connectToRemoteManagements([clusterManagemenet]);
		}
	});

	eventEmitter.on(objectNotifier.events.volumeVersionChangeEvent.name, (args) => {
		logger.sysDEBUG('Volume version change event caught!');
		volumeModule.updateVolumeVersionInCache(args.payload, () => {});

		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			return;

		clientModule.sendUpdateVolumesToClient(args.payload);
		volumeModule.sendVolumeUpdateToTomaByVolume(args.payload);
	});

	eventEmitter.on(objectNotifier.events.nodeRemovedEvent.name, function(args) {
		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			return;

		logger.sysDEBUG(`Node ${args.payload.nodeID} Removed`);
	});

	eventEmitter.on(objectNotifier.events.generalSettingsChangeEvent.name, function() {
		new SystemMessage(systemMessages.GENERAL_SETTINGS_CHANGED).log();

		generalSettingsModule.load({}, err => {
			if (err)
				new SystemMessage(systemMessages.BOOTSTRAP_GENERAL_SETTINGS_LOAD_FAILED).addInfo(Entities.Error, err).log();
			else
				new SystemMessage(systemMessages.BOOTSTRAP_GENERAL_SETTINGS_RELOADED).log();
		}, false);
	});


	eventEmitter.on(objectNotifier.events.newUpstreamTopicEvent.name, ({ payload: { topics } }) => {
		logger.sysDEBUG(`Got ${objectNotifier.events.newUpstreamTopicEvent.name} event about new topics: ${topics}`);

		const before = kafkaModule.subscribableTopics.size;
		topics.forEach(topic => kafkaModule.subscribableTopics.add(topic));
		const after = kafkaModule.subscribableTopics.size;

		if (before === after)
			return;

		logger.sysDEBUG(`${after - before} topics added`);
		events.emitEvent(null, objectNotifier.events.upstreamTopicChangeEvent);
	});


	eventEmitter.on(objectNotifier.events.removedUpstreamTopicEvent.name, ({ payload: { topics } }) => {
		logger.sysDEBUG(`Got ${objectNotifier.events.removedUpstreamTopicEvent.name} event about removed topics: ${topics}`);

		const before = kafkaModule.subscribableTopics.size;
		topics.forEach(topic => kafkaModule.subscribableTopics.delete(topic));
		const after = kafkaModule.subscribableTopics.size;

		if (before === after)
			return;

		logger.sysDEBUG(`${before - after} topics removed`);
		events.emitEvent(null, objectNotifier.events.upstreamTopicChangeEvent);
	});

	eventEmitter.on(objectNotifier.events.upstreamTopicChangeEvent.name, function() {
		logger.sysDEBUG(`Got ${objectNotifier.events.upstreamTopicChangeEvent.name} event`);

		if (!kafkaModule.topicsInitialized)
			return logger.sysDEBUG('Topics are not initialized yet, skipping upstreamTopicChangeEvent');

		const consumerId = app.get('kafkaConsumer')?.customConsumerInstanceID;
		logger.sysWARNING(`upstreamTopicChangeEvent: consumer ID ${consumerId} requesting recycle`);
		kafkaModule.requestConsumerRecycle(consumerId);
	});

	eventEmitter.on(objectNotifier.events.interopDBVersionChangedEvent.name, ({ payload: { upgradeAgentID, oldInteropDBVersion, newInteropDBVersion } }) => {
		if (upgradeAgentID !== app.get('hostname'))
			return;

		new SystemAdminMessage(systemMessages.INTEROPDB_VERSION_CHANGED)
			.addInfo(Entities.UpgradeAgent.ID, upgradeAgentID)
			.addInfo(Entities.InteropDB.version, oldInteropDBVersion, Differentiators.Old)
			.addInfo(Entities.InteropDB.version, newInteropDBVersion, Differentiators.New)
			.log();

		const interopDB = app.get('interopDB');
		interopDB.reconnect(consts.INTEROP_DB_RELATIVE_PATH, err => {
			if (err) {
				new SystemAdminMessage(systemMessages.SQLITE_CONNECTION_ERROR)
					.addInfo(Entities.SQLITE.dbPath, consts.INTEROP_DB_RELATIVE_PATH)
					.addInfo(Entities.Error, new InteropDBError(err))
					.log();
				process.exit(1);
			}
		});
	});

	eventEmitter.on(objectNotifier.events.zonesRanksChangeEvent.name, function(args) {
		// updating the latest zoneRanks another MGMT did into my cache
		if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT)
			objectNotifier.setObject(objectNotifier.events.zonesRanksChangeEvent.name, args.payload);
	});
}

scope.registerToEvents = function(cb) {
	var eventEmitter = app.get('eventEmitter');

	registerToLogsHandlers(eventEmitter);

	cb();
};

function reloadSettings(cb) {
	generalSettingsModule.load({}, (err) => {
		if (err) {
			new SystemMessage(systemMessages.BOOTSTRAP_GENERAL_SETTINGS_LOAD_FAILED_ON_STARTUP).addInfo(Entities.Error, err).log();
			process.exit(1);
		} else
			logger.sysDEBUG('Settings reloaded successfully');

		cb();
	}, false);
}

function getNewEntityEventPayloadForCounters() {
	return {
		total: 1,
		alarm: 0,
		critical: 1
	};
}

function logSystemInfo(cb) {
	utils.getSystemInfo((systemInfo) => {
		new SystemAdminMessage(systemMessages.SYSTEM_INFO).addInfo(Entities.SystemInfo, systemInfo).log();
		cb();
	});
}

scope.afterModulesLoaded = function(callback) {
	sanityAndRecover.afterModuleLoaded();
	websocket.afterModuleLoaded();
	clientModule.afterModuleLoaded();
	targetModule.afterModuleLoaded();
	volumeModule.afterModuleLoaded();
	utils.afterModuleLoaded();
	lastMessageLog.afterModuleLoaded();
	errorModule.afterModuleLoaded();
	lockModule.afterModuleLoaded();
	zoneModule.afterModuleLoaded();
	configurationProfileModule.afterModuleLoaded();
	diskModule.afterModuleLoaded();
	kafkaModule.afterModuleLoaded();
	logModule.afterModuleLoaded();
	diskClassModule.afterModuleLoaded();
	events.afterModuleLoaded();
	logModule.afterModuleLoaded();
	objectNotifier.afterModuleLoaded();
	generalSettingsModule.afterModuleLoaded();
	volumeEncryptionModule.afterModuleLoaded();
	callback();
};

scope.bootstrap = function(callback) {
	async.series([
		logSystemInfo,
		reloadSettings,
		kafkaModule.connectToKafka,
		objectNotifier.init,
		dbBackup.startBackupProcess,
		websocketCommon.handleClusterEventSubscriptions,
		scope.registerToEvents,
		websocket.joinManagementCluster,
		kafkaModule.initTopics,
		lastMessageLog.startKeepaliveValidationInterval,
		validation.init,
		diskModule.startMissingDriveCheckupInterval,
		utils.sendStatsToExceleroPeriodically,
		zoneModule.dispatchAllZonesHardwareConfiguration,
		scope.removeOldMessages
	], function(err) {
		callback(err);
	});
};

scope.removeOldMessages = (cb) => {
	//No reason to wait for the GC to finish, we can startup immediately.
	if (cb)
		cb();

	logger.sysDEBUG('Starting to remove committed messages');

	async.series([
		callback => {
			const db = app.get('db');
			const versionCollection = db.collection('configurationVersion');

			versionCollection.find({ _id: { $ne: consts.CONFIG_VER_CLUSTER_ID } },
				{ projection: { topics: 1, targetsInZone: 1 } }).toArray((err, results) => {
				if (err) {
					new MongoError(err).log();
					return callback(err);
				}

				if (results.length) {
					return async.eachSeries(results, (versionDocument, callback) => {
						kafkaModule.GCZoneTopics(versionDocument, callback);
					}, callback);
				}
			});
		},
		kafkaModule.GCClientsTopics,
		kafkaModule.GCManagementTopics,
		kafkaModule.GCUpgradeAgentsTopics
	], (err) => {
		if (err)
			new SystemMessage(systemMessages.KAFKA_TOPIC_GC_ERROR).addInfo(Entities.Error, err).log();
		else
			logger.sysDEBUG('Finished removing committed messages');

		setTimeout(scope.removeOldMessages, consts.kafka.KAFKA_GC_TIMEOUT);
	});
};

module.exports = scope;
