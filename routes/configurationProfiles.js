/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


var express = require('express');

var configProfilesModule = require('../modules/configurationProfiles.js');
var consts = require('../consts.js');
var utils = require('../utils.js');

var systemMessages = require('../systemMessages.js');
var { Entities } = require('../modules/error.js');
const { createAuditRequestLog } = require('../modules/log.js');
const validateProjection = require('../middlewares/validateProjection.js');
const isAdminRole = require('../middlewares/isAdminRole.js');
const { getCountEntitiesHandler } = require('./common.js');

var router = express.Router();
module.exports = router;

router.get('/', function(req, res) {
	var renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };

	if (consts.userRoles.ADMIN === req.user.role) {
		renderData.isReact = true;
		renderData.componentName = consts.componentsPages.configurationProfiles;

		res.render('react', renderData);
	} else
		res.send('insufficient privileges');
});


/**
 * @apiVersion 1.0.0
 * @api {get} /configurationProfiles/nodeConfig/:page/:count Get nodeConfiguration entry
 * @apiName GetNodeConfiguration
 * @apiGroup configurationProfiles
 * @apiDescription Get list of NodeConfiguration entries
 *
 * @apiParam {integer} page The `page` number to fetch.
 * @apiParam {integer} count Number of records per `page`.
 * @apiParam {object} [filter] `Filter` before fetching. <small><i>--MongoDB filter obj</i></small>
 * @apiParam {object} [sort] `Sort` before fetching. <small><i>--MongoDB sort obj</i></small>
 * @apiParamExample {string} Example request
 * /configurationProfiles/nodeConfig/0/0?filter={'profile.id':profileID}
 *
 * @apiSuccess {object} API Response
 *
 * @apiSuccessExample Example data on success
 * [{
 *   "_id": "scale-1",
 *   "desiredProfile": {
 *     "id": "29c6b100-8c59-11ef-8e35-0bd0249fb0c6",
 *     "name": "Cluster Default",
 *     "version": 2
 *   },
 *   "status": "restartRequired",
 *   "userOverride": false
 * }]
 */
router.get('/nodeConfig/:page/:count', function(req, res) {
	var page = parseInt(req.params.page);
	var count = parseInt(req.params.count);

	var query = {
		filter: utils.tryParseJSON(req.query.filter) || {},
		projection: utils.tryParseJSON(req.query.projection) || {},
		sort: utils.tryParseJSON(req.query.sort) || {},
		skip: page * count,
		limit: count
	};

	utils.loadCollection('nodeConfiguration', query, function(err, results) {
		if (err)
			return res.json({ error: err });

		res.json(results);
	});
});

router.use(isAdminRole);

router.get('/fromNodeConfiguration/:clientOrTarget/:nodeID', function(req, res) {
	var clientOrTarget = req.params.clientOrTarget;
	var nodeID = req.params.nodeID;

	configProfilesModule.fromNodeConfiguration(nodeID, clientOrTarget, function(err, config) {
		if (err)
			return res.json({ error: err });

		res.json({ config: config || {} });
	});
});

/**
* @apiVersion 1.0.0
* @api {get} /configurationProfiles/all Get Configuration Profile
* @apiName GetConfigurationProfiles
* @apiGroup configurationProfiles
* @apiDescription Get all `configurationProfiles`.
*
* @apiSuccess {object[]} configurationProfiles List Of `configurationProfiles`.
*
* @apiSuccessExample Example data on success
*[
*    {
*        "_id": "NVMesh Default",
*        "name": "NVMesh Default",
*        "config": {
*            "IPV4_ONLY": true,
*            "TCP_ENABLED": false,
*            "DUMP_FTRACE_ON_OOPS": false,
*            "MCS_LOGGING_LEVEL": "INFO",
*            "AGENT_LOGGING_LEVEL": "INFO",
*        },
*        "createdBy": "admin@nvidia.com",
*        "dateCreated": "2021-03-16T10:29:52.650Z",
*        "dateModified": "2021-03-16T10:29:52.650Z",
*        "deleteNotAllowed": true,
*        "editNotAllowed": true,
*        "hosts": [],
*        "labels": [],
*        "modifiedBy": "admin@nvidia.com",
*        "uuid": "nvmesh_default",
*        "version": 1
*    },
*    {
*        "_id": "Cluster Default",
*        "name": "Cluster Default",
*        "config": {
*            "IPV4_ONLY": true,
*            "DUMP_FTRACE_ON_OOPS": false,
*            "MCS_LOGGING_LEVEL": "INFO",
*            "AGENT_LOGGING_LEVEL": "INFO",
*        },
*        "createdBy": "admin@nvidia.com",
*        "dateCreated": "2021-03-16T10:29:52.737Z",
*        "dateModified": "2021-03-16T10:29:52.737Z",
*        "deleteNotAllowed": true,
*        "editNotAllowed": false,
*        "hosts": [],
*        "labels": [],
*        "modifiedBy": "admin@nvidia.com",
*        "uuid": "cluster_default",
*        "version": 1
*    },
*    {
*        "_id": "NVMesh Debug",
*        "name": "NVMesh Debug",
*        "config": {
*            "DUMP_FTRACE_ON_OOPS": true,
*            "MCS_LOGGING_LEVEL": "DEBUG",
*            "AGENT_LOGGING_LEVEL": "DEBUG"
*        },
*        "createdBy": "admin@nvidia.com",
*        "dateCreated": "2021-03-16T10:29:52.737Z",
*        "dateModified": "2021-03-16T10:29:52.737Z",
*        "deleteNotAllowed": true,
*        "editNotAllowed": false,
*        "hosts": [],
*        "labels": [],
*        "modifiedBy": "admin@nvidia.com",
*        "uuid": "nvmesh_debug",
*        "version": 1
*    }
*]
*/
router.get('/all/:page/:count', validateProjection, function(req, res) {
	var page = parseInt(req.params.page);
	var count = parseInt(req.params.count);

	var query = {
		filter: utils.tryParseJSON(req.query.filter) || {},
		projection: utils.tryParseJSON(req.query.projection) || {},
		sort: utils.tryParseJSON(req.query.sort) || {},
		skip: page * count,
		limit: count
	};

	utils.loadCollection('configurationProfile', query, function(err, results) { res.json(results); });
});

/**
* @apiVersion 1.0.0
* @api {get} /configurationProfiles/count Count Configuration Profile
* @apiName CountConfigurationProfiles
* @apiGroup configurationProfiles
* @apiDescription Get total `configurationProfiles` count.
*
* @apiSuccess {integer} count `configurationProfiles` count.
*
* @apiSuccessExample Example data on success
* 4
*/
router.get('/count', getCountEntitiesHandler('configurationProfile'));

/**
* @apiVersion 1.0.0
* @api {post} /configurationProfiles/save Save Configuration Profile
* @apiName SaveConfigurationProfile
* @apiGroup configurationProfiles
* @apiDescription Save Configuration Profile.
*
* @apiParam {object[]} configuration profiles `configuration profiles` to create.
* @apiParam {string} configurationProfiles.name The Name of the `configuration profiles`.<br />
* @apiParam {string} [configurationProfiles.description] The Description of the `configuration profiles`.<br />
* @apiParam {string[]} [configurationProfiles.labels] The Labels of the `configuration profiles`.<br />
* @apiParam {object[]} [configurationProfiles.config] The Configuration to be assigned to the `configuration profiles`.<br />
* <small><i>Options: `KAFKA_SERVERS`, `MANAGEMENT_SERVERS`, `CONFIGURED_NICS`, `IPV4_ONLY`,
*  `MAX_SM_QUERY_BURST`, `TCP_ENABLED`, `DUMP_FTRACE_ON_OOPS`,
*  `MCS_LOGGING_LEVEL`, `MCS_LOGGING_VERBOSE_TYPES`, `AGENT_LOGGING_LEVEL`</i></small>
* @apiParamExample {string} Payload example
* [{
*		"name": "NVMesh GPU Clients",
*		"description": "Plain text",
*		"labels": [""],
*		"config": { "IPV4_ONLY": true }
* }]
*

* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* [{
* 		"_id": "NVMesh GPU Clients",
*       "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
* 		"success": true,
*		"error": null,
* 		"payload": null
* }]
*/
router.post('/save', (req, res) => {
	let configurationProfiles = req.body;

	let incomingRequestSystemAdminMessages = configurationProfiles.map(configurationProfile => {
		let message = createAuditRequestLog(req, systemMessages.CONFIG_PROFILE_SAVE_REQUEST)
			.addInfo(Entities.ConfigurationProfile.name, configurationProfile.name);

		if (configurationProfile.config)
			message.addInfo(Entities.ConfigurationProfile.config, configurationProfile.config);

		if (configurationProfile.labels)
			message.addInfo(Entities.ConfigurationProfile.labels, configurationProfile.labels);

		return message;
	});


	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => configProfilesModule.save(configurationProfiles, req.user, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.ConfigurationProfile.ID, Entities.ConfigurationProfile.UUID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {post} /configurationProfiles/delete Delete configurationProfiles
* @apiName DeleteConfigurationProfiles
* @apiGroup configurationProfiles
* @apiDescription Delete `configurationProfiles`.
*
* @apiParam {object[]} configurationProfiles `configurationProfiles` to delete.
* @apiParam {string} _id The `_id` of the `configurationProfiles` to delete.
* @apiParam {string} uuid The `uuid` of the `configurationProfiles` to delete.
* @apiParamExample {object[]} Payload example
* [{
* 	"_id": "My Profile"
* 	"uuid": "aa5026d0-7acc-11ed-a2de-b131fa9cd898"
* }]
*
* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* [{
*	"_id": "My Profile",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*	"success": true,
*	"error": null,
*	"payload": null
* }]
*/
router.post('/delete', function(req, res) {
	let configurationProfiles = req.body;

	let incomingRequestSystemAdminMessages = configurationProfiles.map(configurationProfile =>
		createAuditRequestLog(req, systemMessages.CONFIG_PROFILE_DELETE_REQUEST)
			.addInfo(Entities.ConfigurationProfile.ID, configurationProfile._id)
			.addInfo(Entities.ConfigurationProfile.UUID, configurationProfile.uuid));


	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => configProfilesModule.delete(configurationProfiles, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.ConfigurationProfile.ID, Entities.ConfigurationProfile.UUID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {post} /configurationProfiles/update Update Configuration Profile
* @apiName UpdateConfigurationProfile
* @apiGroup configurationProfiles
* @apiDescription Update Configuration Profile.
*
* @apiParam {object[]} configuration profiles `configuration profiles` to update.
* @apiParam {string} configurationProfiles.name The Name of the `configuration profiles`.<br />
* @apiParam {string} [configurationProfiles.description] The Description of the `configuration profiles`.<br />
* @apiParam {string[]} [configurationProfiles.labels] The Labels of the `configuration profiles`.<br />
* @apiParam {object[]} [configurationProfiles.config] The Configuration to be assigned to the `configuration profiles`.<br />
* <small><i>Options: `MANAGEMENT_SERVERS`, `CONFIGURED_NICS`, `IPV4_ONLY`,
*  `MAX_SM_QUERY_BURST`, `TCP_ENABLED`, `DUMP_FTRACE_ON_OOPS`,
*  `MCS_LOGGING_LEVEL`, `MCS_LOGGING_VERBOSE_TYPES`, `AGENT_LOGGING_LEVEL`</i></small>
* @apiParamExample {string} Payload example
* [{
*		"name": "NVMesh GPU Clients",
*		"description": "Plain text",
*		"labels": [""],
*		"config": { "IPV4_ONLY": true }
* }]
*

* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* [{
* 		"_id": "NVMesh GPU Clients",
*       "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
* 		"success": true,
*		"error": null,
* 		"payload": null
* }]
*/
router.post('/update', (req, res) => {
	let configurationProfiles = req.body;

	let incomingRequestSystemAdminMessages = configurationProfiles.map(configurationProfile => {
		let message = createAuditRequestLog(req, systemMessages.CONFIG_PROFILE_UPDATE_REQUEST)
			.addInfo(Entities.ConfigurationProfile.name, configurationProfile.name)
			.addInfo(Entities.ConfigurationProfile.UUID, configurationProfile.uuid);

		if (configurationProfile.config)
			message.addInfo(Entities.ConfigurationProfile.config, configurationProfile.config);

		if (configurationProfile.labels)
			message.addInfo(Entities.ConfigurationProfile.labels, configurationProfile.labels);

		return message;
	});


	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => configProfilesModule.updateConfigurationProfiles(configurationProfiles, req.user, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.ConfigurationProfile.ID, Entities.ConfigurationProfile.UUID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {post} /configurationProfiles/apply Applies a Configuration Profile to a set of nodes
* @apiName ApplyConfigurationProfile
* @apiGroup configurationProfiles
* @apiDescription Apply Configuration Profile.
*
* @apiParam {string} name The name of the `configuration profile` to apply.
* @apiParam {string} uuid The UUID of the `configuration profile` to apply.<br />
* @apiParam {string[]} nodeIDs A list of nodes to apply the profile to.<br />
* @apiParamExample {string} Payload example
* {
*		"name": "NVMesh GPU Clients",
*		"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb"
*		"nodeIDs": [
*			"gpu-worker1",
*			"gpu-worker2"
*		]
* }
*

* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* [{
* 		"_id": "NVMesh GPU Clients",
*       "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
* 		"success": true,
*		"error": null,
* 		"payload": null
* }]
*/
router.post('/apply', function(req, res) {
	let { name, uuid, nodeIDs } = req.body;
	let profile = { name, uuid };

	let requestLog = createAuditRequestLog(req, systemMessages.CONFIG_PROFILE_APPLY_REQUEST)
		.addInfo(Entities.ConfigurationProfile.name, name)
		.addInfo(Entities.ConfigurationProfile.UUID, uuid);

	nodeIDs.forEach(nodeID => requestLog.addInfo(Entities.Client.ID, nodeID));

	utils.handleRESTAndLog(
		[requestLog],
		cb => configProfilesModule.apply(profile, nodeIDs, req.user, cb),
		systemAdminMessages =>
			res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.ConfigurationProfile.ID, Entities.ConfigurationProfile.UUID))[0])
	);
});

/**
* @apiVersion 1.0.0
* @api {get} /configurationProfiles/:id Get configurationProfile by ID
* @apiName GetConfigurationProfile
* @apiGroup configurationProfiles
* @apiDescription Get specific `configurationProfile` by `ID`.
*
* @apiParam {string} configurationProfile `configurationProfile's ID` to fetch.
* @apiParamExample {string} Example request
* configurationProfiles/NVMesh Debug
*
* @apiSuccess {object} API Response
*
* @apiSuccessExample Example data on success
* {
*         "_id": "NVMesh Debug",
*         "name": "NVMesh Debug",
*         "config": {
*             "DUMP_FTRACE_ON_OOPS": true,
*             "MCS_LOGGING_LEVEL": "DEBUG",
*             "AGENT_LOGGING_LEVEL": "DEBUG"
*         },
*         "createdBy": "admin@nvidia.com",
*         "dateCreated": "2024-04-17T12:17:03.926Z",
*         "dateModified": "2024-04-17T12:17:03.926Z",
*         "deleteNotAllowed": true,
*         "editNotAllowed": false,
*         "hosts": [],
*         "labels": [],
*         "modifiedBy": "admin@nvidia.com",
*         "uuid": "66835560-fcb4-11ee-8738-d72aa6bb8f40",
*         "version": 1
* }
*/
router.get('/:id', (req, res) => {
	configProfilesModule.fetchProfileByID(req.params.id, (error, profile) => {
		if (error)
			return res.json(error.createApiResponse());

		return res.json(profile);
	});
});
