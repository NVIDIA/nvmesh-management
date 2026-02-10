/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var express = require('express');
var ObjectId = require('mongodb-legacy').ObjectId;

var utils = require('../utils.js');
var consts = require('../consts.js');
var logModule = require('../modules/log.js');
const validateProjection = require('../middlewares/validateProjection.js');
const isAdminRole = require('../middlewares/isAdminRole.js');
const { getCountEntitiesHandler } = require('./common.js');

var router = express.Router();

router.get('/', function(req, res) {
	var renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };
	renderData.componentName = consts.componentsPages.logs;

	res.render('react', renderData);
});

/**
* @apiVersion 17.0.0
* @api {get} /logs/all/:page/:count?filter={}&sort={} Get logs
* @apiName GetLogs
* @apiGroup logs
* @apiDescription Get `logs` by `page` and `count`.
*
* @apiParam {integer} page The `page` to fetch.
* @apiParam {integer} count Number of records per `page`.
* @apiParam {object} [filter] `Filter` before fetching. <small><i>--MongoDB filter obj</i></small>
* @apiParam {object} [sort] `Sort` before fetching. <small><i>--MongoDB sort obj</i></small>
* @apiParamExample {object[]} Example request
* /logs/all/0/2?filter={"level":"ERROR"}&sort={"timestamp":-1}
*
* @apiSuccess {object[]} logs List of `logs`.
*
* @apiSuccessExample Example data on success
* [{
* 	"_id": "55dc13db54e5bd8f4ecfd9fa",
* 	"message": "NIC: 0xfe80000000000000f452140300f543f1 reported error",
*	"rawMessage": "NIC: {} reported error",
* 	"timestamp": "2015-08-25T07:06:03.022Z",
* 	"level": "ERROR",
* 	"meta": {
* 		"header": "NIC failure",
* 		"acknowledged": true,
*		"link": { "entityType": "NIC", "entityText": "0xfe80000000000000f452140300f543f1" },
*		"managementID": "1.1.1.1:4000"
* 	}
* }, {
* 	"_id": "55d9de691978c3ac4195d800",
* 	"message": "NIC: 0xfe80000000000000f452140300f543f1 reported error",
*	"rawMessage": "NIC: {} reported error",
* 	"timestamp": "2015-08-23T14:53:29.868Z",
* 	"level": "ERROR",
* 	"meta": {
* 		"header": "NIC failure",
* 		"acknowledged": true,
*		"link": { "entityType": "NIC", "entityText": "0xfe80000000000000f452140300f543f1" }
*		"managementID": "1.1.1.1:4000"
* 	}
* }]
*/
router.get('/all/:page/:count', validateProjection, function(req, res) {
	var page = parseFloat(req.params.page);
	var count = parseInt(req.params.count);

	var query = {
		filter: utils.tryParseJSON(req.query.filter) || {},
		projection: utils.tryParseJSON(req.query.projection) || {},
		sort: utils.tryParseJSON(req.query.sort) || {},
		skip: page * count,
		limit: count
	};

	utils.loadCollection('log', query, (err, results) => {
		res.json(results);
	}, true);
});

/**
* @apiVersion 17.0.0
* @api {get} /logs/count Count logs
* @apiName CountLogs
* @apiGroup logs
* @apiDescription Get total `logs` count.
* @apiSuccess {integer} count `logs` count.
* @apiSuccessExample Example data on success
* 3606
*/
router.get('/count', getCountEntitiesHandler('log'));

/**
* @apiVersion 17.0.0
* @api {get} /logs/alerts/:page/:count?filter={}&sort={} Get alerts
* @apiName GetAlerts
* @apiGroup logs
* @apiDescription Get `alerts` by `page` and `count`. <small><i>--Alerts are errors that hasn't been acknowledged</i></small>
*
* @apiParam {integer} page The `page` to fetch.
* @apiParam {integer} count Number of records per `page`.
* @apiParam {object} [filter] `Filter` before fetching. <small><i>--MongoDB filter obj</i></small>
* @apiParam {object} [sort] `Sort` before fetching. <small><i>--MongoDB sort obj</i></small>
* @apiParamExample {object[]} Example request
* /logs/alerts/0/2?filter={}&sort={"timestamp":-1}
*
* @apiSuccess {object[]} alerts List of `alerts`.
*
* @apiSuccessExample Example data on success
* [{
* 	"_id": "55d46a6a05847d2d34f9f19b",
* 	"message": "Drive: CVMD438000BL400AGN.1 endurance is below 1%",
*	"rawMessage": "Drive: {} endurance is below 1%",
* 	"timestamp": "2015-08-19T11:37:14.300Z",
* 	"level": "ERROR",
* 	"meta": {
* 		"header": "Critical disk endurance",
* 		"acknowledged": false,
*		"link": { "entityType": "Disk", "entityText": "CVMD438000BL400AGN.1" }
*		"managementID": "1.1.1.1:4000"
* 	}
* },{
* 	"_id": "55d46a6a05847d2d34f9f19c",
* 	"message": "NIC: 0xfe80000000000000f452140300f54371 reported error",
*	"rawMessage": "NIC: {} reported error",
* 	"timestamp": "2015-08-19T11:37:14.300Z",
* 	"level": "ERROR",
* 	"meta": {
* 		"header": "NIC failure",
* 		"acknowledged": false,
*		"link": { "entityType": "NIC", "entityText": "0xfe80000000000000f452140300f54371" }
*		"managementID": "1.1.1.1:4000"
* 	}
* }]
*/
router.get('/alerts/:page/:count', function(req, res) {
	var page = 	parseFloat(req.params.page);
	var count = parseInt(req.params.count);

	var query = {
		filter: utils.tryParseJSON(req.query.filter) || {},
		sort: utils.tryParseJSON(req.query.sort) || {},
		projection: {},
		skip: page * count,
		limit: count
	};

	query.filter['meta.acknowledged'] = false;

	if (utils.isEmpty(query.filter['level']))
		query.filter['level'] = { $in: [consts.logsLevel.WARNING, consts.logsLevel.ERROR] };

	utils.loadCollection('log', query, function(err, results) {
		res.json(results);
	});
});

/**
* @apiVersion 17.0.0
* @api {get} /logs/alerts/count Count alerts
* @apiName CountAlerts
* @apiGroup logs
* @apiDescription Get total `alerts` count.
* @apiSuccess {integer} count `alerts` count.
* @apiSuccessExample Example data on success
* 122
*/
router.get('/alerts/count', getCountEntitiesHandler('log',
	{ level: { $in: [consts.logsLevel.WARNING, consts.logsLevel.ERROR] }, 'meta.acknowledged': false }));

/**
* @apiVersion 17.0.0
* @api {post} /logs/acknowledge Acknowledge logged alert
* @apiName AckLog
* @apiGroup logs
* @apiDescription Acknowledge a specified `log` by `ID`.
*
* @apiBody {object} Object including the `log ID` to acknowledge.
* @apiBody {string} id The `log ID` to acknowledge.
* @apiExample {object} Payload example
* {
*	"id": "55d46a6a05847d2d34f9f19c"
* }
* @apiSuccess {object} success status
* @apiSuccessExample Example data on success
* {
* 	"success": true,
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*   "_id": null,
*	"error": null,
*	"payload": null
* }*/
router.post('/acknowledge/', isAdminRole, function(req, res) {
	var logID = req.body.id;

	try {
		var objectId = new ObjectId(logID);
		logModule.acknowledgeById(objectId, req.user.email, function(err) {
			res.json(utils.createApiResponse(logID, null, !err, err || null));
		});
	} catch (e) {
		res.json(utils.createApiResponse(logID, null, false, e.message));
	}
});

/**
* @apiVersion 17.0.0
* @api {post} /logs/acknowledgeAll Acknowledge all logged alerts
* @apiName AckAll
* @apiGroup logs
* @apiDescription Acknowledge all logged alerts.
*
* @apiSuccessExample Example data on success
* {
* 	"success": true,
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*   "_id": null,
*	"error": null,
*	"payload": { "count": 10 }
* }
*/
router.post('/acknowledgeAll', isAdminRole, function(req, res) {
	logModule.acknowledgeAll(req.user.email, result => {
		res.json(utils.createApiResponse(null, null, result.success, null, { count: result.count }));
	});
});

/**
* @apiVersion 17.0.0
* @api {get} /logs/:id Get log by ID
* @apiName GetLog
* @apiGroup logs
* @apiDescription Get specific `log` by `ID`.
*
* @apiParam {string} id `log's ID` to fetch.
* @apiParamExample {string} Example request
* logs/661fbdbc078a05dced487817
* @apiSuccess {object} API Response
* @apiSuccessExample Example data on success
* {
*         "_id": "661fbdbc078a05dced487817",
*         "timestamp": "2024-04-17T12:17:00.152Z",
*         "level": "INFO",
*         "message": "id: 1056. targetID: nvme1039. NICID: 0x00000000000000009a039bfffea09956",
*         "meta": {
*             "header": "NIC went online",
*             "link": {
*                 "entityType": "NIC",
*                 "entityText": "0x00000000000000009a039bfffea09956",
*                 "target": "nvme1039"
*             },
*             "user": null,
*             "id": null,
*             "acknowledged": false,
*             "rawMessage": "id: 1056. targetID: nvme1039. NICID: 0x00000000000000009a039bfffea09956",
*             "managementID": "1.1.1.1:4000"
*         }
* }
*/
router.get('/:id', (req, res) => {
	logModule.fetchLogByID(req.params.id, (error, log) => {
		if (error)
			return res.json(error.createApiResponse());

		return res.json(log);
	});
});

module.exports = router;
