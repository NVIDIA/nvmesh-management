/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

const async = require('async');
const systemMessages = require('../systemMessages.js');

const { SystemAdminMessage, Entities, InteropDBError } = require('./error.js');

let scope = {};

scope.getAllComponentVersions = (queryObj, callback) => {
	const interopDB = app.get('interopDB');
	let error;

	interopDB.getAllComponentVersions(queryObj, (results) => {
		if (results.error)
			error = new SystemAdminMessage(systemMessages.LOAD_COMPONENTS_VERSIONS_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));

		callback(error, results?.data);
	});
};

scope.createComponents = (components, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(components, (component, cb) => {
		interopDB.createComponentVersion(component, (results) => {
			let response = !results.success
				? new SystemAdminMessage(systemMessages.COMPONENT_SAVE_REQUEST_FAILED)
					.addInfo(Entities.Error, new InteropDBError(results.error))
					.addInfo(Entities.Component.ID, component.ID)
				: new SystemAdminMessage(systemMessages.COMPONENT_SAVED)
					.addInfo(Entities.Component.ID, results.data.ID);

			responses.push(response);

			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.deleteComponents = (components, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(components, (component, cb) => {
		interopDB.deleteComponentVersions([component], (results) => {
			let response = (!results.success
				? new SystemAdminMessage(systemMessages.COMPONENT_DELETE_REQUEST_FAILED).addInfo(Entities.Error, new InteropDBError(results.error))
				: new SystemAdminMessage(systemMessages.COMPONENT_DELETED)
			).addInfo(Entities.Component.ID, component.ID);

			responses.push(response);

			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.updateComponents = (components, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(components, (component, cb) => {
		interopDB.updateComponentVersion(component, (results) => {
			let response = (!results.success
				? new SystemAdminMessage(systemMessages.COMPONENT_UPDATE_REQUEST_FAILED).addInfo(Entities.Error, new InteropDBError(results.error))
				: new SystemAdminMessage(systemMessages.COMPONENT_UPDATED)
			).addInfo(Entities.Component.ID, component.ID);

			responses.push(response);

			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.getAllComponentTypes = (callback) => {
	const interopDB = app.get('interopDB');

	interopDB.getAllComponentTypes((results) => {
		callback(results.data);
	});
};

scope.getAllComponents = (queryObj, eagerLoading, callback) => {
	const interopDB = app.get('interopDB');
	let error;

	interopDB.getAllComponents(queryObj, eagerLoading, (results) => {
		if (results.error)
			error = new SystemAdminMessage(systemMessages.LOAD_COMPONENTS_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));

		callback(error, results?.data);
	});
};

scope.getComponentsByTypeID = (componentTypeID, callback) => {
	const interopDB = app.get('interopDB');

	interopDB.getComponentsByTypeID(componentTypeID, (results) => {
		callback(results.data);
	});
};

scope.count = (filterObj, cb) => {
	const interopDB = app.get('interopDB');

	interopDB.countComponentVersions(filterObj, (results) => {
		cb(results.data);
	});
};

scope.countComponents = (filterObj, cb) => {
	const interopDB = app.get('interopDB');

	interopDB.countComponents(filterObj, (results) => {
		cb(results.data);
	});
};

module.exports = scope;
