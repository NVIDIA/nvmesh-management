/* global app */

const async = require('async');
const systemMessages = require('../systemMessages.js');
const { Entities, SystemMessage, SystemAdminMessage } = require('../modules/error.js');
const objectNotifier = require('../objectNotifier.js');
const events = require('../events.js');

const scope = {};

scope.getAllUpgrades = (queryObj, cb) => {
	const interopDB = app.get('interopDB');

	interopDB.getAllUpgrades(queryObj, (results) => {
		if (results.error)
			return cb(new SystemMessage(systemMessages.FAILED_TO_LOAD_UPGRADE_SCENARIOS).addInfo(Entities.Error, results.error));

		cb(null, results.data || results);
	});
};

scope.countUpgrades = (filterObj, cb) => {
	const interopDB = app.get('interopDB');

	interopDB.countUpgrades(filterObj, (results) => {
		cb(results.data);
	});
};

scope.createUpgrades = (upgrades, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(upgrades, (upgrade, cb) => {
		interopDB.createUpgrade(upgrade, (results) => {
			const upgradeID = results?.data?.ID;
			let response;

			if (!results.success)
				response = new SystemAdminMessage(systemMessages.UPGRADE_SCENARIO_SAVE_REQUEST_FAILED).addInfo(Entities.Error, results.error);
			else {
				response = new SystemAdminMessage(systemMessages.UPGRADE_SCENARIO_SAVED);
				events.emitEvent([events.getUpgradeScenarioID(upgradeID)], objectNotifier.events.newUpgradeScenarioEvent);
			}
			response
				.addInfo(Entities.UpgradeScenario.ID, upgradeID)
				.addInfo(Entities.UpgradeScenario.sourceVersion, upgrade.sourceVersion)
				.addInfo(Entities.UpgradeScenario.destinationVersion, upgrade.destinationVersion);

			responses.push(response);
			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.updateUpgrades = (upgrades, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(upgrades, (upgrade, cb) => {
		interopDB.updateUpgrade(upgrade, (results) => {
			let response;

			if (!results.success)
				response = new SystemAdminMessage(systemMessages.UPGRADE_SCENARIO_UPDATE_REQUEST_FAILED).addInfo(Entities.Error, results.error);
			else {
				response = new SystemAdminMessage(systemMessages.UPGRADE_SCENARIO_UPDATED);
				events.emitEvent([events.getUpgradeScenarioID(upgrade.ID)], objectNotifier.events.upgradeScenarioChangedEvent);
			}

			response
				.addInfo(Entities.UpgradeScenario.ID, upgrade.ID)
				.addInfo(Entities.UpgradeScenario.sourceVersion, upgrade.sourceVersion)
				.addInfo(Entities.UpgradeScenario.destinationVersion, upgrade.destinationVersion);

			responses.push(response);
			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.deleteUpgrades = (upgrades, callback) => {
	const interopDB = app.get('interopDB');
	const responses = [];

	async.eachSeries(upgrades, (upgrade, cb) => {
		interopDB.deleteUpgrades([upgrade], (results) => {
			let response;

			if (!results.success)
				response = new SystemAdminMessage(systemMessages.UPGRADE_SCENARIO_DELETE_REQUEST_FAILED).addInfo(Entities.Error, results.error);
			else {
				response = new SystemAdminMessage(systemMessages.UPGRADE_SCENARIO_DELETED);
				events.emitEvent([events.getUpgradeScenarioID(upgrade.ID)], objectNotifier.events.upgradeScenarioRemovedEvent);
			}

			response
				.addInfo(Entities.UpgradeScenario.ID, upgrade.ID)
				.addInfo(Entities.UpgradeScenario.sourceVersion, upgrade.sourceVersion)
				.addInfo(Entities.UpgradeScenario.destinationVersion, upgrade.destinationVersion);

			responses.push(response);
			cb();
		});
	}, () => {
		callback(responses);
	});
};

scope.getAllUpgradeTypes = (cb) => {
	const interopDB = app.get('interopDB');

	interopDB.getAllUpgradeTypes((results) => {
		if (results.error)
			return cb(new SystemMessage(systemMessages.FAILED_TO_LOAD_UPGRADE_TYPES).addInfo(Entities.Error, results.error));

		cb(null, results.data || results);
	});
};

module.exports = scope;
