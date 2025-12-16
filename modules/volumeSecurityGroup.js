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
const uuid = require('uuid');

const utils = require('../utils');
const systemMessages = require('../systemMessages');
const { MongoError, SystemMessage, Entities, SystemAdminMessage } = require('./error');

const scope = {};

scope.fetchVSGByID = function(vsgID, cb) {
	utils.fetchEntityByID('volumeSecurityGroup', vsgID, false, {}, systemMessages.VSG_NOT_FOUND, cb);
};

scope.deleteVSGs = (VSGs, callback) => {
	const messages = [];

	async.each(VSGs, (VSG, callback) => {
		utils.deleteFromCollection([VSG], 'volumeSecurityGroup', false, (err, results) => {
			let error;

			if (err) {
				error = new MongoError(err).log();
			} else if (results.deletedCount === 0) {
				error = new SystemMessage(systemMessages.VSG_DELETE_NOT_FOUND);
			}

			messages.push((error ? 
				new SystemAdminMessage(systemMessages.VSG_DELETE_FAILED).addInfo(Entities.Error, error) : 
				new SystemAdminMessage(systemMessages.VSG_DELETED)) 
				.addInfo(Entities.VSG.ID, VSG._id)
				.addInfo(Entities.VSG.UUID, VSG.uuid));
			callback();
		});
	}, () => callback(messages));
};

scope.saveVSGs = (VSGs, user, cb) => {
	const messages = [];

	async.eachSeries(VSGs, (VSG, callback) => {
		let successLog;

		async.series([
			(callback) => validateKeys(VSG, callback),
			(callback) => {
				VSG.dateCreated = VSG.dateModified = new Date();
				VSG.createdBy = VSG.modifiedBy = user.email;
				VSG.uuid = uuid.v1();

				utils.insertToCollection(VSG, 'volumeSecurityGroup', (err) => {
					if (err) {
						if (err.isDuplicateKeyError)
							return callback(new SystemMessage(systemMessages.VSG_NAME_ALREADY_EXISTS));

						return callback(err);
					}

					successLog = new SystemAdminMessage(systemMessages.VSG_SAVED);
					callback();
				});
			}
		], (error) => {
			messages.push((successLog || new SystemAdminMessage(systemMessages.VSG_SAVE_FAILED).addInfo(Entities.Error, error))
				.addInfo(Entities.VSG.ID, VSG._id)
				.addInfo(Entities.VSG.UUID, VSG.uuid));
			callback();
		});
	}, () => cb(messages));
};

function validateKeys(VSG, cb) {
	if (!VSG.keys)
		return cb();

	const db = app.get('db');
	const keyCollection = db.collection('key');

	keyCollection.find({ _id: { $in: VSG.keys } }).toArray((err, keys) => {
		if (err)
			return cb(new MongoError(err).log());

		if (keys?.length !== VSG.keys.length) {
			const keyFoundIDs = keys.map(k => k._id);
			const inexistingKeyIDs = VSG.keys.filter(requestKey => keyFoundIDs.includes(requestKey));
			const message = new SystemMessage(systemMessages.KEY_NOT_FOUND);
			inexistingKeyIDs.forEach(k => message.addInfo(Entities.Keys.ID, k));
			return cb(message);
		}

		cb();
	});
}

scope.updateVSGs = (VSGs, user, cb) => {
	const db = app.get('db');
	const VSGCollection = db.collection('volumeSecurityGroup');
	const messages = [];

	async.eachSeries(VSGs, (VSG, callback) => {
		let successLog;
		let VSGFromDB;

		async.series([
			(callback) => validateKeys(VSG, callback),
			(callback) => {
				VSGCollection.findOne({ _id: VSG._id, uuid: VSG.uuid }, (err, result) => {
					VSGFromDB = result;

					if (err)
						return callback(new MongoError(err).log());

					if (!VSGFromDB)
						return callback(new SystemMessage(systemMessages.VSG_NOT_FOUND));

					callback();
				});
			}, (callback) => {
				VSGFromDB.dateModified = new Date();
				VSGFromDB.modifiedBy = user.email;

				['description', 'keys'].forEach(k => {
					if (k in VSG)
						VSGFromDB[k] = VSG[k];
				});

				utils.updateCollection([VSGFromDB], 'volumeSecurityGroup', false, (err) => {
					if (err)
						return callback(new MongoError(err).log());

					successLog = new SystemAdminMessage(systemMessages.VSG_UPDATED);
					callback();
				});
			}
		], (error) => {
			messages.push((successLog || new SystemAdminMessage(systemMessages.VSG_UPDATE_FAILED).addInfo(Entities.Error, error))
				.addInfo(Entities.VSG.ID, VSG._id)
				.addInfo(Entities.VSG.UUID, VSG.uuid));
			callback();
		});
	}, () => cb(messages));
};

scope.removeKeysFromSVG = (keys, callback) => {
	const db = app.get('db');
	const VSGCollection = db.collection('volumeSecurityGroup');
	const $in = { keys: { $in: keys.map(k => k._id) } };

	VSGCollection.updateMany($in, { $pull: $in }, { multi: true }, (err) => {
		if (err)
			new MongoError(err).log();

		callback(!err);
	});
};

module.exports = scope;