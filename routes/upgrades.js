/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


const express = require('express');
const uuid = require('uuid');

const upgradeModule = require('../modules/upgrade.js');
const consts = require('../consts.js');
const utils = require('../utils.js');
const systemMessages = require('../systemMessages.js');
const validateProjection = require('../middlewares/validateProjection.js');
const isDeprecated = require('../middlewares/isDeprecated.js');
const { getCountEntitiesHandler } = require('./common.js');
const { Entities } = require('../modules/error.js');
const { createAuditRequestLog } = require('../modules/log.js');

const router = express.Router();

router.get('/', function(req, res) {
	var renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };
	renderData.componentName = consts.componentsPages.upgrades;

	res.render('react', renderData);
});


router.get('/upgrade/:id', function(req, res) {
	const renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };
	renderData.componentName = consts.componentsPages.upgrade;

	res.render('react', renderData);
});

/**
 * @apiVersion 17.0.0
 * @api {get} /upgrades/all/:page/:count?filter={}&sort={} Get upgrades
 * @apiName GetUpgrades
 * @apiGroup upgrades
 * @apiDescription Get `upgrades` by `page` and `count`.
 *
 * @apiParam {integer} page The `page` to fetch.
 * @apiParam {integer} count Number of records per `page`.
 * @apiParam {object} [filter] `Filter` before fetching.
 * @apiParam {object} [sort] `Sort` before fetching.
 * @apiParamExample {object[]} Example request
 * /upgrades/all/0/2?filter={"sourceVersion":"3.2.0-15"}&sort={"timestamp":-1}
 * @apiSuccess {object[]} upgrades List of `upgrades`.
 * @apiSuccessExample Example data on success
 * [{
 *	"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefc",
 * 	"_id": "1",
 * 	"sourceVersion": "3.2.0",
 *	"destinationVersion": "3.2.1",
 *	"status": "completed",
 * 	"components": ["TOMA"],
 *	"availability": 'Max'
 *	"mode": 'Automatic'
 *	"steps": 15
 *	"dateCreated": 2025-03-02T12:18:39.761Z,
 *	"dateModified": 2025-04-02T12:18:39.761Z,
 *	"createdBy": "admin@nvidia.com",
 *	"modifiedBy": "admin@nvidia.com"
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

	queryObj.filter.isPending = false;

	upgradeModule.getAllUpgrades(queryObj, (error, upgrades) => {
		if (error)
			return res.json(error.createApiResponse());

		res.json(upgrades);
	});
});

/**
 * @apiVersion 17.0.0
 * @api {get} /upgrades/count Count upgrades
 * @apiName CountUpgrades
 * @apiGroup upgrades
 * @apiDescription Get total `upgrades` count.
 * @apiSuccess {integer} count `upgrades` count.
 * @apiSuccessExample Example data on success
 * 4
 */
router.get('/count', getCountEntitiesHandler('upgrade', { isPending: false }));

/**
 * @apiVersion 17.0.0
 * @api {post} /upgrades/save Save upgrade
 * @apiName SaveUpgrade
 * @apiGroup upgrades
 * @apiDescription Save an upgrade.
 *
 * @apiBody {object} upgrade `Upgrade` to create.
 * @apiBody {string} upgrade.destinationVersion `Destination version` of the `Upgrade`.
 * @apiBody {string[]} upgrade.machinesToUpgrade `Machines to upgrade` of the `Upgrade`.
 * @apiBody {string} [upgrade.executionMode=automatic] `Execution mode` of the `Upgrade`.
 * <small><i>Options: `automatic`, `manualStart`, `manual`</i></small>.
 * @apiBody {string} [upgrade.minRedundancyLevel=max] `Minimum redundancy level` of the `Upgrade`.
 * <small><i>Options: `max`, `minimum`, `none`</i></small>.
 * @apiBody {boolean} [upgrade.skipMachinesOnFailure=false] `Skip machines on failure` of the `Upgrade`.
 * @apiBody {number} [upgrade.maxErrorsThreshold=1] `Max errors threshold` of the `Upgrade`.
 * @apiBody {number} [upgrade.maxConcurrentClients=1] Maximum amount of clients that can be upgraded concurrently.
 * @apiExample {object} Payload example
 * {
 *	destinationVersion: '3.2.2',
 * 	executionMode: 'automatic',
 * 	minRedundancyLevel: 'max',
 * 	skipMachinesOnFailure: true,
 * 	maxErrorsThreshold: 3,
 * 	machinesToUpgrade: ['node1.example.com', 'node2.example.com']
 * }
 * @apiSuccess {object} results success statuses
 * @apiSuccessExample Example data on success
 * {
 *	"_id": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
 *	"uuid": null,
 *  "success": true,
 *	"error": null,
 *	"payload": null
 * }
 */

router.post('/save', function(req, res) {
	const upgrade = req.body;
	const user = req.user;

	upgrade.uuid = uuid.v1();

	const incomingRequestSystemAdminMessage = createAuditRequestLog(req, systemMessages.UPGRADE_SAVE_REQUEST)
		.addInfo(Entities.Upgrade.UUID, upgrade.uuid)
		.addInfo(Entities.Upgrade.DestinationVersion, upgrade.destinationVersion)
		.addInfo(Entities.Upgrade.ExecutionMode, upgrade.executionMode)
		.addInfo(Entities.Upgrade.MinRedundancyLevel, upgrade.minRedundancyLevel)
		.addInfo(Entities.Upgrade.SkipMachinesOnFailure, upgrade.skipMachinesOnFailure)
		.addInfo(Entities.Upgrade.MaxErrorsThreshold, upgrade.maxErrorsThreshold)
		.addInfo(Entities.Upgrade.MachinesToUpgrade, upgrade.machinesToUpgrade);

	utils.handleRESTAndLog(
		[incomingRequestSystemAdminMessage],
		cb => upgradeModule.createUpgrade(upgrade, user, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Upgrade.UUID)))
	);
});

/**
 * @apiDeprecated
 * @apiVersion 17.1.0
 * @api {get} /upgrades/getPossibleUpgrades Get possible upgrades
 * @apiName GetPossibleUpgrades
 * @apiGroup upgrades
 * @apiDescription Get possible upgrades for a given source version.
 *
 * @apiQuery {string} sourceVersion The source version to get possible upgrades for.
 * @apiExample {string} Example request
 * /upgrades/getPossibleUpgrades?sourceVersion=3.2.0
 * @apiSuccess {string[]} versions List of possible upgrades.
 * @apiSuccessExample Example data on success
 * ["3.2.0-15", "3.2.1-16"]
 */
router.get('/getPossibleUpgrades', isDeprecated, function(req, res) {
	const sourceVersion = req.query.sourceVersion;

	upgradeModule.getPossibleUpgrades(sourceVersion, (error, versions) => {
		if (error)
			return res.json(error.createApiResponse());

		res.json(versions);
	});
});

/**
 * @apiVersion 17.1.0
 * @api {post} /upgrades/getPossibleUpgradesByHostnames Get possible upgrades by hostnames
 * @apiName GetPossibleUpgradesByHostnames
 * @apiGroup upgrades
 * @apiDescription Get possible upgrade destination releases for a set of hostnames.
 * Validates per-component upgrade paths and version comparisons.
 *
 * @apiBody {string[]} hostnames List of hostnames to check upgrades for.
 * @apiBody {string[]} [components] Optional list of component names to check.
 * Defaults to all upgradeable components (nvmesh-client, nvmesh-management, nvmesh-upgrade-agent).
 * @apiSuccess {string[]} versions List of valid destination release versions.
 * @apiExample {json} Example request
 * { "hostnames": ["host1", "host2"], "components": ["nvmesh-management"] }
 * @apiSuccessExample Example data on success
 * ["3.4.0-15", "3.4.1-16"]
 */
router.post('/getPossibleUpgradesByHostnames', function(req, res) {
	const { hostnames, components } = req.body;

	upgradeModule.getPossibleUpgradesByHostnames(hostnames, components, (error, versions) => {
		if (error)
			return res.json(error.createApiResponse());

		res.json(versions);
	});
});

/**
 * @apiVersion 17.0.0
 * @api {post} /upgrades/delete Delete upgrade
 * @apiName DeleteUpgrade
 * @apiGroup upgrades
 * @apiDescription Delete an upgrade.
 *
 * @apiBody {object[]} upgrades `Upgrades` to delete.
 * @apiExample {object[]} Payload example
 * [{
 *	uuid: 'f02abf10-6bfb-11ed-a62f-d1b4ca08eefb'
 * }]
 * @apiSuccess {object} results success statuses
 * @apiSuccessExample Example data on success
 * [{
 *	"_id": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
 *	"uuid": null,
 *	"success": true,
 *	"error": null,
 *	"payload": null
 * }]
 */
router.post('/delete', (req, res) => {
	const upgrades = req.body;

	const incomingRequestSystemAdminMessages = upgrades.map((upgrade) => createAuditRequestLog(req, systemMessages.UPGRADE_DELETE_REQUEST)
		.addInfo(Entities.Upgrade.UUID, upgrade.uuid)
	);

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => upgradeModule.deleteUpgrades(upgrades, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Upgrade.UUID)))
	);
});

/**
 * @apiVersion 17.0.0
 * @api {get} /upgrades/:id Get upgrade by ID
 * @apiName GetUpgrade
 * @apiGroup upgrades
 * @apiDescription Get specific `upgrade` by `ID`.
 *
 * @apiParam {string} id `upgrade's ID` to fetch.
 * @apiParamExample {string} Example request
 * upgrades/c330b200-4121-11f0-8a04-73607af23336
 * @apiSuccess {object} API Response
 * @apiSuccessExample Example data on success
 * {
    _id: 'c330b200-4121-11f0-8a04-73607af23336',
    destinationVersion: '3.2.0-HF2',
    executionMode: 'automatic',
    minRedundancyLevel: 'max',
    machinesToUpgrade: [
      {
        _id: 'scale-1',
        uuid: '364fa1c0-4121-11f0-a262-f146ce21e3c0',
        hostname: 'scale-1',
        kafkaMessageSequence: { keepalive: 40 },
        upgradeAgentToken: 1,
        upgradeAgentData: {
          version: '3.1.0-1417-SIM',
          featureCompatibilityVersion: '1',
          operatingSystem: {
            name: 'Rocky Linux 8.6 (Green Obsidian)',
            id: 'rocky',
            versionID: '8.6'
          },
          archType: 'x86_64',
          kernel: '4.18.0-372.19.1.el8_6.x86_64',
          ofed: 'inbox',
          nvmeshVersions: {
            'nvmesh-target': '3.1.0-1357.el8_6.x86_64',
            'nvmesh-base': '3.1.0-1357.el8_6.x86_64',
            'nvmesh-client': '3.1.0-1357.el8_6.x86_64',
            'nvmesh-utils': '3.0.0-706.el8_6.x86_64',
            'nvmesh-management': '3.0.0-706.el8_6.x86_64'
          },
          additionalData: {},
          health: 'healthy'
        },
        status: 'online',
        topics: { '.upgradeAgent.commands': 'scale-1.upgradeAgent.commands.1.0.0' },
        docVersion: null,
        dateModified: '2025-06-04T08:56:08.334Z',
        lastReceivedKeepAlive: '2025-06-04T08:56:08.334Z',
        isClientOnly: false
      },
      {
        _id: 'scale-2',
        uuid: '3658f090-4121-11f0-a262-f146ce21e3c0',
        hostname: 'scale-2',
        kafkaMessageSequence: { keepalive: 41 },
        upgradeAgentToken: 2,
        upgradeAgentData: {
          version: '3.1.0-1417-SIM',
          featureCompatibilityVersion: '1',
          operatingSystem: {
            name: 'Rocky Linux 8.6 (Green Obsidian)',
            id: 'rocky',
            versionID: '8.6'
          },
          archType: 'x86_64',
          kernel: '4.18.0-372.19.1.el8_6.x86_64',
          ofed: 'inbox',
          nvmeshVersions: {
            'nvmesh-target': '3.1.0-1357.el8_6.x86_64',
            'nvmesh-base': '3.1.0-1357.el8_6.x86_64',
            'nvmesh-client': '3.1.0-1357.el8_6.x86_64',
            'nvmesh-utils': '3.0.0-706.el8_6.x86_64',
            'nvmesh-management': '3.0.0-706.el8_6.x86_64'
          },
          additionalData: {},
          health: 'healthy'
        },
        status: 'online',
        topics: { '.upgradeAgent.commands': 'scale-2.upgradeAgent.commands.1.0.0' },
        docVersion: null,
        dateModified: '2025-06-04T08:56:08.333Z',
        lastReceivedKeepAlive: '2025-06-04T08:56:08.333Z',
        isClientOnly: false
      }
    ],
    uuid: 'c330b200-4121-11f0-8a04-73607af23336',
    isPending: false,
    createdBy: 'admin@nvidia.com',
    modifiedBy: 'admin@nvidia.com',
    dateCreated: ISODate('2025-06-04T08:56:11.297Z'),
    dateModified: ISODate('2025-06-04T08:56:11.397Z'),
    status: 'completed',
    handledBy: { managementId: '10.242.34.244:4001', bootVersion: 2 },
    docVersion: null,
    stepsToComplete: 8
  }
 */
router.get('/:id', (req, res) => {
	upgradeModule.fetchUpgradeByID(req.params.id, (error, upgrade) => {
		if (error)
			return res.json(error.createApiResponse());

		return res.json(upgrade);
	});
});

/**
 * @apiVersion 17.0.0
 * @api {post} /upgrades/startUpgrade Start upgrade
 * @apiName StartUpgrade
 * @apiGroup upgrades
 * @apiDescription Manually start an upgrade.

 * @apiBody {object} upgrade `Upgrade` to start.
 * @apiBody {string} [upgrade._id] `ID` of the `Upgrade`.
 * @apiExample {object} Payload example
 * {
 *	_id: 'f02abf10-6bfb-11ed-a62f-d1b4ca08eefb'
 * }
 * @apiSuccess {object} results success statuses
 * @apiSuccessExample Example data on success
 * {
 *	"_id": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
 *	"uuid": null,
 *  "success": true,
 *	"error": null,
 *	"payload": null
 * }
 */

router.post('/startUpgrade', function(req, res) {
	let upgrade = req.body;

	let incomingRequestSystemAdminMessage = createAuditRequestLog(req, systemMessages.UPGRADE_START_REQUEST)
		.addInfo(Entities.Upgrade.UUID, upgrade._id);

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => upgradeModule.startUpgradeByID(upgrade._id, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Upgrade.UUID)))
	);
});

/**
 * @apiVersion 17.0.0
 * @api {post} /upgrades/resumeUpgrade Resume upgrade
 * @apiName ResumeUpgrade
 * @apiGroup upgrades
 * @apiDescription Resume an upgrade.

 * @apiBody {object} upgrade `Upgrade` to resume.
 * @apiBody {string} [upgrade._id] `ID` of the `Upgrade`.
 * @apiExample {object} Payload example
 * {
 *	_id: 'f02abf10-6bfb-11ed-a62f-d1b4ca08eefb'
 * }
 * @apiSuccess {object} results success statuses
 * @apiSuccessExample Example data on success
 * {
 *	"_id": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
 *	"uuid": null,
 *  "success": true,
 *	"error": null,
 *	"payload": null
 * }
 */
router.post('/resumeUpgrade', function(req, res) {
	let upgrade = req.body;

	let incomingRequestSystemAdminMessage = createAuditRequestLog(req, systemMessages.UPGRADE_RESUME_REQUEST)
		.addInfo(Entities.Upgrade.UUID, upgrade._id);

	utils.handleRESTAndLog(
		[incomingRequestSystemAdminMessage],
		cb => upgradeModule.resumeUpgrade(upgrade, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Upgrade.UUID)))
	);
});

/**
 * @apiVersion 17.0.0
 * @api {post} /upgrades/skipFailedMachine Skip failed machine
 * @apiName skipFailedMachine
 * @apiGroup upgrades
 * @apiDescription Skip a machine in an upgrade.

 * @apiBody {object} upgrade `Upgrade` to skip.
 * @apiBody {string} [upgrade._id] `ID` of the `Upgrade`.
 * @apiExample {object} Payload example
 * {
 *	_id: 'f02abf10-6bfb-11ed-a62f-d1b4ca08eefb'
 * }
 * @apiSuccess {object} results success statuses
 * @apiSuccessExample Example data on success
 * {
 *	"_id": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
 *	"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
 *  "success": true,
 *	"error": null,
 *	"payload": null
 * }
 */
router.post('/skipFailedMachine', (req, res) => {
	let upgrade = req.body;

	let incomingRequestSystemAdminMessage = createAuditRequestLog(req, systemMessages.UPGRADE_SKIP_MACHINE_REQUEST)
		.addInfo(Entities.Upgrade.UUID, upgrade._id);

	utils.handleRESTAndLog(
		[incomingRequestSystemAdminMessage],
		cb => upgradeModule.skipFailedMachine(upgrade, true, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Upgrade.ID, Entities.Upgrade.UUID)))
	);
});

module.exports = router;
