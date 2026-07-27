/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* global app */

var ObjectId = require('mongodb-legacy').ObjectId;
var async = require('async');

var utils = require('../utils.js');
var events = require('../events.js');
var consts = require('../consts.js');
var objectNotifier = require('../objectNotifier.js');
var { SystemAdminMessage, Entities, MongoError } = require('./error.js');
var systemMessages = require('../systemMessages.js');

var scope = {};

scope.afterModuleLoaded = () => {
	({ SystemAdminMessage, Entities, MongoError } = require('./error.js'));
};

scope.load = function(projection, callback, useCache = true) {
	var db = app.get('db');
	var globalSettingsCollection = db.collection('globalSettings');
	var cache = app.get('globalSettings');
	function getValue(obj, path) {
		return path.split('.').reduce((acc, currKey) => typeof acc !== 'undefined' && currKey in acc ? acc[currKey] : undefined, obj);
	}

	if (useCache && cache) {
		var result = {};

		if (utils.isEmpty(projection)) {
			result = cache;
		} else {
			for (const [key, value] of Object.entries(projection))
				if (value === 1)
					result[key] = getValue(cache, key);
		}
		return callback && callback(null, result);
	}

	globalSettingsCollection.findOne({}, { projection: projection || {} }, (err, settings) => {
		if (err) {
			new MongoError(err).log();
		} else if (utils.isEmpty(projection)) {
			updateSettingsInCache(settings);
		}

		callback && callback(err, settings);
	});
};

function updateSettingsInCache(settings) {
	app.set('globalSettings', settings);
	app.set('globalSettingsHidden', settings.hidden);
	delete settings.hidden;
}

scope.updateGeneralSettings = (settings, callback) => {
	const messages = [];
	const db = app.get('db');
	const globalSettingsCollection = db.collection('globalSettings');
	let currSettings;

	async.series([
		function findExistingSettings(cb) {
			globalSettingsCollection.findOne({}, (err, dbSettings) => {
				if (err)
					return cb(err);

				if (!dbSettings)
					return cb('No settings found!');

				currSettings = dbSettings;

				settings._id = dbSettings._id;
				settings.version = dbSettings.version;
				settings.dateModified = new Date();

				cb();
			});
		},
		function validateSettings(cb) {
			// do not allow disabling zones
			if (!settings.enableZones && currSettings.enableZones) {
				return cb('Cannot disable zones once zones are enabled');
			}

			// skip if not trying to enable zones
			if (!settings.enableZones || currSettings.enableZones) {
				return cb();
			}

			const serversCollection = db.collection('server');
			serversCollection.countDocuments((err, count) => {
				if (err)
					return cb(err);

				if (count > 0)
					return cb('Cannot enable zones because the cluster already contains targets!');

				cb();
			});
		},
		function updateSettings(cb) {
			let id = new ObjectId(settings._id);
			let version = settings.version;

			delete settings._id;
			delete settings.version;
			delete settings.hidden;

			globalSettingsCollection.findOneAndUpdate(
				{ _id: id, version: version },
				{ ...utils.setUpdateOperators(settings), $inc: { version: 1 } },
				{ returnDocument: consts.mongoReturnDocument.AFTER },
				(err, newSettings) => {
					if (err) {
						new MongoError(err).log();

					} else if (!newSettings) {
						err = 'Looks like someone updated settings at the same time, please try again.';

					} else {
						updateSettingsInCache(newSettings);
						events.emitEvent(null, objectNotifier.events.generalSettingsChangeEvent);
					}

					cb(err);
				});
		}
	], (err) => {
		if (err)
			messages.push(new SystemAdminMessage(systemMessages.GENERAL_SETTINGS_UPDATE_FAILED).addInfo(Entities.Error, err));
		else
			messages.push(new SystemAdminMessage(systemMessages.GENERAL_SETTINGS_UPDATED));

		callback(messages);
	});
};

module.exports = scope;
