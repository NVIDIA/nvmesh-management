/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const express = require('express');

const upgradeStepScenarioModule = require('../modules/upgradeStepScenario.js');
const consts = require('../consts.js');
const utils = require('../utils.js');
const systemMessages = require('../systemMessages.js');
const { Entities } = require('../modules/error.js');
const { createAuditRequestLog } = require('../modules/log.js');
const validateProjection = require('../middlewares/validateProjection.js');

const router = express.Router();

router.get('/', function(req, res) {
	const renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };
	renderData.componentName = consts.componentsPages.upgradeStepsScenarios;

	res.render('react', renderData);
});

/**
 * @apiVersion 17.0.0
 * @api {get} /upgradeStepsScenarios/all/:page/:count?filter={}&sort={} Get upgrade steps scenarios
 * @apiName GetUpgradeStepsScenarios
 * @apiGroup upgradeStepsScenarios
 * @apiDescription Get `upgrade steps scenarios` by `page` and `count`.
 *
 * @apiParam {integer} page The `page` to fetch.
 * @apiParam {integer} count Number of records per `page`.
 * @apiParam {object} [filter] `Filter` before fetching.
 * @apiParam {object} [sort] `Sort` before fetching.
 * @apiParamExample {object[]} Example request
 * /upgradeStepsScenarios/all/0/10?filter={"command":{"$regex":"systemctl","$options":"i"}}&sort={"name":1}
 * @apiSuccess {object[]} upgradeStepsScenarios List of `upgrade steps scenarios`.
 * @apiSuccessExample Example data on success
 * [{
 *   "ID": 3,
 *   "name": "stopClient",
 *   "command": "systemctl",
 *   "timeout": 300,
 *   "verificationCommand": null,
 *   "isVolumeAffected": 1,
 *   "arguments": "[\"stop\",\"nvmeshclient\"]"
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

	upgradeStepScenarioModule.getAllUpgradeStepScenarios(queryObj, (error, upgradeStepsScenarios) => {
		if (error)
			return res.json(error.createApiResponse());

		res.json(upgradeStepsScenarios);
	});
});

/**
 * @apiVersion 17.0.0
 * @api {get} /upgradeStepsScenarios/count Count upgrade steps scenarios
 * @apiName CountUpgradeStepsScenarios
 * @apiGroup upgradeStepsScenarios
 * @apiDescription Get total `upgrade steps scenarios` count.
 * @apiSuccess {integer} count `upgrade steps scenarios` count.
 * @apiSuccessExample Example data on success
 * 15
 */
router.get('/count', function(req, res) {
	const filterObj = utils.tryParseJSON(req.query.filter) || {};

	upgradeStepScenarioModule.countUpgradeStepScenarios(filterObj, (count) => {
		res.json(count);
	});
});

/**
 * @apiVersion 17.0.0
 * @api {post} /upgradeStepsScenarios/save Save upgrade steps scenarios
 * @apiName SaveUpgradeStepsScenarios
 * @apiGroup upgradeStepsScenarios
 * @apiDescription Save `upgrade steps scenarios`.
 *
 * @apiBody {object[]} upgradeStepsScenarios List of `upgrade steps scenarios` to save.
 * @apiBody {string} upgradeStepsScenarios.name The name of the upgrade step scenario to save.
 * @apiBody {string} upgradeStepsScenarios.command The command of the upgrade step scenario to save.
 * @apiBody {integer} [upgradeStepsScenarios.timeout] The timeout of the upgrade step scenario to save.
 * @apiBody {string} [upgradeStepsScenarios.verificationCommand] The verification command of the upgrade step scenario to save.
 * @apiBody {integer} [upgradeStepsScenarios.isVolumeAffected] The is volume affected of the upgrade step scenario to save.
 * @apiBody {string} [upgradeStepsScenarios.arguments] The arguments of the command of the upgrade step scenario to save.
 * @apiExample {object[]} Example request
 * [{
 *   "name": "stopClient",
 *   "command": "systemctl",
 *   "timeout": 300,
 *   "verificationCommand": null,
 *   "isVolumeAffected": 1,
 *   "arguments": "[\"stop\",\"nvmeshclient\"]"
 * }]
 * @apiSuccess {object[]} results Success statuses
 * @apiSuccessExample Example data on success
 * [{
 *   "_id": 1,
 *   "success": true,
 *   "error": null,
 *   "payload": null,
 *   "uuid": null
 * }]
 */
router.post('/save', (req, res) => {
	let upgradeStepsScenarios = req.body;

	let incomingRequestSystemAdminMessage = upgradeStepsScenarios.map((upgradeStepScenario) =>
		createAuditRequestLog(req, systemMessages.UPGRADE_STEP_SCENARIO_SAVE_REQUEST)
			.addInfo(Entities.UpgradeStepScenario.name, upgradeStepScenario.name)
			.addInfo(Entities.UpgradeStepScenario.command, upgradeStepScenario.command)
			.addInfo(Entities.UpgradeStepScenario.timeout, upgradeStepScenario.timeout)
			.addInfo(Entities.UpgradeStepScenario.verificationCommand, upgradeStepScenario.verificationCommand)
			.addInfo(Entities.UpgradeStepScenario.isVolumeAffected, upgradeStepScenario.isVolumeAffected)
			.addInfo(Entities.UpgradeStepScenario.arguments, upgradeStepScenario.arguments)
	);

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => upgradeStepScenarioModule.createUpgradeStepScenarios(upgradeStepsScenarios, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.UpgradeStepScenario.ID)))
	);
});

/**
 * @apiVersion 17.0.0
 * @api {post} /upgradeStepsScenarios/update Update upgrade steps scenarios
 * @apiName UpdateUpgradeStepsScenarios
 * @apiGroup upgradeStepsScenarios
 * @apiDescription Update `upgrade steps scenarios`.
 *
 * @apiBody {object[]} upgradeStepsScenarios List of `upgrade steps scenarios` to update.
 * @apiBody {integer} upgradeStepsScenarios.ID The ID of the upgrade step scenario to update.
 * @apiBody {string} upgradeStepsScenarios.name The name of the upgrade step scenario to update.
 * @apiBody {string} upgradeStepsScenarios.command The command of the upgrade step scenario to update.
 * @apiBody {integer} [upgradeStepsScenarios.timeout] The timeout of the upgrade step scenario to update.
 * @apiBody {string} [upgradeStepsScenarios.verificationCommand] The verification command of the upgrade step scenario to update.
 * @apiBody {integer} [upgradeStepsScenarios.isVolumeAffected] The is volume affected of the upgrade step scenario to update.
 * @apiBody {string} [upgradeStepsScenarios.arguments] The arguments of the command of the upgrade step scenario to update.
 * @apiExample {object[]} Example request
 * [{
 *     "ID": 1,
 *     "name": "stopClient",
 *     "command": "systemctl",
 *     "timeout": 300,
 *     "verificationCommand": null,
 *     "isVolumeAffected": 1,
 *     "arguments": "[\"stop\",\"nvmeshclient\"]"
 * }]
 *
 * @apiSuccess {object[]} results Success statuses
 * @apiSuccessExample Example data on success
 * [{
 *	"_id": 1,
 *	"success": true,
 *	"error": null,
 *	"payload": null,
 *	"uuid": null
 * }]
 */
router.post('/update', (req, res) => {
	let upgradeStepsScenarios = req.body;

	let incomingRequestSystemAdminMessage = upgradeStepsScenarios.map((upgradeStepScenario) =>
		createAuditRequestLog(req, systemMessages.UPGRADE_STEP_SCENARIO_UPDATE_REQUEST)
			.addInfo(Entities.UpgradeStepScenario.ID, upgradeStepScenario.ID)
			.addInfo(Entities.UpgradeStepScenario.name, upgradeStepScenario.name)
			.addInfo(Entities.UpgradeStepScenario.command, upgradeStepScenario.command)
			.addInfo(Entities.UpgradeStepScenario.timeout, upgradeStepScenario.timeout)
			.addInfo(Entities.UpgradeStepScenario.verificationCommand, upgradeStepScenario.verificationCommand)
			.addInfo(Entities.UpgradeStepScenario.isVolumeAffected, upgradeStepScenario.isVolumeAffected)
			.addInfo(Entities.UpgradeStepScenario.arguments, upgradeStepScenario.arguments)
	);

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => upgradeStepScenarioModule.updateUpgradeStepScenarios(upgradeStepsScenarios, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.UpgradeStepScenario.ID)))
	);
});

/**
 * @apiVersion 17.0.0
 * @api {post} /upgradeStepsScenarios/delete Delete upgrade steps scenarios
 * @apiName DeleteUpgradeStepsScenarios
 * @apiGroup upgradeStepsScenarios
 * @apiDescription Delete `upgrade steps scenarios`.
 *
 * @apiBody {object[]} upgradeStepsScenarios List of `upgrade steps scenarios` to delete.
 * @apiBody {integer} upgradeStepsScenarios.ID The ID of the upgrade step scenario to delete.
 * @apiExample {object[]} Example request
 * [{
 *   "ID": 1
 * }]
 * @apiSuccess {object[]} results Success statuses
 * @apiSuccessExample Example data on success
 * [{
 *	"_id": 1,
 *	"success": true,
 *	"error": null,
 *	"payload": null,
 *	"uuid": null
 * }]
 */
router.post('/delete', (req, res) => {
	let upgradeStepsScenarios = req.body;

	let incomingRequestSystemAdminMessage = upgradeStepsScenarios.map((upgradeStepScenario) =>
		createAuditRequestLog(req, systemMessages.UPGRADE_STEP_SCENARIO_DELETE_REQUEST)
			.addInfo(Entities.UpgradeStepScenario.ID, upgradeStepScenario.ID)
			.addInfo(Entities.UpgradeStepScenario.name, upgradeStepScenario.name)
	);

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => upgradeStepScenarioModule.deleteUpgradeStepScenarios(upgradeStepsScenarios, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.UpgradeStepScenario.ID)))
	);
});

module.exports = router;
