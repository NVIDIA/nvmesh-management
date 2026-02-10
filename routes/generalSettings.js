/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

var express = require('express');

var utils = require('../utils.js');
var generalSettings = require('../modules/generalSettings.js');
var consts = require('../consts.js');

var systemMessages = require('../systemMessages.js');
var { Entities } = require('../modules/error.js');
const { createAuditRequestLog } = require('../modules/log.js');
const validateProjection = require('../middlewares/validateProjection.js');
const isAdminRole = require('../middlewares/isAdminRole.js');

var router = express.Router();
module.exports = router;

router.get('/', function(req, res) {
	var renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };

	if (consts.userRoles.ADMIN === req.user.role) {
		renderData.componentName = consts.componentsPages.generalSettings;

		res.render('react', renderData);
	} else
		res.send('insufficient privileges');

});


/**
* @apiVersion 17.0.0
* @api {get} /generalSettings/all?projection={} Get generalSettings
* @apiName GetGeneralSettings
* @apiGroup generalSettings
* @apiDescription Get all `generalSettings`.
*
* @apiSuccess {Object[]} generalSettings General settings.
*
* @apiSuccessExample Example data on success
*[{
*	"_id": "5fc79f5c33a875670367464f",
*	"MAX_JSON_SIZE": 2,
*	"RESERVED_BLOCKS": 0.5,
*	"autoLogOutThreshold": 3600,
*	"cacheUpdateInterval": 60,
*	"compatibilityMode": false,
*	"dateModified": "2021-01-10T13:05:19.103Z",
*	"debugComponents": {
*		"lock": true,
*		"events": true,
*		"counters": false,
*		"client": false,
*		"diskSegments": false,
*		"HA": true,
*		"kafka": false,
*		"perf.updatePRaidStatus": false
*	},
*	"domain": "@nvidia.com",
*	"enableDistributedRAID": true,
*	"enableLegacyFormatting": false,
*	"enableNVMf": false,
*	"enableZones": false,
*	"keepaliveIntervals": {
 *	    "MANAGEMENT_AGENT": 5,
 *	    "CLIENT": 5,
 *	    "TOMA": 5,
 *	    "TOMA_LEADER": 5,
 *	    "UPGRADE_AGENT": 5,
 *	},
*	"loggingLevel": "INFO",
*	"sendStatsInterval": 604800,
*	"defaultUnitType": "binary",
*	"defaultDomain": "nvidia.com"
*}]
*/
router.get('/all', validateProjection, (req, res) => {
	var projection = utils.tryParseJSON(req.query.projection) || { defaultStatisticsLayout: 0 };
	if (!utils.isAdmin(req.user))
		projection = { enableZones: 1 };

	generalSettings.load(projection, (err, settings) => { res.json([settings]); }, false);
});

router.get('/load', validateProjection, (req, res) => {
	var projection = utils.tryParseJSON(req.query.projection);

	if (!utils.isAdmin(req.user))
		projection = {
			defaultUnitType: 1
		};

	generalSettings.load(projection || {}, (err, settings) => {
		res.json({ success: !err, results: settings });
	});
});

router.use(isAdminRole);

/**
* @apiVersion 17.0.0
* @api {post} /generalSettings/update Update generalSettings
* @apiName UpdateGeneralSettings
* @apiGroup generalSettings
* @apiDescription Update `generalSettings`.
*
* @apiBody {object} generalSettings `generalSettings` to update.
* @apiBody {string} [generalSettings.domain] The default domain.
* @apiBody {integer} [generalSettings.MAX_JSON_SIZE]  The size of the largest JSON message supported by the Management Server.
* Do not modify this setting unless explicitly authorized by SREs.
* @apiBody {double} [generalSettings.RESERVED_BLOCKS] The percentage of reserved blocks at the start of a managed NVMe device.
* Do not modify this setting unless explicitly authorized by SREs.
* @apiBody {integer} [generalSettings.autoLogOutThreshold] The timeout of the GUI and API access (in seconds).
* After the timeout expires the GUI and API will automatically logout all logged in users.
* @apiBody {integer} [generalSettings.keepaliveGracePeriod] The grace period, in milliseconds, since the last message from every component.
* When the grace period is over, the management server will declare that component as timedOut.
* @apiBody {boolean} [generalSettings.compatibilityMode] Use the NVMesh version of dynamic
* libraries instead of the operating system versions to avoid compatibility issues.
* @apiBody {boolean} [generalSettings.enableLegacyFormatting] Determines whether to allow legacy formatting on metadata supported drives via the RESTful API.
* @apiBody {boolean} [generalSettings.enableDistributedRAID] This option only affects the creation of EC volumes via the GUI, it does not affect
* creating EC volumes via RESTful API. This option will not hide existing EC volumes.
* @apiBody {boolean} [generalSettings.enableZones] Enable zones.
* @apiBody {string} [generalSettings.loggingLevel] The logging level of the Management Server, options: NONE, INFO, VERBOSE, DEBUG, ERROR, WARNING.
* @apiBody {object} [generalSettings.debugComponents] Active logging `debugComponents`.
* @apiBody {boolean} [generalSettings.debugComponents.lock] Log lock debug messages.
* @apiBody {boolean} [generalSettings.debugComponents.events] Log events debug messages.
* @apiBody {boolean} [generalSettings.debugComponents.counters] Log counters debug messages.
* @apiBody {boolean} [generalSettings.debugComponents.client] Log client debug messages.
* @apiBody {boolean} [generalSettings.debugComponents.statistics] Log statistics debug messages.
* @apiBody {boolean} [generalSettings.debugComponents.diskSegments] Log diskSegments debug messages.
* @apiBody {boolean} [generalSettings.debugComponents.HA] Log HA debug messages.
* @apiBody {boolean} [generalSettings.debugComponents.kafka] Log kafka debug messages.
* @apiBody {boolean} [generalSettings.debugComponents.updatePRaidStatus] `perf.updatePRaidStatus` Log PRAID Status debug messages.
* @apiBody {integer} [generalSettings.sendStatsInterval] The interval of time passing after which the "phone home" statistics should be sent home in ms.
* @apiBody {integer} [generalSettings.cacheUpdateInterval] Statistics cache update interval. Modifying the following options impacts the overall load on
* the Management Server and the NVMesh clients and targets, and may make the system unstable.
* @apiBody {integer} [generalSettings.requestStatsInterval] The frequency of statistics updates from the node machines to the management server.
* @apiBody {boolean} [generalSettings.enableNVMf] Set default value of Enable NVMf for volume creation.
* @apiBody {string} [generalSettings.defaultUnitType] Set default value of unit type to be used.
* @apiBody {boolean} [generalSettings.forceUpgradeUpToDateComponents] Force NDU on up to date components even if they are already in destination version.
* @apiBody {integer} [generalSettings.snapshotAttachTimeout] Set the timeout for snapshot attach.
* @apiBody {integer} [generalSettings.snapshotExportTimeout] Set the timeout for snapshot export.
* @apiBody {object} [generalSettings.zoneRanking] Zone ranking mechanism configuration.
* @apiBody {integer} [generalSettings.zoneRanking.fuzziness] Set the zone ranking fuzziness.
* @apiBody {object} [generalSettings.zoneRanking.criterias] The zone ranking criterias.
* @apiBody {integer} [generalSettings.zoneRanking.criterias.segmentsInZone] Segments in zone criteria.
* @apiBody {integer} [generalSettings.zoneRanking.criterias.targetsInZone] Targets in zone criteria.
* @apiBody {integer} [generalSettings.zoneRanking.criterias.avgTimeSpentWaitingForLock] Average time spent waiting for lock criteria.
* @apiBody {object} [generalSettings.kafka] Kafka configuration.
* @apiBody {integer} [generalSettings.kafka.partitionsFactorForManagementTopics] Set the partitions factor for management topics.
* @apiBody {boolean} [generalSettings.disableOldManagements] Disable old managements when in upgrade mode. <strong>Must be true</strong>.
* @apiExample {string} Payload example
* {
* 	"enableNVMf": false,
*	"enableZones": false
* }
* @apiSuccess {object} results success statuses
* @apiSuccessExample Example data on success
*{
*    "_id": "5e57d20a76412363d4c5dba9",
*    "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*    "success": true,
*    "error": null,
*    "payload": {
*        "updated": {
*            "enableNVMf": false,
*            "enableZones": false
*        }
*    }
*}
*/
router.post('/update', (req, res) => {
	let requestSettings = req.body;

	let incomingRequestSystemAdminMessage = createAuditRequestLog(req, systemMessages.GENERAL_SETTINGS_UPDATE_REQUEST)
		.addInfo(Entities.GeneralSettings.settings, requestSettings);


	utils.handleRESTAndLog(
		[incomingRequestSystemAdminMessage],
		cb => generalSettings.updateGeneralSettings(requestSettings, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse()))
	);
});

router.get('/isElectDisabled', (req, res) => {
	var GLOBAL_SETTINGS_HIDDEN = app.get('globalSettingsHidden');
	res.json({ isElectDisabled: GLOBAL_SETTINGS_HIDDEN.isElectDisabled });
});
