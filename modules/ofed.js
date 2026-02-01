/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

const async = require('async');
const { SystemAdminMessage, Entities, InteropDBError } = require('./error');
const systemMessages = require('../systemMessages');
const events = require('../events');
const objectNotifier = require('../objectNotifier');

const scope = {};

scope.getOfeds = (queryObj, callback) => {
	const interopDB = app.get('interopDB');

	interopDB.getAllOfeds(queryObj, (results) => {
		if (results.error)
			return callback(new SystemAdminMessage(systemMessages.LOAD_OFEDS_FAILED).addInfo(Entities.Error, new InteropDBError(results.error)));

		callback(null, results.data);
	});
};

scope.countOfeds = (filterObj, callback) => {
	const interopDB = app.get('interopDB');

	interopDB.countOfeds(filterObj, (results) => {
		callback(results.data);
	});
};

scope.createOfeds = (ofedVersions, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(ofedVersions, (version, cb) => {
		interopDB.createOfed({ version }, (results) => {
			let response;

			if (!results.success) {
				response = new SystemAdminMessage(systemMessages.OFED_SAVE_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));
			} else {
				response = new SystemAdminMessage(systemMessages.OFED_SAVED).addInfo(Entities.Ofed.ID, results.data.ID);
				events.emitEvent([events.getOfedID(results.data.ID)], objectNotifier.events.newOfedEvent);
			}

			response.addInfo(Entities.Ofed.version, version);
			responses.push(response);

			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.updateOfeds = (ofeds, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(ofeds, (ofed, cb) => {
		interopDB.updateOfed(ofed, (results) => {
			let response;

			if (!results.success)
				response = new SystemAdminMessage(systemMessages.OFED_UPDATE_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));
			else {
				response = new SystemAdminMessage(systemMessages.OFED_UPDATED);
				events.emitEvent([events.getOfedID(ofed.ID)], objectNotifier.events.ofedChangedEvent, { version: ofed.version });
			}
			response
				.addInfo(Entities.Ofed.ID, ofed.ID)
				.addInfo(Entities.Ofed.version, ofed.version);

			responses.push(response);

			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.deleteOfeds = (ofeds, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(ofeds, (ofed, cb) => {
		interopDB.deleteOfeds([{ ID: ofed.ID }], (results) => {
			let response;

			if (!results.success)
				response = new SystemAdminMessage(systemMessages.OFED_DELETE_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));
			else {
				response = new SystemAdminMessage(systemMessages.OFED_DELETED);
				events.emitEvent([events.getOfedID(ofed.ID)], objectNotifier.events.ofedRemovedEvent);
			}

			response
				.addInfo(Entities.Ofed.ID, ofed.ID)
				.addInfo(Entities.Ofed.version, ofed.version);

			responses.push(response);

			cb();
		});
	}, () => {
		callback(responses);
	});
};

module.exports = scope;
