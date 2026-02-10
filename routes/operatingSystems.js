/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


const express = require('express');

const operatingSystemModule = require('../modules/operatingSystem.js');
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
	renderData.componentName = consts.componentsPages.operatingSystems;

	res.render('react', renderData);
});

/**
* @apiVersion 17.0.0
* @api {get} /operatingSystems/all/:page/:count?filter={}&sort={} Get operatingSystems
* @apiName GetOperatingSystems
* @apiGroup operatingSystems
* @apiDescription Get `operatingSystems` by `page` and `count`.
* @apiParam {integer} page The `page` to fetch.
* @apiParam {integer} count Number of records per `page`.
* @apiParam {object} [filter] `Filter` before fetching.
* @apiParam {object} [sort] `Sort` before fetching.
* @apiParamExample {object[]} Example request
* /operatingSystems/all/0/2?filter={"version":"24.04"}&sort={"version":-1}
* @apiSuccess {object[]} operatingSystems List of `operatingSystems`.
* @apiSuccessExample Example data on success
* [{ "ID": 1, "version": "24.04", "distributionTypeID": 1 }]
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

	operatingSystemModule.getOperatingSystems(queryObj, (error, operatingSystems) => {
		if (error)
			return res.json(error.createApiResponse());

		res.json(operatingSystems);
	});
});

/**
* @apiVersion 17.0.0
* @api {post} /operatingSystems/save Create new operatingSystems
* @apiName CreateOperatingSystems
* @apiGroup operatingSystems
* @apiDescription Create new `operatingSystems` from a list of objects.
* @apiBody {Object[]} operatingSystems Array of operatingSystem objects to create. Each object must contain `version` and `distributionTypeID`.
* @apiBody {string} operatingSystems.version The `version` of the `operatingSystem`.
* @apiBody {string} operatingSystems.distributionTypeID The `distributionTypeID` of the `operatingSystem`.
* @apiExample {json} Example request
* [{ "version": "24.04", "distributionTypeID": 2 }]
* @apiSuccess {Object[]} result List of results for each operatingSystem creation.
* @apiSuccessExample {json} Example data on success
* [{"_id":"24.04","uuid":1,"success":true,"error":null,"payload":null}]
*/
router.post('/save', (req, res) => {
	const operatingSystems = req.body;

	const incomingRequestSystemAdminMessage = operatingSystems.map(os =>
		createAuditRequestLog(req, systemMessages.OPERATING_SYSTEM_SAVE_REQUEST)
			.addInfo(Entities.OperatingSystem.version, os.version)
			.addInfo(Entities.OperatingSystem.distributionType, os.distributionTypeID));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => operatingSystemModule.createOperatingSystems(operatingSystems, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.OperatingSystem.version, Entities.OperatingSystem.ID)))
	);
});

/**
* @apiVersion 17.0.0
* @api {post} /operatingSystems/update Update existing operatingSystems
* @apiName UpdateOperatingSystems
* @apiGroup operatingSystems
* @apiDescription Update existing `operatingSystems` from a list of operatingSystem objects.
* @apiBody {Object[]} operatingSystems Array of operatingSystem objects to update. Each object must contain `ID`, `version`, and `distributionTypeID`.
* @apiBody {string} operatingSystems.ID The `ID` of the `operatingSystem`.
* @apiBody {string} operatingSystems.version The `version` of the `operatingSystem`.
* @apiBody {string} operatingSystems.distributionTypeID The `distributionTypeID` of the `operatingSystem`.
* @apiExample {json} Example request
* [{"ID": 1, "version": "24.04", "distributionTypeID": 2}]
* @apiSuccess {Object[]} result List of results for each operatingSystem update.
* @apiSuccessExample {json} Example data on success
* [{"_id":"24.04","uuid":1,"success":true,"error":null,"payload":null}]
*/
router.post('/update', (req, res) => {
	const operatingSystems = req.body;

	const incomingRequestSystemAdminMessage = operatingSystems.map(os =>
		createAuditRequestLog(req, systemMessages.OPERATING_SYSTEM_UPDATE_REQUEST)
			.addInfo(Entities.OperatingSystem.ID, os.ID)
			.addInfo(Entities.OperatingSystem.version, os.version)
			.addInfo(Entities.OperatingSystem.distributionType, os.distributionTypeID));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => operatingSystemModule.updateOperatingSystems(operatingSystems, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.OperatingSystem.version, Entities.OperatingSystem.ID)))
	);
});

/**
* @apiVersion 17.0.0
* @api {post} /operatingSystems/delete Delete existing operatingSystems
* @apiName DeleteOperatingSystems
* @apiGroup operatingSystems
* @apiDescription Delete existing `operatingSystems` from a list of operatingSystem objects.
* @apiBody {Object[]} operatingSystems Array of operatingSystem objects to delete.
* @apiBody {string} operatingSystems.ID The `ID` of the `operatingSystem`.
* @apiBody {string} operatingSystems.version The `version` of the `operatingSystem`.
* @apiExample {json} Example request
* [{"ID": 1, "version": "24.04"}]
* @apiSuccess {Object[]} result List of results for each operatingSystem deletion.
* @apiSuccessExample {json} Example data on success
* [{"_id":"24.04","uuid":1,"success":true,"error":null,"payload":null}]
*/
router.post('/delete', (req, res) => {
	const operatingSystems = req.body;

	const incomingRequestSystemAdminMessage = operatingSystems.map(os =>
		createAuditRequestLog(req, systemMessages.OPERATING_SYSTEM_DELETE_REQUEST)
			.addInfo(Entities.OperatingSystem.ID, os.ID)
			.addInfo(Entities.OperatingSystem.version, os.version));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => operatingSystemModule.deleteOperatingSystems(operatingSystems, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.OperatingSystem.version, Entities.OperatingSystem.ID)))
	);
});

/**
* @apiVersion 17.0.0
* @api {get} /operatingSystems/count Count operatingSystems
* @apiName CountOperatingSystems
* @apiGroup operatingSystems
* @apiDescription Get total `operatingSystems` count.
* @apiParam {object} [filter] `Filter` before counting. <small><i>--MongoDB filter obj</i></small>
* @apiParamExample {object} Example request
* /operatingSystems/count?filter={"version":"24.04"}
* @apiSuccess {integer} count `operatingSystems` count.
* @apiSuccessExample Example data on success
* 3606
*/
router.get('/count', (req, res) => {
	const filterObj = utils.tryParseJSON(req.query.filter) || {};

	operatingSystemModule.countOperatingSystems(filterObj, (count) => {
		res.json(count);
	});
});

/**
* @apiVersion 17.0.0
* @api {get} /operatingSystems/distributionTypes Get all distribution types
* @apiName GetAllDistributionTypes
* @apiGroup operatingSystems
* @apiDescription Get all `distributionTypes`.
* @apiParam {object} [filter] `Filter` before fetching. <small><i>--MongoDB filter obj</i></small>
* @apiParam {object} [sort] `Sort` before fetching. <small><i>--MongoDB sort obj</i></small>
* @apiSuccess {Object[]} distributionTypes List of `distributionTypes`.
* @apiSuccessExample Example data on success
* [{ "ID": 1, "name": "ubuntu" }]
*/
router.get('/distributionTypes', (req, res) => {
	const queryObj = {
		filter: utils.tryParseJSON(req.query.filter) || {},
		sort: utils.tryParseJSON(req.query.sort) || {},
	};

	operatingSystemModule.getDistributionTypes(queryObj, (error, distributionTypes) => {
		if (error)
			return res.json(error.createApiResponse());

		res.json(distributionTypes);
	});
});

module.exports = router;
