/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

const async = require('async');
const uuid = require('uuid');

const utils = require('../utils');
const VSGModule = require('./volumeSecurityGroup');
const { SystemAdminMessage, Entities, MongoError, SystemMessage } = require('./error');
const systemMessages = require('../systemMessages');

const scope = {};

scope.deleteKeys = (keys, callback) => {
	const messages = [];

	async.each(keys, (key, callback) => {
		utils.deleteFromCollection([key], 'key', false, (err, results) => {
			let error;

			if (err) {
				error = new MongoError(err).log();
			} else if (results.deletedCount === 0) {
				error = new SystemMessage(systemMessages.KEYS_DELETE_NOT_FOUND);
			}

			messages.push((error ?
				new SystemAdminMessage(systemMessages.KEYS_DELETE_FAILED).addInfo(Entities.Error, error) :
				new SystemAdminMessage(systemMessages.KEYS_DELETED))
				.addInfo(Entities.Keys.ID, key._id)
				.addInfo(Entities.Keys.UUID, key.uuid));
			callback();
		});
	}, () => VSGModule.removeKeysFromSVG(keys, () => callback(messages)));
};

scope.saveKeys = (keys, user, callback) => {
	const messages = [];

	async.eachSeries(keys, (key, callback) => {
		key.uuid = uuid.v1();
		key.dateCreated = key.dateModified = new Date();
		key.createdBy = key.modifiedBy = user.email;

		utils.insertToCollection(key, 'key', (err) => {
			messages.push((err ?
				new SystemAdminMessage(systemMessages.KEYS_SAVE_FAILED)
					.addInfo(Entities.Error, err.isDuplicateKeyError ? new SystemMessage(systemMessages.KEY_SAVE_FAILURE_DUP_KEY) : err) :
				new SystemAdminMessage(systemMessages.KEYS_SAVED))
				.addInfo(Entities.Keys.ID, key._id)
				.addInfo(Entities.Keys.UUID, key.uuid));
			callback();
		});
	}, () => callback(messages));
};

scope.updateKeys = (keys, user, callback) => {
	const db = app.get('db');
	const keyCollection = db.collection('key');
	const messages = [];

	async.eachSeries(keys, (key, callback) => {
		let keyFromDB;

		async.series([
			(callback) => {
				keyCollection.findOne({ _id: key._id, uuid: key.uuid }, (err, result) => {
					let error;

					if (err)
						error = new MongoError(err).log();
					else if (!result)
						error = new SystemMessage(systemMessages.UPDATE_KEY_NOT_FOUND);

					keyFromDB = result;
					callback(error);
				});
			}, (callback) => {
				keyFromDB.dateModified = new Date();
				keyFromDB.modifiedBy = user.email;
				keyFromDB.description = key.description;

				utils.updateCollection([keyFromDB], 'key', false, (err) => {
					if (err)
						return callback(new MongoError(err).log());

					callback();
				});
			}
		], (error) => {
			messages.push((error ?
				new SystemAdminMessage(systemMessages.KEYS_UPDATE_FAILED).addInfo(Entities.Error, error) :
				new SystemAdminMessage(systemMessages.KEYS_UPDATED))
				.addInfo(Entities.Keys.ID, key._id)
				.addInfo(Entities.Keys.UUID, key.uuid));
			callback();
		});
	}, () => callback(messages));
};

scope.fetchKeyByID = function(keyID, cb) {
	utils.fetchEntityByID('key', keyID, false, {}, systemMessages.KEY_NOT_FOUND, cb);
};

module.exports = scope;
