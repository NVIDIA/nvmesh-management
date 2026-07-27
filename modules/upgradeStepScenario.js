/* global app */

const async = require('async');
const systemMessages = require('../systemMessages.js');
const { Entities, SystemMessage, SystemAdminMessage } = require('../modules/error.js');
const objectNotifier = require('../objectNotifier.js');
const events = require('../events.js');

const scope = {};

scope.getAllUpgradeStepScenarios = (queryObj, cb) => {
	const interopDB = app.get('interopDB');

	interopDB.getAllUpgradeSteps(queryObj, (results) => {
		if (results.error)
			return cb(new SystemMessage(systemMessages.FAILED_TO_LOAD_UPGRADE_STEP_SCENARIOS).addInfo(Entities.Error, results.error));

		cb(null, results.data || results);
	});
};

scope.countUpgradeStepScenarios = (filterObj, cb) => {
	const interopDB = app.get('interopDB');

	interopDB.countUpgradeSteps(filterObj, (results) => {
		cb(results.data);
	});
};

scope.createUpgradeStepScenarios = (upgradeStepScenarios, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(upgradeStepScenarios, (upgradeStepScenario, cb) => {
		interopDB.createUpgradeStep(upgradeStepScenario, (results) => {
			const upgradeStepScenarioID = results?.data?.ID;
			let response;

			if (!results.success)
				response = new SystemAdminMessage(systemMessages.UPGRADE_STEP_SCENARIO_SAVE_REQUEST_FAILED).addInfo(Entities.Error, results.error);
			else {
				response = new SystemAdminMessage(systemMessages.UPGRADE_STEP_SCENARIO_SAVED);
				events.emitEvent([events.getUpgradeStepScenarioID(upgradeStepScenarioID)], objectNotifier.events.newUpgradeStepScenarioEvent);
			}
			response
				.addInfo(Entities.UpgradeStepScenario.ID, upgradeStepScenarioID)
				.addInfo(Entities.UpgradeStepScenario.name, upgradeStepScenario.name);

			responses.push(response);
			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.updateUpgradeStepScenarios = (upgradeStepScenarios, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(upgradeStepScenarios, (upgradeStepScenario, cb) => {
		interopDB.updateUpgradeStep(upgradeStepScenario, (results) => {
			let response;

			if (!results.success)
				response = new SystemAdminMessage(systemMessages.UPGRADE_STEP_SCENARIO_UPDATE_REQUEST_FAILED).addInfo(Entities.Error, results.error);
			else {
				response = new SystemAdminMessage(systemMessages.UPGRADE_STEP_SCENARIO_UPDATED);
				events.emitEvent([events.getUpgradeStepScenarioID(upgradeStepScenario.ID)], objectNotifier.events.upgradeStepScenarioChangedEvent);
			}

			response
				.addInfo(Entities.UpgradeStepScenario.ID, upgradeStepScenario.ID)
				.addInfo(Entities.UpgradeStepScenario.name, upgradeStepScenario.name);

			responses.push(response);
			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.deleteUpgradeStepScenarios = (upgradeStepScenarios, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(upgradeStepScenarios, (upgradeStepScenario, cb) => {
		interopDB.deleteUpgradeSteps([upgradeStepScenario], (results) => {
			let response;

			if (!results.success)
				response = new SystemAdminMessage(systemMessages.UPGRADE_STEP_SCENARIO_DELETE_REQUEST_FAILED).addInfo(Entities.Error, results.error);
			else {
				response = new SystemAdminMessage(systemMessages.UPGRADE_STEP_SCENARIO_DELETED);
				events.emitEvent([events.getUpgradeStepScenarioID(upgradeStepScenario.ID)], objectNotifier.events.upgradeStepScenarioRemovedEvent);
			}

			response
				.addInfo(Entities.UpgradeStepScenario.ID, upgradeStepScenario.ID)
				.addInfo(Entities.UpgradeStepScenario.name, upgradeStepScenario.name);

			responses.push(response);
			cb();
		});
	}, () => {
		callback(responses);
	});
};

module.exports = scope;
