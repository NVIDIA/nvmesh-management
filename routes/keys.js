/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global app */

const express = require('express');
const consts = require('../consts');
const utils = require('../utils');

const keysModule = require('../modules/key');
const validateProjection = require('../middlewares/validateProjection');
const { createAuditRequestLog } = require('../modules/log.js');
const systemMessages = require('../systemMessages.js');
const { Entities } = require('../modules/error.js');
const isAdminRole = require('../middlewares/isAdminRole.js');
const { fetchEntityByID, getCountEntitiesHandler } = require('./common.js');

const router = express.Router();

router.get('/', (req, res) => {
	const renderData = {};

	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };

	if (consts.userRoles.ADMIN === req.user.role) {
		renderData.isReact = true;
		renderData.componentName = consts.componentsPages.keys;
		res.render('react', renderData);
	} else {
		res.send('insufficient privileges');
	}
});

router.use(isAdminRole);

/**
* @apiVersion 1.0.0
* @api {get} /keys/all Get keys
* @apiName GetKeys
* @apiGroup keys
* @apiDescription Get all `keys`.
*
* @apiSuccess {object[]} keys List Of `keys`.
*
* @apiSuccessExample Example data on success
* [{
* 	"_id": "KeyA",
*	"uuid": "1ca95530-4bc8-11e5-b932-53542b263b32",
* 	"createdBy" : "tomzan@mail.com",
*	"modifiedBy" : "tomzan@mail.com",
*	"dateCreated" : ISODate("2015-08-19T17:02:54.136Z"),
*	"dateModified" : ISODate("2015-08-19T17:02:54.136Z")
* }]
*/
router.get('/all/:page/:count', validateProjection, (req, res) => {
	const page = parseFloat(req.params.page);
	const count = parseInt(req.params.count);

	const query = {
		filter: utils.tryParseJSON(req.query.filter) || {},
		projection: utils.tryParseJSON(req.query.projection) || {},
		sort: utils.tryParseJSON(req.query.sort) || {},
		skip: page * count,
		limit: count
	};

	utils.loadCollection('key', query, (err, results) => {
		results?.forEach((k) => k.dbUUID = app.get('dbUUID'));
		res.json(results);
	});
});

/**
* @apiVersion 1.0.0
* @api {post} /keys/delete Delete keys
* @apiName DeleteKeys
* @apiGroup keys
* @apiDescription Delete `keys`.
*
* @apiParam {string} _id The `id[s]` of the `keys[s]` to delete.
* @apiParamExample {object[]} Payload example
* [{
* 	"_id": "KeyA",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb"
* }]
*
* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* [{
*	"_id": "KeyA",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*	"success": true,
*	"error": null,
*	"payload": null
* }]
*/
router.post('/delete', (req, res) => {
	const keys = req.body;

	const incomingRequestSystemAdminMessages = keys.map(({ _id, uuid }) => createAuditRequestLog(req, systemMessages.KEYS_DELETE_REQUEST)
		.addInfo(Entities.Keys.ID, _id)
		.addInfo(Entities.Keys.UUID, uuid));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => keysModule.deleteKeys(keys, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Keys.ID, Entities.Keys.UUID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {post} /keys/update Update keys
* @apiName UpdateKeys
* @apiGroup keys
* @apiDescription Update `keys`. <small><i>--name field cannot be updated</i></small>
*
* @apiParam {object[]} keys `keys` to update.
* @apiParam {string} keys._id `keys ID` to update.
* @apiParam {string} [keys.description] `Description` of the `key`.
* @apiParamExample {string} Payload example
* [{
* 	"_id": "KeyA",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
* 	"description": "Super secure key"
* }]
*
* @apiSuccess {object[]} results Results for the keys we tried to update.
* @apiSuccess {string} results.keyID the `ID` of the `key` we attempted to update.
* @apiSuccess {boolean} results.success Indication whether `key` update succeeded or not.<br />
* <small><i>`true` if succeeded, `false` if failed.</i></small>
*
* @apiSuccessExample Example data on success
* [{
*	"_id": "KeyA",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*	"success": true,
*	"error": null,
*	"payload": null
* }]
*/
router.post('/update', (req, res) => {
	const keys = req.body;

	const incomingRequestSystemAdminMessages = keys.map(({ _id, uuid, description }) => createAuditRequestLog(req, systemMessages.KEYS_UPDATE_REQUEST)
		.addInfo(Entities.Keys.ID, _id)
		.addInfo(Entities.Keys.UUID, uuid)
		.addInfo(Entities.Keys.description, description));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => keysModule.updateKeys(keys, req.user, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Keys.ID, Entities.Keys.UUID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {get} /keys/count Count Keys
* @apiName CountKeys
* @apiGroup keys
* @apiDescription Get total `keys` count.
*
* @apiSuccess {integer} count `keys` count.
*
* @apiSuccessExample Example data on success
* 4
*/
router.get('/count', getCountEntitiesHandler('key'));

/**
* @apiVersion 1.0.0
* @api {post} /keys/save Create keys
* @apiName CreateKeys
* @apiGroup keys
* @apiDescription Create `keys`.
*
* @apiParam {object[]} keys `keys` to create.
* @apiParam {string} keys._id `Name` of the `key`.
* @apiParam {string} [keys.description] `Description` of the `key`.
* @apiParamExample {string} Payload example
* [{
* 	"_id": "KeyA",
* 	"description": "Key A"
* }]
*
* @apiSuccess {object[]} results success statuses
*
* @apiSuccessExample Example data on success
* [{
*	"_id": "KeyA",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*	"success": true,
*	"error": null,
*	"payload": null
* }]
*/
router.post('/save', (req, res) => {
	const keys = req.body;

	const incomingRequestSystemAdminMessages = keys.map(({ _id, description }) => createAuditRequestLog(req, systemMessages.KEYS_SAVE_REQUEST)
		.addInfo(Entities.Keys.ID, _id)
		.addInfo(Entities.Keys.description, description));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => keysModule.saveKeys(keys, req.user, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Keys.ID, Entities.Keys.UUID)))
	);
});


/**
* @apiVersion 1.0.0
* @api {get} /keys/:id Get key by ID
* @apiName GetKey
* @apiGroup keys
* @apiDescription Get specific `key` by `ID`.
*
* @apiParam {string} key `key's ID` to fetch.
* @apiParamExample {string} Example request
* keys/key-pair1
*
* @apiSuccess {object} API Response
*
* @apiSuccessExample Example data on success
* {
*         "_id": "key-pair1",
*         "uuid": "a9a95a00-07c3-11ef-a906-876efff58063",
*         "dateModified": "2024-05-01T14:04:01.824Z",
*         "dateCreated": "2024-05-01T14:04:01.824Z",
*         "modifiedBy": "admin@nvidia.com",
*         "createdBy": "admin@nvidia.com"
* }
*/
router.get('/:id', (req, res) => {
	fetchEntityByID('key', req.params.id, false, {}, result => {
		return res.json(result);
	});
});

module.exports = router;
