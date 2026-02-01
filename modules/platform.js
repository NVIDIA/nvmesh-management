/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

const async = require('async');
const systemMessages = require('../systemMessages.js');

const { SystemAdminMessage, Entities, InteropDBError } = require('./error.js');
const events = require('../events.js');
const objectNotifier = require('../objectNotifier.js');

let scope = {};

scope.getAllArchTypes = (callback) => {
	const interopDB = app.get('interopDB');
	interopDB.getAllArchTypes((results) => {
		callback(results.data);
	});
};

scope.getAllPlatforms = (queryObj, callback) => {
	const interopDB = app.get('interopDB');
	let error;

	interopDB.getAllPlatforms(queryObj, (results) => {
		if (results.error)
			error = new SystemAdminMessage(systemMessages.LOAD_PLATFORMS_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));

		callback(error, results?.data);
	});
};

scope.createPlatforms = (platforms, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(platforms, (platform, cb) => {
		interopDB.createPlatform(platform, (results) => {
			let response;
			let platformID = results?.data?.ID;

			if (!results.success)
				response = new SystemAdminMessage(systemMessages.PLATFORM_SAVE_REQUEST_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));
			else {
				response = new SystemAdminMessage(systemMessages.PLATFORM_SAVED);
				events.emitEvent([events.getPlatformID(platformID)], objectNotifier.events.newPlatformEvent);
			}
			response
				.addInfo(Entities.Platform.ID, platformID)
				.addInfo(Entities.Platform.name, platform.name);

			responses.push(response);

			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.deletePlatforms = (platforms, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(platforms, (platform, cb) => {
		interopDB.deletePlatforms([platform], (results) => {
			let response;

			if (!results.success)
				response = new SystemAdminMessage(systemMessages.PLATFORM_DELETE_REQUEST_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));
			else {
				response = new SystemAdminMessage(systemMessages.PLATFORM_DELETED);
				events.emitEvent([events.getPlatformID(platform.ID)], objectNotifier.events.platformRemovedEvent);
			}

			response
				.addInfo(Entities.Platform.ID, platform.ID)
				.addInfo(Entities.Platform.name, platform.name);

			responses.push(response);

			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.updatePlatforms = (platforms, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(platforms, (platform, cb) => {
		interopDB.updatePlatform(platform, (results) => {
			let response;

			if (!results.success)
				response = new SystemAdminMessage(systemMessages.PLATFORM_UPDATE_REQUEST_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));
			else {
				response = new SystemAdminMessage(systemMessages.PLATFORM_UPDATED);
				events.emitEvent([events.getPlatformID(platform.ID)], objectNotifier.events.platformChangedEvent);
			}

			response
				.addInfo(Entities.Platform.ID, platform.ID)
				.addInfo(Entities.Platform.name, platform.name);

			responses.push(response);

			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.count = (filterObj, cb) => {
	const interopDB = app.get('interopDB');

	interopDB.countPlatforms(filterObj, (results) => {
		cb(results.data);
	});
};

module.exports = scope;
