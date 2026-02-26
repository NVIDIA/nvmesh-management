/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const express = require('express');

const upgradeScenarioModule = require('../modules/upgradeScenario.js');
const consts = require('../consts.js');
const utils = require('../utils.js');
const systemMessages = require('../systemMessages.js');
const { Entities } = require('../modules/error.js');
const { createAuditRequestLog } = require('../modules/log.js');
const validateProjection = require('../middlewares/validateProjection.js');

const router = express.Router();

router.get('/', function(req, res) {
	var renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };
	renderData.componentName = consts.componentsPages.upgradeScenarios;

	res.render('react', renderData);
});

/**
 * @apiVersion 17.0.0
 * @api {get} /upgradeScenarios/all/:page/:count?filter={}&sort={} Get upgrade scenarios
 * @apiName GetUpgradeScenarios
 * @apiGroup upgradeScenarios
 * @apiDescription Get `upgrade scenarios` by `page` and `count`.
 *
 * @apiParam {integer} page The `page` to fetch.
 * @apiParam {integer} count Number of records per `page`.
 * @apiParam {object} [filter] `Filter` before fetching.
 * @apiParam {object} [sort] `Sort` before fetching.
 * @apiParamExample {object[]} Example request
 * /upgradeScenarios/all/0/10?filter={"componentVersion.version":{"$regex":"3.1.0","$options":"i"}}&sort={"upgradeType.name":1}
 * @apiSuccess {object[]} upgradeScenarios List of `upgrade scenarios`.
 * @apiSuccessExample Example data on success
 * [{
 *   "ID": 5,
 *   "upgradeTypeID": 2,
 *   "destinationReleaseID": 4,
 *   "sourceVersionID": 1,
 *   "upgradeType": {
 *     "ID": 2,
 *     "name": "clientOnly"
 *   },
 *   "steps": [],
 *   "release": {
 *     "ID": 4,
 *     "version": "3.2.0"
 *   },
 *   "componentVersion": {
 *     "ID": 1,
 *     "version": "3.1.0",
 *     "componentID": 1
 *   }
 * }]
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

	upgradeScenarioModule.getAllUpgrades(queryObj, false, (error, upgradeScenarios) => {
		if (error)
			return res.json(error.createApiResponse());

		res.json(upgradeScenarios);
	});
});

/**
 * @apiVersion 17.0.0
 * @api {get} /upgradeScenarios/count Count upgrade scenarios
 * @apiName CountUpgradeScenarios
 * @apiGroup upgradeScenarios
 * @apiDescription Get total `upgrade scenarios` count.
 * @apiSuccess {integer} count `upgrade scenarios` count.
 * @apiSuccessExample Example data on success
 * 4
 */
router.get('/count', function(req, res) {
	const filterObj = utils.tryParseJSON(req.query.filter) || {};

	upgradeScenarioModule.countUpgrades(filterObj, (count) => {
		res.json(count);
	});
});

/**
 * @apiVersion 17.0.0
 * @api {post} /upgradeScenarios/save Save upgrade scenarios
 * @apiName SaveUpgradeScenarios
 * @apiGroup upgradeScenarios
 * @apiDescription Save `upgrade scenarios`.
 *
 * @apiBody {object[]} upgradeScenarios List of `upgrade scenarios` to save.
 * @apiBody {integer} upgradeScenarios.upgradeTypeID The upgrade type ID to save the upgrade scenario for.
 * @apiBody {integer} upgradeScenarios.sourceVersionID The source version ID to save the upgrade scenario for.
 * @apiBody {integer} upgradeScenarios.destinationReleaseID The destination release ID to save the upgrade scenario for.
 * @apiExample {object[]} Example request
 * [{
 *   "upgradeTypeID": 2,
 *   "destinationReleaseID": 1,
 *   "sourceVersionID": 1
 * }]
 *
 * @apiSuccess {object[]} results Success statuses
 * @apiSuccessExample Example data on success
 * [{
 *  "_id": "42",
 *  "success": true,
 *  "error": null,
 *  "payload": null,
 *  "uuid": null
 * }]
 */
router.post('/save', (req, res) => {
	let upgradeScenarios = req.body;

	let incomingRequestSystemAdminMessage = upgradeScenarios.map((upgradeScenario) => createAuditRequestLog(req, systemMessages.UPGRADE_SCENARIO_SAVE_REQUEST)
		.addInfo(Entities.UpgradeScenario.sourceVersion, upgradeScenario.sourceVersionID)
		.addInfo(Entities.UpgradeScenario.destinationVersion, upgradeScenario.destinationReleaseID)
		.addInfo(Entities.UpgradeScenario.upgradeTypeID, upgradeScenario.upgradeTypeID)
	);

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => upgradeScenarioModule.createUpgrades(upgradeScenarios, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.UpgradeScenario.ID)))
	);
});

/**
 * @apiVersion 17.0.0
 * @api {post} /upgradeScenarios/update Update upgrade scenarios
 * @apiName UpdateUpgradeScenarios
 * @apiGroup upgradeScenarios
 * @apiDescription Update `upgrade scenarios`.
 *
 * @apiBody {object[]} upgradeScenarios List of `upgrade scenarios` to update.
 * @apiBody {integer} upgradeScenarios.ID The ID of the upgrade scenario to update.
 * @apiBody {integer} upgradeScenarios.destinationReleaseID The destination release ID to update the upgrade scenario for.
 * @apiBody {integer} upgradeScenarios.sourceVersionID The source version ID to update the upgrade scenario for.
 * @apiBody {integer} upgradeScenarios.upgradeTypeID The upgrade type ID to update the upgrade scenario for.
 * @apiBody {object[]} [upgradeScenarios.steps] The steps to update the upgrade scenario for.
 * @apiBody {integer} upgradeScenarios.steps.ID The ID of the step to update the upgrade scenario for.
 * @apiExample {object[]} Example request
 * [{
 *   "ID": 42,
 *   "destinationReleaseID": 1,
 *   "sourceVersionID": 5,
 *   "upgradeTypeID": 1,
 *   "steps": [
 *     {
 *       "ID": 2
 *     }
 *   ]
 * }]
 *
 * @apiSuccess {object[]} results Success statuses
 * @apiSuccessExample Example data on success
 * [{
 *	"_id": "42",
 *	"success": true,
 *	"error": null,
 *	"payload": null,
 *	"uuid": null
 * }]
 */
router.post('/update', (req, res) => {
	let upgradeScenarios = req.body;

	let incomingRequestSystemAdminMessage = upgradeScenarios.map((upgradeScenario) => createAuditRequestLog(req, systemMessages.UPGRADE_SCENARIO_UPDATE_REQUEST)
		.addInfo(Entities.UpgradeScenario.ID, upgradeScenario.ID)
		.addInfo(Entities.UpgradeScenario.sourceVersion, upgradeScenario.sourceVersionID)
		.addInfo(Entities.UpgradeScenario.destinationVersion, upgradeScenario.destinationReleaseID)
		.addInfo(Entities.UpgradeScenario.upgradeTypeID, upgradeScenario.upgradeTypeID)
	);

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => upgradeScenarioModule.updateUpgrades(upgradeScenarios, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.UpgradeScenario.ID)))
	);
});

/**
 * @apiVersion 17.0.0
 * @api {post} /upgradeScenarios/delete Delete upgrade scenarios
 * @apiName DeleteUpgradeScenarios
 * @apiGroup upgradeScenarios
 * @apiDescription Delete `upgrade scenarios`.
 *
 * @apiBody {object[]} upgradeScenarios List of `upgrade scenarios` to delete.
 * @apiBody {integer} upgradeScenarios.ID The ID of the upgrade scenario to delete.
 * @apiExample {object[]} Example request
 * [{
 *   "ID": 1
 * }]
 *
 * @apiSuccess {object[]} results Success statuses
 * @apiSuccessExample Example data on success
 * [{
 *	"_id": "1",
 *	"success": true,
 *	"error": null,
 *	"payload": null,
 *	"uuid": null
 * }]
 */
router.post('/delete', (req, res) => {
	let upgradeScenarios = req.body;

	let incomingRequestSystemAdminMessage = upgradeScenarios.map((upgradeScenario) => createAuditRequestLog(req, systemMessages.UPGRADE_SCENARIO_DELETE_REQUEST)
		.addInfo(Entities.UpgradeScenario.ID, upgradeScenario.ID)
	);

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => upgradeScenarioModule.deleteUpgrades(upgradeScenarios, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.UpgradeScenario.ID)))
	);
});

/**
 * @apiVersion 17.0.0
 * @api {get} /upgradeScenarios/upgradeTypes Get all upgrade types
 * @apiName GetAllUpgradeTypes
 * @apiGroup upgradeScenarios
 * @apiDescription Get all available `upgrade types`.
 *
 * @apiSuccess {object[]} upgradeTypes List of `upgrade types`.
 * @apiSuccessExample Example data on success
 * [[
 *   {
 *     "ID": 1,
 *     "name": "clientTarget"
 *   },
 *   {
 *     "ID": 2,
 *     "name": "clientOnly"
 *   },
 *   {
 *     "ID": 3,
 *     "name": "management"
 *   }
 * ]]
 */
router.get('/upgradeTypes', function(req, res) {
	upgradeScenarioModule.getAllUpgradeTypes((error, upgradeTypes) => {
		if (error)
			return res.json(error.createApiResponse());

		res.json(upgradeTypes);
	});
});


module.exports = router;
