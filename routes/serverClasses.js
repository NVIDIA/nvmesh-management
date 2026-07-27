/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* global app */

const express = require('express');

const consts = require('../consts.js');
const utils = require('../utils.js');
const serverClassModule = require('../modules/serverClass.js');
const { MongoError, Entities } = require('../modules/error.js');
const validateProjection = require('../middlewares/validateProjection.js');
const { createAuditRequestLog } = require('../modules/log.js');
const systemMessages = require('../systemMessages.js');
const isAdminRole = require('../middlewares/isAdminRole.js');
const { fetchEntityByID, getCountEntitiesHandler } = require('./common.js');

const router = express.Router();

//Request to render the serverClasses.ejs page.
router.get('/', (req, res) => {
	const renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };

	if (consts.userRoles.ADMIN === req.user.role) {
		renderData.isReact = true;
		renderData.componentName = consts.componentsPages.targetClasses;

		res.render('react', renderData);
	} else
		res.send('insufficient privileges');
});

//Request to get all the server nodes, will also return the status of the server
router.get('/servers', (req, res) => {
	const db = app.get('db');
	const serverCollection = db.collection('server');

	serverCollection.find({}).project({ node_id: 1, node_status: 1 }).sort({ node_id: 1 }).toArray(function(err, results) {
		if (err)
			new MongoError(err).log();

		res.json(results);
	});
});

router.use(isAdminRole);

/**
* @apiVersion 1.0.0
* @api {get} /serverClasses/all/:page/:count?filter={}&sort={} Get serverClasses
* @apiName GetServerClasses
* @apiGroup serverClasses
* @apiDescription Get all `serverClasses`.
*
* @apiSuccess {object[]} serverClasses List of `serverClasses`.
*
* @apiSuccessExample Example data on success
* [{
* 	"_id": "groupAServers",
* 	"targetNodes": ["nvme21.excelero.com", "nvme6"],
* 	"name": "groupAServers",
* 	"description": "All the servers of group A",
*	"domains": [{ scope: "Rack", identifier: "A" }, { scope: "DRSite", identifier: "C" }],
* 	"dateModified": "2015-07-14T11:21:10.592Z"
* }, {
* 	"_id": "1Server",
* 	"targetNodes": ["nvme21.excelero.com"],
* 	"name": "1Server",
* 	"description": "This is just 1 server",
*	"domains": [{ scope: "Rack", identifier: "B" }],
* 	"dateModified": "2015-07-16T14:20:13.230Z"
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

	utils.loadCollection('serverClass', query, (err, results) => res.json(results));
});

/**
* @apiVersion 1.0.0
* @api {get} /serverClasses/count Count Server Classes
* @apiName CountServerClasses
* @apiGroup serverClasses
* @apiDescription Get total `serverClasses` count.
*
* @apiSuccess {integer} count `serverClasses` count.
*
* @apiSuccessExample Example data on success
* 4
*/
router.get('/count', getCountEntitiesHandler('serverClass'));

/**
* @apiVersion 1.0.0
* @api {post} /serverClasses/save Create serverClasses
* @apiName CreateServerClasses
* @apiGroup serverClasses
* @apiDescription Create `serverClasses`.
*
* @apiParam {object[]} serverClasses `serverClasses` to create.
* @apiParam {string[]} serverClasses.targetNodes Array of `server ID[s]`.
* @apiParam {string} serverClasses.name `Name` of the `serverClass`.
* @apiParam {string} [serverClasses.description] `Description` of the `serverClass`.
* @apiParam {object[]} [serverClasses.domains] `Domains` of the `serverClass`.
* @apiParamExample {string} Payload example
* [{
* 	"targetNodes": ["nvme31.excelero.com"],
* 	"name": "RandomServer",
* 	"description": "This server wasn't really randomized",
*	"domains": [{ "scope": "Rack", "identifier": "A" }]
* }]
*
* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
 [{
*	"_id": "RandomServer",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*	"success": true,
*	"error": null,
*	"payload": null
* }]
*/
router.post('/save', (req, res) => {
	const serverClasses = req.body;

	const incomingRequestSystemAdminMessages = serverClasses.map(serverClass => {
		const message = createAuditRequestLog(req, systemMessages.TARGETCLASS_SAVE_REQUEST)
			.addInfo(Entities.ServerClass.ID, serverClass.name);

		if (serverClass.description)
			message.addInfo(Entities.ServerClass.description, serverClass.description);
			
		serverClass.targetNodes.forEach(target => message.addInfo(Entities.Target.ID, target));
		serverClass?.domain?.length?.forEach(domain => 
			message.addInfo(Entities.Domain.scope, domain.scope).addInfo(Entities.Domain.identifier, domain.identifier));
		return message;
	});

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => serverClassModule.saveTargetClasses(serverClasses, req.user, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.ServerClass.ID, Entities.ServerClass.UUID))));
});

router.post('/getServersByClass', (req, res) => {
	const serverClasses = req.body;

	utils.getServersByServerClass(serverClasses.map(s => ({ _id: s })), null, null, (_err, results) => {
		// Ignore the err, as it was already printed and we have nothing to do with it in this flow.
		res.json(results);
	});
});

router.get('/getDomains', (req, res) => {
	const { projection } = req.query;

	serverClassModule.getDomains(projection, (results) => {
		res.json(results);
	});
});

/**
* @apiVersion 1.0.0
* @api {post} /serverClasses/delete Delete serverClasses.
* @apiName DeleteServerClasses
* @apiGroup serverClasses
* @apiDescription Delete `serverClasses`
*
* @apiParam {string} _id The `id[s]` of the `serverClasses[s]` to delete.
* @apiParamExample {object[]} Payload example
* [{
* 	"_id": "groupAServers",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb"
* }]
*
* @apiSuccess {object} results success statuses
* @apiSuccessExample Example data on success
 [{
*	"_id": "groupAServers",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*	"success": true,
*	"error": null,
*	"payload": null
* }]
*/
router.post('/delete', (req, res) => {
	const targetClasses = req.body;

	const incomingRequestSystemAdminMessages = targetClasses.map(targetClass => createAuditRequestLog(req, systemMessages.TARGETCLASS_DELETE_REQUEST)
		.addInfo(Entities.ServerClass.ID, targetClass._id)
		.addInfo(Entities.ServerClass.UUID, targetClass.uuid));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => serverClassModule.deleteTargetClasses(targetClasses, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.ServerClass.ID, Entities.ServerClass.UUID))));
});

/**
* @apiVersion 1.0.0
* @api {post} /serverClasses/update Update serverClasses
* @apiName UpdateServerClasses
* @apiGroup serverClasses
* @apiDescription Update `serverClasses`.
*
* @apiParam {object[]} serverClasses `serverClasses` to update.
* @apiParam {string} serverClasses._id The `id` of the `serverClass` to update.
* @apiParam {string[]} [serverClasses.targetNodes] Array of the new `server ID[s]`.
* @apiParam {string} [serverClasses.description] The new `description` of the `serverClass`.
* @apiParam {object[]} [serverClasses.domains] `Domains` of the `serverClass`.
* @apiParamExample {string} Payload example
* [{
* 	"_id": "SC1",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
* 	"description": "sss",
* 	"domains": [{ "scope": "Rack", "identifier": "B" }],
* 	"targetNodes": ["nvme31.excelero.com", "nvme50.excelero.com"]
* }]
*
* @apiSuccess {object[]} results Results for the serverClasses we tried to update.
* @apiSuccess {string} results.ServerClassID the `ID` of the `serverClass` we attempted to update.
* @apiSuccess {boolean} results.success Indication whether `serverClass` update succeeded or not.<br />
* <small><i>`true` if succeeded, `false` if failed.</i></small>
*
* @apiSuccessExample Example data on success
 [{
*	"_id": "SC1",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*	"success": true,
*	"error": null,
*	"payload": null
* }]
*/
router.post('/update', (req, res) => {
	const targetClasses = req.body;

	const incomingRequestSystemAdminMessages = targetClasses.map(targetClass => createAuditRequestLog(req, systemMessages.TARGETCLASS_UPDATE_REQUEST)
		.addInfo(Entities.ServerClass.ID, targetClass._id)
		.addInfo(Entities.ServerClass.UUID, targetClass.uuid));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => serverClassModule.updateTargetClasses(targetClasses, req.user, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.ServerClass.ID, Entities.ServerClass.UUID))));
});

/**
* @apiVersion 1.0.0
* @api {get} /serverClasses/:id Get serverClass by ID
* @apiName GetServerClass
* @apiGroup serverClasses
* @apiDescription Get specific `serverClass` by `ID`.
*
* @apiParam {string} serverClass `serverClass's ID` to fetch.
* @apiParamExample {string} Example request
* serverClasses/server-class-1
*
* @apiSuccess {object} API Response
*
* @apiSuccessExample Example data on success
* {
*         "_id": "server-class-1",
*         "servers": [],
*         "domains": [],
*         "name": "server-class-1",
*         "targetNodes": [
*             "nvme1040"
*         ],
*         "modifiedBy": "admin@nvidia.com",
*         "createdBy": "admin@nvidia.com",
*         "dateModified": "2024-05-01T14:34:44.191Z",
*         "dateCreated": "2024-05-01T14:34:44.191Z"
* }
*/
router.get('/:id', (req, res) => {
	fetchEntityByID('serverClass', req.params.id, false, {}, result => {
		return res.json(result);
	});
});

module.exports = router;
