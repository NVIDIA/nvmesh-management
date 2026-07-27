/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* global app */

const async = require('async');
const { SystemAdminMessage, Entities, InteropDBError } = require('./error');
const systemMessages = require('../systemMessages');
const events = require('../events');
const objectNotifier = require('../objectNotifier');

const scope = {};

scope.getKernels = (queryObj, callback) => {
	const interopDB = app.get('interopDB');

	interopDB.getAllKernels(queryObj, (results) => {
		if (results.error)
			return callback(new SystemAdminMessage(systemMessages.LOAD_KERNELS_FAILED).addInfo(Entities.Error, new InteropDBError(results.error)));

		callback(null, results.data);
	});
};

scope.countKernels = (filterObj, callback) => {
	const interopDB = app.get('interopDB');

	interopDB.countKernels(filterObj, (results) => {
		callback(results.data);
	});
};

scope.createKernels = (kernelVersions, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(kernelVersions, (version, cb) => {
		interopDB.createKernel({ version }, (results) => {
			let response;

			if (!results.success) {
				response = new SystemAdminMessage(systemMessages.KERNEL_SAVE_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));
			} else {
				response = new SystemAdminMessage(systemMessages.KERNEL_SAVED).addInfo(Entities.Kernel.ID, results.data.ID);
				events.emitEvent([events.getKernelID(results.data.ID)], objectNotifier.events.newKernelEvent);
			}

			response.addInfo(Entities.Kernel.version, version);
			responses.push(response);

			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.updateKernels = (kernels, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(kernels, (kernel, cb) => {
		interopDB.updateKernel(kernel, (results) => {
			let response;

			if (!results.success)
				response = new SystemAdminMessage(systemMessages.KERNEL_UPDATE_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));
			else {
				response = new SystemAdminMessage(systemMessages.KERNEL_UPDATED);
				events.emitEvent([events.getKernelID(kernel.ID)], objectNotifier.events.kernelChangedEvent, { version: kernel.version });
			}
			response
				.addInfo(Entities.Kernel.ID, kernel.ID)
				.addInfo(Entities.Kernel.version, kernel.version);

			responses.push(response);

			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.deleteKernels = (kernels, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(kernels, (kernel, cb) => {
		interopDB.deleteKernels([{ ID: kernel.ID }], (results) => {
			let response;

			if (!results.success)
				response = new SystemAdminMessage(systemMessages.KERNEL_DELETE_FAILED).addInfo(Entities.Error, new InteropDBError(results.error));
			else {
				response = new SystemAdminMessage(systemMessages.KERNEL_DELETED);
				events.emitEvent([events.getKernelID(kernel.ID)], objectNotifier.events.kernelRemovedEvent);
			}

			response
				.addInfo(Entities.Kernel.ID, kernel.ID)
				.addInfo(Entities.Kernel.version, kernel.version);

			responses.push(response);

			cb();
		});
	}, () => {
		callback(responses);
	});
};

module.exports = scope;