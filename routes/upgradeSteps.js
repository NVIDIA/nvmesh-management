/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


const express = require('express');

const utils = require('../utils.js');
const { getCountEntitiesHandler } = require('./common.js');
const validateProjection = require('../middlewares/validateProjection.js');
const upgradeStepModule = require('../modules/upgradeStep.js');
const { createAuditRequestLog } = require('../modules/log.js');
const systemMessages = require('../systemMessages.js');
const { Entities } = require('../modules/error.js');

const router = express.Router();

/**
* @apiVersion 1.0.0
* @api {get} /upgradeSteps/all/:page/:count?filter={}&sort={} Get upgrade steps
* @apiName GetUpgradeSteps
* @apiGroup upgradeSteps
* @apiDescription Get `upgradeSteps` by `page` and `count`.
*
* @apiParam {integer} page The `page` to fetch.
* @apiParam {integer} count Number of records per `page`.
* @apiParam {object} [filter] `Filter` before fetching.
* @apiParam {object} [sort] `Sort` before fetching.
* @apiParamExample {object[]} Example request
* /upgradeSteps/all/0/2?filter={"upgradeID":"1"}&sort={"dateModified":-1}
*
* @apiSuccess {object[]} upgradeSteps List of `upgradeSteps`.
*
* @apiSuccessExample Example data on success
* [{
*    _id: '4c275241-3659-11f0-a7ac-b9c53b0d839f',
*    command: {
*      cmd: '/opt/nvmesh/bin/nvmesh_clnt_shutdown',
*      timeout: 30,
*      verificationCommand: null,
*      args: [ '--upgrade' ]
*    },
*    isVolumeAffected: false,
*    upgradeID: '4c1af630-3659-11f0-a7ac-b9c53b0d839f',
*    hostname: 'scale-1',
*    stepIndex: 1,
*    shouldStop: false,
*    status: 'completed',
*    startCondition: 'allDone',
*    upgradeAgentToken: -1,
*    messageSequence: -1,
*    docVersion: null,
*    dateModified: ISODate('2025-05-21T15:36:01.796Z'),
*    lastMessageSent: { topic: 'scale-1.upgradeAgent.commands.1.0.0', upgradeAgentToken: 1 },
*    response: null
*  }]
*/
router.get('/all/:page/:count', validateProjection, function(req, res) {
	const page = parseFloat(req.params.page);
	const count = parseInt(req.params.count);

	const queryObj = {
		filter: utils.tryParseJSON(req.query.filter) || {},
		sort: utils.tryParseJSON(req.query.sort) || {},
		skip: page * count,
		limit: count
	};

	upgradeStepModule.getAllUpgradeSteps(queryObj, (error, upgradeSteps) => {
		if (error)
			return res.json(error.createApiResponse());

		res.json(upgradeSteps);
	});
});

/**
* @apiVersion 1.0.0
* @api {get} /upgradeSteps/count Count upgrade steps
* @apiName CountUpgradeSteps
* @apiGroup upgradeSteps
* @apiDescription Get total `upgradeSteps` count.
*
* @apiSuccess {integer} count `upgradeSteps` count.
*
* @apiSuccessExample Example data on success
* 4
*/
router.get('/count', getCountEntitiesHandler('upgradeStep'));


/**
* @apiVersion 1.0.0
* @api {post} /upgradeSteps/setBreakpoint Set breakpoint
* @apiName SetBreakpoint
* @apiGroup upgradeSteps
* @apiDescription Set a breakpoint for an upgrade step.

* @apiParam {string} upgradeStepID `ID` of the `Upgrade step`.
* @apiParam {boolean} isBreakpointSet Whether to set or clear the breakpoint.
*
* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* {
*	"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
* 	"success": true,
*	"error": null,
*	"payload": null
* }
*/
router.post('/setBreakpoint', function(req, res) {
	const { upgradeStepID, isBreakpointSet } = req.body;

	upgradeStepModule.setBreakpoint(upgradeStepID, isBreakpointSet, (error, result) => {
		if (error)
			return res.json(error.createApiResponse());

		res.json(utils.createApiResponse(upgradeStepID, null, true, null, result));
	});
});

/**
* @apiVersion 1.0.0
* @api {post} /upgradeSteps/markAsCompleted Mark as completed
* @apiName MarkAsCompleted
* @apiGroup upgradeSteps
* @apiDescription Mark an upgrade step as completed manually.

* @apiParam {string} upgradeStepID `ID` of the `Upgrade step`.
*
* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* {
*	"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
* 	"success": true,
*	"error": null,
*	"payload": null
* }
*/
router.post('/markAsCompleted', function(req, res) {
	const { upgradeStepID } = req.body;

	let incomingRequestSystemAdminMessage = createAuditRequestLog(req, systemMessages.UPGRADE_STEP_MARK_AS_COMPLETED_REQUEST)
		.addInfo(Entities.UpgradeStep.ID, upgradeStepID);

	utils.handleRESTAndLog(
		[incomingRequestSystemAdminMessage],
		cb => upgradeStepModule.markAsCompleted(upgradeStepID, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.UpgradeStep.ID)))
	);
});

module.exports = router;
