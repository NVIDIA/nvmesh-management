/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global app */

var express = require('express');

var utils = require('../utils.js');
var consts = require('../consts.js');
var diskModule = require('../modules/disk.js');
var router = express.Router();

var { MongoError, Entities, SystemMessage } = require('../modules/error.js');
const { createAuditRequestLog } = require('../modules/log.js');

var systemMessages = require('../systemMessages.js');
const validateProjection = require('../middlewares/validateProjection.js');
const isAdminRole = require('../middlewares/isAdminRole.js');

router.get('/', function(req, res) {
	var renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };
	renderData.componentName = consts.componentsPages.drives;

	res.render('react', renderData);
});


router.get('/models', function(req, res) {
	var db = app.get('db');
	var serverCollection = db.collection('server');

	serverCollection.aggregate([{ $unwind: '$disks' }, { $group: { _id: '$disks.Model', available: { $sum: 1 } } }]).toArray(function(err, results) {
		if (err)
			new MongoError(err).log();

		res.json(results);
	});
});

const drivesProjection = {
	'disks.diskID': 1,
	'disks.nodeID': 1,
	'disks.Model': 1,
	'disks.Serial_Number': 1,
	'disks.Vendor': 1,
	'disks.status': 1,
	'disks.isExcluded': 1,
	'disks.excludeReason': 1,
	'disks.excludedByManagement': 1,
	'disks.automaticallyEvicted': 1,
	'disks.autoEvictReason': 1,
	'disks.isOutOfService': 1,
	'disks.usableBlocks': 1,
	'disks.availableBlocks': 1,
	'disks.nZeroedBlks': 1,
	'disks.blocks': 1,
	'disks.uuid': 1,
	'disks.isPendingFormat': 1,
	'disks.diskSegments': 1,
	'disks.metadata_size': 1,
	'disks.block_size': 1,
	'disks.health': 1,
	'disks.vendor': 1,
	'node_id': 1,
	'health': 1,
	'zone': 1
};

/**
* @apiVersion 1.0.0
* @api {get} /disks/all/:page/:count?filter={}&sort={}&projection={} Get Disks
* @apiName GetDisks
* @apiGroup disks
* @apiDescription Get `disks` by `page` and `count`..
*
* @apiParam {integer} page The `page` number to fetch.
* @apiParam {integer} count Number of records per `page`.
* @apiParam {object} [filter] `Filter` before fetching. <small><i>--MongoDB filter obj</i></small>
* @apiParam {object} [sort] `Sort` before fetching. <small><i>--MongoDB sort obj</i></small>
* @apiParam {object} [projection] `Projection` before fetching. <small><i>--MongoDB projection obj</i></small>
* @apiSuccess {object[]} disks List Of `disks`.
*
* @apiSuccessExample Example data on success
* {
*     "edges": [
*         {
*             "_id": "nvme1038",
*             "node_id": "nvme1038",
*             "disks": {
*                 "diskID": "S3HCNX0K800794.1",
*                 "blocks": 195353046,
*                 "block_size": 4096,
*                 "metadata_size": 8,
*                 "Serial_Number": "S3HCNX0K800794",
*                 "Vendor": "Samsung",
*                 "Model": "SAMSUNG MZWLL800HEHP-00003",
*                 "status": "Ok",
*                 "isExcluded": false,
*                 "excludeReason": "None",
*                 "nodeID": "nvme1038",
*                 "uuid": "699c0b70-0b78-11ef-9dca-9fcb6cce2ad8",
*                 "availableBlocks": 193842944,
*                 "usableBlocks": 193842944,
*                 "health": "healthy",
*                 "autoEvictReason": "",
*                 "automaticallyEvicted": false,
*                 "isOutOfService": false,
*                 "isPendingFormat": false,
*                 "diskSegments": []
*             },
*             "health": "healthy",
*             "zone": "1"
*         }
*     ],
*     "pageInfo": [
*         {
*             "_id": 1,
*             "count": 17
*         }
*     ]
* }
*/
router.get('/all/:page/:count', validateProjection, function(req, res) {
	var page = parseFloat(req.params.page);
	var count = parseInt(req.params.count);
	var sort = utils.tryParseJSON(req.query.sort) || {};
	var filter = utils.tryParseJSON(req.query.filter) || {};
	const requestProjection = utils.tryParseJSON(req.query.projection) || {};
	var projection = Object.keys(requestProjection).length ? requestProjection : drivesProjection;

	var edges = [
		{ $skip: page * count }
	];
	count && edges.push({ $limit: count });

	var matchQuery = { $match: filter };

	var aggregatePipeline = [
		{ $project: { 'disks.diskSegments': 0 } },
		{ $unwind: '$disks' },
		matchQuery,
		{ $project: projection },
		{
			$facet: {
				edges: edges,
				pageInfo: [
					{ $group: { _id: 1, count: { $sum: 1 } } },
				],
			},
		}
	];

	!utils.isEmpty(sort) && aggregatePipeline.splice(aggregatePipeline.indexOf(matchQuery), 0, { $sort: sort });

	var db = app.get('db');
	var serverCollection = db.collection('server');

	serverCollection.aggregate(aggregatePipeline).toArray(function(err, results) {
		if (err)
			new MongoError(err).log();

		if (results?.length && req.headers['user-agent'].includes('python-requests'))
			results = [results[0].edges];

		res.json(results && results.length ? results[0] : { err: 'Disks wasn\'t found!' });
	});
});


/**
* @apiVersion 1.0.0
* @api {get} /disks/count Count DisksdiskMatch["disks.diskID"]
* @apiGroup disks
* @apiDescription Get total `disks` count.
*
* @apiParam {object} [filter] `Filter` before fetching. <small><i>--MongoDB filter obj</i></small>
*
* @apiSuccess {integer} count `disks` count.
*
* @apiSuccessExample Example data on success
* 4
*/
router.get('/count', (req, res) => {
	const filter = utils.tryParseJSON(req.query.filter) || {};

	const db = app.get('db');
	const serverCollection = db.collection('server');
	const pipeline = [
		{ $project: drivesProjection },
		{ $unwind: '$disks' },
		{ $match: filter },
		{ $group: { _id: 1, count: { $sum: 1 } } }
	];

	serverCollection.aggregate(pipeline).toArray(function(err, results) {
		if (err)
			new MongoError(err).log();

		res.json(results && results[0] ? results[0].count : 0);
	});
});

router.get('/segments/:page/:count', function(req, res) {
	var page = parseInt(req.params.page);
	var count = parseInt(req.params.count);
	var sort = utils.tryParseJSON(req.query.sort) || { _id: 1 };
	var filter = utils.tryParseJSON(req.query.filter) || {};
	var serverID = req.query.serverID || null;
	var diskID = req.query.diskID || null;

	var serverIdMatch = serverID ? { _id: serverID } : {};
	var diskIdMatch = diskID ? { 'disks.diskID': diskID } : {};
	var sortQuery = { $sort: sort };

	var statusFilter = {};

	// segment status fields is taken from the volume collection and should have a later filter
	if ('disks.diskSegments.status' in filter) {
		statusFilter['disks.diskSegments.status'] = filter['disks.diskSegments.status'];
		delete filter['disks.diskSegments.status'];
	}

	var aggregatePipeline = [
		{ $project: {
			disks: 1,
			_id: 1,
			node_id: 1
		} },
		{ $match: serverIdMatch },
		{ $unwind: '$disks' },
		{ $project: {
			'disks.diskSegments': 1,
			'disks.diskID': 1,
			'disks.Model': 1,
			'disks.nodeID': 1
		} },
		{ $match: diskIdMatch },
		{ $unwind: '$disks.diskSegments' },
		{ $match: filter },
		{ $lookup: {
			from: 'volume',
			let: { segUUID: '$disks.diskSegments.uuid', volName: '$disks.diskSegments.volumeName' },
			pipeline: [
				{
					$match: {
						$expr: {
							$eq: ['$name', '$$volName']
						}
					}
				},
				{
					$project: {
						'chunks.pRaids.diskSegments.uuid': 1,
						'chunks.pRaids.diskSegments.status': 1
					}
				},
				{
					$unwind: '$chunks'
				},
				{
					$unwind: '$chunks.pRaids'
				},
				{
					$unwind: '$chunks.pRaids.diskSegments'
				},
				{
					$match: {
						$expr: {
							$eq: ['$chunks.pRaids.diskSegments.uuid', '$$segUUID']
						}
					}
				}
			],
			as: 'volSegStatus'
		} },
		{
			$addFields: {
				'volSegStatus': { $arrayElemAt: ['$volSegStatus', 0] }
			}
		},
		{
			$addFields: {
				'disks.diskSegments.status': '$volSegStatus.chunks.pRaids.diskSegments.status'
			}
		},
		{ $project: { 'volSegStatus': 0 } },
		{ $match: statusFilter },
		sortQuery,
		{
			$facet: {
				edges: [
					{ $skip: page * count },
					{ $limit: count },
				],
				pageInfo: [
					{ $group: { _id: 1, count: { $sum: 1 } } },
				],
			},
		}
	];
	var db = app.get('db');
	var serverCollection = db.collection('server');

	utils.isEmpty(sort) && aggregatePipeline.splice(aggregatePipeline.indexOf(sortQuery) - 1, 1);

	serverCollection.aggregate(aggregatePipeline).toArray(function(err, results) {
		if (err)
			new MongoError(err).log();

		res.json(results && results.length ? results[0] : { err: 'Disks wasn\'t found!' });
	});
});

//getting distinct list of models
router.post('/getModelsByAlreadySelectedDisks', function(req, res) {
	var db = app.get('db');
	var serverCollection = db.collection('server');
	var modelAndDisks = req.body;
	var disks = [];

	modelAndDisks.forEach(function(md) {
		disks = disks.concat(md.disks);
	});

	disks = disks.map(function(e) { return e.diskID; });

	serverCollection.aggregate([
		{ $unwind: '$disks' },
		{ $match: { 'disks.diskID': { $nin: disks } } },
		{ $group: { _id: '$disks.Model', available: { $sum: 1 } } }]).toArray(function(err, results) {
		if (err)
			new MongoError(err).log();

		res.json(results);
	}
	);
});

router.get('/disksByModel/:model', function(req, res) {
	var db = app.get('db');
	var serverCollection = db.collection('server');
	var model = req.params.model;

	serverCollection.aggregate([
		{ $unwind: '$disks' },
		{ $match: { 'disks.Model': { $regex: model } } },
		{ $project: { 'disks': 1, _id: 0, node_id: 1 } }
	]).toArray(function(err, results) {
		if (err)
			new MongoError(err).log();

		res.json(results);
	}
	);
});

//This method should be 'GET' but because angular.js can't parse array correctly its 'POST'
router.post('/disksByNodes/', function(req, res) {
	utils.getDisksByNodes(req.body, function(err, data) {
		res.json(data);
	});
});

/**
* @apiVersion 1.0.0
* @api {post} /disks/delete Delete disk by ID
* @apiName DeleteDisk
* @apiGroup disks
* @apiDescription Delete specific `disk` by `ID`. <small><i>--`Disk` can only be deleted if it doesn't
* contain any `diskSegments` and not in NOT_INITIALIZED status or in EXCLUDED state</i></small>
*
* @apiParam {object[]} configurationProfiles `disks` to delete.
* @apiParam {string} _id The `_id` of the `disks` to delete.
* @apiParam {string} uuid The `uuid` of the `disks` to delete.
* @apiParamExample {object[]} Payload example
* [{
* 	"_id": "S23YNAAH200330.1",
* 	"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb"
* }]
*
* @apiSuccessExample Example data on success
* [{
*	"_id": "S23YNAAH200330.1",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*	"success": true,
*	"error": null,
*	"payload": null
* }]
*/
router.post('/delete', isAdminRole, function(req, res) {
	const disks = req.body;

	let incomingRequestSystemAdminMessages = disks.map(disk =>
		createAuditRequestLog(req, systemMessages.DISK_DELETE_REQUEST)
			.addInfo(Entities.Drive.ID, disk._id)
			.addInfo(Entities.Drive.UUID, disk.uuid));


	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => diskModule.deleteDisks(disks, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Drive.ID, Entities.Drive.UUID))));
});

/**
* @apiVersion 1.0.0
* @api {post} /disks/evictDiskByDiskIDsAndUUIDs Evict disk
* @apiName EvictDisk
* @apiGroup disks
* @apiDescription Evict a disk.
*
* @apiParam {object[]} disks `disks` to evict.
* @apiParam {string} disk.diskID The `diskID` of the `disk` to evict.
* @apiParam {string} disk.uuid The `diskUUID` of the `disk` to evict.
* @apiParamExample {string} Payload example
* [{
*		"diskID": "S23YNAAH200330.1"
*		"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398",
* }]
*
* @apiSuccessExample Example data on success
* [{
*	"_id": "S23YNAAH200330.1",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*	"success": true,
*	"error": null,
*	"payload": null
* },
* {
*	"_id": "PHMD614200A3400FGN.1",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefc",
*	"success": true,
*	"error": null,
*	"payload": null
* }]
*/
router.post('/evictDiskByDiskIDsAndUUIDs', isAdminRole, (req, res) => {
	let disks = req.body;
	let user = req.user.email;


	let incomingRequestSystemAdminMessages = disks.map(disk =>
		createAuditRequestLog(req, systemMessages.DISK_EVICT_REQUEST)
			.addInfo(Entities.Drive.ID, disk.diskID)
			.addInfo(Entities.Drive.UUID, disk.uuid));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => diskModule.evictDiskByDiskIDsAndUUIDsWithLogsWrapper(disks, user, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Drive.ID, Entities.Drive.UUID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {post} /disks/formatDiskByIDsAndUUIDs Format disk
* @apiName FormatDisk
* @apiGroup disks
* @apiDescription Start the format process for the specified disks according to the specified format type.
*
* @apiParam {string[]} diskIDs The `diskID[s]` of the `disk[s]` to format.
* @apiParam {string} formatType The `formatType` that specifies the way to format all the given disks. <br />
* <small><i>Options: `format_raid`, `format_ec`.</i></small>
* @apiParamExample {object[]} Payload example
* {
* 	disks: [{ _id: "PHMD614200A3400FGN.1", uuid: "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb" }],
*	formatType: "format_ec"
* }
*
* @apiSuccessExample Example data on success
* [{
*	"_id": "S23YNAAH200330.1",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*	"success": true,
*	"error": null,
*	"payload": null
* }]
*/
router.post('/formatDiskByIDsAndUUIDs', isAdminRole, (req, res) => {
	const { disks, formatType } = req.body;

	const incomingRequestSystemAdminMessage = createAuditRequestLog(req, systemMessages.DISK_FORMAT_REQUEST)
		.addInfo(Entities.Drive.formatType, formatType);

	disks.forEach(disk => incomingRequestSystemAdminMessage.addInfo(Entities.Drive.ID, disk._id).addInfo(Entities.Drive.UUID, disk.uuid));

	utils.handleRESTAndLog(
		[incomingRequestSystemAdminMessage],
		cb => diskModule.formatDiskByIDsAndUUIDs(disks, formatType, false, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Drive.ID, Entities.Drive.UUID))));
});

/**
* @apiVersion 1.0.0
* @api {get} /disks/:id Get disks by ID
* @apiName GetDisk
* @apiGroup disks
* @apiDescription Get specific `disk` by `ID`.
*
* @apiParam {string} disk `disk's ID` to fetch.
* @apiParamExample {string} Example request
* disks/S3HCNX0K800367.1
*
* @apiSuccess {object} API Response
*
* @apiSuccessExample Example data on success
* {
*         "diskID": "S3HCNX0K800367.1",
*         "disk_version": 0,
*         "blocks": 195353046,
*         "block_size": 4096,
*         "metadata_size": 8,
*         "pci_address": "0000:d9:00.0",
*         "Serial_Number": "S3HCNX0K800367",
*         "Vendor": "Samsung",
*         "Model": "SAMSUNG MZWLL800HEHP-00003",
*         "Submission_Queues": 128,
*         "Completion_Queues": 128,
*         "MSIX_Interrupts": 129,
*         "Numa_Node": 1,
*         "Critical_Warning": "0x0",
*         "Available_Spare": "100_%",
*         "Available_Spare_Threshold": "10_%",
*         "Percentage_Used": "0_%",
*         "Controller_Busy_Time": "0xed6",
*         "Power_Cycles": "0x2e",
*         "Power_On_Hours": "0xad9f",
*         "Unsafe_Shutdowns": "0x23",
*         "Media_Errors": "0x0",
*         "Number_of_Error_Information_Log_Entries": "0x0",
*         "status": "Ok",
*         "isExcluded": false,
*         "excludeReason": "None",
*         "metadataCapabilities": "3",
*         "formatOptions": [
*             {
*                 "dataBS": 512,
*                 "metaBS": 0
*             },
*             {
*                 "dataBS": 512,
*                 "metaBS": 8
*             },
*             {
*                 "dataBS": 4096,
*                 "metaBS": 0
*             },
*             {
*                 "dataBS": 4096,
*                 "metaBS": 8
*             }
*         ],
*         "writeCounter": 7742654450,
*         "reappearingCounter": 3,
*         "formatRequestCounter": 1,
*         "activeFormatRequestCounter": 1,
*         "nodeID": "nvme1038",
*         "nodeUUID": "0be6d3b0-fbc5-11ee-b7a0-15f31bb23eb6",
*         "vendorID": 5197,
*         "uuid": "57467b30-fbc5-11ee-8f46-c1ffa6087b01",
*         "availableBlocks": 193842944,
*         "usableBlocks": 193842944,
*         "largestSegmentAvailable": {
*             "lbs": 1509632,
*             "lbe": 195352575,
*             "blocks": 193842944
*         },
*         "version": 16,
*         "reappearingOutOfSync": false,
*         "health": "critical",
*         "pci_root": null,
*         "autoEvictReason": "Drive uuid mismatch found",
*         "automaticallyEvicted": true,
*         "isOutOfService": true,
*         "isPendingFormat": false,
*         "kafkaMessageSequence": 50,
*         "zeroWriteCounter": 7741672728,
*         "GPT": {
*             "diskGuid": "ad062d00-fcb4-11ee-bf5e-6b7c96cd0914",
*             "isValid": 1,
*             "firstUsableLba": 512,
*             "lastUsableLba": 195352575,
*             "mgmtDbUuid": "d26a9550-fcb3-11ee-b8f6-f9663885ee73",
*             "maxNGptEntries": 8192,
*             "entries": []
*         },
*         "diskSegments": []
* }
*/
router.get('/:id', (req, res) => {
	const diskID = req.params.id;
	const db = app.get('db');
	const serverCollection = db.collection('server');
	const pipeline = [
		{ $unwind: '$disks' },
		{ $match: { 'disks.diskID': diskID } },
		{ $project: { 'disks': 1, _id: 0, node_id: 1 } }
	];

	serverCollection.aggregate(pipeline).toArray((error, results) => {
		if (error) {
			error = new MongoError(error).log();
			return res.json(utils.createApiResponse(diskID, null, false, error.toApiResponse()));
		}

		if (!results || !results.length)
			return res.json(utils.createApiResponse(diskID, null, false, new SystemMessage(systemMessages.CANT_FIND_ENTITY).toApiResponse()));

		const server = results[0];
		res.json(server.disks);
	});
});

module.exports = router;
