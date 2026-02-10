/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


const express = require('express');

const componentsModule = require('../modules/component.js');
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
	renderData.componentName = consts.componentsPages.components;

	res.render('react', renderData);
});

/**
* @apiVersion 17.0.0
* @api {get} /components/all/:page/:count?filter={}&sort={} Get components
* @apiName GetComponents
* @apiGroup components
* @apiDescription Get `components` by `page` and `count`.
* @apiParam {integer} page The `page` to fetch.
* @apiParam {integer} count Number of records per `page`.
* @apiParam {object} [filter] `Filter` before fetching.
* @apiParam {object} [sort] `Sort` before fetching.
* @apiParamExample {object[]} Example request
* /components/all/0/0?filter{version:"3.1.0"}&sort={ID:1}
* @apiSuccess {object[]} components List of `components`.
* @apiSuccessExample Example data on success
* [
*     {
*         "ID": 1,
*         "version": "3.1.0",
*         "componentID": 1,
*         "component": {
*             "id": 1,
*             "ID": 1,
*             "name": "nvmesh-client",
*             "componentTypeID": 1,
*             "componentType": {
*                 "ID": 1,
*                 "name": "NVMESH_PACKAGE"
*             }
*         },
*         "platforms": [
*             {
*                 "ID": 1,
*                 "name": "SetupName",
*                 "description": "Setup description",
*                 "archTypeID": 1,
*                 "operatingSystemID": 1,
*                 "kernelID": 8,
*                 "ofedID": 4,
*                 "ComponentVersionPlatform": {
*                     "ID": 5,
*                     "componentVersionID": 1,
*                     "platformID": 1
*                 }
*             }
*         ],
*         "requirements": [
*             {
*                 "id": 1,
*                 "ID": 1,
*                 "name": "nvmesh-client",
*                 "componentTypeID": 1,
*                 "ComponentRequirement": {
*                     "ID": 4,
*                     "componentVersionID": 1,
*                     "componentID": 1
*                 }
*             }
*         ],
*         "compatibilities": [
*             {
*                 "ID": 2,
*                 "version": "3.1.0",
*                 "componentID": 2,
*                 "ComponentCompatibility": {
*                     "ID": 1,
*                     "sourceVersionID": 1,
*                     "destinationVersionID": 2
*                 }
*             }
*         ]
*     }
* ]
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

	componentsModule.getAllComponentVersions(queryObj, (error, components) => {
		if (error)
			return res.json(error.createApiResponse());

		res.json(components);
	});
});
/**
 * @apiVersion 17.0.0
 * @api {post} /components/save Save components
 * @apiName SaveComponents
 * @apiGroup components
 * @apiDescription Save `components`.
 *
 * @apiBody {object[]} components The `components` to save.
 * @apiBody {string} components.version The version of the `component`.
 * @apiBody {integer} components.componentID The ID of the `component`.
 * @apiBody {integer} components.componentTypeID The type ID of the `component`.
 * @apiBody {object[]} [components.platforms] Target platforms for this component version.
 * @apiBody {integer} components.platforms.ID ID of the platforms.
 * @apiBody {object[]} [components.requirements] Required components.
 * @apiBody {integer} components.requirements.ID ID of the required component.
 * @apiBody {object[]} [components.compatibilities] Compatible component versions.
 * @apiBody {integer} components.compatibilities.ID Compatibility ID.
 * @apiExample {object[]} Example request
 * [{
 *   "version": "3.6",
 *   "platforms": [{"ID": 4}],
 *   "requirements": [{
 *     "ID": 7
 *   }],
 *   "compatibilities": [{
 *     "ID": 1,
 *   }],
 *   "componentID": 2,
 *   "componentTypeID": 1
 * }]
 * @apiSuccess {object[]} components The saved `components`.
 * @apiSuccessExample {object[]} Example data on success
 * [{"_id":"2","uuid":null,"success":true,"error":null,"payload":null}]
 */
router.post('/save', (req, res) => {
	let components = req.body;

	let incomingRequestSystemAdminMessage = components.map((component) => createAuditRequestLog(req, systemMessages.COMPONENT_SAVE_REQUEST)
		.addInfo(Entities.Component.component, component.component)
		.addInfo(Entities.Component.version, component.version)
	);

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => componentsModule.createComponents(components, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Component.component, Entities.Component.version)))
	);
});

/**
 * @apiVersion 17.0.0
 * @api {post} /components/delete Delete components
 * @apiName DeleteComponents
 * @apiGroup components
 * @apiDescription Delete `components`.
 *
 * @apiBody {object[]} components The `components` to delete.
 * @apiBody {integer} components.ID The `ID` of the `component`.
 * @apiExample {object[]} Example request
 * [{"ID":10}]
 * @apiSuccess {object[]} components The deleted `components`.
 * @apiSuccessExample {object[]} Example data on success
 * [{"_id":"someComponent","uuid":10,"success":true,"error":null,"payload":null}]
 */
router.post('/delete', (req, res) => {
	let components = req.body;

	let incomingRequestSystemAdminMessage = components.map((component) => createAuditRequestLog(req, systemMessages.COMPONENT_DELETE_REQUEST)
		.addInfo(Entities.Component.component, component.component)
		.addInfo(Entities.Component.version, component.version)
	);

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => componentsModule.deleteComponents(components, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Component.component, Entities.Component.version)))
	);
});

/**
 * @apiVersion 17.0.0
 * @api {post} /components/update Update components
 * @apiName UpdateComponents
 * @apiGroup components
 * @apiDescription Update components.
 *
 * @apiBody {object[]} components The components to update.
 * @apiBody {string} components.version The version of the component.
 * @apiBody {integer} components.componentID The ID of the component.
 * @apiBody {integer} components.componentTypeID The type ID of the component.
 * @apiBody {object[]} [components.platforms] Target platforms for this component version.
 * @apiBody {integer} components.platforms.ID ID of the platforms.
 * @apiBody {object[]} [components.requirements] Required components.
 * @apiBody {integer} components.requirements.ID ID of the required component.
 * @apiBody {object[]} [components.compatibilities] Compatible component versions.
 * @apiBody {integer} components.compatibilities.ID Compatibility ID.
 * @apiExample {object[]} Example request
 * [{
 *   "version": "3.6",
 *   "platforms": [{"ID": 4}],
 *   "requirements": [{
 *     "ID": 7
 *   }],
 *   "compatibilities": [{
 *     "ID": 1,
 *   }],
 *   "componentID": 2,
 *   "componentTypeID": 1
 * }]
 * @apiSuccess {object[]} components The updated components.
 * @apiSuccessExample {object[]} Example data on success
 * [{"_id":"2","uuid":null,"success":true,"error":null,"payload":null}]
 */

router.post('/update', (req, res) => {
	let components = req.body;

	let incomingRequestSystemAdminMessage = components.map((component) => createAuditRequestLog(req, systemMessages.COMPONENT_UPDATE_REQUEST)
		.addInfo(Entities.Component.component, component.component)
		.addInfo(Entities.Component.version, component.version)
	);

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => componentsModule.updateComponents(components, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Component.component, Entities.Component.version)))
	);
});

/**
* @apiVersion 17.0.0
* @api {get} /components/count Count components
* @apiName CountComponents
* @apiGroup components
* @apiDescription Get total `components` count.
*
* @apiParam {object} [filter] `Filter` before counting. <small><i>--MongoDB filter obj</i></small>
* @apiParamExample {object} Example request
* components/count?filter={}
*
* @apiSuccess {integer} count `components` count.
*
* @apiSuccessExample Example data on success
* 3606
*/
router.get('/count', (req, res) => {
	const filterObj = utils.tryParseJSON(req.query.filter) || {};

	componentsModule.count(filterObj, (count) => {
		res.json(count);
	});
});

/**
 * @apiVersion 17.0.0
 * @api {get} /components/getAllComponentTypes Get component types
 * @apiName GetAllComponentTypes
 * @apiGroup components
 * @apiDescription Get list of all available `component` types.
 * @apiSuccess {object[]} componentTypes List of `component` types.
 * @apiSuccess {integer} componentTypes.ID ID of the component type.
 * @apiSuccess {string} componentTypes.name Name of the component type.
 * @apiSuccessExample {object[]} Example data on success
 * [
 *     {
 *         "ID": 1,
 *         "name": "NVMESH_PACKAGE"
 *     },
 *     {
 *         "ID": 2,
 *         "name": "KAFKA_TOPIC"
 *     }
 * ]
 */
router.get('/getAllComponentTypes', (req, res) => {
	componentsModule.getAllComponentTypes((results) => {
		res.json(results);
	});
});

/**
 * @apiVersion 17.0.0
 * @api {get} /components/componentsAll/:page/:count Get components definitions
 * @apiName GetComponentsDefinitions
 * @apiGroup components
 * @apiDescription Get component definitions by `page` and `count`.
 * @apiParam {integer} page The `page` number to fetch.
 * @apiParam {integer} count Number of records per `page`.
 * @apiParam {object} [filter] `Filter` before fetching.
 * @apiParam {object} [sort] `Sort` before fetching.
 * @apiParam {boolean} [eagerLoading=false] If `true`, include related component versions, platforms and compatibilities.
 * @apiParamExample {object[]} Example request
 * /components/componentsAll/0/10?filter={}&sort={}&eagerLoading=true
 * @apiSuccess {object[]} components List of `components`.
 * @apiSuccessExample {object[]} Example data on success
 * [
 *     {
 *         "ID": 1,
 *         "name": "nvmesh-client",
 *         "componentTypeID": 1
 *     }
 * ]
 */
router.get('/componentsAll/:page/:count', validateProjection, function(req, res) {
	const page = parseFloat(req.params.page);
	const count = parseInt(req.params.count);

	const queryObj = {
		filter: utils.tryParseJSON(req.query.filter) || {},
		sort: utils.tryParseJSON(req.query.sort) || {},
		skip: page * count,
		limit: count
	};

	const eagerLoading = req.query.eagerLoading === 'true' || false;

	componentsModule.getAllComponents(queryObj, eagerLoading, (error, components) => {
		if (error)
			return res.json(error.createApiResponse());

		res.json(components);
	});
});

router.get('/countComponents', (req, res) => {
	const filterObj = utils.tryParseJSON(req.query.filter) || {};

	componentsModule.countComponents(filterObj, (count) => {
		res.json(count);
	});
});

router.get('/getComponentsByTypeID/:componentTypeID', (req, res) => {
	let componentTypeID = req.params.componentTypeID;

	componentsModule.getComponentsByTypeID(componentTypeID, (results) => {
		res.json(results);
	});
});

module.exports = router;
