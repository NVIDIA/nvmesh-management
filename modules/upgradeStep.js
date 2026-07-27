/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* global app */

const consts = require('../consts.js');
const utils = require('../utils.js');
const events = require('../events.js');
const objectNotifier = require('../objectNotifier.js');
const systemMessages = require('../systemMessages.js');
const upgradeModule = require('./upgrade.js');
const { Entities, SystemMessage, SystemAdminMessage } = require('../modules/error.js');
const { MongoError } = require('./error.js');

const scope = {};

scope.getAllUpgradeSteps = (queryObj, cb) => {
	utils.loadCollection('upgradeStep', queryObj, function(err, upgradeSteps) {
		let error;

		if (err)
			error = new SystemMessage(systemMessages.FAILED_TO_LOAD_UPGRADE_STEPS).addInfo(Entities.Error, err);

		cb(error, upgradeSteps);
	});
};

scope.setBreakpoint = (upgradeStepID, isBreakpointSet, cb) => {
	const db = app.get('db');
	const collection = db.collection('upgradeStep');

	collection.findOneAndUpdate(
		{ _id: upgradeStepID, status: consts.upgradeStepStatuses.PENDING },
		{ $set: { isBreakpointSet } },
		{ returnDocument: 'after' },
		(err, result) => {
			if (err) return cb(new MongoError(err).log());
			if (!result) return cb(new SystemMessage(systemMessages.UPGRADE_STEP_SET_BREAKPOINT_FAILED).addInfo(Entities.UpgradeStep.ID, upgradeStepID));

			cb(null, result);
		});
};

scope.markAsCompleted = (upgradeStepID, cb) => {
	const db = app.get('db');
	const collection = db.collection('upgradeStep');

	collection.findOneAndUpdate(
		{ _id: upgradeStepID, status: consts.upgradeStepStatuses.FAILED },
		{ $set: { status: consts.upgradeStepStatuses.MANUALLY_COMPLETED } },
		{ returnDocument: 'after' },
		(err, result) => {
			if (err) return cb([new MongoError(err).log()]);

			if (!result) 
				return cb([new SystemAdminMessage(systemMessages.UPGRADE_STEP_MARK_AS_COMPLETED_FAILED)
					.addInfo(Entities.UpgradeStep.ID, upgradeStepID)]
				);

			events.emitEvent(
				[events.getUpgradeID(result.upgradeID), events.getUpgradeStepID(result._id)],
				objectNotifier.events.upgradeStepStatusChangedEvent,
				result
			);

			upgradeModule.updateUpgrade(result.upgradeID, true, [], (err) => {
				if (err) return cb([err]);

				cb([new SystemAdminMessage(systemMessages.UPGRADE_STEP_MARKED_AS_COMPLETED).addInfo(Entities.UpgradeStep.ID, upgradeStepID)]);
			});
		});
};

module.exports = scope;
