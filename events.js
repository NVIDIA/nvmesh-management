/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

let { SystemMessage, Entities } = require('./modules/error.js');
const systemMessages = require('./systemMessages.js');

/* global app */

let logger = null;
const scope = {};

scope.afterModuleLoaded = () => {
	({ SystemMessage, Entities } = require('./modules/error.js'));
};

scope.getNodeID = function(id) {
	return 'nodeID_' + id;
};

scope.getTargetID = function(id) {
	return 'targetID_' + id;
};

scope.getClientID = function(id) {
	return 'clientID_' + id;
};

scope.getDiskID = function(id) {
	return 'diskID_' + id;
};

scope.getNicID = function(id) {
	return 'nicID_' + id;
};

scope.getVolumeID = function(id) {
	return 'volumeID_' + id;
};

scope.getDiskSegmentID = function(id) {
	return 'diskSegmentID_' + id;
};

scope.getLogID = function(id) {
	return 'logID_' + id;
};

scope.getPlatformID = function(id) {
	return 'platformID_' + id;
};

scope.getArtifactID = function(id) {
	return 'artifactID_' + id;
};

scope.getUpgradeAgentID = function(id) {
	return 'upgradeAgentID_' + id;
};

scope.getComponentID = function(id) {
	return 'componentID_' + id;
};

scope.getZoneID = function(id) {
	return 'zoneID_' + id;
};

scope.getUpgradeID = function(id) {
	return 'upgradeID_' + id;
};

scope.getUpgradeStepID = function(id) {
	return 'upgradeStepID_' + id;
};

scope.getReleaseID = function(id) {
	return 'releaseID_' + id;
};

scope.getKernelID = function(id) {
	return 'kernelID_' + id;
};

scope.getOfedID = function(id) {
	return 'ofedID_' + id;
};

scope.getOperatingSystemID = function(id) {
	return 'operatingSystemID_' + id;
};

scope.getUpgradeScenarioID = function(id) {
	return 'upgradeScenarioID_' + id;
};

scope.getUpgradeStepScenarioID = function(id) {
	return 'upgradeStepScenarioID_' + id;
};

/*
Implements event propagation, as we don't have events hierarchy. triggering for every event serveral possible events.
for exmalple the payload:
	*["diskID123", "volumeID222", "serverID123123"], diskChange, data
Will emit the following events:
	*diskChange
	*diskID_123@diskChange
	*volumeID_222@diskChange
	*targetID_123123@diskChange
	*targetID_123123
*/
scope.emitEvent = function(ids, event, data) {
	var eventObject = {};

	eventObject.payload = (data || data === 0)
		? (!event.projection || !Object.keys(event.projection).length
			? data
			: createEventPayload(event.projection, data))
		: {};
	//eventObject.opcode = event.opcode;

	if (!logger)
		logger = require('./logger.js');

	var callingFunction = logger.getCallingFunction(2);
	logger.sysDEBUG(`Emitting the event: ${event.name} with ids: ${JSON.stringify(ids)}`);
	logger.sysVERBOSE('events', `event: ${event.name} with ids: ${JSON.stringify(ids)} called from ${callingFunction}`, eventObject);

	if (ids)
		ids.forEach(function(id) {
			scope.emitOnAllSockets(id + '@' + event.name, eventObject);
			scope.emitOnAllSockets(id, eventObject);
		});

	scope.emitOnAllSockets(event.name, eventObject);
};

scope.emitOnAllSockets = function(eventName, eventObject) {
	var eventEmitter = app.get('eventEmitter');

	eventObject.eventName = eventName;

	//emit event locally within nodeJS
	if (eventEmitter?.emit)
		eventEmitter.emit(eventName, eventObject);
};

function createEventPayload(projection, rawObject) {
	var obj = {};

	for (var key in projection) {
		var propertyPath = projection[key];

		if (propertyPath !== null && typeof propertyPath === 'object') {
			if (rawObject[key] && Array.isArray(rawObject[key]))
				obj[key] = rawObject[key].map(function(e) { return createEventPayload(propertyPath, e); });
		} else {
			var value = 0;

			propertyPath.split('.').forEach(function(e) { value = !value ? rawObject[e] : value[e]; });

			obj[key] = value === undefined ? null : value;
		}
	}

	return obj;
}

scope.waitForEventOrTimeout = function(eventName, timeoutMS, callback) {
	var eventEmitter = app.get('eventEmitter');
	var timer;
	var listener = (args) => {
		eventEmitter.removeListener(eventName, listener);
		clearTimeout(timer);
		callback(null, args);
	};

	timer = setTimeout(() => {
		eventEmitter.removeListener(eventName, listener);
		callback(new SystemMessage(systemMessages.TIMED_OUT_EVENT).addInfo(Entities.Event, eventName));
	}, timeoutMS);

	eventEmitter.on(eventName, listener);
};

module.exports = scope;
