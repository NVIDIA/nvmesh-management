/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


const express = require('express');

const ofedModule = require('../modules/ofed.js');
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
	renderData.componentName = consts.componentsPages.ofeds;

	res.render('react', renderData);
});

/**
* @apiVersion 17.0.0
* @api {get} /ofeds/all/:page/:count?filter={}&sort={} Get ofeds
* @apiName GetOfeds
* @apiGroup ofeds
* @apiDescription Get `ofeds` by `page` and `count`.
* @apiParam {integer} page The `page` to fetch.
* @apiParam {integer} count Number of records per `page`.
* @apiParam {object} [filter] `Filter` before fetching.
* @apiParam {object} [sort] `Sort` before fetching.
* @apiParamExample {object[]} Example request
* /ofeds/all/0/2?filter={"version":"MLNX_OFED_LINUX-23.10-4.0.9.1:"}&sort={"version":-1}
* @apiSuccess {object[]} ofeds List of `ofeds`.
* @apiSuccessExample Example data on success
* [{ "ID": 1, "version": "MLNX_OFED_LINUX-23.10-4.0.9.1:" }]
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

	ofedModule.getOfeds(queryObj, (error, ofeds) => {
		if (error)
			return res.json(error.createApiResponse());

		res.json(ofeds);
	});
});

/**
* @apiVersion 17.0.0
* @api {post} /ofeds/save Create new ofeds
* @apiName CreateOfeds
* @apiGroup ofeds
* @apiDescription Create new `ofeds` from a list of versions.
* @apiBody {String[]} ofeds Array of ofed version strings to create.
* @apiExample {json} Example request
* ["MLNX_OFED_LINUX-23.10-4.0.9.1:"]
* @apiSuccess {Object[]} result List of results for each ofed creation.
* @apiSuccessExample {json} Example data on success
* [{"_id":"MLNX_OFED_LINUX-23.10-4.0.9.1:","uuid":1,"success":true,"error":null,"payload":null}]
*/
router.post('/save', (req, res) => {
	let ofedVersions = req.body;

	let incomingRequestSystemAdminMessage = ofedVersions.map((ofedVersion) => createAuditRequestLog(req, systemMessages.OFED_SAVE_REQUEST)
		.addInfo(Entities.Ofed.version, ofedVersion));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => ofedModule.createOfeds(ofedVersions, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Ofed.version, Entities.Ofed.ID)))
	);
});

/**
* @apiVersion 17.0.0
* @api {post} /ofeds/update Update existing ofeds
* @apiName UpdateOfeds
* @apiGroup ofeds
* @apiDescription Update existing `ofeds` from a list of ofed objects.
* @apiBody {Object[]} ofeds Array of ofed objects to update, each with ID and new version.
* @apiBody {string} ofeds.ID The `ID` of the `ofed`.
* @apiBody {string} ofeds.version The `version` of the `ofed`.
* @apiExample {json} Example request
* [{"ID": 1, "version": "MLNX_OFED_LINUX-23.10-4.0.9.1:"}]
* @apiSuccess {Object[]} result List of results for each ofed update.
* @apiSuccessExample {json} Example data on success
* [{"_id":"MLNX_OFED_LINUX-23.10-4.0.9.1:","uuid":1,"success":true,"error":null,"payload":null}]
*/
router.post('/update', (req, res) => {
	let ofedVersions = req.body;

	let incomingRequestSystemAdminMessage = ofedVersions.map((ofedVersion) => createAuditRequestLog(req, systemMessages.OFED_UPDATE_REQUEST)
		.addInfo(Entities.Ofed.ID, ofedVersion.ID)
		.addInfo(Entities.Ofed.version, ofedVersion.version));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => ofedModule.updateOfeds(ofedVersions, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Ofed.version, Entities.Ofed.ID)))
	);
});

/**
* @apiVersion 17.0.0
* @api {post} /ofeds/delete Delete existing ofeds
* @apiName DeleteOfeds
* @apiGroup ofeds
* @apiDescription Delete existing `ofeds` from a list of ofed objects.
* @apiBody {Object[]} ofeds Array of ofed objects to delete.
* @apiBody {string} ofeds.ID The `ID` of the `ofed`.
* @apiBody {string} ofeds.version The `version` of the `ofed`.
* @apiExample {json} Example request
* [{"ID": 1, "version": "MLNX_OFED_LINUX-23.10-4.0.9.1:"}]
* @apiSuccess {Object[]} result List of results for each ofed deletion.
* @apiSuccessExample {json} Example data on success
* [{"_id":"MLNX_OFED_LINUX-23.10-4.0.9.1:","uuid":1,"success":true,"error":null,"payload":null}]
*/
router.post('/delete', (req, res) => {
	let ofedVersions = req.body;

	let incomingRequestSystemAdminMessage = ofedVersions.map((ofedVersion) => createAuditRequestLog(req, systemMessages.OFED_DELETE_REQUEST)
		.addInfo(Entities.Ofed.ID, ofedVersion.ID)
		.addInfo(Entities.Ofed.version, ofedVersion.version));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => ofedModule.deleteOfeds(ofedVersions, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Ofed.version, Entities.Ofed.ID)))
	);
});

/**
* @apiVersion 17.0.0
* @api {get} /ofeds/count Count ofeds
* @apiName CountOfeds
* @apiGroup ofeds
* @apiDescription Get total `ofeds` count.
* @apiParam {object} [filter] `Filter` before counting. <small><i>--MongoDB filter obj</i></small>
* @apiParamExample {object} Example request
* /ofeds/count?filter={"version":"MLNX_OFED_LINUX-23.10-4.0.9.1:"}
* @apiSuccess {integer} count `ofeds` count.
* @apiSuccessExample Example data on success
* 3606
*/
router.get('/count', (req, res) => {
	const filterObj = utils.tryParseJSON(req.query.filter) || {};

	ofedModule.countOfeds(filterObj, (count) => {
		res.json(count);
	});
});

module.exports = router;
