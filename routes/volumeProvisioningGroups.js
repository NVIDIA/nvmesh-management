/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global app */

var express = require('express');

var utils = require('../utils.js');
var logger = require('../logger.js');
var consts = require('../consts.js');

var router = express.Router();

var { MongoError, Entities } = require('../modules/error.js');

var systemMessages = require('../systemMessages.js');
const { createAuditRequestLog } = require('../modules/log.js');
const {
	saveVPGs,
	deleteVPGs,
	updateVPGs,
	extendVPGs,
	getVolumesCapacityUsageByID,
	getVolumesCapacityUsageAll,
	fetchVPGByID
} = require('../modules/volumeProvisioningGroup.js');
const validateProjection = require('../middlewares/validateProjection.js');
const isAdminRole = require('../middlewares/isAdminRole.js');
const { getCountEntitiesHandler } = require('./common.js');

router.get('/', function(req, res) {
	var renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };

	if (consts.userRoles.ADMIN === req.user.role) {
		renderData.componentName = consts.componentsPages.vpg;

		res.render('react', renderData);
	} else
		res.send('insufficient privileges');
});

/**
* @apiVersion 17.0.0
* @api {get} /volumeProvisioningGroups/getVolumesCapacityUsageByID/:id Get volumeProvisioningGroup volumes usage data by ID
* @apiName GetVolumesCapacityUsageByID
* @apiGroup VPGs
* @apiDescription Get volumes usage data  for  a specific `volumeProvisioningGroup` by `ID`.
*
* @apiParam {string} id `volumeProvisioningGroup's ID` to fetch.
* @apiParamExample {string} Example request
* volumeProvisioningGroups/getVolumesCapacityUsageByID/test
* @apiSuccess {object} API Response
* @apiSuccessExample Example data on success
*{
*  "VPG": "test",
*  "allowOverflow": false, // indicates if the VPG is allowing allocation outside reserved space
*  "totalCapacity": 11, // total VPG reserved space in GB
*  "allocatedCapacity": 5, // used VPG reserved space across volumes in GB
*  "freeCapacity": 6, // free VPG reserved space in GB
*  "volumesInUse": [
*    {
*      "name": "testvol",
*      "uuid": "96aca9f0-5ca6-11f0-91b1-5166e9f5afff"
*    },
*    {
*      "name": "testvol2",
*      "uuid": "9d9a3160-5ca6-11f0-91b1-5166e9f5afff"
*    }
*  ]
*}
*/
router.get('/getVolumesCapacityUsageByID/:id', (req, res) => {
	const id = req.params.id;

	getVolumesCapacityUsageByID(id, result => {
		return res.json(result);
	});
});

router.get('/getVolumesCapacityUsage/all', (req, res) => {
	getVolumesCapacityUsageAll(result => {
		return res.json(result);
	});
});

router.use(isAdminRole);

/**
* @apiVersion 17.0.0
* @api {get} /volumeProvisioningGroups/all/:page/:count?filter={}&sort={} Get VPGs
* @apiName GetVPGs
* @apiGroup VPGs
* @apiDescription Get all `VPGs`.
*
* @apiParam {integer} page The `page` number to fetch.
* @apiParam {integer} count Number of records per `page`.
* @apiParam {object} [filter] `Filter` before fetching. <small><i>--MongoDB filter obj.</i></small>
* @apiParam {object} [sort] `Sort` before fetching. <small><i>--MongoDB sort obj.</i></small>
* @apiSuccess {object[]} VPGs List Of `VPGs`
* @apiSuccessExample Example data on success
* [{
* 	"_id": "VPG1",
* 	"diskClasses": [],
* 	"serverClasses": [],
* 	"RAIDLevel": "Concatenated",
* 	"serviceResources": "Indirect",
* 	"capacity": 100,
* 	"name": "VPG1",
*	"allowOverflow": true,
* 	"description": "Test for simple VPG",
* 	"modifiedBy": "tomzan@mail.com",
* 	"createdBy": "tomzan@mail.com",
* 	"dateCreated": "2015-08-25T15:57:03.929Z",
* 	"dateModified": "2015-08-25T15:57:03.929Z"
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

	utils.loadCollection('volumeProvisioningGroup', query, function(err, results) { res.json(results); });
});

/**
* @apiVersion 17.0.0
* @api {get} /volumeProvisioningGroups/count Count VPGs
* @apiName CountVPGs
* @apiGroup VPGs
* @apiDescription Get total `VPG` count.
* @apiSuccess {integer} count `VPG` count.
* @apiSuccessExample Example data on success
* 4
*/
router.get('/count', getCountEntitiesHandler('volumeProvisioningGroup'));

/**
* @apiVersion 17.2.1
* @api {post} /volumeProvisioningGroups/save Create VPGs
* @apiName CreateVPGs
* @apiGroup VPGs
* @apiDescription Create `VPGs`.
*
* @apiBody {object[]} VPGs `VPGs` to save.
* @apiBody {string} VPGs.name <strong>Required</strong>. Name of the `VPG`.
* @apiBody {string} VPGs.RAIDLevel <strong>Required</strong>. The RAID level for volumes in this VPG.<br />
* <small><i>Options: `Concatenated`, `Striped RAID-0`, `Mirrored RAID-1`, `Striped & Mirrored RAID-10`, `Erasure Coding`, `Striped Erasure Coding`.</i></small>
* @apiBody {string} [VPGs.capacity=0] Space to reserve for the VPG in GB.
* @apiBody {string} [VPGs.description] `Description` of the `VPG`.
* @apiBody {string[]} [VPGs.diskClasses] Limit volumes allocation to specific `diskClasses`.
* @apiBody {string[]} [VPGs.serverClasses] Limit volumes allocation to specific `serverClasses`.
* @apiBody {string[]} [VPGs.VSGs] Associated volume security groups.
* @apiBody {boolean} [VPGs.allowOverflow=true] Allow allocation outside of reserved space.
* @apiBody {boolean} [VPGs.allowAllocationOnOfflineDrives=false] Use offline drives for allocation.
* @apiBody {string} [VPGs.type] `type` of the VPG. Set to `METADATA_VOLUME` if the VPG is for a snapshot's metadata volume.
This will force `RAIDLevel` to `Mirrored RAID-1`.
* @apiBody {boolean} [VPGs.isEncrypted=false] Volumes in this VPG will be encrypted.
* @apiBody {object} [VPGs.encryption] Encryption options. <strong>Available when `isEncrypted` is true.</strong>
* @apiBody {integer} [VPGs.encryption.headerSize=16] Volume encryption header size in MiB.
* @apiBody {string} [VPGs.domain] `Protection Domain` to use for allocation.
* @apiBody (RAID) {integer} [stripeSize=32] Stripe size in 4k blocks (e.g., 32 for 128k). <br/><strong>Depends on `RAIDLevel`.</strong>
* @apiBody (RAID) {integer} [stripeWidth=2] Number of disks for stripe. <br/><strong>Depends on `RAIDLevel`.</strong>
* @apiBody (RAID) {integer} [numberOfMirrors=1] Number of mirrors. Allowed values are 1 or 2. <br/><strong>Depends on `RAIDLevel`.</strong>
* @apiBody (RAID) {integer} [dataBlocks=8] Number of data disks for Erasure Coding. <br/><strong>Depends on `RAIDLevel`.</strong>
* @apiBody (RAID) {integer} [parityBlocks=2] Number of parity disks for Erasure Coding. <br/><strong>Depends on `RAIDLevel`.</strong>
* @apiBody (RAID) {string} [protectionLevel='Full Separation'] Protection level. <small><i>Options: `Full Separation`, `Minimal Separation`,
`Ignore Separation`.</i></small> <br/><strong>Depends on `RAIDLevel`.</strong>
* @apiBody (RAID) {boolean} [ignoreNodeSeparation] <strong>Obsolete</strong> — use `protectionLevel` (`Ignore Separation` instead of `true`).
Mutually exclusive with `protectionLevel`. <br/><strong>Depends on `RAIDLevel`.</strong>
* @apiBody (RAID) {boolean} [enableCrcCheck=false] `enableCrcCheck` Enables CRC check for the derived volumes.
Defaults to true for Erasure Coding and Striped Erasure Coding.
* @apiExample {object[]} Payload example
* [{
* 	"RAIDLevel": "Striped RAID-0",
*	"capacity": 100,
*	"description": "Plain text",
*	"diskClasses": null,
*	"name": "VPG1",
*	"serverClasses": ["V1"],
*	"VSGs": ["VSG1"],
*	"allowOverflow": true,
*	"domain": "Rack",
*	"stripeSize": 32,
*	"stripeWidth": 2,
*	"enableCrcCheck": false
* }]
* @apiSuccess {object} results success statuses
* @apiSuccessExample Example data on success
* [{
*	"_id": "highEndurance",
*	"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398"
*	"success": true,
*	"error": null
* }]
*/
router.post('/save', function(req, res) {
	let vpgs = req.body;

	let incomingRequestSystemAdminMessages = vpgs.map(vpg => createAuditRequestLog(req, systemMessages.VPG_SAVE_REQUEST)
		.addInfo(Entities.VPG.name, vpg.name)
		.addInfo(Entities.VPG.definition, vpg));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => saveVPGs(vpgs, req.user, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.VPG.ID, Entities.VPG.UUID)))
	);
});

/**
* @apiVersion 17.0.0
* @api {post} /volumeProvisioningGroups/delete Delete VPGs
* @apiName DeleteVPGs
* @apiGroup VPGs
* @apiDescription Delete `VPGs`. <small><i>A VPG cannot be deleted if it has volumes.</i></small>
*
* @apiBody {object[]} VPGs `VPGs` to delete.
* @apiBody {string} VPGs._id The `ID` of the `VPG` to delete.
* @apiBody {string} VPGs.uuid The `UUID` of the `VPG` to delete.
* @apiExample {object[]} Payload example
* [{
* 	"_id": "VPG1",
*	"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398"
* }]
*
* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* [{
*	"_id": "VPG1",
*	"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398"
*	"success": true,
*	"error": null,
*	"payload": null
* }]
*/
router.post('/delete', function(req, res) {
	let VPGs = req.body;

	let incomingRequestSystemAdminMessages = VPGs.map(vpg => createAuditRequestLog(req, systemMessages.VPG_DELETE_REQUEST)
		.addInfo(Entities.VPG.ID, vpg._id)
		.addInfo(Entities.VPG.UUID, vpg.uuid));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => deleteVPGs(VPGs, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.VPG.ID, Entities.VPG.UUID)))
	);
});

/**
* @apiVersion 17.0.0
* @api {post} /volumeProvisioningGroups/update Update VPGs
* @apiName UpdateVPGs
* @apiGroup VPGs
* @apiDescription Update VPGs. Only the properties listed below can be updated.
* @apiBody {object[]} VPGs `VPGs` to update.
* @apiBody {string} VPGs._id <strong>Required</strong>. The `ID` of the `VPG` to update.
* @apiBody {string} VPGs.uuid <strong>Required</strong>. The `UUID` of the `VPG` to update.
* @apiBody {string} [VPGs.description] The `VPG`'s description.
* @apiBody {string[]} [VPGs.VSGs] Associated volume security groups.
* @apiBody {boolean} [VPGs.allowAllocationOnOfflineDrives] Use offline drives for allocation.
* @apiExample {object[]} Payload example
* [{
*		"_id": "VPG5",
*		"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398",
* 		"description": "New description"
* }]
*
* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* [{
* 		"_id": "VPG5",
*   	"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
* 		"success": true,
*		"error": null
* 		"payload": null
* }]
*/
router.post('/update', function(req, res) {
	let VPGs = req.body;

	let incomingRequestSystemAdminMessages = VPGs.map(vpg => createAuditRequestLog(req, systemMessages.VPG_UPDATE_REQUEST)
		.addInfo(Entities.VPG.ID, vpg._id)
		.addInfo(Entities.VPG.UUID, vpg.uuid));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => updateVPGs(VPGs, req.user, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.VPG.ID, Entities.VPG.UUID)))
	);
});

/**
* @apiVersion 17.0.0
* @api {post} /volumeProvisioningGroups/extend Extend VPGs
* @apiName ExtendVPGs
* @apiGroup VPGs
* @apiDescription Extend VPGs.
* @apiBody {object[]} VPGs `VPGs` to extend.
* @apiBody {string} VPGs._id The `ID` of the `VPG` to extend.
* @apiBody {string} VPGs.uuid The `UUID` of the `VPG` to extend.
* @apiBody {integer} [VPGs.capacity] Extend the `VPG` capacity.
* @apiBody {boolean} [VPGs.allowAllocationOnOfflineDrives] Use offline drives for allocation, defaults to false.
* @apiExample {object[]} Payload example
* [{
*		"_id": "VPG5",
*		"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398",
* 		"capacity": 200,
* }]
* @apiSuccess {object} results success statuses
* @apiSuccessExample Example data on success
* [{
* 		"_id": "VPG5",
*		"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
* 		"success": true,
*		"error": null
* 		"payload": null
* }]
*/
router.post('/extend', function(req, res) {
	let VPGs = req.body;

	let incomingRequestSystemAdminMessages = VPGs.map(vpg => createAuditRequestLog(req, systemMessages.VPG_EXTEND_REQUEST)
		.addInfo(Entities.VPG.ID, vpg._id)
		.addInfo(Entities.VPG.UUID, vpg.uuid)
		.addInfo(Entities.VPG.capacity, vpg.capacity));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => extendVPGs(VPGs, req.user, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.VPG.ID, Entities.VPG.UUID)))
	);
});

router.get('/getDisksByID/:id', function(req, res) {
	var id = req.params.id;
	var db = app.get('db');
	var vpgCollection = db.collection('volumeProvisioningGroup');

	vpgCollection.find({ _id: id }).toArray(function(err, results) {
		if (err)
			err = new MongoError(err);

		if (err || !results || !results.length) {
			logger.sysDEBUG('Failed to load VPG', err);
			return res.json(results);
		}

		utils.getDisksByClasses(results[0].diskClasses, results[0].serverClasses, null, null, false, function(data) {
			res.json(data);
		});
	});
});

/**
* @apiVersion 17.0.0
* @api {get} /volumeProvisioningGroups/:id Get volumeProvisioningGroup by ID
* @apiName GetVolumeProvisioningGroup
* @apiGroup VPGs
* @apiDescription Get specific `volumeProvisioningGroup` by `ID`.
*
* @apiParam {string} id `volumeProvisioningGroup's ID` to fetch.
* @apiParamExample {string} Example request
* volumeProvisioningGroups/DEFAULT_CONCATENATED_VPG
* @apiSuccess {object} API Response
* @apiSuccessExample Example data on success
* {
*         "_id": "DEFAULT_CONCATENATED_VPG",
*         "RAIDLevel": "Concatenated",
*         "capacity": 0,
*         "createdBy": "admin@nvidia.com",
*         "dateCreated": "2024-04-17T12:12:46.691Z",
*         "dateModified": "2024-04-17T12:12:46.691Z",
*         "diskClasses": [],
*         "isDefault": true,
*         "modifiedBy": "admin@nvidia.com",
*         "name": "DEFAULT_CONCATENATED_VPG",
*         "serverClasses": [],
*         "serviceResources": "RDDA",
*         "uuid": "cd306330-fcb3-11ee-b01f-e19dd52b26f7"
* }
*/
router.get('/:id', (req, res) => {
	fetchVPGByID(req.params.id, (error, vpg) => {
		if (error)
			return res.json(error.createApiResponse());

		return res.json(vpg);
	});
});


module.exports = router;
