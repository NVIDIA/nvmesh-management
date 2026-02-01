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


scope.getAllReleases = (queryObj, callback) => {
	const interopDB = app.get('interopDB');
	let error;

	interopDB.getAllReleases(queryObj, (results) => {
		if (results.error)
			error = new SystemAdminMessage(systemMessages.LOAD_RELEASES_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));

		callback(error, results?.data);
	});
};

scope.createReleases = (releases, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(releases, (release, cb) => {
		interopDB.createRelease(release, (results) => {
			let response;
			let releaseID = results?.data?.ID;

			if (!results.success)
				response = new SystemAdminMessage(systemMessages.RELEASE_SAVE_REQUEST_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));
			else {
				response = new SystemAdminMessage(systemMessages.RELEASE_SAVED);
				events.emitEvent([events.getReleaseID(releaseID)], objectNotifier.events.newReleaseEvent);
			}
			response
				.addInfo(Entities.Release.ID, releaseID)
				.addInfo(Entities.Release.name, release.version);

			responses.push(response);

			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.deleteReleases = (releases, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(releases, (release, cb) => {
		interopDB.deleteReleases([release], (results) => {
			let response;

			if (!results.success)
				response = new SystemAdminMessage(systemMessages.RELEASE_DELETE_REQUEST_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));
			else {
				response = new SystemAdminMessage(systemMessages.RELEASE_DELETED);
				events.emitEvent([events.getReleaseID(release.ID)], objectNotifier.events.releaseRemovedEvent);
			}

			response
				.addInfo(Entities.Release.ID, release.ID)
				.addInfo(Entities.Release.name, release.version);

			responses.push(response);

			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.updateReleases = (releases, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(releases, (release, cb) => {
		interopDB.updateRelease(release, (results) => {
			let response;

			if (!results.success)
				response = new SystemAdminMessage(systemMessages.RELEASE_UPDATE_REQUEST_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));
			else {
				response = new SystemAdminMessage(systemMessages.RELEASE_UPDATED);
				events.emitEvent([events.getReleaseID(release.ID)], objectNotifier.events.releaseChangedEvent);
			}

			response
				.addInfo(Entities.Release.ID, release.ID)
				.addInfo(Entities.Release.name, release.version);

			responses.push(response);

			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.count = (filterObj, cb) => {
	const interopDB = app.get('interopDB');

	interopDB.countReleases(filterObj, (results) => {
		cb(results.data);
	});
};

module.exports = scope;
