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

scope.getOperatingSystems = (queryObj, callback) => {
	const interopDB = app.get('interopDB');

	interopDB.getAllOperatingSystems(queryObj, (results) => {
		if (results.error)
			return callback(new SystemAdminMessage(systemMessages.LOAD_OPERATING_SYSTEMS_FAILED).addInfo(Entities.Error, new InteropDBError(results.error)));

		callback(null, results.data);
	});
};

scope.getDistributionTypes = (queryObj, callback) => {
	const interopDB = app.get('interopDB');

	interopDB.getAllDistributionTypes(queryObj, (results) => {
		if (results.error)
			return callback(new SystemAdminMessage(systemMessages.LOAD_DISTRIBUTION_TYPES_FAILED).addInfo(Entities.Error, new InteropDBError(results.error)));

		callback(null, results.data);
	});
};

scope.countOperatingSystems = (filterObj, callback) => {
	const interopDB = app.get('interopDB');

	interopDB.countOperatingSystems(filterObj, (results) => {
		callback(results.data);
	});
};

scope.createOperatingSystems = (operatingSystems, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(operatingSystems, (operatingSystem, cb) => {
		interopDB.createOperatingSystem(operatingSystem, (results) => {
			let response;

			if (!results.success) {
				response = new SystemAdminMessage(systemMessages.OPERATING_SYSTEM_SAVE_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));
			} else {
				response = new SystemAdminMessage(systemMessages.OPERATING_SYSTEM_SAVED).addInfo(Entities.OperatingSystem.ID, results.data.ID);
				events.emitEvent([events.getOperatingSystemID(results.data.ID)], objectNotifier.events.newOperatingSystemEvent);
			}

			response.addInfo(Entities.OperatingSystem.version, operatingSystem.version);
			response.addInfo(Entities.OperatingSystem.distributionType, operatingSystem.distributionTypeID);
			responses.push(response);

			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.updateOperatingSystems = (operatingSystems, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(operatingSystems, (operatingSystem, cb) => {
		interopDB.updateOperatingSystem(operatingSystem, (results) => {
			let response;

			if (!results.success)
				response = new SystemAdminMessage(systemMessages.OPERATING_SYSTEM_UPDATE_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));
			else {
				response = new SystemAdminMessage(systemMessages.OPERATING_SYSTEM_UPDATED);
				events.emitEvent([events.getOperatingSystemID(operatingSystem.ID)], objectNotifier.events.operatingSystemChangedEvent, operatingSystem);
			}
			response
				.addInfo(Entities.OperatingSystem.ID, operatingSystem.ID)
				.addInfo(Entities.OperatingSystem.version, operatingSystem.version)
				.addInfo(Entities.OperatingSystem.distributionType, operatingSystem.distributionTypeID);

			responses.push(response);

			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.deleteOperatingSystems = (operatingSystems, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(operatingSystems, (operatingSystem, cb) => {
		interopDB.deleteOperatingSystems([{ ID: operatingSystem.ID }], (results) => {
			let response;

			if (!results.success)
				response = new SystemAdminMessage(systemMessages.OPERATING_SYSTEM_DELETE_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));
			else {
				response = new SystemAdminMessage(systemMessages.OPERATING_SYSTEM_DELETED);
				events.emitEvent([events.getOperatingSystemID(operatingSystem.ID)], objectNotifier.events.operatingSystemRemovedEvent);
			}

			response
				.addInfo(Entities.OperatingSystem.ID, operatingSystem.ID)
				.addInfo(Entities.OperatingSystem.version, operatingSystem.version);

			responses.push(response);

			cb();
		});
	}, () => {
		callback(responses);
	});
};

module.exports = scope;
