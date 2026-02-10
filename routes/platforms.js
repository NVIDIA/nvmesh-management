/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


const express = require('express');

const platformModule = require('../modules/platform.js');
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
	renderData.componentName = consts.componentsPages.platforms;

	res.render('react', renderData);
});

/**
* @apiVersion 17.0.0
* @api {get} /platforms/all/:page/:count?filter={}&sort={} Get platforms
* @apiName GetPlatforms
* @apiGroup platforms
* @apiDescription Get `platforms` by `page` and `count`.
*
* @apiParam {integer} page The `page` to fetch.
* @apiParam {integer} count Number of records per `page`.
* @apiParam {object} [filter] `Filter` before fetching.
* @apiParam {object} [sort] `Sort` before fetching.
* @apiParamExample {object[]} Example request
* /platforms/all/0/2?filter={"level":"ERROR"}&sort={"timestamp":-1}
*
* @apiSuccess {object[]} platforms List of `platforms`.
*
* @apiSuccessExample Example data on success
* [{
*	"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefc",
* 	"_id": "1",
* 	"name": "High Perf",
*	"description": "Some description",
*	"archType": "x86",
* 	"operatingSystem": "Ubuntu 20.04",
*	"kernel": "6.8.0-50-generic",
*	"ofed": "inbox"
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

	platformModule.getAllPlatforms(queryObj, (error, platforms) => {
		if (error)
			return res.json(error.createApiResponse());

		res.json(platforms);
	});
});

/**
 * @apiVersion 17.0.0
 * @api {post} /platforms/save Save platforms
 * @apiName SavePlatforms
 * @apiGroup platforms
 * @apiDescription Save `platforms`.
 *
 * @apiBody {object[]} platforms The `platforms` to save.
 * @apiBody {string} platforms.name The name of the `platform`.
 * @apiBody {string} platforms.description The description of the `platform`.
 * @apiBody {integer} platforms.archTypeID The `archTypeID` of the `platform`.
 * @apiBody {integer} platforms.operatingSystemID The `operatingSystemID` of the `platform`.
 * @apiBody {integer} platforms.kernelID The `kernelID` of the `platform`.
 * @apiBody {integer} platforms.ofedID The `ofedID` of the `platform`.
 * @apiExample {object[]} Example request
 * [{"name":"asdasd","description":"sd","archTypeID":2,"operatingSystemID":2,"kernelID":2,"ofedID":3}]
 * @apiSuccess {object[]} result List of results for each platform creation.
 * @apiSuccessExample {object[]} Example data on success
 * [{"_id":"OCICluster","uuid":null,"success":true,"error":null,"payload":null}]
 */
router.post('/save', (req, res) => {
	let platforms = req.body;

	let incomingRequestSystemAdminMessage = platforms.map((platform) => createAuditRequestLog(req, systemMessages.PLATFORM_SAVE_REQUEST)
		.addInfo(Entities.Platform.ID, platform.ID)
		.addInfo(Entities.Platform.name, platform.name)
	);

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => platformModule.createPlatforms(platforms, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Platform.name, Entities.Platform.ID)))
	);
});

/**
 * @apiVersion 17.0.0
 * @api {post} /platforms/delete Delete platforms
 * @apiName DeletePlatforms
 * @apiGroup platforms
 * @apiDescription Delete `platforms`.
 *
 * @apiBody {object[]} platforms The `platforms` to delete.
 * @apiBody {string} platforms.ID The `ID` of the `platform`.
 * @apiBody {string} platforms.name The name of the `platform`.
 * @apiExample {object[]} Example request
 * [{"ID":10,"name":"asdasd"}]
 * @apiSuccess {object[]} result List of results for each platform deletion.
 * @apiSuccessExample {object[]} Example data on success
 * [{"_id":"OCICluster","uuid":10,"success":true,"error":null,"payload":null}]
 */
router.post('/delete', (req, res) => {
	let platforms = req.body;

	let incomingRequestSystemAdminMessage = platforms.map((platform) => createAuditRequestLog(req, systemMessages.PLATFORM_DELETE_REQUEST)
		.addInfo(Entities.Platform.ID, platform.ID)
		.addInfo(Entities.Platform.name, platform.name)
	);

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => platformModule.deletePlatforms(platforms, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Platform.name, Entities.Platform.ID)))
	);
});

/**
 * @apiVersion 17.0.0
 * @api {post} /platforms/update Update platforms
 * @apiName UpdatePlatforms
 * @apiGroup platforms
 * @apiDescription Update `platforms`.
 *
 * @apiBody {object[]} platforms The `platforms` to update.
 * @apiBody {string} platforms.ID The `ID` of the `platform`.
 * @apiBody {string} platforms.name The name of the `platform`.
 * @apiBody {string} platforms.description The description of the `platform`.
 * @apiBody {integer} platforms.archTypeID The `archTypeID` of the `platform`.
 * @apiBody {integer} platforms.operatingSystemID The `operatingSystemID` of the `platform`.
 * @apiBody {integer} platforms.kernelID The `kernelID` of the `platform`.
 * @apiBody {integer} platforms.ofedID The `ofedID` of the `platform`.
 * @apiExample {object[]} Example request
 * [{"ID": 9, "name":"OCICluster","description":"zzz","archTypeID":2,"operatingSystemID":2,"kernelID":2,"ofedID":3}]
 * @apiSuccess {object[]} result List of results for each platform update.
 * @apiSuccessExample {object[]} Example data on success
 * [{"_id":"OCICluster","uuid":9,"success":true,"error":null,"payload":null}]
 */
router.post('/update', (req, res) => {
	let platforms = req.body;

	let incomingRequestSystemAdminMessage = platforms.map((platform) => createAuditRequestLog(req, systemMessages.PLATFORM_UPDATE_REQUEST)
		.addInfo(Entities.Platform.ID, platform.ID)
		.addInfo(Entities.Platform.name, platform.name)
	);

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => platformModule.updatePlatforms(platforms, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Platform.name, Entities.Platform.ID)))
	);
});

/**
* @apiVersion 17.0.0
* @api {get} /platforms/count Count platforms
* @apiName CountPlatforms
* @apiGroup platforms
* @apiDescription Get total `platforms` count.
* @apiParam {object} [filter] `Filter` before counting. <small><i>--MongoDB filter obj</i></small>
* @apiParamExample {object} Example request
* platforms/count?filter={"archTypeID":2}
* @apiSuccess {integer} count `platforms` count.
* @apiSuccessExample Example data on success
* 3606
*/
router.get('/count', (req, res) => {
	const filterObj = utils.tryParseJSON(req.query.filter) || {};

	platformModule.count(filterObj, (count) => {
		res.json(count);
	});
});

router.get('/getAllArchTypes', (req, res) => {
	platformModule.getAllArchTypes((archTypes) => {
		res.json(archTypes);
	});
});

module.exports = router;
