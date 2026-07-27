/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

var express = require('express');

var utils = require('../utils.js');
var consts = require('../consts.js');
var clientModule = require('../modules/client.js');
var { Entities, SystemMessage } = require('../modules/error.js');
const systemMessages = require('../systemMessages.js');
const { createAuditRequestLog } = require('../modules/log.js');
const validateProjection = require('../middlewares/validateProjection.js');
const isAdminRole = require('../middlewares/isAdminRole.js');
const { fetchEntityByID, getCountEntitiesHandler } = require('./common.js');

var router = express.Router();

router.get('/', function(req, res) {
	var renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };
	renderData.isReact = true;
	renderData.componentName = consts.componentsPages.clients;

	res.render('react', renderData);
});

/**
* @apiVersion 1.0.0
* @api {get} /clients/all/:page/:count?filter={}&sort={} Get clients
* @apiName GetClients
* @apiGroup clients
* @apiDescription Get `clients` by `page` and `count`.
*
* @apiParam {integer} page The `page` to fetch.
* @apiParam {integer} count Number of records per `page`.
* @apiParam {object} [filter] `Filter` before fetching. <small><i>--MongoDB filter obj</i></small>
* @apiParam {object} [sort] `Sort` before fetching. <small><i>--MongoDB sort obj</i></small>
* @apiParamExample {object[]} Example request
* clients/all/0/10?filter={"client_status":1}&sort={"clientID":1}
*
* @apiSuccess {object[]} clients List of `clients`.
* @apiSuccess {string} clients.clientID List of the block devices for the <code>client</code>.
* @apiSuccess {integer} clients.client_status Client status:
	<br/><code>0</code> Client is initializing.
	<br/><code>1</code> Client is ready.
	<br/><code>2 - 4</code> Internal statuses while the client is shutting down.
	<br/><code>5</code> Client software is down.
	<br/><code>6</code> Could not determine the client status.
* @apiSuccess {string} clients.version The <code>client</code> version.
* @apiSuccess {string} clients.health The <code>client</code> health.
* @apiSuccess {string[]} clients.nvmfAttachedVolumes List of the NVMf attached block devices for the <code>client</code>.
* @apiSuccess {object[]} clients.block_devices List of the block devices for the <code>client</code>.
* @apiSuccess {string} clients.block_devices.name The name of the attached <code>volume</code>.
* @apiSuccess {integer} clients.block_devices.vol_status Status the block device options:
	<br/><code>1</code> Failed to detach block device - client is used by another application (busy).
	<br/><code>2</code> Block device is detached.
	<br/><code>3</code> Failed to detach block device.
	<br/><code>4</code> Block device is attached.
	<br/><code>5</code> Failed to attach block device.
* @apiSuccessExample Example data on success
* [{
* 		"_id": "nvme13.excelero.com",
* 		"clientID": "nvme13.excelero.com",
* 		"client_status": 1,
*		"block_devices": [{
			"trim_latency": 0,
			"read_latency": 20576,
			"read_ops": 45,
			"trim_size": 0,
			"read_size": 1069056,
			"write_latency": 0,
			"uuid": "80c87510-4a75-11e8-9662-d38f6a748f9c",
			"write_ops": 0,
			"write_size": 0,
			"trim_ops": 0,
			"time": 0,
			"name": "vol1",
			"vol_status": 4,
			"is_blocked_no_io": 0
		}],
*		"dateModified: ISODate("2015-08-17T12:26:08.939Z")
* }, {
*		"_id": "nvme48.excelero.com",
*		"clientID": "nvme48.excelero.com",
* 		"client_status": 1,
*		"block_devices": [],
*		"dateModified: ISODate("2015-08-17T12:26:08.939Z")
* }]
*/
router.get('/all/:page/:count', validateProjection, function(req, res) {
	var page = parseFloat(req.params.page);
	var count = parseInt(req.params.count);

	var query = {
		filter: utils.tryParseJSON(req.query.filter) || {},
		sort: utils.tryParseJSON(req.query.sort) || {},
		projection: utils.tryParseJSON(req.query.projection) || {},
		skip: page * count,
		limit: count
	};

	utils.loadCollection('client', query, function(err, clients) {
		if (err)
			return res.json(utils.createApiResponse(null, null, false, new SystemMessage(systemMessages.FAILED_TO_LOAD_CLIENTS).addInfo(Entities.Error, err)));

		if (req.user.role === consts.userRoles.OBSERVER)
			for (let clientIndex = 0; clientIndex < clients.length; clientIndex++) {
				let client = clients[clientIndex];

				if (client.block_devices) {
					client.block_devices = client.block_devices.filter(bd => bd.vol_status !== consts.volumeAttachmentStatus.DETACHED);

					for (let blockDevicesIndex = 0; blockDevicesIndex < client.block_devices.length; blockDevicesIndex++) {
						let bd = client.block_devices[blockDevicesIndex];

						if (!bd.name)
							return res.status(403).json(utils.createApiResponse(null, null, false,
								new SystemMessage(systemMessages.PROJECTION_MUST_INCLUDE_BD_NAME).toApiResponse()));

						if (bd.name.endsWith(consts.MetadataVolumeEnding))
							client.block_devices.splice(blockDevicesIndex--, 1);
					}
				}
			}

		res.json(clients);
	});
});

/**
* @apiVersion 1.0.0
* @api {get} /clients/combinedStatus/:clientID/:volumeID Get data attachment with combined status
* @apiName GetCombinedStatus
* @apiGroup clients
* @apiDescription Get combined status data attachment.
*
* @apiParamExample Example request {object[]}
* /clients/combinedStatus/nvme13.excelero.com/snapshot_test
*
* @apiSuccess object combined status attachment.
*
* @apiSuccessExample Example data on success
{
    "_id" : "nvme13.excelero.com",
    "snapshot_test" : {
        "io_perm" : 15,
		"name" : "snapshot_test",
		"ioEnabled" : 1,
		"version" : 1,
		"vol_status" : 4,
		"reservation" : {
			"preempt" : 0,
			"version" : 2,
			"mode" : 1,
			"is_512B_IO_allowed" : 0
		},
		"is_hidden" : 0,
		"uuid" : "ba226e60-2865-11ed-80a7-13172e9635f3",
		"isSnapshotReady": true,
		"combinedIOEnabled": true
}
*/
router.get('/combinedStatus/:clientID/:volumeID', isAdminRole, (req, res) => {
	const volumeID = req.params.volumeID;
	const clientID = req.params.clientID;

	utils.loadCollection('client', { filter: { clientID: clientID } }, function(err, clients) {
		if (!clients.length || !clients[0].block_devices || !clients[0].block_devices.length)
			return res.json({});

		clientModule.getCombinedStatusAttachment(clients[0], volumeID, client => res.json(client));
	});
});

/**
* @apiVersion 1.0.0
* @api {post} /clients/delete Delete clients
* @apiName DeleteClients
* @apiGroup clients
* @apiDescription Delete `clients`.
*
* @apiParam {object[]} clients `clients` to delete.
* @apiParam {string} delete._id The `ID` of the `client` to delete.
* @apiParam {string} delete.uuid The `UUID` of the `client` to delete.
* @apiParamExample {string} Payload example
* [{
*		"_id": "nvme31.excelero.com"
*		"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398",
* }]
* @apiSuccess {object} results success statuses
* @apiSuccessExample Example data on success
* [{
*      "success": true,
*	   "uuid": "",
*      "_id": "nvme31.excelero.com",
*      "error": null,
*	   "payload": null
* }]*/
router.post('/delete', isAdminRole, function(req, res) {
	const clients = req.body;

	const incomingRequestSystemAdminMessages = clients.map(({ _id, uuid }) => createAuditRequestLog(req, systemMessages.CLIENT_DELETE_REQUEST)
		.addInfo(Entities.Client.ID, _id).addInfo(Entities.Client.UUID, uuid));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => clientModule.deleteClients(clients, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Client.ID, Entities.Client.UUID))));
});

/**
* @apiVersion 1.0.0
* @api {get} /clients/count Count clients
* @apiName CountClients
* @apiGroup clients
* @apiDescription Get total `clients` count.

* @apiParam {object} [filter] `Filter` before counting. <small><i>--MongoDB filter obj</i></small>
* @apiParamExample {object} Example request
* clients/count?filter={"client_status":1}
*
* @apiSuccess {integer} count `clients` count.
*
* @apiSuccessExample Example data on success
* 4
*/
router.get('/count', getCountEntitiesHandler('client'));

/**
* @apiVersion 1.0.0
* @api {post} /clients/attach Attach Volumes
* @apiName AttachVolumes
* @apiGroup clients
* @apiDescription Attach `volumes` to a `client`
*
* @apiParam {object} attach attach `volumes` to a `client`
* @apiParam {string} attach.client `client ID` to update
* @apiParam {string} attach.clientUUID `client UUID` to update
* @apiParam {object[]} attach.volumes Array of `volumes`
* @apiParam {string} attach.volumes.name `volume ID` to `attach`
* @apiParam {string} attach.volumes.uuid `volume UUID` to `attach`
* @apiParam {object} [attach.volumes.reservation] `volume` reservation parameters
* @apiParam {string} [attach.volumes.reservation.mode] The `reservation` mode of the `volume`
* <small><i>Available options are: `SHARED_READ_WRITE` (default), `SHARED_READ_ONLY` or `EXCLUSIVE_READ_WRITE`</i></small>
* @apiParam {int} [attach.volumes.reservation.version] The `reservation` version of the `volume`
* @apiParam {boolean} [attach.volumes.reservation.preempt] Use preempt to forcefully apply `reservation` mode.
* @apiParam {boolean} [attach.volumes.reservation.isDetachOthers] if set to true, it will detach all other clients attached to this volume.
* @apiParam {object} [attach.volumes.emulation] `volume` emulation parameters
* @apiParam {string} [attach.volumes.emulation.mode] The `emulation` mode of the `volume`, available only for UM clients.
* @apiParam {string} [attach.volumes.referenceID] The `referenceID` of the `volume`, used in a multi-attach mode.
* <small><i>Available options are: `NONE` (default), `STATIC` or `HOTPLUG`</i></small>
* @apiParamExample {string} Payload example
* {
* 	"client": "nvme21.excelero.com",
* 	"clientUUID": "f02abf10-6bfb-11ed-a62f-d1b4ca08eef3",
* 	"volumes": [{
* 		"name": "V1",
*		"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*		"reservation": {
*			"mode": "SHARED_READ_ONLY"
*		},
*		"emulation": {
*			"mode": "NONE"
*		}
* 	}]
* }
*
* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* [{
*      "success": true,
*	   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*      "_id": "V1",
*      "error": null,
*	   "payload": null
* }]
*/

router.post('/attach', isAdminRole, (req, res) => {
	let { client, clientUUID, volumes } = req.body;

	let incomingRequestSystemAdminMessages = volumes.map(volume => createAuditRequestLog(req, systemMessages.CLIENT_ATTACH_REQUEST)
		.addInfo(Entities.Client.ID, client)
		.addInfo(Entities.Client.UUID, clientUUID)
		.addInfo(Entities.Volume.name, volume.name)
		.addInfo(Entities.Volume.UUID, volume.uuid)
		.addInfo(Entities.Volume.reservation, volume.reservation)
		.addInfo(Entities.Volume.referenceID, volume.referenceID));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => clientModule.attach(client, clientUUID, volumes, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID)))
	);
});


/**
* @apiVersion 1.0.0
* @api {post} /clients/detach Detach Volumes
* @apiName DetachVolumes
* @apiGroup clients
* @apiDescription Detach `volumes` from a `client`
*
* @apiParam {object} detach detach `volumes` from a `client`
* @apiParam {string} detach.client `client ID` to update
* @apiParam {string} detach.clientUUID `client UUID` to update
* @apiParam {object[]} detach.volumes Array of `volumes`
* @apiParam {string} detach.volumes.name `volume ID` to `detach`
* @apiParam {string} detach.volumes.uuid `volume UUID` to `detach`
* @apiParam {boolean} [detach.volumes.force] force `detach`
* @apiParam {string} [detach.volumes.referenceID] The `referenceID` of the `volume`, used in a multi-attach mode.

* @apiParamExample {string} Payload example
* {
* 	"client": "nvme21.excelero.com",
* 	"clientUUID": "f02abf10-6bfb-11ed-a62f-d1b4ca08eef3",
* 	"volumes": [{
* 		"name": "V1",
*		"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
* 	}]
* }
*
* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* [{
*      "success": true,
*	   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*      "_id": "V1",
*      "error": null,
*	   "payload": null
* }]
*/
router.post('/detach', isAdminRole, (req, res) => {
	let { client, clientUUID, volumes } = req.body;

	let incomingRequestSystemAdminMessages = volumes.map(volume => createAuditRequestLog(req, systemMessages.CLIENT_DETACH_REQUEST)
		.addInfo(Entities.Client.ID, client)
		.addInfo(Entities.Client.UUID, clientUUID)
		.addInfo(Entities.Volume.name, volume.name)
		.addInfo(Entities.Volume.UUID, volume.uuid)
		.addInfo(Entities.Volume.reservation, volume.reservation)
		.addInfo(Entities.Volume.referenceID, volume.referenceID));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => clientModule.detach(client, clientUUID, volumes, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {get} /clients/:id Get client by ID
* @apiName GetClient
* @apiGroup clients
* @apiDescription Get specific `client` by `ID`.
*
* @apiParam {string} client `client's ID` to fetch.
* @apiParamExample {string} Example request
* clients/nvme1038
*
* @apiSuccess {object} API Response
*
* @apiSuccessExample Example data on success
* {
*         "_id": "nvme1038",
*         "clientID": "nvme1038",
*         "agentOriginID": "5a8e73de-fcb4-11ee-ad29-0cc47afbca16",
*         "health": "critical",
*         "client_status": 5,
*         "managementAgentStatus": "down",
*         "kafkaMessageSequence": {
*             "keepalive": 0,
*             "reportClient": 0,
*             "updateAttachmentStatus": 0
*         },
*         "agentKafkaMessageSequence": {
*             "keepalive": 152,
*             "configProfileUpdated": 0,
*             "updateConfigProfileUserOverride": 0,
*             "updateKeys": 0
*         },
*         "managementAgentToken": 2,
*         "clientToken": 2,
*         "reportID": 0,
*         "nvmfAttachmentsID": 0,
*         "keepAliveCounter": 5,
*         "attachmentsVersion": 0,
*         "isUmClient": 0,
*         "block_devices": [],
*         "attachments": {},
*         "dateModified": "2024-04-17T12:29:15.102Z",
*         "health_old": "critical",
*         "keys": [],
*         "restartRequired": true,
*         "version": "2.8.0-542",
*         "branch": "master",
*         "commit": "d796a0b",
*         "hasIoDisabled": false,
*         "clientOriginID": "5e97802e-fcb4-11ee-ad29-0cc47afbca16",
*         "lastReceivedClientKeepAlive": "2024-04-17T12:29:15.102Z",
*         "client_id": "nvme1038",
*         "configProfile": {
*             "version": 0,
*             "id": "No Profile",
*             "name": "No Profile"
*         }
* }
*/
router.get('/:id', (req, res) => {
	fetchEntityByID('client', req.params.id, false, {}, result => {
		return res.json(result);
	});
});


/**
* @apiVersion 1.0.0
* @api {post} /clients/setEmulationMode Set Emulation Mode for a UM Client Volume Attachments
* @apiName SetEmulationMode
* @apiGroup clients
* @apiDescription Set emulation mode on a UM `client` `volume` attachments
*
* @apiParam {object} setEmulationMode set emulation mode on a UM `client` `volume` attachments
* @apiParam {string} setEmulationMode.client `client ID` to update
* @apiParam {object[]} setEmulationMode.volumes Array of `volumes` attachments
* @apiParam {string} setEmulationMode.volumes.name `volume ID` to set emulation mode
* @apiParam {string} setEmulationMode.volumes.uuid `volume UUID` to set emulation mode
* @apiParam {object} [setEmulationMode.volumes.emulation] `volume` emulation parameters
* @apiParam {string} [attach.volumes.emulation.mode] The `emulation` mode of the `volume`
* <small><i>Available options are: `NONE` (default), `STATIC` or `HOTPLUG`</i></small>
* @apiParamExample {string} Payload example
* {
* 	"client": "nvme21.excelero.com",
* 	"clientUUID": "f02abf10-6bfb-11ed-a62f-d1b4ca08eef3",
* 	"volumes": [{
* 		"name": "V1",
*		"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*		"emulation": {
*			"mode": "STATIC"
*		}
* 	}]
* }
*
* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* [{
*      "success": true,
*	   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*      "_id": "V1",
*      "error": null,
*	   "payload": null
* }]
*/

router.post('/setEmulationMode', isAdminRole, (req, res) => {
	let { client, clientUUID, volumes } = req.body;

	let incomingRequestLogs = volumes.map(volume => createAuditRequestLog(req, systemMessages.CLIENT_SET_EMULATION_MODE_REQUEST)
		.addInfo(Entities.Client.ID, client)
		.addInfo(Entities.Volume.name, volume.name)
		.addInfo(Entities.Volume.UUID, volume.uuid)
		.addInfo(Entities.Volume.emulation, volume.emulation));

	utils.handleRESTAndLog(
		incomingRequestLogs,
		cb => clientModule.setEmulationMode(client, clientUUID, volumes, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID)))
	);
});
module.exports = router;
