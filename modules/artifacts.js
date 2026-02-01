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

scope.getAllArtifacts = (queryObj, callback) => {
	const interopDB = app.get('interopDB');
	let error;

	interopDB.getAllArtifacts(queryObj, (results) => {
		if (results.error)
			error = new SystemAdminMessage(systemMessages.LOAD_ARTIFACTS_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));

		callback(error, results?.data);
	});
};

scope.createArtifacts = (artifacts, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(artifacts, (artifact, cb) => {
		interopDB.createArtifact(artifact, (results) => {
			let response;
			let artifactID = results?.data?.ID;

			if (!results.success)
				response = new SystemAdminMessage(systemMessages.ARTIFACT_SAVE_REQUEST_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));
			else {
				response = new SystemAdminMessage(systemMessages.ARTIFACT_SAVED);
				events.emitEvent([events.getArtifactID(artifactID)], objectNotifier.events.newArtifactEvent);
			}
			response
				.addInfo(Entities.Artifact.ID, artifactID)
				.addInfo(Entities.Artifact.name, artifact.name);

			responses.push(response);

			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.deleteArtifacts = (artifacts, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(artifacts, (artifact, cb) => {
		interopDB.deleteArtifacts([artifact], (results) => {
			let response;

			if (!results.success)
				response = new SystemAdminMessage(systemMessages.ARTIFACT_DELETE_REQUEST_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));
			else {
				response = new SystemAdminMessage(systemMessages.ARTIFACT_DELETED);
				events.emitEvent([events.getArtifactID(artifact.ID)], objectNotifier.events.artifactRemovedEvent);
			}

			response
				.addInfo(Entities.Artifact.ID, artifact.ID)
				.addInfo(Entities.Artifact.name, artifact.name);

			responses.push(response);

			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.updateArtifacts = (artifacts, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(artifacts, (artifact, cb) => {
		interopDB.updateArtifact(artifact, (results) => {
			let response;

			if (!results.success)
				response = new SystemAdminMessage(systemMessages.ARTIFACT_UPDATE_REQUEST_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));
			else {
				response = new SystemAdminMessage(systemMessages.ARTIFACT_UPDATED);
				events.emitEvent([events.getArtifactID(artifact.ID)], objectNotifier.events.artifactChangedEvent);
			}

			response
				.addInfo(Entities.Artifact.ID, artifact.ID)
				.addInfo(Entities.Artifact.name, artifact.name);

			responses.push(response);

			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.countArtifacts = (filterObj, cb) => {
	const interopDB = app.get('interopDB');

	interopDB.countArtifacts(filterObj, (results) => {
		cb(results.data);
	});
};

module.exports = scope;
