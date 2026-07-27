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
var async = require('async');

var utils = require('../utils.js');
var logger = require('../logger.js');
var events = require('../events.js');
var objectNotifier = require('../objectNotifier.js');
var websocketCommon = require('../modules/websocketCommon.js');
var volumeModule = require('../modules/volume.js');
var config = require('../modules/config.js');
var nvmeshMetadata = require('../modules/nvmeshMetadata.js');
var consts = require('../consts.js');

var router = express.Router();

var { SystemMessage, Entities, SystemAdminMessage } = require('../modules/error.js');

var systemMessages = require('../systemMessages.js');
const isDeprecated = require('../middlewares/isDeprecated.js');

/* GET home page. */
router.get('/', function(req, res) {
	var renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = {
		email: req.user.email,
		isAdmin: req.user.role === consts.userRoles.ADMIN
	};

	renderData.isReact = true;
	renderData.componentName = consts.componentsPages.dashboard;

	res.render('react', renderData);
});


router.post('/isAdminPassword', function(req, res) {
	utils.isAdminPassword(req.user.email, req.body.password, function(err, user) {
		if (err)
			new SystemAdminMessage(systemMessages.INDEX_FAILED_TO_CHECK_ADMIN_PASSWORD).addInfo(Entities.Error, err).log();

		res.json(user);
	});
});

router.post('/isEmailValid', function(req, res) {
	utils.isEmailValid(req.body.email, function(err, user) {
		if (err)
			new SystemAdminMessage(systemMessages.INDEX_FAILED_TO_CHECK_CONFIRMATION_EMAIL)
				.addInfo(Entities.Error, err).log();

		res.json(user);
	});
});

/* GET About page. */
router.get('/about', function(req, res) {
	var renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };
	renderData.isReact = true;
	renderData.componentName = consts.componentsPages.about;

	res.render('react', renderData);
});

router.post('/triggerEvent', function(req, res) {
	var ids = req.body.ids;
	var eventName = req.body.event;
	var eventData = req.body.data;

	var event = objectNotifier.getEventByName(eventName);

	events.emitEvent(ids, event, eventData);

	res.json();
});

router.post('/registerToEvent', function(req, res) {
	var id = 'HTTP_ROUTE_TESTING';
	var eventName = req.body.event;

	websocketCommon.unregisterFromEvents(id, 'REST', eventName, true);

	websocketCommon.registerToEvents(id, 'REST', eventName, true, function(data) {
		res.json(data);
	});
});

function getCounters(cb) {
	async.parallel({
		volumeCount: function(callback) {
			volumeModule.calculateVolumeCounters((err, obj) => {
				callback(err, obj);
			});
		},
		serverCount: function(callback) {
			objectNotifier.getObject(objectNotifier.events.serversCountChangeEvent.name, function(err, obj) {
				callback(err, obj);
			});
		},
		clientCount: function(callback) {
			objectNotifier.getObject(objectNotifier.events.clientsCountChangeEvent.name, function(err, obj) {
				callback(err, obj);
			});
		},
		diskCount: function(callback) {
			objectNotifier.getObject(objectNotifier.events.disksCountChangeEvent.name, function(err, obj) {
				callback(err, obj);
			});
		},
		nicCount: function(callback) {
			objectNotifier.getObject(objectNotifier.events.nicsCountChangeEvent.name, function(err, obj) {
				callback(err, obj);
			});
		}
	}, (err, results) => {
		cb(err, results);
	});
}

router.get('/getCounters', function(req, res) {
	getCounters(function(err, results) {
		if (err)
			new SystemMessage(systemMessages.INDEX_GET_COUNTERS_FAILURE).addInfo(Entities.Error, err).log();

		res.json(results);
	});
});

router.get('/getVolumeCounters', function(req, res) {
	volumeModule.calculateVolumeCounters((err, counters) => {
		if (err)
			new SystemMessage(systemMessages.INDEX_GET_COUNTERS_FAILURE).addInfo(Entities.Error, err).log();

		res.json(counters);
	});
});

/**
* @apiVersion 1.0.0
* @api {get} /getClusterStatus?skipLogs=true Get cluster status query
* @apiName getClusterStatusQuery
* @apiGroup index
* @apiParam {boolean} [skipLogs] skip logs in the cluster status
* @apiDescription Get `cluster status query` of the system, cluster ID, and counters status.
*
* @apiSuccess {json} status Overall `status` of the system.
*
* @apiSuccessExample Example data on success
* {
*   "servers": {
*     "totalServers": 3,
*     "timedOutServers": 0,
*     "offlineServers": 0,
*     "alarm": 0,
*     "critical": 0,
*     "healthy": 3
*   },
*   "clients": {
*     "timedOutClients": 0,
*     "offlineClients": 0,
*     "totalClients": 3,
*     "alarm": 0,
*     "critical": 0,
*     "healthy": 3
*   },
*   "volumes": {
*     "Concatenated": {
*       "healthy": [
*         "vol1"
*       ],
*     "alarm": [],
*     "critical": []
*     },
*     "alarm": 0,
*     "critical": 0,
*     "healthy": 1
*   },
*   "managementVersion": "2.8.2-71.el8_6",
*   "dbUUID": "6e4b0d60-0ba0-11ef-b7c5-9310896c9cc8",
*   "warnings": [],
*   "errors": [],
*   "totalSpace": 10483.17,
*   "allocatedSpace": 0,
*   "freeSpace": 10483.17,
*   "clusterID": "My Cluster",
*   "drives": {
*     "alarm": 0,
*     "total": 17,
*     "critical": 0,
*     "updateType": "full",
*     "healthy": 17
*   }
* }
*/
router.get('/getClusterStatus', (req, res) => {
	const skipLogs = req.query.skipLogs === 'true';

	utils.getStatus(skipLogs, function(data) {
		getCounters((err, results) => {
			if (err) {
				logger.sysDEBUG('Failed to get counters for status json');
			} else {
				var counters = Object.keys(results).reduce((acc, curr) => { acc[curr.replace('Count', 's')] = results[curr]; return acc; }, {});
				for (let key in data) {
					if (Object.keys(counters).indexOf(key) !== -1) {
						data[key].alarm = counters[key].alarm;
						data[key].critical = counters[key].critical;
						data[key].healthy = counters[key].total - counters[key].critical - counters[key].alarm;
					}
				}

				data.drives = counters.disks;
				data.drives.healthy = counters.disks.total - counters.disks.critical - counters.disks.alarm;

				nvmeshMetadata.getClusterID((clusterID) => {
					data.clusterID = clusterID ? clusterID.id : '';
					res.json(data);
				});
			}
		});
	});
});

router.post('/resetVolumeStatuses', function(req, res) {
	volumeModule.resetVolumeStatuses(function(err) {
		res.json({ err: err, success: !err });
	});
});

/**
* @apiVersion 1.0.0
* @api {get} /getSpaceAllocation Get space allocation data
* @apiName getSpaceAllocation
* @apiGroup index
* @apiDescription Get `spaceAllocation` data in gigabytes.
*
* @apiSuccess {json} spaceAllocation `totalCapacity` and `availableSpace` in the system.
*
* @apiSuccessExample Example data on success
* {
* 	"_id": "",
* 	"totalCapacityInGigabytes": 4801,
* 	"availableSpaceInGigabytes": 1101
* }
*/
router.get('/getSpaceAllocation', function(req, res) {
	objectNotifier.getObject(objectNotifier.events.allocatedSpaceChangeEvent.name, function(err, obj) {
		if (err)
			logger.sysDEBUG('Failed to calculate allocation', err);

		if (obj)
			return res.json(obj);

		res.json(err);
	});
});

/**
* @apiVersion 1.0.0
* @api {get} /status?skipLogs=true Get status query
* @apiName getStatusQuery
* @apiGroup index
* @apiDescription Get `status query` of the system.
* @apiParam {boolean} [skipLogs] skip logs in the cluster status
*
* @apiSuccess {json} status Overall `status` of the system.
*
* @apiSuccessExample Example data on success
* {
*	"servers": {
*		"totalServers": 12,
*		"offlineServers": 1,
*		"timedOutServers": 12
*	},
*	"clients": {
*		"timedOutClients": 4,
*		"offlineClients": 1,
*		"totalClients": 4
*	},
*	"volumes": {
*    	"Striped & Mirrored RAID-10": {
*      		"count": 29,
*      		"alarm": 0,
*      		"critical": 29
*   	},
*   	"Striped RAID-0": {
*      		"count": 21,
*      		"alarm": 2,
*      		"critical": 18
*    	}
* 	},
*	"totalSpace": 12002647080000,
*	"allocatedSpace": 3420001664064,
*	"freeSpace": 8582645415936,
*	"errors": [{
*		"message": "Drive: CVCQ524600A2400AGN.1 is missing",
*		"timestamp": "2015-08-18T13:01:11.691Z",
*		"meta": {
*			"header": "Disk failure"
*		}
*	}, {
*		"message": "NIC: 0xfe80000000000000f452140300798461 is missing",
*		"timestamp": "2015-08-18T13:01:11.692Z",
*		"meta": {
*			"header": "NIC failure"
*		}
*	}],
*	"warnings": []
* }
*/
router.get('/status', function(req, res) {
	const skipLogs = req.query.skipLogs === 'true';

	utils.getStatus(skipLogs, function(data) {
		var filename = app.get('hostname') + '_status' + '.json';
		res.setHeader('Content-type', 'application/json');
		res.setHeader('Content-disposition', 'attachment; filename=' + filename);
		res.send(data);
	});
});

router.get('/internalState/', async function(req, res) {
	const data = await utils.getSerializableInternalState();
	res.json(data);
});

router.get('/isAlive', function(req, res) {
	res.json('Of course I\'m alive..');
});

/**
* @apiDeprecated
* @apiVersion 1.0.0
* @api {get} /version Get detailed version
* @apiName getVersion
* @apiGroup index
* @apiDescription Get `detailed version` of the management including `version`, `commit`, `changeID`, and `branch`
* @apiSuccess {object} detailed version
* @apiSuccessExample Example data on success
* {
*   "version": "3.1.0-509.el8_6",
*   "commit": "e9a1d5b15cc5a55ae655da7548d32c8a2a439ef7",
*   "changeID": "I8c4a4c76f908e7b0db9e4093975b327643f248eb",
*   "branch": "master"
* }
*/
router.get('/version', isDeprecated, function(req, res) {
	res.json(app.get('versionsFromFile'));
});

/**
* @apiDeprecated
* @apiVersion 1.0.0
* @api {get} /managementVersion Get management version
* @apiName getManagementVersion
* @apiGroup index
* @apiDescription Get `version` of the management
*
* @apiSuccess {string} version
*
* @apiSuccessExample Example data on success
* "2.8.2-71.el8_6"
*/
router.get('/managementVersion', isDeprecated, function(req, res) {
	res.json(app.get('managementVersion'));
});

/**
* @apiDeprecated
* @apiVersion 1.0.0
* @api {get} /APIVersion Get API Version
* @apiName getAPIVersion
* @apiGroup index
* @apiDescription Get `API version` of the management
*
* @apiSuccess {string} API version
*
* @apiSuccessExample Example data on success
* "7"
*/
router.get('/APIVersion', isDeprecated, function(req, res) {
	res.json(app.get('APIVersion'));
});

/**
* @apiVersion 1.0.0
* @api {get} /aboutInfo Get About Information
* @apiName getAboutInformation
* @apiGroup index
* @apiDescription Get `about information` of the management including `managementVersion`, `nodeVersion`,
* `mongoVersion`, `isMongoReplicated`, `hasMongoClusterManagerRole`, `hasMongoRootRole` and `clusterID`
*
* @apiSuccess {object} About Information
*
* @apiSuccessExample Example data on success
* {
*   "managementVersion": "2.8.2-71.el8_6",
*   "nodeVersion": "18.14.2\n",
*   "mongoVersion": "7.0.9",
*   "isMongoReplicated": true,
*   "hasMongoClusterManagerRole": true,
*   "hasMongoRootRole": true,
*   "clusterID": "My Cluster"
* }
*/
router.get('/aboutInfo', function(req, res) {
	var aboutInfo = {};
	var aboutInfoProperties = ['managementVersion', 'nodeVersion', 'mongoVersion', 'isMongoReplicated', 'hasMongoClusterManagerRole', 'hasMongoRootRole'];

	for (var property of aboutInfoProperties)
		aboutInfo[property] = app.get(property);

	nvmeshMetadata.getClusterID((clusterID) => {
		aboutInfo.clusterID = clusterID ? clusterID.id : '';
		res.json(aboutInfo);
	});
});

router.get('/docs/rest', function(req, res) {
	res.redirect('/docs/index.html');
});

/**
* @apiVersion 1.0.0
* @api {get} /config/get/:key Get config by key
* @apiName getConfigByKey
* @apiGroup index
* @apiDescription Get `config` from the management.js.conf by specified key.
* @apiParam {integer} key The `key` representing configuration name to fetch.
* @apiParamExample {string} Payload example
* /config/get/mongoConnection.transport.TLS
* @apiSuccess {object} About Information
* @apiSuccessExample Example data on success
* false
*/
router.get('/config/get/:key', (req, res) => {
	let key = req.params.key;
	let value = config.get(key);
	res.json(value);
});

router.get('/InteropDB', (req, res) => {
	res.download(consts.INTEROP_DB_RELATIVE_PATH, 'InteropDB');
});

/**
* @apiVersion 1.0.0
* @api {get} /getAllSystemMessages Get all system messages
* @apiName getAllSystemMessages
* @apiGroup index
* @apiDescription Fetches a JSON object containing all possible system messages.
* @apiSuccess {Object} systemMessages An object where each key is a message identifier and the value is an object containing the message details
* @apiSuccessExample {json} Example data on success:
* {
*   "UNAUTHORIZED": {
*     "message": "Operation not permitted. This action can only be performed by an Admin.",
*     "id": 401,
*     "header": "Unauthorized",
*     "logLevel": "ERROR",
*     "sysLogLevel": "ERROR"
*   },
*   "UPGRADE_FAILED": {
*     "message": "Upgrade failed",
*     "id": 17003,
*     "sysLogLevel": "ERROR"
*   },
*   ...
* }
*/
router.get('/getAllSystemMessages', (req, res) => {
	res.json(systemMessages);
});

/**
* @apiVersion 1.0.0
* @api {get} /systemInfo Get system information
* @apiName getSystemInfo
* @apiGroup index
* @apiDescription Get `system information` of the management including `version`, `managementVersion`, `rpmVersion`, `managementCompatibilityVersion`,
* `APIVersion`, `protocolVersion`, `bootVersion`, `commitID`, `changeID`, `branch`, `hostname`,
* `ipAddress`, `managementId`, `dbUUID`, `clusterID`, `nodeVersion`, `mongoVersion`, and `isDev`
* @apiSuccess {Object} systemInfo An object containing the system information
* @apiSuccessExample Example data on success:
* {
*    "managementVersion": "3.1.0-509.el8_6",
*    "rpmVersion": "3.1.0-509.el8_6",
*    "managementCompatibilityVersion": "1",
*    "APIVersion": "11",
*    "protocolVersion": 1,
*    "bootVersion": 8,
*    "hostname": "ekespi-mlt",
*    "ipAddress": "10.242.140.102",
*    "managementId": "10.242.140.102:4001",
*    "dbUUID": "52e121e0-564a-11f0-b7cc-994f43c79f38",
*    "clusterID": "MY-CLUSTER",
*    "nodeVersion": "18.20.4",
*    "mongoVersion": "7.0.12",
*    "isDev": false
* }
*/
router.get('/systemInfo', (req, res) => {
	utils.getSystemInfo((systemInfo) => {
		res.json(systemInfo);
	});
});

module.exports = router;
