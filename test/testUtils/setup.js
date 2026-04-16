/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app, log */

const generalSettingsModule = require('../../modules/generalSettings.js');
const utils = require('../../utils.js');
const lockModule = require('../../modules/lock.js');
const exec = require('child_process').exec;
const EventEmitter = require('eventemitter3');
const testLogModule = require('./log.js');
const bootstrapper = require('../../bootstrapper.js');
const { mockKafkaModule } = require('./mockKafkaModule.js');
const consts = require('../../consts.js');
const { setEnableZones } = require('./settingsUtils.js');
const mongoDBModule = require('../../modules/mongoDB.js');

// eslint-disable-next-line no-global-assign
log = testLogModule.createLogger();

app.set('testLogger', log);
const DB_NAME = app.get('test-db-name');

const scope = {};
exports.setup = scope;

exports.SetupOptions = class SetupOptions{
	constructor(enableZones) {
		this.enableZones = enableZones == undefined ? false : enableZones;
		this.enableMongoLog = false;
	}

	setEnableZones(enableZones) {
		this.enableZones = enableZones;
		return this;
	}

	setEnableMongoLog(enableMongoLog) {
		this.enableMongoLog = enableMongoLog;
		return this;
	}
};

/**
 * @param {exports.SetupOptions} options
 * @returns {Promise}
 */
scope.newSetup = async function(options) {
	if (!options)
		options = new exports.SetupOptions();
	await scope.resetDB();
	await scope.initApp(options);
	await setEnableZones(options.enableZones);
	await mockKafkaModule();
};

scope.ensureClusterConfigDoc = function() {
	const db = app.get('db');
	return db.collection('configurationVersion').findOneAndUpdate(
		{ _id: consts.CONFIG_VER_CLUSTER_ID },
		{
			$setOnInsert: {
				_id: consts.CONFIG_VER_CLUSTER_ID,
				dbUUID: app.get('dbUUID'),
				protocolVersion: 1,
				supportedMCSVersions: ['1.0'],
				managements: {}
			}
		},
		{ upsert: true }
	);
};

scope.afterModulesLoaded = function() {
	return new Promise(resolve => {
		bootstrapper.afterModulesLoaded(() => {
			bootstrapper.registerToEvents(resolve);
		});
	});
};

scope.initApp = async function(options) {
	// variables that only need to be instantiated once, even if db is cleared during it's life time.
	app.set('projectRoot', __dirname);
	app.set('eventEmitter', new EventEmitter());
	app.set('managementLogger', log);

	if (options && options.enableMongoLog)
		testLogModule.enableMongoLog();
	else
		testLogModule.disableMongoLog();

	app.set('authorizedConnections', {});
	app.set('timedIntervals', { intervals: {} });
	app.set('communicationStats', {});

	app.set('managementVersion', '3.1.0-509.el8_6');
	app.set('rpmVersion', '3.1.0-509.el8_6');

	// HA
	app.set('managementId', 'unittest-mgmt');
	app.set('mgmtOutboundClusterConnections', {});
	app.set('mgmtInboundClusterConnections', {});

	// disable message debouncer for tests
	consts.DEFAULT_DEBOUNCER_MINIMUM_WAIT = 0;
	scope.setupOpenTelemetry();
	await scope.resetCache();
	await scope.afterModulesLoaded();
};

scope.setupOpenTelemetry = function() {
	const openTelemetry = require('../../modules/openTelemetry.js');
	openTelemetry.otelBooststrapLog = () => {};
	openTelemetry.init();
	openTelemetry.stopInstrumentation();
};

scope.resetCache = function() {
	return new Promise((resolve, reject) => {
	// cache variables that must be reset every time we clear the DB
		log.debug('reset cache');
		utils.resetDebouncerCache();
		app.set('authorizedConnections', {});
		app.set('timedIntervals', { intervals: {} });
		app.set('communicationStats', {});
		app.set('globalSettings', null);

		Object.keys(lockModule._zoneLocksCache).forEach(zone => {
			delete lockModule._zoneLocksCache[zone];
		});

		generalSettingsModule.load({}, (err) => {
			if (err)
				return reject(err);

			// override globalSettings for tests
			var globalSettings = app.get('globalSettings');
			globalSettings.loggingLevel = consts.loggingLevel.DEBUG;
			resolve();
		});
	});
};

scope.dropDB = function() {
	let db = app.get('db');
	return db.dropDatabase();
};

scope.clearDB = function() {
	let db = app.get('db');

	let collectionNames = [
		'client',
		'configurationProfile',
		'configurationVersion',
		'globalSettings',
		'lastMessageLog',
		'lock',
		'log',
		'mcsConnection',
		'server',
		'serverClass',
		'diskClass',
		'statisticsLayout',
		'user',
		'volume',
		'volumeProvisioningGroup',
		'managementCluster',
		'statistics',
		'nodeConfiguration',
		'key',
		'volumeSecurityGroup'
	];

	function deleteAllDocumentsFromCollection(collectionName) {
		return new Promise((resolve, reject) => {
			db.collection(collectionName).deleteMany({}, (err) => {
				if (err)
					return reject(err);

				resolve();
			});
		});

	}
	let clearFunctions = collectionNames.map(name => deleteAllDocumentsFromCollection(name));
	return Promise.all(clearFunctions);
};

scope.initDB = function() {
	return new Promise((resolve, reject) => {
		exec(`mongosh ${DB_NAME} ./initDB.js`, (error, stdout, stderr) => {
			log.debug(`error: ${error ? error.message : ''}. stderr: ${stderr} stdout: ${stdout}`);
			if (error)
				return reject(error);

			resolve();
		});
	});
};

scope.populateDB = function() {
	// This code currently DOES NOT SUPPORT docVersion fetching from Interop-DB
	return new Promise((resolve, reject) => {
		mongoDBModule.populateInitialDBCollections((error) => {
			if (error)
				return reject(error);

			resolve();
		});
	});
};

scope.resetDB = function() {
	return scope.dropDB()
		.then(() => scope.initDB())
		.then(() => scope.populateDB())
		.then(() => scope.ensureClusterConfigDoc());
};

scope.saveTargets = function(targets) {
	let promises = targets.map(t => t.save());
	return Promise.all(promises);
};
