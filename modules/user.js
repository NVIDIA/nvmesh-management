/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

var async = require('async');
var uuid = require('uuid');

var utils = require('../utils.js');
var consts = require('../consts.js');
var { MongoError, SystemAdminMessage, Entities } = require('./error.js');
var systemMessages = require('../systemMessages.js');
const { removeUsersSessionsFromConcurrentSessions } = require('../middlewares/login.js');

var scope = {};

scope.saveUsers = (users, creatingUser, callback) => {
	const messages = [];

	let usersSet;

	async.series([
		function loadCollection(cb) {
			utils.loadCollection('user', { projection: { _id: 0, email: 1 } }, (err, currentUsers) => {
				if (!err)
					usersSet = utils.getCollectionSetByKey(currentUsers, user => user.email);

				cb(err);
			});
		},
		function saveUsers(cb) {
			async.each(users, (user, eachCallback) => {
				const addInfoToMessage = message => message.addInfo(Entities.User.ID, user.email).addInfo(Entities.User.UUID, user.uuid);

				if (usersSet.has(user.email)) {
					messages.push(addInfoToMessage(new SystemAdminMessage(systemMessages.EMAIL_ALREADY_TAKEN)));
					return eachCallback();
				}

				user._id = user.email.toLowerCase();
				user.uuid = uuid.v1();
				user.createdBy = user.modifiedBy = creatingUser;
				user.dateCreated = user.dateModified = new Date();
				user.password = utils.getHash(user.password);
				user.layout = consts.defaultLayout;
				delete user.confirmationPassword;

				utils.insertToCollection(user, 'user', (err) => {
					const systemAdminMessage = new SystemAdminMessage(err ? systemMessages.USER_SAVE_FAILED : systemMessages.USER_SAVED);

					if (err)
						systemAdminMessage.addInfo(Entities.Error, err);

					messages.push(addInfoToMessage(systemAdminMessage));

					eachCallback();
				});
			}, () => cb());
		}
	], (err) => {
		if (err)
			messages.push(new SystemAdminMessage(systemMessages.USERS_SAVE_FAILED).addInfo(Entities.Error, err));

		callback(messages);
	});
};

scope.updateUsers = (users, updatingUser, callback) => {
	const messages = [];
	const newPasswordByUserID = {};

	let usersIDSet, usersUUIDSet, dbUsers;

	async.series([
		function loadCollection(cb) {
			utils.loadCollection('user', { projection: { uuid: 1 } }, (err, currentUsers) => {
				if (!err) {
					dbUsers = currentUsers;
					usersIDSet = utils.getCollectionSetByKey(currentUsers, user => user._id);
					usersUUIDSet = utils.getCollectionSetByKey(currentUsers, user => user.uuid);
				}

				cb(err);
			});
		},
		function updateUsers(cb) {
			async.each(users, (user, eachCallback) => {
				const addInfoToMessage = message => message.addInfo(Entities.User.ID, user._id).addInfo(Entities.User.UUID, user.uuid);

				if (!(usersIDSet.has(user._id) && usersUUIDSet.has(user.uuid))) {
					messages.push(addInfoToMessage(new SystemAdminMessage(systemMessages.USER_UPDATE_NOT_FOUND)));
					return eachCallback();
				}

				if (user.isImmutable && user.role !== consts.userRoles.ADMIN) {
					messages.push(addInfoToMessage(new SystemAdminMessage(systemMessages.USER_UPDATE_FAILED).addInfo(Entities.User.role, user.role)));
					return eachCallback();
				}

				if (user.changePassword && user.email !== updatingUser) {
					messages.push(addInfoToMessage(new SystemAdminMessage(systemMessages.USER_CANNOT_CHANGE_PASSWORD).addInfo(Entities.User.role, user.role)));
					return eachCallback();
				}

				let newPassword;
				let dbUser = dbUsers.filter(u => u._id === user._id && u.uuid === user.uuid)[0];

				dbUser.modifiedBy = updatingUser;
				dbUser.dateModified = new Date();

				if (user.changePassword) {
					if (user.changePassword.newPassword === user.changePassword.confirmation && user.changePassword.newPassword)
						dbUser.password = utils.getHash(user.changePassword.newPassword);

				} else if (user.resetPassword) {
					newPassword = (Math.random() + 1).toString(36).substr(2, 5);
					dbUser.password = utils.getHash(newPassword);
					dbUser.shouldChangePassword = true;
				}

				if (user.notificationLevel)
					dbUser.notificationLevel = user.notificationLevel;

				if (user.role)
					dbUser.role = user.role;

				if (user._id == consts.PHONE_HOME_USER && user.email)
					dbUser.email = user.email;

				if ('sendStats' in user)
					dbUser.sendStats = user.sendStats;


				if (user.relogin)
					removeUsersSessionsFromConcurrentSessions(user._id);

				if (typeof user.sendStats === 'boolean')
					dbUser.sendStats = user.sendStats;

				utils.updateCollection([dbUser], 'user', false, function(err) {
					const message = addInfoToMessage(new SystemAdminMessage(err ? systemMessages.USER_UPDATE_FAILED : systemMessages.USER_UPDATED));

					if (err)
						message.addInfo(Entities.Error, err);
					else if (newPassword)
						newPasswordByUserID[user._id] = newPassword;

					messages.push(message);

					eachCallback();
				});
			}, () => cb());
		}
	], (err) => {
		if (err)
			users.forEach(u => messages.push(new SystemAdminMessage(systemMessages.USERS_UPDATE_FAILED)
				.addInfo(Entities.Error, err).addInfo(Entities.User.ID, u._id).addInfo(Entities.User.UUID, u.uuid)));

		callback(messages, newPasswordByUserID);
	});
};

scope.deleteUsers = (users, callback) => {
	const messages = [];

	let db = app.get('db');
	let userCollection = db.collection('user');

	async.each(users, (user, eachCallback) => {
		const addInfoToMessage = message => message.addInfo(Entities.User.ID, user._id).addInfo(Entities.User.UUID, user.uuid);

		if (user.isImmutable) {
			messages.push(addInfoToMessage(new SystemAdminMessage(systemMessages.USER_DELETE_UNDELETABLE)));
			return eachCallback();
		}

		userCollection.deleteOne({ _id: user._id, uuid: user.uuid }, (err, results) => {
			if (err)
				new MongoError(err).log();

			let errorSystemMessage, errorMessage;
			let success = Boolean(!err && results.deletedCount);

			if (!success) {
				errorMessage = err ? 'Couldn\'t save to DB' : `User ${user._id} ${user.uuid} not found`;
				errorSystemMessage = err ? systemMessages.USER_DELETE_FAILED : systemMessages.USER_DELETE_NOT_FOUND;
			}

			let systemAdminMessage = addInfoToMessage(new SystemAdminMessage(success ? systemMessages.USER_DELETED : errorSystemMessage));

			if (!success)
				systemAdminMessage.addInfo(Entities.Error, errorMessage);

			messages.push(systemAdminMessage);

			eachCallback();
		});
	}, () => callback(messages));
};

scope.changePassword = (user, updatingUser, callback) => {
	let systemAdminMessage;

	const done = systemAdminMessage => callback([systemAdminMessage.addInfo(Entities.User.ID, user._id).addInfo(Entities.User.UUID, user.uuid)]);

	// only allow a user with admin to change its own password unless it is the admin user
	if (!utils.isAdmin(updatingUser) && updatingUser._id != user._id)
		systemAdminMessage = new SystemAdminMessage(systemMessages.OPERATION_NOT_PERMITTED_NOT_ADMIN);

	else if (user.password !== user.confirmationPassword)
		systemAdminMessage = new SystemAdminMessage(systemMessages.CHANGE_PASSWORD_PASSWORDS_DONT_MATCH);

	if (systemAdminMessage)
		return done(systemAdminMessage);

	delete user.confirmationPassword;
	user.shouldChangePassword = false;
	user.password = utils.getHash(user.password);

	const db = app.get('db');
	const userCollection = db.collection('user');
	const query = { _id: user._id, uuid: user.uuid };
	const update = utils.setUpdateOperators(user);

	userCollection.findOneAndUpdate(query, update, (err, res) => {
		if (err) {
			err = new MongoError(err).log();
			systemAdminMessage = new SystemAdminMessage(systemMessages.CHANGE_PASSWORD_FAILED_TO_UPDATE).addInfo(Entities.Error, err);

		} else if (!res) {
			systemAdminMessage = new SystemAdminMessage(systemMessages.USER_UPDATE_NOT_FOUND);

		} else {
			systemAdminMessage = new SystemAdminMessage(systemMessages.PASSWORD_CHANGED);
		}

		done(systemAdminMessage);
	});
};

module.exports = scope;
