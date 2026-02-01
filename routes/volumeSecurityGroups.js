/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


const express = require('express');

const consts = require('../consts.js');
const utils = require('../utils.js');
const VSGModule = require('../modules/volumeSecurityGroup.js');
const validateProjection = require('../middlewares/validateProjection.js');
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
		renderData.componentName = consts.componentsPages.volumeSecurityGroups;
		res.render('react', renderData);
	} else {
		res.send('insufficient privileges');
	}
});

router.use(isAdminRole);

/**
* @apiVersion 1.0.0
* @api {get} /volumeSecurityGroups/all Get VSGs
* @apiName GetVSG
* @apiGroup VSGs
* @apiDescription Get all `VSGs`.
*
* @apiSuccess {object[]} VSGs List Of `VSGs`.
*
* @apiSuccessExample Example data on success
* [{
* 	"_id": "someVSG",
*	"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*   "description": "some description",
*   "keys": ["key1", "key2"],
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

	utils.loadCollection('volumeSecurityGroup', query, (err, results) => res.json(results));
});

/**
* @apiVersion 1.0.0
* @api {post} /volumeSecurityGroups/delete Delete VSGs
* @apiName DeleteVSGs
* @apiGroup VSGs
* @apiDescription Delete `VSGs`.
*
* @apiParam {string} _id The `id[s]` of the `VSGs[s]` to delete.
* @apiParamExample {object[]} Payload example
* [{
* 	"_id": "someVSG",
*	"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb"
* }]
*
* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* [{
*	"_id": "someVSG",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*	"success": true,
*	"error": null,
*	"payload": null
* }]
*/
router.post('/delete', (req, res) => {
	const VSGs = req.body;

	const incomingRequestSystemAdminMessages = VSGs.map(({ _id, uuid }) => createAuditRequestLog(req, systemMessages.VSG_DELETE_REQUEST)
		.addInfo(Entities.VSG.ID, _id)
		.addInfo(Entities.VSG.UUID, uuid));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => VSGModule.deleteVSGs(VSGs, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.VSG.ID, Entities.VSG.UUID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {post} /volumeSecurityGroups/update Update VSGs
* @apiName UpdateVSGs
* @apiGroup VSGs
* @apiDescription Update `VSGs`. <small><i>--name field cannot be updated</i></small>
*
* @apiParam {object[]} VSGs `VSGs` to update.
* @apiParam {string} VSGs._id `VSG` to update.
* @apiParam {string} [VSGs.description] `Description` of the `VSG`.
* @apiParam {string[]} VSGs.keys `VSGs keys` associated keys.
* @apiParamExample {string} Payload example
* [{
* 	"_id": "VSG1",
*	"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
* 	"description": "A Security Group",
*	"keys": ["someKey"]
* }]
*
* @apiSuccess {object[]} results Results for the VSGs we tried to update.
* @apiSuccess {string} results._id the `ID` of the `VSG` we attempted to update.
* @apiSuccess {boolean} results.success Indication whether `VSG` update succeeded or not.<br />
* <small><i>`true` if succeeded, `false` if failed.</i></small>
*
* @apiSuccessExample Example data on success
* [{
*	"_id": "VSG1",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*	"success": true,
*	"error": null,
*	"payload": null
* }]
*/
router.post('/update', (req, res) => {
	const VSGs = req.body;

	const incomingRequestSystemAdminMessages = VSGs.map(({ _id, uuid, description, keys }) => { 
		const message = createAuditRequestLog(req, systemMessages.VSG_UPDATE_REQUEST)
			.addInfo(Entities.VSG.ID, _id)
			.addInfo(Entities.VSG.UUID, uuid)
			.addInfo(Entities.VSG.description, description);

		(keys || []).forEach(k => message.addInfo(Entities.Keys.ID, k));

		return message;
	});

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => VSGModule.updateVSGs(VSGs, req.user, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.VSG.ID, Entities.VSG.UUID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {get} /volumeSecurityGroups/count Count VSGs
* @apiName CountVSGs
* @apiGroup VSGs
* @apiDescription Get total `VSG` count.
*
* @apiSuccess {integer} count `VSG` count.
*
* @apiSuccessExample Example data on success
* 4
*/
router.get('/count', getCountEntitiesHandler('volumeSecurityGroup'));

/**
* @apiVersion 1.0.0
* @api {post} /volumeSecurityGroups/save Create VSGs
* @apiName CreateVSGs
* @apiGroup VSGs
* @apiDescription Create `VSGs`.
*
* @apiParam {object[]} VSGs `VSGs` to create.
* @apiParam {string} VSGs._id `Name` of the `VSG`.
* @apiParam {string} [VSGs.description] `Description` of the `VSG`.
* @apiParamExample {string} Payload example
* [{
* 	"_id": "someVSG",
* 	"description": "Some description"
*   "keys": ["key1", "key2"],
* }]
*
* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* [{
*	"_id": "someVSG",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*	"success": true,
*	"error": null,
*	"payload": null
* }]
*/
router.post('/save', (req, res) => {
	const VSGs = req.body;

	const incomingRequestSystemAdminMessages = VSGs.map(({ _id, description, keys }) => { 
		const message = createAuditRequestLog(req, systemMessages.VSG_SAVE_REQUEST)
			.addInfo(Entities.VSG.ID, _id)
			.addInfo(Entities.VSG.description, description);

		(keys || []).forEach(k => message.addInfo(Entities.Keys.ID, k));

		return message;
	});

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => VSGModule.saveVSGs(VSGs, req.user, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.VSG.ID, Entities.VSG.UUID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {get} /volumeSecurityGroups/:id Get volumeSecurityGroup by ID
* @apiName GetVolumeSecurityGroup
* @apiGroup VSGs
* @apiDescription Get specific `volumeSecurityGroup` by `ID`.
*
* @apiParam {string} volumeSecurityGroup `volumeSecurityGroup's ID` to fetch.
* @apiParamExample {string} Example request
* volumeSecurityGroups/vsg1
*
* @apiSuccess {object} API Response
*
* @apiSuccessExample Example data on success
* {
*         "_id": "vsg1",
*		  "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*         "keys": ["key-pair1"],
*         "dateModified": "2024-05-02T12:21:10.780Z",
*         "dateCreated": "2024-05-02T12:21:10.780Z",
*         "modifiedBy": "admin@nvidia.com",
*         "createdBy": "admin@nvidia.com"
* }
*/
router.get('/:id', (req, res) => {
	fetchEntityByID('volumeSecurityGroup', req.params.id, false, {}, result => {
		return res.json(result);
	});
});

module.exports = router;
