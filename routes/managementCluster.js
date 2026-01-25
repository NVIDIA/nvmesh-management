/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global app */

var express = require('express');

var utils = require('../utils.js');
var consts = require('../consts.js');
var managementClusterModule = require('../modules/managementCluster.js');
const isAdminRole = require('../middlewares/isAdminRole.js');
const { getCountEntitiesHandler } = require('./common.js');
const { Entities } = require('../modules/error.js');
const systemMessages = require('../systemMessages.js');
const { createAuditRequestLog } = require('../modules/log.js');

var router = express.Router();

router.get('/', function(req, res) {
	var renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };

	renderData.isReact = true;
	renderData.componentName = consts.componentsPages.managementCluster;

	res.render('react', renderData);
});

/**
* @apiVersion 1.0.0
* @api {get} /managementCluster/all/:page/:count?filter={}&sort={} Get Managements
* @apiName GetManagements
* @apiGroup managementCluster
* @apiDescription Get `managements` by `page` and `count`.
*
* @apiParam {integer} page The `page` number to fetch.
* @apiParam {integer} count Number of records per `page`.
* @apiParam {object} [filter] `Filter` before fetching. <small><i>--MongoDB filter obj</i></small>
* @apiParam {object} [sort] `Sort` before fetching. <small><i>--MongoDB sort obj</i></small>
* @apiSuccess {object[]} managementCluster List Of `managementCluster`.
*
* @apiSuccessExample Example data on success
* [
*     {
*         "_id": "10.240.18.209:4001",
*         "changeID": "\"I5eff5fc0bef19180190487dfbac46ba40d8a965b\"",
*         "dateModified": "2024-05-06T07:47:37.097Z",
*         "hostname": "nvme1039",
*         "ip": "10.240.18.209",
*         "managementVersion": "2.8.2-68.el8_6",
*         "port": 4001,
*         "useSSL": false,
*         "outbound_socket_status": "connected",
*         "inbound_socket_status": "connected"
*     }
* ]
*/
router.get('/all/:page/:count', function(req, res) {
	var page = parseInt(req.params.page);
	var count = parseInt(req.params.count);
	var outboundClusterConnections = app.get('mgmtOutboundClusterConnections');
	var inboundClusterConnections = app.get('mgmtInboundClusterConnections');
	var managementId = app.get('managementId');

	var query = {
		filter: utils.tryParseJSON(req.query.filter) || {},
		sort: utils.tryParseJSON(req.query.sort) || {},
		skip: page * count,
		limit: count
	};

	utils.loadCollection('managementCluster', query, function(err, results) {
		if (err)
			return res.json(err);

		results.forEach(function(mgmt) {
			if (mgmt._id === managementId)
				mgmt.isMe = true;

			if (mgmt._id in outboundClusterConnections)
				mgmt.outbound_socket_status = outboundClusterConnections[mgmt._id].status;
			else
				mgmt.outbound_socket_status = consts.socketStatus.DISCONNECTED;

			if (mgmt._id in inboundClusterConnections)
				mgmt.inbound_socket_status = consts.socketStatus.CONNECTED;
			else
				mgmt.inbound_socket_status = consts.socketStatus.DISCONNECTED;
		});

		res.json(results);
	});
});

/**
* @apiVersion 1.0.0
* @api {get} /managementCluster/count Count managements
* @apiName CountManagements
* @apiGroup managementCluster
* @apiDescription Get total `management` count.
*
* @apiSuccess {integer} count `managementCluster` count.
*
* @apiSuccessExample Example data on success
* 3
*/
router.get('/count', getCountEntitiesHandler('managementCluster'));

/**
* @apiVersion 1.0.0
* @api {post} /managementCluster/delete Delete management
* @apiName DeleteManagement
* @apiGroup managementCluster
* @apiDescription Delete `managementCluster`.
*
* @apiParam {string[]} _id The `id[s]` of the `managementCluster[s]` to delete.
* @apiParamExample {string[]} Payload example
* ["nvme1038:4001"]
*
* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* [{
*	"_id": "nvme1038:4001",
*   "uuid": "null",
*	"success": true,
*	"error": null,
*	"payload": null
* }]
*/
router.post('/delete', isAdminRole, function(req, res) {
	const managementIds = req.body;

	const incomingRequestSystemAdminMessages = managementIds.map(managementId =>
		createAuditRequestLog(req, systemMessages.MANAGEMENT_CLUSTER_DELETE_REQUEST)
			.addInfo(Entities.ManagementID, managementId));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => managementClusterModule.deleteManagementsFromCluster(managementIds, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.ManagementID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {get} /managementCluster/:id Get management by ID
* @apiName GetManagement
* @apiGroup managementCluster
* @apiDescription Get specific `management` by `ID`.
*
* @apiParam {string} management `management's ID` to fetch.
* @apiParamExample {string} Example request
* managementCluster/192.168.75.159:4001
*
* @apiSuccess {object} API Response
*
* @apiSuccessExample Example data on success
* {
*         "_id": "192.168.75.159:4001",
*         "changeID": "\"Ie7efcb3f01a43971a1f28723bb26eb51b9dba079\"",
*         "dateModified": "2024-05-01T14:25:36.449Z",
*         "hostname": "nvme1038.rpff",
*         "ip": "192.168.75.159",
*         "managementVersion": "2.8.0-18",
*         "port": 4001,
*         "useSSL": false
* }
*/
router.get('/:id', (req, res) => {
	managementClusterModule.fetchManagementClusterByID(req.params.id, (error, managementCluster) => {
		if (error)
			return res.json(error.createApiResponse());

		return res.json(managementCluster);
	});
});

module.exports = router;
