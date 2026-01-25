/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

var objectNotifier = require('../objectNotifier.js');
var events = require('../events.js');
var consts = require('../consts.js');
var logger = require('../logger.js');
var utils = require('../utils.js');
var systemMessages = require('../systemMessages.js');

var { Entities, MongoError, SystemAdminMessage, SystemMessage } = require('./error.js');

var scope = {};

scope.afterModuleLoaded = () => {
	logger = require('../logger.js');
	events = require('../events.js');
	objectNotifier = require('../objectNotifier.js');
	consts = require('../consts.js');
	systemMessages = require('../systemMessages.js');
	({ Entities, MongoError, SystemAdminMessage, SystemMessage } = require('./error.js'));
};

scope.updateLogByQuery = function(query, newLevel, newMessage, callback) {
	var db = app.get('db');
	var logCollection = db.collection('log');
	var $set = {};

	if (newMessage)
		$set['message'] = newMessage;

	if (newLevel)
		$set['level'] = newLevel;

	$set['timestamp'] = new Date();

	logCollection.findOneAndUpdate(query, { $set: $set }, { returnDocument: consts.mongoReturnDocument.AFTER }, function(err, result) {
		if (err) {
			err = new MongoError(err).log();
		} else
			events.emitEvent([events.getLogID(query['meta.id'])], objectNotifier.events.logChangedEvent, $set);

		if (callback)
			callback(err, result);
	});
};

scope.acknowledgeAll = function(user, callback) {
	scope.acknowledgeByQuery({}, user, result => {
		if (result.success) {
			new SystemAdminMessage(systemMessages.ALL_LOGS_ACKNOWLEDGED)
				.addInfo(Entities.User.ID, user)
				.addInfo(Entities.Count, result.count)
				.log();

			events.emitEvent(null, objectNotifier.events.allLogsAcknowledgedEvent, { count: result.count });
		}

		callback(result);
	});
};

scope.acknowledgeByQuery = function(query, user, callback) {
	const db = app.get('db');
	const logCollection = db.collection('log');

	query['level'] = { $in: [consts.loggingLevel.INFO, consts.loggingLevel.WARNING, consts.loggingLevel.ERROR] };
	query['meta.acknowledged'] = false;

	logger.sysDEBUG(`Ack All: Going to acknowledge logs with query: ${JSON.stringify(query)}`);

	logCollection.updateMany(
		query,
		{ $set: { 'meta.acknowledged': true, 'dateModified': new Date(), acknowledgedBy: user } },
		(err, result) => {
			let success = false;
			let count = 0;

			if (err) {
				new MongoError(err).log();
			} else {
				count = result.modifiedCount || 0;
				success = true;

				if (count)
					logger.sysDEBUG(`Ack All: Successfully acknowledged ${count} logs`);
				else
					logger.sysDEBUG('Ack All: Query didn\'t match any alerts');
			}

			if (callback)
				callback({ success: success, count: count });
		}
	);
};

scope.acknowledgeById = function(logID, user, callback) {
	var db = app.get('db');
	var logCollection = db.collection('log');

	logCollection.findOneAndUpdate(
		{ _id: logID },
		{ $set: { 'meta.acknowledged': true, 'dateModified': new Date(), acknowledgedBy: user } },
		{ returnDocument: consts.mongoReturnDocument.AFTER },
		function(err, result) {
			if (err) {
				err = new MongoError(err).log();
			} else if (!result) {
				var errMsg = 'There is no such alert in the system';
			} else {
				events.emitEvent([events.getLogID(logID)], objectNotifier.events.logChangedEvent, result);
			}

			if (callback)
				callback(errMsg || err);
		}
	);
};

scope.logWithRequestUUID = (sysMessages, requestUUID) => {
	if (!Array.isArray(sysMessages))
		sysMessages = [sysMessages];

	sysMessages.forEach(sysMessage => {
		if (!(sysMessage instanceof SystemMessage)) {
			logger.sysWARNING(`Got an unexpected system message with type ${typeof sysMessage}: ${JSON.stringify(sysMessage)}`);
			return;
		}

		if (requestUUID)
			sysMessage.addInfo(Entities.ApiRequest.UUID, requestUUID);

		sysMessage.log();
	});
};

scope.createAuditRequestLog = (request, systemMessage) => {
	const systemMsg = new SystemAdminMessage(systemMessage)
		.addInfo(Entities.ApiRequest.URL, request.originalUrl)
		.addInfo(Entities.ApiRequest.address, request.socket.remoteAddress)
		.addInfo(Entities.ApiRequest.timestamp, new Date())
		.addInfo(Entities.ApiRequest.managementID, app.get('managementId'));

	if (request.user) {
		systemMsg
			.addInfo(Entities.ApiRequest.user, request.user.email)
			.addInfo(Entities.ApiRequest.role, request.user.role);
	}
	return systemMsg;
};

scope.fetchLogByID = function(logID, cb) {
	utils.fetchEntityByID('log', logID, true, {}, systemMessages.LOG_NOT_FOUND, cb);
};

module.exports = scope;
