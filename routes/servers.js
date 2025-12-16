/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* global app */

var express = require('express');

var utils = require('../utils.js');
var consts = require('../consts.js');
var targetModule = require('../modules/target.js');

var systemMessages = require('../systemMessages.js');
var { MongoError, Entities, getNICID } = require('../modules/error.js');
const { createAuditRequestLog } = require('../modules/log.js');
const validateProjection = require('../middlewares/validateProjection.js');
const isAdminRole = require('../middlewares/isAdminRole.js');
const { getCountEntitiesHandler } = require('./common.js');

var router = express.Router();


router.get('/', function(req, res) {
	var db = app.get('db');
	var server = db.collection('server');
	var renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };

	var id = req.query.id;

	if (id) {
		server.findOne({ _id: id }, function(data) {
			renderData.server = data;
			res.render('server', renderData);
		});
	} else {
		renderData.isReact = true;
		renderData.componentName = consts.componentsPages.targets;

		res.render('react', renderData);
	}
});

/**
* @apiVersion 1.0.0
* @api {get} /servers/count Count servers
* @apiName CountServers
* @apiGroup servers
* @apiDescription Get total `servers` count.
*
* @apiSuccess {integer} count `servers` count.
*
* @apiSuccessExample Example data on success
* 14
*/
router.get('/count', getCountEntitiesHandler('server', {}, { node_status: { $ne: consts.nodeStatus.DELETING } }));

router.get('/getAllocationByTarget', function(req, res) {
	targetModule.getAllocationByTarget(function(data) {
		res.json(data);
	});
});

router.get('/server/:id', function(req, res) {
	var db = app.get('db');
	var server = db.collection('server');
	var renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };

	var id = req.params.id;

	server.findOne({ _id: id }, { _id: 0, node_id: 1 }, function(err, data) {
		if (err)
			new MongoError(err).log();

		renderData.server = data;
		renderData.isReact = true;
		renderData.componentName = consts.componentsPages.target;

		res.render('react', renderData);
	});
});

/**
* @apiVersion 1.0.0
* @api {post} /servers/delete Delete servers
* @apiName DeleteServers
* @apiGroup servers
* @apiDescription Delete `servers`. <small><i>--Server won't be deleted if a volume is dependent on it.</i></small>
*
* @apiParam {object[]} servers `servers` to delete.
* @apiParam {string} delete._id The `ID` of the `server` to delete.
* @apiParam {string} delete.uuid The `UUID` of the `server` to delete.
* @apiParamExample {string} Payload example
* [{
*		"_id": "nvme50.excelero.com",
*		"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398",
* }]
*
* @apiSuccess {object[]} servers The servers requested for deletion.
* @apiSuccess {string} servers.id The `node_id` of the `server` requested for deletion.
* @apiSuccess {boolean} servers.success Indication whether `server` deletion succeeded or not.<br />
* <small><i>`true` if succeeded, `false` if failed.</i></small>
*
* @apiSuccessExample Example data on success
* [{
*	"_id": "nvme50.excelero.com",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*	"success": true,
*	"error": null,
*	"payload": null
* }]
*/
router.post('/delete', isAdminRole, function(req, res) {
	const targets = req.body;

	const incomingRequestSystemAdminMessages = targets.map(({ _id, uuid }) => createAuditRequestLog(req, systemMessages.SERVER_DELETE_REQUEST)
		.addInfo(Entities.Target.ID, _id).addInfo(Entities.Target.UUID, uuid));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => targetModule.deleteTargets(targets, false, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Target.ID, Entities.Target.UUID))));
});

/**
* @apiVersion 1.0.0
* @api {post} /servers/evict Evict servers
* @apiName EvictServers
* @apiGroup servers
* @apiDescription Evict `servers` will delete a server while evicting all of it's drives.
* <small><i>--Server won't be evicted if one of it's drives cannot be evicted.</i></small>
*
* @apiParam {object[]} servers `servers` to evict.
* @apiParam {string} evict._id The `ID` of the `server` to evict.
* @apiParam {string} evict.uuid The `UUID` of the `server` to evict.
* @apiParamExample {string} Payload example
* [{
*		"_id": "nvme50.excelero.com"
*		"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398",
* }]
*
* @apiSuccess {object[]} servers The servers requested for eviction.
* @apiSuccess {string} servers.id The `node_id` of the `server` requested for eviction.
* @apiSuccess {boolean} servers.success Indication whether `server` eviction succeeded or not.<br />
* <small><i>`true` if succeeded, `false` if failed.</i></small>
*
* @apiSuccessExample Example data on success
* [{
*	"_id": "nvme50.excelero.com",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*	"success": true,
*	"error": null,
*	"payload": null
* }]
*/
router.post('/evict', isAdminRole, function(req, res) {
	const targets = req.body;
	const incomingRequestSystemAdminMessages = targets.map(({ _id, uuid }) => createAuditRequestLog(req, systemMessages.SERVER_EVICT_REQUEST)
		.addInfo(Entities.Target.ID, _id).addInfo(Entities.Target.UUID, uuid));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => targetModule.deleteTargets(targets, true, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Target.ID, Entities.Target.UUID))));
});

//Get total space.
router.post('/totalSpace', function(req, res) {
	const { nodes, disks, onlyEC, vpg, allowAllocationOnOfflineDrives } = req.body;

	targetModule.getTotalSpace(nodes, disks, vpg, onlyEC, allowAllocationOnOfflineDrives, function(data) {
		res.json(data);
	});
});

//Get total allocated space.
router.post('/allocatedSpace', function(req, res) {
	const { nodes, disks, onlyEC, vpg, allowAllocationOnOfflineDrives } = req.body;

	targetModule.getAllocatedSpace(nodes, disks, vpg, onlyEC, allowAllocationOnOfflineDrives, function(data) {
		res.json(data);
	});
});

//Get the available mirrors by capacity
router.post('/availableMirrors/:capacity', function(req, res) {
	var capacity = parseInt(req.params.capacity);
	var limitNodes = req.body.nodes;
	var limitDisks = req.body.disks;
	var vpg = req.body.vpg;
	var allowAllocationOnOfflineDrives = req.body.allowAllocationOnOfflineDrives;

	targetModule.getAvailableMirrorsCount(capacity, limitNodes, limitDisks, vpg, allowAllocationOnOfflineDrives, function(data) {
		res.json(data);
	});
});

/**
* @apiVersion 1.0.0
* @api {post} /servers/deleteNic Delete NIC by ID
* @apiName DeleteNic
* @apiGroup servers
* @apiDescription Delete specific `NIC` by `ID`. <small><i>--`NIC` can only be deleted if its `status` is `Missing` on the specified `target`.</i></small>
*
* @apiParam {object[]} servers `servers` to delete `NIC` from.
* @apiParam {string} delete.targetID The `ID` of the `server` to delete `NIC` from.
* @apiParam {string} delete.targetUUID The `UUID` of the `server` to delete `NIC` from.
* @apiParamExample {string} Payload example
* [{
* 	"nicID": "0xfe80000000000000001e670300932499",
*	"targetID": "nvme47.excelero.com"
*	"targetUUID": "05457a00-7a13-11ed-a3a5-2dd1199d2398",
* }]
* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* {
*	"_id": "0xfe80000000000000001e670300932499",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*	"success": true,
*	"error": null,
*	"payload": null
* }
*/
router.post('/deleteNic', isAdminRole, function(req, res) {
	const targets = req.body;
	const incomingRequestSystemAdminMessages = targets.map(({ targetID, targetUUID, nicID }) =>
		createAuditRequestLog(req, systemMessages.SERVER_DELETE_NIC_REQUEST)
			.addInfo(Entities.Target.ID, targetID)
			.addInfo(Entities.Target.UUID, targetUUID)
			.addInfo(Entities.NIC.ID, getNICID(nicID, targetID)));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => targetModule.deleteNICs(targets, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.NIC.ID, Entities.Target.UUID))));
});

/**
* @apiVersion 1.0.0
* @api {get} /servers/all/:page/:count?filter={}&sort={} Get servers
* @apiName GetServers
* @apiGroup servers
* @apiDescription Get `servers` by `page` and `count`.
*
* @apiParam {integer} page The `page` to fetch.
* @apiParam {integer} count Number of records per `page`.
* @apiParam {object} [filter] `Filter` before fetching. <small><i>--MongoDB filter obj.</i></small>
* @apiParam {object} [sort] `Sort` before fetching. <small><i>--MongoDB sort obj.</i></small>
* @apiParamExample {object[]} Example request
* /servers/all/0/2?filter={"node_id":"nvme50.excelero.com"}&sort={"node_status":-1}
*
* @apiSuccess {object[]} servers List of `servers`.
*
* @apiSuccessExample Example data on success
* [{
* 	"_id": "55d9dd3d1978c3ac4195d7ea",
* 	"node_id": "nvme50.excelero.com",
* 	"node_status": 1,
* 	"nics": [{
* 		"nicID": "0xfe80000000000000f452140300f555e1"
* 	}],
* 	"disks":[{
* 		"diskID": "CVCQ5246004B400AGN.1"
* 	}, {
* 		"diskID": "CVCQ523400G9400AGN.1"
* 	}, {
* 		"diskID": "CVCQ5245007Y400AGN.1"
* 	}, {
* 		"diskID": "CVCQ5246003Z400AGN.1"
* 	}, {
* 		"diskID": "CVCQ5246003L400AGN.1"
* 	}],
* 	"dateModified": "2015-08-23T14:48:29.936Z"
* }]
*/
router.get('/all/:page/:count', validateProjection, function(req, res) {
	const page = parseFloat(req.params.page);
	const count = parseInt(req.params.count);
	const filter = utils.tryParseJSON(req.query.filter) || {};
	const sort = utils.tryParseJSON(req.query.sort) || {};
	const projection = utils.tryParseJSON(req.query.projection) ||	{
		'node_id': 1,
		'zone': 1,
		'uuid': 1,
		'version': 1,
		'node_status': 1,
		'isPending': 1,
		'dateModified': 1,
		'disks.diskID': 1,
		'nics.nicID': 1,
		'health': 1,
		'tomaStatus': 1,
		'configProfile': 1,
		'restartRequired': 1,
		'leaderUUID': 1
	};

	if (!filter['node_status'])
		filter['node_status'] = { $ne: consts.nodeStatus.DELETING };

	const query = { filter, projection, sort, skip: page * count, limit: count };

	utils.loadCollection('server', query, (err, results) => res.json(results));
});

router.post('/byRegex', function(req, res) {
	var db = app.get('db');
	var serverCollection = db.collection('server');

	var regex = req.body.regex;

	serverCollection.find({ node_id: { $regex: regex } }).project({ node_id: 1 }).toArray(function(err, results) {
		if (err)
			new MongoError(err).log();

		res.json(results);
	});
});

/**
* @apiVersion 1.0.0
* @api {post} /servers/setZone Assign servers to Zone ID
* @apiName SetZone
* @apiGroup servers
* @apiDescription Assign Zone to a list of `servers`;
*
* @apiParam {string} zoneID `ID` of the zone to assign to.
* @apiParam {object[]} targets `targets`'s of the `Target`s to be assigned.
* @apiParam {string} target._id The `ID` of the `target`.
* @apiParam {string} target.uuid The `UUID` of the `target`.
* @apiParamExample  {object} Payload example
* {
* 	"zoneID": "10",
*	"targets": [{
*		"_id": "nvme50.excelero.com",
*		"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398",
* 	}]
* }
* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* [{
*	"_id": "nvme1038.nvidia.com",
*   "uuid": null,
*	"success": true,
*	"error": null,
*	"payload": null
* }]
*/
router.post('/setZone', isAdminRole, (req, res) => {
	const { targets, zoneID } = req.body;

	const incomingRequestSystemAdminMessages = targets.map(({ _id, uuid }) => createAuditRequestLog(req, systemMessages.SET_ZONE_REQUEST)
		.addInfo(Entities.Target.zone, zoneID).addInfo(Entities.Target.ID, _id).addInfo(Entities.Target.UUID, uuid));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => targetModule.setZone(targets, zoneID.toString(), cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Target.ID, Entities.Target.UUID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {post} /servers/regenerateTOMAMessages Regenerate TOMA messages by Zone ID
* @apiName RegenerateTOMAMessages
* @apiGroup servers
* @apiDescription Regenerate TOMA messages by Zone ID
*
* @apiParam {string} zoneID `ID` of the zone to regenerate TOMA messages from.
* @apiParamExample  {object} Payload example
* {
* 	"zoneID": "10",
* }
* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* {
*	"_id": "10",
*   "uuid": null,
*	"success": true,
*	"error": null,
*	"payload": null
* }
*/
router.post('/regenerateTOMAMessages', isAdminRole, (req, res) => {
	let { zoneID } = req.body;

	let incomingRequestSystemAdminMessage = createAuditRequestLog(req, systemMessages.REGEN_TOMA_MSGS_REQUEST)
		.addInfo(Entities.Target.zone, zoneID);

	utils.handleRESTAndLog(
		[incomingRequestSystemAdminMessage],
		cb => targetModule.regenerateTOMAMessages(zoneID.toString(), cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Target.zone)))
	);
});

/**
* @apiVersion 1.0.0
* @api {get} /servers/:id Get server by ID
* @apiName GetServer
* @apiGroup servers
* @apiDescription Get specific `server` by `ID`.
*
* @apiParam {string} server `server's ID` to fetch.
* @apiParamExample {string} Example request
* servers/nvme1039
*
* @apiSuccess {object} API Response
*
* @apiSuccessExample Example data on success
* {
*         "_id": "nvme1039",
*         "node_id": "nvme1039",
*         "uuid": "0b0bb5f0-fbc5-11ee-b7a0-15f31bb23eb6",
*         "disks": [],
*         "nics": [
*             {
*                 "nicID": "0x00000000000000009a039bfffea09956",
*                 "protocol": "RoCE",
*                 "status": "Ok",
*                 "guid": "0x00000000000000000000ffff01010102",
*                 "pkey": 65535,
*                 "pci_root": 0,
*                 "mtu": 1024,
*                 "deviceType": "mlx5_0",
*                 "version": 1,
*                 "uuid": "0d906500-fbc5-11ee-b7a0-15f31bb23eb6",
*                 "nodeUUID": "0b0bb5f0-fbc5-11ee-b7a0-15f31bb23eb6",
*                 "nodeID": "nvme1039",
*                 "health": "healthy"
*             }
*         ],
*         "isPending": false,
*         "restartRequired": false,
*         "lastReceivedTomaKeepAlive": "2024-04-17T12:29:13.110Z",
*         "dateModified": "2024-04-17T12:29:13.110Z",
*         "tomaStatus": "down",
*         "node_status": null,
*         "kafkaMessageSequence": {
*             "keepalive": 0,
*             "reportTarget": 0
*         },
*         "health": "critical",
*         "tomaToken": 8,
*         "branch": "master",
*         "commit": "d796a0b79424281cc07540489d372b27584d04d5",
*         "configProfile": {
*             "id": "cd337070-fcb3-11ee-b01f-e19dd52b26f7",
*             "name": "Cluster Default",
*             "version": "1"
*         },
*         "health_old": "healthy",
*         "isTargetUpdateSequenceInc": true,
*         "lastReceivedReport": "2024-04-17T12:28:15.065Z",
*         "version": "2.8.0-542.el8",
*         "zone": "1"
* }
*/
router.get('/:id', (req, res) => {
	targetModule.fetchServerByID(req.params.id, (error, server) => {
		if (error)
			return res.json(error.createApiResponse());

		return res.json(server);
	});
});

module.exports = router;
