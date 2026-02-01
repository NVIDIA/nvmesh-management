/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


const express = require('express');

const kernelModule = require('../modules/kernel.js');
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

	renderData.isReact = true;
	renderData.componentName = consts.componentsPages.kernels;

	res.render('react', renderData);
});

/**
* @apiVersion 1.0.0
* @api {get} /kernels/all/:page/:count?filter={}&sort={} Get kernels
* @apiName GetKernels
* @apiGroup kernels
* @apiDescription Get `kernels` by `page` and `count`.
* @apiParam {integer} page The `page` to fetch.
* @apiParam {integer} count Number of records per `page`.
* @apiParam {object} [filter] `Filter` before fetching.
* @apiParam {object} [sort] `Sort` before fetching.
* @apiParamExample {object[]} Example request
* /kernels/all/0/2?filter={"version":"5.15.0-1000-generic"}&sort={"version":-1}
* @apiSuccess {object[]} kernels List of `kernels`.
* @apiSuccessExample Example data on success
* [{ "ID": 1, "version": "4.18.0-372.32.1.el8_lustre.x86_64" }]
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

	kernelModule.getKernels(queryObj, (error, kernels) => {
		if (error)
			return res.json(error.createApiResponse());

		res.json(kernels);
	});
});

/**
* @apiVersion 1.0.0
* @api {post} /kernels/save Create new kernels
* @apiName CreateKernels
* @apiGroup kernels
* @apiDescription Create new `kernels` from a list of versions.
* @apiParam {String[]} - Array of kernel version strings to create.
* @apiParamExample {json} Example request
* ["5.15.0-1000-generic", "4.18.0-372.32.1.el8_lustre.x86_64"]
* @apiSuccess {Object[]} result List of results for each kernel creation.
* @apiSuccessExample {json} Example data on success
* [{"_id":"5.15.0-1000-generic","uuid":1,"success":true,"error":null,"payload":null}]
*/
router.post('/save', (req, res) => {
	let kernelVersions = req.body;

	let incomingRequestSystemAdminMessage = kernelVersions.map((kernelVersion) => createAuditRequestLog(req, systemMessages.KERNEL_SAVE_REQUEST)
		.addInfo(Entities.Kernel.version, kernelVersion));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => kernelModule.createKernels(kernelVersions, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Kernel.version, Entities.Kernel.ID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {post} /kernels/update Update existing kernels
* @apiName UpdateKernels
* @apiGroup kernels
* @apiDescription Update existing `kernels` from a list of kernel objects.
* @apiParam {Object[]} - Array of kernel objects to update, each with ID and new version.
* @apiParam {string} kernels.ID The `ID` of the `kernel`.
* @apiParam {string} kernels.version The `version` of the `kernel`.
* @apiParamExample {json} Example request
* [{"ID": 1, "version": "5.15.0-1001-generic"}]
* @apiSuccess {Object[]} result List of results for each kernel update.
* @apiSuccessExample {json} Example data on success
* [{"_id":"5.15.0-1001-generic","uuid":1,"success":true,"error":null,"payload":null}]
*/
router.post('/update', (req, res) => {
	let kernelVersions = req.body;

	let incomingRequestSystemAdminMessage = kernelVersions.map((kernelVersion) => createAuditRequestLog(req, systemMessages.KERNEL_UPDATE_REQUEST)
		.addInfo(Entities.Kernel.ID, kernelVersion.ID)
		.addInfo(Entities.Kernel.version, kernelVersion.version));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => kernelModule.updateKernels(kernelVersions, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Kernel.version, Entities.Kernel.ID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {post} /kernels/delete Delete existing kernels
* @apiName DeleteKernels
* @apiGroup kernels
* @apiDescription Delete existing `kernels` from a list of kernel objects.
* @apiParam {Object[]} - Array of kernel objects to delete.
* @apiParam {string} kernels.ID The `ID` of the `kernel`.
* @apiParam {string} kernels.version The `version` of the `kernel`.
* @apiParamExample {json} Example request
* [{"ID": 1, "version": "5.15.0-1001-generic"}]
* @apiSuccess {Object[]} result List of results for each kernel deletion.
* @apiSuccessExample {json} Example data on success
* [{"_id":"5.15.0-1001-generic","uuid":1,"success":true,"error":null,"payload":null}]
*/
router.post('/delete', (req, res) => {
	let kernelVersions = req.body;

	let incomingRequestSystemAdminMessage = kernelVersions.map((kernelVersion) => createAuditRequestLog(req, systemMessages.KERNEL_DELETE_REQUEST)
		.addInfo(Entities.Kernel.ID, kernelVersion.ID)
		.addInfo(Entities.Kernel.version, kernelVersion.version));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => kernelModule.deleteKernels(kernelVersions, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Kernel.version, Entities.Kernel.ID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {get} /kernels/count Count kernels
* @apiName CountKernels
* @apiGroup kernels
* @apiDescription Get total `kernels` count.
* @apiParam {object} [filter] `Filter` before counting. <small><i>--MongoDB filter obj</i></small>
* @apiParamExample {object} Example request
* /kernels/count?filter={"version":"5.15.0-1000-generic"}
* @apiSuccess {integer} count `kernels` count.
* @apiSuccessExample Example data on success
* 3606
*/
router.get('/count', (req, res) => {
	const filterObj = utils.tryParseJSON(req.query.filter) || {};

	kernelModule.countKernels(filterObj, (count) => {
		res.json(count);
	});
});

module.exports = router;
