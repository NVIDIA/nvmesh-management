/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global app */

var express = require('express');
const uuid = require('uuid');

var utils = require('../utils.js');
var consts = require('../consts.js');
var userModule = require('../modules/user.js');
var { MongoError, Entities } = require('../modules/error.js');
const { createAuditRequestLog } = require('../modules/log.js');
const systemMessages = require('../systemMessages.js');
const { removeSessionFromConcurrentSessions, getConcurrentSessions } = require('../middlewares/login.js');
const isAdminRole = require('../middlewares/isAdminRole.js');
const { getCountEntitiesHandler } = require('./common.js');

var router = express.Router();

router.get('/', function(req, res) {
	var renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };
	renderData.isReact = true;
	renderData.componentName = consts.componentsPages.users;

	if (consts.userRoles.ADMIN === req.user.role)
		res.render('react', renderData);
	else
		res.send('insufficient privileges');
});

/**
* @apiVersion 1.0.0
* @api {get} /users/count Count Users
* @apiName CountUsers
* @apiGroup users
* @apiDescription Get total `users` count.
*
* @apiSuccess {integer} count `users` count.
*
* @apiSuccessExample Example data on success
* 4
*/
router.get('/count', isAdminRole, getCountEntitiesHandler('user', { password: { $exists: true } }));

router.get('/checkDefaultPassword', function(req, res) {
	var db = app.get('db');
	var userCollection = db.collection('user');
	var $query = {};

	$query = { email: req.user.email, $or: [{ password: 'admin' }, { shouldChangePassword: true }] };

	//Check if the admin user has default password or the current user needs to change his password.
	userCollection.find($query).toArray(function(err, results) {
		if (err)
			new MongoError(err).log();

		res.json(results);
	});
});

router.get('/getPhoneHomeUser', function(req, res) {
	utils.getPhoneHomeUser(function(user) {
		res.json(user);
	});
});

router.get('/getDefaultDomain', function(req, res) {
	utils.getDefaultDomain(function(domain) {
		res.json(domain);
	});
});

router.post('/updateDefaultDomain', function(req, res) {
	if (req.body && req.body[0]) {
		var defaultDomain = req.body[0];

		utils.updateDefaultDomain(defaultDomain, function(err) {
			res.json(err);
		});
	}
});

/**
* @apiVersion 1.0.0
* @api {get} /users/all Get users
* @apiName GetUsers
* @apiGroup users
* @apiDescription Get all `users`.
*
* @apiSuccess {object[]} users List of `users`.
*
* @apiSuccessExample Example data on success
* [{
* 	"_id": "admin@nvidia.com",
* 	"role": "Admin",
* 	"email": "admin@nvidia.com",
* 	"uuid": "8cd4e1f0-7ba7-11ed-bb53-b119afb29b38",
* 	"dateCreated": "2017-07-10T12:19:18.848Z",
* 	"notificationLevel": "NONE"
* }]
*/
router.get('/all', isAdminRole, function(req, res) {
	var $filter = utils.tryParseJSON(req.query.filter) || {};
	//Don't return "hidden" users.
	$filter.password = { $exists: true };

	var query = {
		filter: $filter,
		projection: { password: 0, shouldChangePassword: 0 },
		sort: utils.tryParseJSON(req.query.sort) || {},
		skip: 0,
		limit: 0
	};

	utils.loadCollection('user', query, function(err, results) {
		res.json(results);
	});
});

router.get('/concurrentSessions', function(req, res) {
	res.json(getConcurrentSessions(req));
});

/**
* @apiVersion 1.0.0
* @api {post} /users/save Create users
* @apiName CreateUsers
* @apiGroup users
* @apiDescription Create `users`.
*
* @apiParam {object[]} users `users` to save.
* @apiParam {string} users.email `Email` of the `user`.
* @apiParam {string} users.role `Role` of the `user`.<br />
* <small><i>Options:<br />
* `Observer`.<br />
* `Admin`.
* @apiParam {string} users.notificationLevel `NotificationLevel` of the `user` possible values are: `NONE`, `WARNING` & `ERROR`.
* @apiParam {string} users.password `Password` of the `user`.
* @apiParam {string} users.confirmationPassword `ConfirmationPassword` of the `user`.
* @apiParam {boolean} [users.relogin] Determines if the newly created `user` will be prompted to change the password upon first login.
* @apiParamExample {string} Payload example
* [{
*	"email": "ron@nvidia.com",
*	"role": "Observer",
*	"notificationLevel": "NONE",
*	"password": "qwer",
*	"confirmationPassword": "qwer",
*	"relogin": true
* }]
*
* @apiSuccess {object} results success statuses
* @apiSuccessExample Example data on success
* [
*   {
*       "_id": "ron@nvidia.com",
*       "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*       "success": true,
*		"error": null,
*		"payload": null
*	}
* ]
*/
router.post('/save', isAdminRole, function(req, res) {
	let users = req.body;
	let creatingUser = req.user.email;

	let incomingRequestSystemAdminMessages = users.map(user => createAuditRequestLog(req, systemMessages.USERS_SAVE_REQUEST)
		.addInfo(Entities.User.email, user.email)
		.addInfo(Entities.User.role, user.role)
		.addInfo(Entities.User.notificationLevel, user.notificationLevel));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => userModule.saveUsers(users, creatingUser, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.User.ID, Entities.User.UUID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {post} /users/update Updates users
* @apiName UpdateUsers
* @apiGroup users
* @apiDescription Update `users`.
*
* @apiParam {object[]} users `users` to update.
* @apiParam {string} users._id `Email` of the `user`.
* @apiParam {string} users.uuid `UUID` of the `user`.
* @apiParam {string} users.role `Role` of the `user`.<br />
* <small><i>Options:<br />
* `Observer`.<br />
* `Admin`.
* @apiParam {string} users.notificationLevel `NotificationLevel` of the `user` possible values are: `NONE`, `WARNING` & `ERROR`.
* @apiParam {boolean} [users.relogin] Determines if the updated `user` will be prompted to change the password upon first login.
* @apiParam {boolean} [users.resetPassword] Determines if the `user` password will be reset.

* @apiParamExample {string} Payload example
* [{
*	"_id": "chris@nvidia.com",
*	"uuid": "f87329b0-7af0-11ed-807a-25d20c788f0a",
*	"role": "Observer",
*	"notificationLevel": "NONE",
*	"relogin": true,
*	"resetPassword": true
* }]
*
* @apiSuccess {object} results success statuses
* @apiSuccessExample Example data on success
* [
*   {
*       "_id": "chris@nvidia.com",
*   	"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*       "success": true,
*		"error": null,
*		"payload": {newPassword: "abcd"}
*	}
* ]
*/
router.post('/update', isAdminRole, function(req, res) {
	const requestUUID = uuid.v1();
	const users = req.body;
	const updatingUser = req.user.email;

	users.map(user => createAuditRequestLog(req, systemMessages.USERS_UPDATE_REQUEST)
		.addInfo(Entities.ApiRequest.UUID, requestUUID)
		.addInfo(Entities.User.ID, user._id)
		.addInfo(Entities.User.UUID, user.uuid)
		.addInfo(Entities.User.role, user.role)
		.addInfo(Entities.User.notificationLevel, user.notificationLevel)
		.addInfo(Entities.User.changePassword, Boolean(user.changePassword))
		.addInfo(Entities.User.resetPassword, Boolean(user.resetPassword))
		.log());


	// DO NOT TAKE THIS CODE AS AN EXAMPLE! (more info in commit message)
	userModule.updateUsers(users, updatingUser, (systemAdminMessages, newPasswordByUserID) => {
		res.json(systemAdminMessages.map(m => {
			m.addInfo(Entities.ApiRequest.UUID, requestUUID).log();

			const responseForREST = m.createApiResponse(Entities.User.ID, Entities.User.UUID);

			if (newPasswordByUserID[responseForREST._id])
				responseForREST.payload = { newPassword: newPasswordByUserID[responseForREST._id] };

			return responseForREST;
		}));
	});
});

/**
* @apiVersion 1.0.0
* @api {post} /users/delete Deletes users
* @apiName DeleteUsers
* @apiGroup users
* @apiDescription Delete `users`.
*
* @apiParam {object[]} users `users` to delete.
* @apiParam {string} users._id `Email` of the `user`.
* @apiParam {string} users.uuid `UUID` of the `user`.

* @apiParamExample {string} Payload example
* [{
*	"_id": "chris@nvidia.com",
*	"uuid": "f87329b0-7af0-11ed-807a-25d20c788f0a"
* }]
*
* @apiSuccess {object} results success statuses
* @apiSuccessExample Example data on success
* [
*   {
*       "_id": "chris@nvidia.com",
*   	"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*       "success": true,
*		"error": null,
*		"payload": null
*	}
* ]
*/
router.post('/delete', isAdminRole, function(req, res) {
	let users = req.body;

	let incomingRequestSystemAdminMessages = users.map(user => createAuditRequestLog(req, systemMessages.USERS_DELETE_REQUEST)
		.addInfo(Entities.User.ID, user._id)
		.addInfo(Entities.User.UUID, user.uuid));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => userModule.deleteUsers(users, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.User.ID, Entities.User.UUID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {post} /users/changePassword Change user's password
* @apiName ChangePassword
* @apiGroup users
* @apiDescription Change authenticated user's password.
*
* @apiParam {string} users.password new password of the `user`.
* @apiParam {string} users.confirmationPassword new password of the `user`.

* @apiParamExample {string} Payload example
* {
*	"password": "new_password"
*	"confirmationPassword": "new_password"
* }
*
* @apiSuccess {object} results success statuses
* @apiSuccessExample Example data on success
*   {
*       "_id": "chris@nvidia.com",
*       "success": true,
*       "uuid": "f87329b0-7af0-11ed-807a-25d20c788f0a",
*		"error": null,
*		"payload": null
*	}
*/
router.post('/changePassword', function(req, res) {
	const userToBeEdited = req.body;
	const editingUser = req.user;

	userToBeEdited._id = editingUser._id;
	userToBeEdited.uuid = editingUser.uuid;

	const incomingRequestSystemAdminMessage = createAuditRequestLog(req, systemMessages.CHANGE_PASSWORD_REQUEST)
		.addInfo(Entities.User.ID, userToBeEdited._id)
		.addInfo(Entities.User.UUID, userToBeEdited.uuid);

	utils.handleRESTAndLog(
		[incomingRequestSystemAdminMessage],
		cb => userModule.changePassword(userToBeEdited, editingUser, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.User.ID, Entities.User.UUID))[0]));
});

router.post('/disconnect', isAdminRole, function(req, res) {
	if (!(req.body && req.body.length))
		return res.json();

	req.body.forEach(requestSession => removeSessionFromConcurrentSessions(requestSession.email, requestSession.sessionID));
	res.json(utils.createApiResponse(null, null, true, null));
});

/**
* @apiVersion 1.0.0
* @api {get} /users/:id Get user by ID
* @apiName GetUser
* @apiGroup users
* @apiDescription Get specific `user` by `ID`.
*
* @apiParam {string} user `user's ID` to fetch.
* @apiParamExample {string} Example request
* users/observer@nvidia.com
*
* @apiSuccess {object} API Response
*
* @apiSuccessExample Example data on success
* {
*         "_id": "observer@nvidia.com",
*         "dateCreated": "2024-04-17T12:12:46.672Z",
*         "email": "observer@nvidia.com",
*         "isHuman": true,
*         "role": "Observer",
*         "shouldChangePassword": true,
*         "uuid": "cd2d7d00-fcb3-11ee-b01f-e19dd52b26f7"
* }
*/
router.get('/:id', isAdminRole, (req, res) => {
	userModule.fetchUserByID(req.params.id, (error, user) => {
		if (error)
			return res.json(error.createApiResponse());

		return res.json(user);
	});
});

module.exports = router;
