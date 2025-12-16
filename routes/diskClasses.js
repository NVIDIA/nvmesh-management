/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* global app */

const express = require('express');
const consts = require('../consts.js');
const utils = require('../utils.js');
const diskClassModule = require('../modules/diskClass.js');

const { MongoError, Entities, getDriveID } = require('../modules/error.js');
const validateProjection = require('../middlewares/validateProjection.js');
const { createAuditRequestLog } = require('../modules/log.js');
const systemMessages = require('../systemMessages.js');
const isAdminRole = require('../middlewares/isAdminRole.js');
const { getCountEntitiesHandler } = require('./common.js');

const router = express.Router();

//Request to render the serverClasses.ejs page.
router.get('/', (req, res) => {
	const renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };

	if (consts.userRoles.ADMIN === req.user.role) {
		renderData.isReact = true;
		renderData.componentName = consts.componentsPages.driveClasses;

		res.render('react', renderData);
	} else
		res.send('insufficient privileges');
});


router.use(isAdminRole);

/**
* @apiVersion 1.0.0
* @api {get} /diskClasses/all Get diskClasses
* @apiName GetDiskClasses
* @apiGroup diskClasses
* @apiDescription Get all `diskClasses`.
*
* @apiSuccess {object[]} diskClasses List Of `diskClasses`.
*
* @apiSuccessExample Example data on success
* [{
* 	"_id": "highEndurance",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
* 	"disks": [{
* 		"model": "INTEL_SSDPE2ME400G4_____________________",
* 		"disks": [{
* 			"diskID": "CVMD439000DE400FGN.1",
* 			"node_id": "nvme31.excelero.com'
*		}],
	}],
* 	"name": "highEndurance",
* 	"createdBy" : "tomzan@mail.com",
*	"modifiedBy" : "tomzan@mail.com",
*	"dateCreated" : ISODate("2015-08-19T17:02:54.136Z"),
*	"domains": [{scope: "Rack", identifier: "A"},{scope: "DRSite", identifier: "C"}],
*	"dateModified" : ISODate("2015-08-19T17:02:54.136Z")
* }, {
* 	"_id": "writeIntensive",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefc",
* 	"disks": [{
* 		"model": "INTEL_SSDPEDME400G4_____________________",
* 		"disks": [{
* 			"diskID": "CVMD4381005Q400AGN.1",
* 			"node_id": "nvme21.excelero.com"
*		}]
* 	}],
* 	"name": "writeIntensive",
* 	"createdBy" : "tomzan@mail.com",
*	"modifiedBy" : "tomzan@mail.com",
*	"dateCreated" : ISODate("2015-08-19T17:06:54.126Z"),
*	"domains": [{scope: "Rack", identifier: "B"}],
*	"dateModified" : ISODate("2015-08-19T17:06:54.115Z")
* }]
*/
router.get('/all/:page/:count', validateProjection, (req, res) => {
	const page = parseFloat(req.params.page);
	const count = parseInt(req.params.count);

	const query = {
		filter: utils.tryParseJSON(req.query.filter) || {},
		projection: utils.tryParseJSON(req.query.projection) || {},
		sort: utils.tryParseJSON(req.query.sort) || {},
		skip: page * count,
		limit: count
	};

	utils.loadCollection('diskClass', query, (err, results) => res.json(results));
});

/**
* @apiVersion 1.0.0
* @api {get} /diskClasses/count Count Disk Classes
* @apiName CountDiskClasses
* @apiGroup diskClasses
* @apiDescription Get total `diskClasses` count.
*
* @apiSuccess {integer} count `diskClasses` count.
*
* @apiSuccessExample Example data on success
* 4
*/
router.get('/count', getCountEntitiesHandler('diskClass'));

//Request to get all the tags that already inserted
router.get('/tags', (req, res) => {
	const db = app.get('db');
	const diskClassCollection = db.collection('diskClass');

	diskClassCollection.aggregate([{ $unwind: '$tags' }, { $project: { tag: '$tags' } }]).toArray((err, results) => {
		if (err)
			new MongoError(err).log();

		res.json(results);
	});
});

/**
* @apiVersion 1.0.0
* @api {post} /diskClasses/save Create diskClasses
* @apiName CreateDiskClasses
* @apiGroup diskClasses
* @apiDescription Create `diskClasses`.
*
* @apiParam {object[]} diskClasses `diskClasses` to create.
* @apiParam {object[]} diskClasses.disks Array of `model` and `disks`.
* @apiParam {string} diskClasses.disks.model `Model` of the `disks` in the following array.
* @apiParam {string} diskClasses.disks.diskID Identifier of `disk`.
* @apiParam {string} diskClasses.disks.node_id `Server name` of the `disk`.
* @apiParam {string} diskClasses._id `Name` of the `diskClass`.
* @apiParam {string} [diskClasses.description] `Description` of the `diskClass`.
* @apiParam {object[]} [diskClasses.domains] `Domains` of the `diskClass`.
* @apiParamExample {string} Payload example
* [{
* 	"disks": [{
* 			"diskID": "CVCQ523400G9400AGN.1",
* 			"node_id": "nvme50.excelero.com",
*			"model" : "SAMSUNG MZQKW480HMHQ-00003______________"
*		}, {
* 			"diskID": "CVCQ52430008400AGN.1",
* 			"node_id": "nvme51.excelero.com",
*			"model" : "SAMSUNG MZQKW480HMHQ-00003______________"
* 		}],
* 	"_id": "highPerformance",
* 	"description": "Super duper fast disks",
*	"domains": [{ "scope": "Rack", "identifier": "A" }]
* }]
*
* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* [{
*	"_id": "highEndurance",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*	"success": true,
*	"error": null,
*	"payload": null
* }]
*/
router.post('/save', (req, res) => {
	const driveClasses = req.body;

	const incomingRequestSystemAdminMessages = driveClasses.map(driveClass => {
		const message = createAuditRequestLog(req, systemMessages.DRIVECLASS_SAVE_REQUEST)
			.addInfo(Entities.DriveClass.ID, driveClass._id);

		driveClass.disks.forEach(disk => message
			.addInfo(Entities.Drive.ID, getDriveID(disk.diskID, disk.node_id))
			.addInfo(Entities.Target.ID, disk.node_id)
			.addInfo(Entities.Drive.model, disk.model));

		if (driveClass.description)
			message.addInfo(Entities.DriveClass.description, driveClass.description);

		return message;
	});

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => diskClassModule.saveDriveClasses(driveClasses, req.user, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.DriveClass.ID, Entities.DriveClass.UUID))));
});

/**
* @apiVersion 1.0.0
* @api {post} /diskClasses/delete Delete diskClasses
* @apiName DeleteDiskClasses
* @apiGroup diskClasses
* @apiDescription Delete `diskClasses`.
*
* @apiParam {string} _id The `id[s]` of the `diskClasses[s]` to delete.
* @apiParamExample {object[]} Payload example
* [{
* 	"_id": "highEndurance",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb"
* }]
*
* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* [{
*	"_id": "highEndurance",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*	"success": true,
*	"error": null,
*	"payload": null
* }]
*/
router.post('/delete', function(req, res) {
	const driveClasses = req.body;

	const incomingRequestSystemAdminMessages = driveClasses.map(driveClass => createAuditRequestLog(req, systemMessages.DRIVECLASS_DELETE_REQUEST)
		.addInfo(Entities.DriveClass.ID, driveClass._id)
		.addInfo(Entities.DriveClass.UUID, driveClass.uuid));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => diskClassModule.deleteDriveClasses(driveClasses, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.DriveClass.ID, Entities.DriveClass.UUID))));
});

/**
* @apiVersion 1.0.0
* @api {post} /diskClasses/update Update diskClasses
* @apiName UpdateDiskClasses
* @apiGroup diskClasses
* @apiDescription Update `diskClasses`. <small><i>--name field cannot be updated</i></small>
*
* @apiParam {object[]} diskClasses `diskClasses` to update.
* @apiParam {string} diskClasses._id `diskClasses ID` to update.
* @apiParam {object[]} diskClasses.disks Array of `model` and `disks`.
* @apiParam {string} diskClasses.disks.model `Model` of the `disks` in the following array.
* @apiParam {object[]} diskClasses.disks.disks List of `disks` from the same `model`.
* @apiParam {string} diskClasses.disks.disks.diskID Identifier of `disk`.
* @apiParam {string} diskClasses.disks.disks.node_id `Server name` of the `disk`.
* @apiParam {string} [diskClasses.description] `Description` of the `diskClass`.
* @apiParam {object[]} [diskClasses.domains] `Domains` of the `diskClass`.
* @apiParamExample {string} Payload example
* [{
* 	"_id": "highEndurance",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
* 	"description": "Super duper fast disks",
* 	"disks": [{
* 			"diskID": "CVCQ523400G9400AGN.1",
* 			"node_id": "nvme50.excelero.com",
*			"model" : "SAMSUNG MZQKW480HMHQ-00003______________"
*		}, {
* 			"diskID": "CVCQ52430008400AGN.1",
* 			"node_id": "nvme51.excelero.com",
*			"model" : "SAMSUNG MZQKW480HMHQ-00003______________"
* 		}],
* 	"domains": [{ "scope": "Rack", "identifier": "B" }]
* }]
*
* @apiSuccess {object[]} results Results for the diskClasses we tried to update.
* @apiSuccess {string} results.DiskClassID the `ID` of the `diskClass` we attempted to update.
* @apiSuccess {boolean} results.success Indication whether `diskClass` update succeeded or not.<br />
* <small><i>`true` if succeeded, `false` if failed.</i></small>
*
* @apiSuccessExample Example data on success
* [{
*	"_id": "highEndurance",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*	"success": true,
*	"error": null,
*	"payload": null
* }]
*/
router.post('/update', function(req, res) {
	const driveClasses = req.body;

	const incomingRequestSystemAdminMessages = driveClasses.map(driveClass => createAuditRequestLog(req, systemMessages.DRIVECLASS_UPDATE_REQUEST)
		.addInfo(Entities.DriveClass.ID, driveClass._id)
		.addInfo(Entities.DriveClass.UUID, driveClass.uuid));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => diskClassModule.updateDriveClasses(driveClasses, req.user, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.DriveClass.ID, Entities.DriveClass.UUID))));
});

router.post('/getDisksByServerAndDiskClasses', (req, res) => {
	const diskClasses = req.body.diskClasses;
	const serverClasses = req.body.serverClasses;

	utils.getDisksByClasses(diskClasses, serverClasses, null, null, false, (data) => {
		res.json(data);
	});
});

router.get('/getDomains', (req, res) => {
	const { projection } = req.query;

	diskClassModule.getDomains(projection, (results) => {
		res.json(results);
	});
});

/**
* @apiVersion 1.0.0
* @api {get} /diskClasses/:id Get diskClass by ID
* @apiName GetDiskClass
* @apiGroup diskClasses
* @apiDescription Get specific `diskClass` by `ID`.
*
* @apiParam {string} diskClass `diskClass's ID` to fetch.
* @apiParamExample {string} Example request
* diskClasses/dc1
*
* @apiSuccess {object} API Response
*
* @apiSuccessExample Example data on success
* {
*         "_id": "dc1",
*         "disks": [
*             {
*                 "diskID": "S3HCNX0K800794.1",
*                 "node_id": "nvme1038.mtv.labs.mlnx",
*                 "model": "SAMSUNG MZWLL800HEHP-00003",
*                 "diskIDD": "asd"
*             },
*             {
*                 "diskID": "S3HCNX0K800796.1",
*                 "node_id": "nvme1038.mtv.labs.mlnx",
*                 "model": "SAMSUNG MZWLL800HEHP-00003",
*                 "diskIDD": "asd"
*             },
*             {
*                 "diskID": "S3HCNX0K800376.1",
*                 "node_id": "nvme1038.mtv.labs.mlnx",
*                 "model": "SAMSUNG MZWLL800HEHP-00003",
*                 "diskIDD": "asd"
*             },
*             {
*                 "diskID": "S23YNAAH200313.1",
*                 "node_id": "nvme1038.mtv.labs.mlnx",
*                 "model": "SAMSUNG MZQLV480HCGR-00003",
*                 "diskIDD": "asd"
*             }
*         ],
*         "modifiedBy": "admin@nvidia.com",
*         "createdBy": "admin@nvidia.com",
*         "dateModified": "2024-04-17T12:28:32.714Z",
*         "dateCreated": "2024-04-17T12:28:32.714Z"
* }
*/
router.get('/:id', (req, res) => {
	diskClassModule.fetchDriveClassByID(req.params.id, (error, driveClass) => {
		if (error)
			return res.json(error.createApiResponse());

		return res.json(driveClass);
	});
});

module.exports = router;
