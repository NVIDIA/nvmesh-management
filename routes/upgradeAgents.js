/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const express = require('express');

var { Entities } = require('../modules/error.js');
const systemMessages = require('../systemMessages.js');
const { createAuditRequestLog } = require('../modules/log.js');
const upgradeAgentModule = require('../modules/upgradeAgent.js');
const utils = require('../utils.js');
const validateProjection = require('../middlewares/validateProjection.js');
const { getCountEntitiesHandler } = require('./common.js');
const consts = require('../consts.js');
const isAdminRole = require('../middlewares/isAdminRole.js');

const router = express.Router();

router.get('/', function(req, res) {
	var renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };

	renderData.isReact = true;
	renderData.componentName = consts.componentsPages.upgradeAgents;

	res.render('react', renderData);
});

/**
* @apiVersion 1.0.0
* @api {get} /upgradeAgents/all/:page/:count?filter={}&sort={} Get Upgrade Agents
* @apiName GetUpgradeAgents
* @apiGroup upgradeAgents
* @apiDescription Get `upgradeAgents` by `page` and `count`.
*
* @apiParam {integer} page The `page` to fetch.
* @apiParam {integer} count Number of records per `page`.
* @apiParam {object} [filter] `Filter` before fetching.
* @apiParam {object} [sort] `Sort` before fetching.
* @apiParamExample {object[]} Example request
* /upgradeAgents/all/0/2?filter={"hostname":"node1.example.com"}&sort={"dateModified":-1}
*
* @apiSuccess {object[]} upgradeAgents List of `upgradeAgents`.
*
* @apiSuccessExample Example data on success
* [{
*	"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefc",
* 	"_id": "1",
* 	"hostname": "node1.example.com",
*	"kernel": "3.2.0-15",
* 	"operatingSystem": "Ubuntu 20.04",
*	"ofed": "4.10.0",
*	"archType": "x86_64",
*	"dateCreated": 2025-03-02T12:18:39.761Z,
*	"dateModified": 2025-04-02T12:18:39.761Z
* }]
*/
router.get('/all/:page/:count', validateProjection, function(req, res) {
	const page = parseFloat(req.params.page);
	const count = parseInt(req.params.count);

	const queryObj = {
		filter: utils.tryParseJSON(req.query.filter) || {},
		sort: utils.tryParseJSON(req.query.sort) || {},
		projection: utils.tryParseJSON(req.query.projection) || {},
		skip: page * count,
		limit: count
	};

	upgradeAgentModule.getAllUpgradeAgents(queryObj, (error, upgradeAgents) => {
		if (error)
			return res.json(error);

		res.json(upgradeAgents);
	});
});

/**
* @apiVersion 1.0.0
* @api {post} /upgradeAgents/keepalive Request Fresh Keepalive
* @apiName RequestFreshKeepalive
* @apiGroup upgradeAgents
* @apiDescription Request a fresh keepalive for an upgrade agent.
*
* @apiParam {string} uuid The UUID of the upgrade agent.
* @apiParamExample {json} Payload example
* {
*   "_id": "nvme31.acme.com"
* }
* @apiSuccess {boolean} success Whether the keepalive was successfully requested.
* @apiSuccess {string} [error] Error message, if any.
* @apiSuccessExample Example data on success
*{
*      "success": true,
*	   "uuid": "",
*      "_id": "nvme31.acme.com",
*      "error": null,
*	   "payload": null
* }
*/
router.post('/keepalive', isAdminRole, function(req, res) {
	const { _id } = req.body;

	upgradeAgentModule.requestFreshKeepalive(_id, (error) => {
		if (error) {
			return res.json(utils.createApiResponse(_id, null, false, error.toApiResponse()));
		}
		return res.json(utils.createApiResponse(_id, null, true));
	});
});


/**
* @apiVersion 1.0.0
* @api {post} /upgradeAgents/delete Delete Upgrade Agents
* @apiName DeleteUpgradeAgents
* @apiGroup upgradeAgents
* @apiDescription Delete `upgradeAgents`.
*
* @apiParam {object[]} upgradeAgents `upgradeAgents` to delete.
* @apiParam {string} delete._id The `ID` of the `upgradeAgent` to delete.
* @apiParam {string} delete.uuid The `UUID` of the `upgradeAgent` to delete.
* @apiParamExample {string} Payload example
* [{
*		"_id": "nvme31.acme.com"
*		"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398",
* }]
* @apiSuccess {object} results success statuses
* @apiSuccessExample Example data on success
* [{
*      "success": true,
*	   "uuid": "",
*      "_id": "nvme31.acme.com",
*      "error": null,
*	   "payload": null
* }]*/
router.post('/delete', isAdminRole, function(req, res) {
	const upgradeAgents = req.body;

	const incomingRequestSystemAdminMessages = upgradeAgents.map(({ _id, uuid }) => createAuditRequestLog(req, systemMessages.UPGRADE_AGENT_DELETE_REQUEST)
		.addInfo(Entities.UpgradeAgent.ID, _id).addInfo(Entities.UpgradeAgent.UUID, uuid));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => upgradeAgentModule.deleteUpgradeAgents(upgradeAgents, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.UpgradeAgent.ID, Entities.UpgradeAgent.UUID))));
});

/**
* @apiVersion 1.0.0
* @api {get} /upgradeAgents/count Count Upgrade Agents
* @apiName CountUpgradeAgents
* @apiGroup upgradeAgents
* @apiDescription Get total `upgradeAgents` count.
*
* @apiSuccess {integer} count `upgradeAgents` count.
*
* @apiSuccessExample Example data on success
* 3606
*/
router.get('/count', getCountEntitiesHandler('upgradeAgent'));

module.exports = router;
