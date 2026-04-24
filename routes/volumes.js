/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global app */

var express = require('express');
var async = require('async');

var utils = require('../utils.js');
var logger = require('../logger.js');
var consts = require('../consts.js');
var objectNotifier = require('../objectNotifier.js');
var systemMessages = require('../systemMessages.js');

var volumeModule = require('../modules/volume.js');
var encryptionModule = require('../modules/volumeEncryption.js');
var { Entities, SystemMessage, MongoError } = require('../modules/error.js');
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
	renderData.componentName = consts.componentsPages.volumes;

	res.render('react', renderData);
});

router.get('/ids', function(req, res) {
	volumeModule.getAllVolumes({ _id: 1 }, 0, 0, {}, {}, function(err, results) { res.json(results); });
});

router.get('/nvmfDefault', function(req, res) {
	res.json(app.get('globalSettings').enableNVMf);
});


/**
* @apiVersion 17.1.0
* @api {get} /volumes/all/:page/:count?filter={}&sort={} Get volumes
* @apiName GetVolumes
* @apiGroup volumes
* @apiDescription Get `volumes` by `page` and `count`.
* CDV_MGMT satellite volumes are hidden by default; pass `?includeSatellites=true` to include them.
* CDV responses include a computed `overProvisionRatio` field.
*
* @apiParam {integer} page The `page` number to fetch.
* @apiParam {integer} count Number of records per `page`.
* @apiParam {object} [filter] `Filter` before fetching. <small><i>--MongoDB filter obj</i></small>
* @apiParam {object} [sort] `Sort` before fetching. <small><i>--MongoDB sort obj</i></small>
* @apiParam {boolean} [includeSatellites=false] When `true`, CDV_MGMT satellite volumes are included in results.
* @apiParamExample {object[]} Example request
* /volumes/all/0/15?filter={"_id":"V1"}&sort={}
*
* @apiSuccess {object[]} volumes List of `volumes`.
*
* @apiSuccessExample Example data on success
* [{
* 	"_id": "V1",
*   "health": "healthy",
* 	"RAIDLevel": "Mirrored RAID-1",
* 	"numberOfMirrors": 1,
* 	"capacity": 10,
* 	"limitByNodes": [],
* 	"limitByDisks": [],
* 	"serverClasses": [],
* 	"diskClasses": [],
* 	"name": "V1",
* 	"createdBy": "tomzan@mail.com",
* 	"modifiedBy": "tomzan@mail.com",
* 	"dateModified": "2015-08-26T07:57:35.057Z",
* 	"dateCreated": "2015-08-26T07:57:35.058Z",
* 	"isReserved": false,
* 	"status": "online",
* 	"blocks": 24414063,
* 	"enableNVMf": true,
* 	"selectedClientsForNvmf": ["nvme48.acme.com","nvme67.acme.com"],
* 	"chunks": [{
* 		"_id": "1ca95530-4bc8-11e5-b932-53542b263b32",
* 		"vlbs": 0,
* 		"vlbe": 24414079,
* 		"diskSegments": [{
* 			"lbs": 32,
*			"lbe": 24414111,
* 			"_id": "1ca97c40-4bc8-11e5-b932-53542b263b32",
* 			"diskID": "CVCQ5246004B400AGN.1",
* 			"volumeName": "V1",
* 			"node_id": "nvme50.acme.com",
* 			"allocationIndex": 0
* 		}, {
* 			"lbs": 32,
* 			"lbe": 24414111,
* 			"_id": "1caa8db0-4bc8-11e5-b932-53542b263b32",
* 			"diskID": "CVCQ52430008400AGN.1",
* 			"volumeName": "V1",
* 			"node_id": "nvme51.acme.com",
* 			"allocationIndex": 1
* 		}]
* 	}]
* }]
*/
router.get('/all/:page/:count', validateProjection, function(req, res) {
	var page = parseFloat(req.params.page);
	var count = parseInt(req.params.count);
	let sort = utils.tryParseJSON(req.query.sort);

	// make sort deterministic
	if (sort && !utils.isEmpty(sort)) {
		sort = { ...sort, _id: 1 };
	}

	// Allocator-satellite (CDV_MGMT) volumes are an internal implementation
	// detail; hide them from default listings.  Pass `?includeSatellites=true`
	// to surface them (used by CLI/UI flows that render satellites as child
	// rows of their parent CDV).
	let userFilter = utils.tryParseJSON(req.query.filter) || {};
	const includeSatellites = req.query.includeSatellites === 'true';
	if (!includeSatellites) {
		const excludeMgmt = { volumeClass: { $ne: consts.volumeClass.CDV_MGMT } };
		if (Object.keys(userFilter).length === 0) {
			userFilter = excludeMgmt;
		} else if (userFilter.volumeClass === undefined) {
			userFilter = { ...userFilter, ...excludeMgmt };
		}
		// If the caller explicitly filtered on volumeClass, respect it.
	}

	volumeModule.getAllVolumes(
		utils.tryParseJSON(req.query.projection),
		page,
		count,
		userFilter,
		sort,
		function(err, volumes) {
			if (err)
				return res.json(utils.createApiResponse(null, null, false, new SystemMessage(systemMessages.FAILED_TO_LOAD_VOLUMES)
					.addInfo(Entities.Error, err)));

			if (req.user.role === consts.userRoles.OBSERVER) {
				for (let i = 0; i < volumes.length; i++) {
					let volume = volumes[i];

					if (!volume._id)
						return res.status(403).json(utils.createApiResponse(null, null, false,
							new SystemMessage(systemMessages.PROJECTION_MUST_INCLUDE_VOLUME_ID).toApiResponse()));

					if (volume._id.endsWith(consts.MetadataVolumeEnding))
						volumes.splice(i--, 1);
				}
			}

			volumes.forEach(volume => {
				if (volume.diskClasses?.length) {
					volume.limitByDisks = [];
				}
				if (volume.serverClasses?.length) {
					volume.limitByNodes = [];
				}
			});

			volumeModule.annotateCDVsWithOverprovisionRatio(volumes, () => res.json(volumes));
		}
	);
});

/**
* @apiVersion 1.0.0
* @api {get} /volumes/combinedStatus/:volumeID Get data volume with combined status
* @apiName GetCombinedStatus
* @apiGroup volumes
* @apiDescription Get combined status data volume.
*
* /volumes/combinedStatus/snapshot_test
*
* @apiSuccess object combined status volume.
*
* @apiSuccessExample Example data on success
* {
* 	"_id": "snapshot_test",
*   "health": "healthy",
* 	"RAIDLevel": "Mirrored RAID-1",
*   "sourceID": "source1",
*   "metadataVolumeID": "snapshot_test_MD",
* 	"numberOfMirrors": 1,
* 	"capacity": 10,
* 	"limitByNodes": [],
* 	"limitByDisks": [],
* 	"serverClasses": [],
* 	"diskClasses": [],
* 	"name": "snapshot_test",
* 	"createdBy": "tomzan@mail.com",
* 	"modifiedBy": "tomzan@mail.com",
* 	"dateModified": "2015-08-26T07:57:35.057Z",
* 	"dateCreated": "2015-08-26T07:57:35.058Z",
* 	"isReserved": false,
* 	"status": "online",
* 	"blocks": 24414063,
*	"combinedStatus": "online",
*   "combinedAction": "none",
*   "combinedHealth": "healthy",
*   "isSnapshot": true
* 	"chunks": [{
* 		"_id": "1ca95530-4bc8-11e5-b932-53542b263b32",
* 		"vlbs": 0,
* 		"vlbe": 24414079,
* 		"diskSegments": [{
* 			"lbs": 32,
*			"lbe": 24414111,
* 			"_id": "1ca97c40-4bc8-11e5-b932-53542b263b32",
* 			"diskID": "CVCQ5246004B400AGN.1",
* 			"volumeName": "V1",
* 			"node_id": "nvme50.acme.com",
* 			"allocationIndex": 0
* 		}, {
* 			"lbs": 32,
* 			"lbe": 24414111,
* 			"_id": "1caa8db0-4bc8-11e5-b932-53542b263b32",
* 			"diskID": "CVCQ52430008400AGN.1",
* 			"volumeName": "V1",
* 			"node_id": "nvme51.acme.com",
* 			"allocationIndex": 1
* 		}]
* 	}]
* }
*/
router.get('/combinedStatus/:volumeID', isAdminRole, (req, res) => {
	const volumeID = req.params.volumeID;

	logger.sysDEBUG(`Got combinedStatus request for ${volumeID}`);
	volumeModule.getAllVolumes({}, 0, 0, { _id: volumeID, sourceID: { $exists: true } }, {},
		function(err, volumes) {
			if (!volumes.length)
				return res.json({});

			volumeModule.getCombinedStatusVolume(volumes[0], combinedVolume => res.json(combinedVolume));
		}
	);
});

/**
* @apiVersion 1.0.0
* @api {get} /volumes/count Count Volumes
* @apiName CountVolumes
* @apiGroup volumes
* @apiDescription Get total `volume` count.
*
* @apiSuccess {integer} count `volume` count.
*
* @apiSuccessExample Example data on success
* 4
*/
router.get('/count', getCountEntitiesHandler('volume',
	{ isReserved: false },
	{ status: { $nin: [consts.volumeStatuses.PENDING, consts.volumeStatuses.TO_BE_DELETED] } }));

//Get the 5 biggest volumes in the system (capacity wise) - does not display reserved volumes.
router.get('/getLargestVolumes', function(req, res) {
	objectNotifier.getObject(objectNotifier.events.largestVolumesChangeEvent.name, function(err, obj) {
		if (err) {
			err = `Failed to calculate largest volumes, err: ${err}`;
			logger.sysDEBUG(err);
		}

		if (obj)
			return res.json(obj);

		res.json(err);
	});
});

router.get('/getSegmentsStatusByDisk', (req, res) => {
	const { nodeID, diskID } = req.query;
	const db = app.get('db');
	const serverCollection = db.collection('server');

	serverCollection.aggregate([
		{ $match: { _id: nodeID } },
		{
			$project: {
				disk: {
			  		$first: {
						$filter: {
				  			input: '$disks',
				  			as: 'disk',
				  			cond: { $eq: ['$$disk.diskID', diskID] }
						}
			  		}
				}
			}
		},
		{ $unwind: '$disk.diskSegments' },
		{ $match: { 'disk.diskSegments.volumeName': { $exists: true } } },
		{ $project: { _id: 0, diskSegmentID: '$disk.diskSegments._id', volumeName: '$disk.diskSegments.volumeName' } },
		{
		  $lookup: {
				from: 'volume',
				let: { diskSegmentID: '$diskSegmentID', volumeName: '$volumeName' },
				pipeline: [
					{ $match: { $expr: { $eq: ['$_id', '$$volumeName'] } } },
					{
						$project: {
							allDiskSegments: {
								$reduce: {
									input: '$chunks',
									initialValue: [],
									in: {
										$concatArrays: [
											'$$value',
											{
												$reduce: {
													input: '$$this.pRaids',
													initialValue: [],
													in: { $concatArrays: ['$$value', '$$this.diskSegments'] }
												}
											}
										]
									}
								}
							}
						}
					},
					{ $unwind: '$allDiskSegments' },
					{ $match: { $expr: { $eq: ['$allDiskSegments._id', '$$diskSegmentID'] } } },
					{ $project: { _id: 0, status: '$allDiskSegments.status' } }
				],
				as: 'status'
			}
		},
		{ $project: { k: '$diskSegmentID', v: { $first: '$status.status' } } },
		{ $group: { _id: null, data: { $push: { k: '$k', v: '$v' } } } },
		{ $replaceRoot: { newRoot: { $arrayToObject: '$data' } } }
	  ]).toArray((err, results) => {
		if (err) {
			new MongoError(err).log();
			return res.json({});
		}

		res.json(results[0]);
	});
});

router.get('/getVolumeDiagram/:volumeID', function(req, res) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');
	var volumeID = req.params.volumeID;
	var diagrams = [];

	function addTargetsToVolumeDiagram(diagram, callback) {
		var db = app.get('db');
		var serverCollection = db.collection('server');

		serverCollection.aggregate([
			{ $unwind: '$disks' },
			{ $match: { 'disks.diskSegments': { $elemMatch: { volumeName: diagram.volumeID, type: consts.segmentTypes.DATA } } } },
			{ $project: { node_id: 1, 'disks': 1 } },
			{ $group: { _id: '$node_id', disks: { $addToSet: '$disks' } } },
			{ $sort: { _id: 1 } }
		]).toArray((err, targets) => {
			if (err){
				err = new MongoError(err).log();
			}

			diagram.targets = targets;
			callback(err);
		});
	}

	function addPRaidStatusesToVolume(volume) {
		volume.chunks.forEach(chunk => {
			chunk.pRaids.forEach(pRaid => {
				//TODO (PRAID_STATUS) - Test Volume Diagram and it's usage of pRaid status
				var statusAction = volumeModule.getPRaidStatusAndAction(volume, pRaid, false);
				pRaid.status = statusAction.status;
				pRaid.action = statusAction.action;
			});
		});
	}

	function getDiagramsDataForVolume(volumeID, callback) {
		volumeCollection.findOne({ _id: volumeID }, (err, volume) => {
			if (err || !volume) {
				if (err)
					err = new MongoError(err).addInfo(Entities.Volume.ID, volumeID).log();
				return callback(err);
			}

			if (!volume)
				return callback(new SystemMessage(systemMessages.VOLUME_NOT_FOUND).addInfo(Entities.Volume.ID, volumeID));

			var diagram = {
				title: volumeID,
				volumeID: volumeID,
				targets: [],
				layout: volume,
				additionalInfo: {
					'Name': volume.name,
					'UUID': volume.uuid,
					'Raid Level': volume.RAIDLevel
				}
			};

			volume.metadata = volume.csi_metadata || volume.metadata || {};
			if (Object.keys(volume.metadata).length) {
				diagram.metadata = {};
				for (const key in volume.metadata) {
					let value = volume.metadata[key];
					if (typeof value === 'object' || Array.isArray(value))
						value = JSON.stringify(value);
					diagram.metadata[key] = value;
				}
			}

			diagrams.push(diagram);

			// add pRaid status to all diagrams
			diagrams.forEach((d) => addPRaidStatusesToVolume(d.layout));

			async.each(diagrams || [], addTargetsToVolumeDiagram, function(err) {
				callback(err, diagrams);
			});
		});
	}

	getDiagramsDataForVolume(volumeID, function(sysErr, diagrams) {
		if (sysErr)
			sysErr.log();

		res.json(sysErr || diagrams);
	});
});

router.post('/isExists', function(req, res) {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');
	var volume = req.body;

	volumeCollection.findOne({ name: volume.name }, function(err, doc) {
		res.json({ exists: Boolean(doc) });
	});
});

router.post('/cloneVPGProperties', function(req, res) {
	var volume = req.body;

	utils.cloneVPGProperties(volume, function(err) {
		if (err)
			logger.sysDEBUG(`Failed to clone VPG ${volume._id}`, err);

		res.json(volume);
	});
});

/**
* @apiVersion 1.0.0
* @api {post} /volumes/rebuildVolumes Rebuild Volumes
* @apiName RebuildVolumes
* @apiGroup volumes
* @apiDescription Rebuild `volumes`.
*
* @apiParam {object[]} volumes `volumes` to rebuild.
* @apiParam {string} volumes._id The Volume ID.
* @apiParam {string} volumes.uuid The Volume UUID.
* @apiParam {boolean} [volumes.allowAllocationOnOfflineDrives] Use offline drives for allocation, defaults to false.
* @apiParamExample {string} Payload example
* [{
* 		"_id": "V1",
*		"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398",
* }, {
* 		"_id": "V2",
*		"uuid": "121cfb90-7a13-11ed-a3a5-2dd1199d2398",
* }]
*
* @apiSuccess {object} results success statuses
* @apiSuccessExample Example data on success
* [{
*	"_id": "V1",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*	"success": true,
*	"error": null,
*	"payload": null
* },
* {
*	"_id": "V2",
*   "uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefc",
*	"success": true,
*	"error": null,
*	"payload": null
* }]
*/
router.post('/rebuildVolumes', isAdminRole, function(req, res) {
	let volumes = req.body;
	let user = req.user;

	let incomingRequestSystemAdminMessages = volumes.map(volume => createAuditRequestLog(req, systemMessages.VOLUME_REBUILD_REQUEST)
		.addInfo(Entities.Volume.ID, volume._id)
		.addInfo(Entities.Volume.UUID, volume.uuid));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => volumeModule.rebuildVolumes(volumes, user, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID)))
	);
});

/**
* @apiVersion 17.1.0
* @api {post} /volumes/save Save volumes
* @apiName SaveVolumes
* @apiGroup volumes
* @apiDescription Create one or more volumes, including Capacity Data Volumes (CDV) and Thin-Provisioned Volumes (TPV).
* At a minimum, `name` and `capacity` are required.
* You must also specify allocation rules, either by providing a `VPG` or by specifying `RAIDLevel` and other parameters.
* To create a CDV, set `volumeClass` to `'CDV'` and populate `cdvConfig`.
* To create a TPV, set `volumeClass` to `'TPV'` and populate `tpvConfig` (no RAID fields or `capacity` needed).
*
* @apiParam {object[]} volumes `volumes` to create.
* @apiParam {string} volumes.name <strong>Required</strong>. Name of the `volume`. The name must be unique, as it will become the `ID` of the `volume`.
* @apiParam {object} volumes.capacity <strong>Required</strong>. Space to allocate for the `volume` in GB, or `'MAX'` for using all of the available space.
*
* @apiParam {string} [volumes.VPG] The VPG to use for allocation. If provided, `RAIDLevel` and other allocation-related properties must NOT be sent.
* @apiParam {string} [volumes.RAIDLevel] The RAID level of the `volume`. <strong>Required if `VPG` is not provided</strong>.<br />
* <small><i>Options: `Concatenated`, `Striped RAID-0`, `Mirrored RAID-1`, `Striped & Mirrored RAID-10`, `Erasure Coding`, `Striped Erasure Coding`</i></small>.
*
* @apiParam {string} [volumes.description] `Description` of the `volume`.
* @apiParam {integer} [volumes.relativeRebuildPriority=10] Sets the volume relative rebuild priority.
* @apiParam {string[]} [volumes.VSGs] Associated volume security groups.
*
* @apiParam {string} [volumes.sourceID] The Source Volume ID. Used for creating a snapshot. Requires `sourceUUID`.
* @apiParam {string} [volumes.sourceUUID] The Source Volume UUID. Used for creating a snapshot. Requires `sourceID`.
* @apiParam {object} [volumes.mdvSpec] The allocation specifications for the metadata volume, used for snapshots.
* @apiParam {string[]} [volumes.mdvSpec.diskClasses] Limit the metadata `volume` allocation to specific `diskClasses`.
* @apiParam {string[]} [volumes.mdvSpec.serverClasses] Limit the metadata `volume` allocation to specific `serverClasses`.
* @apiParam {string[]} [volumes.mdvSpec.limitByDisks] Limit the metadata `volume` allocation to specific `disks`.
* @apiParam {string[]} [volumes.mdvSpec.limitByNodes] Limit the metadata `volume` allocation to specific `nodes`.
* @apiParam {string} [volumes.mdvSpec.VPG] Limit the metadata `volume` allocation to a specific `VPG`.
*
* @apiParam {boolean} [volumes.allowAllocationOnOfflineDrives=false] Use offline drives for allocation.
* @apiParam {boolean} [volumes.isReadOnly=false] Should be true when creating a source volume for a snapshot.
* @apiParam {boolean} [volumes.enableNVMf=false] Enable NVMf exposure for the `volume`. If true, `selectedClientsForNvmf` is required.
* @apiParam {string[]} [volumes.selectedClientsForNvmf] Expose the `volume` as NVMf target for specific `clients`.
* <strong>Required if `enableNVMf` is true.</strong>
* @apiBody {boolean} [volumes.isEncrypted=false] Create an encrypted volume.
* @apiBody {object} [volumes.encryption] Encryption options. <strong>Available when `isEncrypted` is true.</strong>
* @apiBody {integer} [volumes.encryption.headerSize=16] Volume encryption header size in MiB.
* @apiBody {object} [volumes.metadata={}] An Object containing `volume`'s metadata. (Max size: 256KB)
* @apiBody {boolean} [volumes.use_debug_di=false] Use debug disk information for the `volume`. <br/><strong> Internal use only !</strong>
* @apiBody (CDV) {string} [volumes.volumeClass] Set to `'CDV'` to create a Capacity Data Volume (backing store for TPVs).
* @apiBody (CDV) {object} [volumes.cdvConfig] CDV configuration. <strong>Required when `volumeClass` is `'CDV'`</strong>.
* @apiBody (CDV) {integer} volumes.cdvConfig.cdvExtentSizeMib CDV extent size in MiB. Must be a power of 2 in the range [16, 65536].
* @apiBody (CDV) {integer} [volumes.cdvConfig.allocatorSizeGib=1] Size in GiB of the allocator satellite volume created alongside the CDV.
* @apiBody (CDV) {integer} [volumes.cdvConfig.maxTPVs=512] Maximum number of TPVs that may be backed by this CDV.
* @apiBody (TPV) {string} [volumes.volumeClass] Set to `'TPV'` to create a Thin-Provisioned Volume.
* @apiBody (TPV) {object} [volumes.tpvConfig] TPV configuration. <strong>Required when `volumeClass` is `'TPV'`</strong>.
* @apiBody (TPV) {string} volumes.tpvConfig.cdvId The `_id` of the parent CDV.
* @apiBody (TPV) {string} volumes.tpvConfig.cdvUUID The `uuid` of the parent CDV.
* @apiBody (TPV) {integer} volumes.tpvConfig.tpvExtentSizeKB TPV extent size in KiB. Must be a power of 2 in the range [64, 65536] and must not exceed `cdvExtentSizeMib * 1024`.
* @apiBody (TPV) {number} volumes.tpvConfig.virtualSizeGB Virtual size of the TPV in GiB. Must not exceed the parent CDV capacity.
* @apiBody (TPV) {string} [volumes.tpvConfig.metaCdvId] `_id` of a second CDV used for metadata extents in split-mode. When provided, `metaTpvExtentSizeKB` is also required.
* @apiBody (TPV) {string} [volumes.tpvConfig.metaCdvUUID] `uuid` of the metadata CDV.
* @apiBody (TPV) {integer} [volumes.tpvConfig.metaTpvExtentSizeKB] Extent size for the metadata CDV in split-mode. Required when `metaCdvId` is set.
* @apiBody (Allocation) {string[]} [diskClasses] Limit `volume` allocation to specific `diskClasses`.
* <br/><strong>Not allowed if `VPG` is set.</strong>
* @apiParam (Allocation) {string[]} [limitByDisks] Limit `volume` allocation to specific `disks`. <br/><strong>Not allowed if `VPG` is set.</strong>
* @apiParam (Allocation) {string[]} [limitByNodes] Limit `volume` allocation to specific `nodes`. <br/><strong>Not allowed if `VPG` is set.</strong>
* @apiParam (Allocation) {string[]} [serverClasses] Limit volumes allocation to specific `serverClasses`.
* <br/><strong>Not allowed if `VPG` is set.</strong>
* @apiParam (Allocation) {string} [domain] `Domain` to use for allocation. <br/><strong>Not allowed if `VPG` is set.</strong>
*
* @apiParam (RAID) {integer} [stripeSize=32] Stripe size in 4k blocks (e.g., 32 for 128k).
* <br/><strong>Depends on `RAIDLevel`. Not allowed if `VPG` is set.</strong>
* @apiParam (RAID) {integer} [stripeWidth=2] Number of disks for stripe. <br/><strong>Depends on `RAIDLevel`. Not allowed if `VPG` is set.</strong>
* @apiParam (RAID) {integer} [numberOfMirrors=1] Number of mirrors. <br/><strong>Depends on `RAIDLevel`. Not allowed if `VPG` is set.</strong>
* @apiParam (RAID) {integer} [dataBlocks=8] Number of data disks for Erasure Coding. <br/><strong>Depends on `RAIDLevel`. Not allowed if `VPG` is set.</strong>
* @apiParam (RAID) {integer} [parityBlocks=2] Number of parity disks for Erasure Coding.
* <br/><strong>Depends on `RAIDLevel`. Not allowed if `VPG` is set.</strong>
* @apiParam (RAID) {string} [protectionLevel='Full Separation'] Protection level.
* <small><i>Options: `Full Separation`, `Minimal Separation`,
* `Ignore Separation`</i></small>
* <br/><strong>Depends on `RAIDLevel`. Not allowed if `VPG` is set.</strong>
* @apiParam (RAID) {boolean} [ignoreNodeSeparation=false] Disable node separation for mirrored volumes.
* <br/><strong>Depends on `RAIDLevel`. Not allowed if `VPG` is set.</strong>
* @apiParam (RAID) {boolean} [enableCrcCheck=false] Enable CRC check for the `volume`. Defaults to true for `Erasure Coding` and `Striped Erasure Coding`.
<br/><strong>Depends on `RAIDLevel`. Not allowed if `VPG` is set.</strong>
* @apiParamExample {string} Payload example
* [{
* 		"RAIDLevel": "Striped RAID-0",
*		"capacity": 100,
*		"description": "Plain text",
*		"diskClasses": ["highPerformance"],
* 		"limitByDisks": ["CVMD439000DE400FGN.1"],
*	 	"limitByNodes": ["nvme31.acme.com"],
*		"name": "V4",
*		"serverClasses": [],
*		"stripeSize": 32,
*		"stripeWidth": 2,
*		"domain": "Rack",
*		"VSGs": ["VSG1", "VSG2"]
* }]
*
*
* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* [{
* 		"_id": "V4",
*   	"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
* 		"success": true,
*		"error": null
* }]
*/
router.post('/save', isAdminRole, function(req, res) {
	let volumes = req.body;
	let user = req.user;

	let incomingRequestSystemAdminMessages = volumes.map(volume => createAuditRequestLog(req, systemMessages.VOLUMES_SAVE_REQUEST)
		.addInfo(Entities.Volume.name, volume.name)
		.addInfo(Entities.Volume.definition, volume));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => volumeModule.saveVolumes(volumes, user, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {post} /volumes/update Update volumes
* @apiName UpdateVolumes
* @apiGroup volumes
* @apiDescription Update volumes. Only the properties listed below can be updated.
* @apiParam {object[]} volumes `volumes` to update.
* @apiParam {string} update._id <strong>Required</strong>. The `ID` of the `volume` to update.
* @apiParam {string} update.uuid <strong>Required</strong>. The `UUID` of the `volume` to update.
* @apiParam {string} [update.description] The `volume`'s description.
* @apiParam {string[]} [update.diskClasses] Limit `volume` allocation to specific `diskClasses`.
* @apiParam {string[]} [update.limitByDisks] Limit `volume` allocation to specific `disks`.
* @apiParam {string[]} [update.limitByNodes] Limit `volume` allocation to specific `nodes`.
* @apiParam {string[]} [update.serverClasses] Limit volumes allocation to specific `serverClasses`.
* @apiParam {string[]} [update.VSGs] Associated `volume` security groups.
* @apiParam {integer} [update.relativeRebuildPriority] Sets the volume relative rebuild priority.
* @apiParam {boolean} [update.enableNVMf] Enable or disable NVMf exposure for the `volume`. If true, `selectedClientsForNvmf` is required.
* @apiParam {string[]} [update.selectedClientsForNvmf] Expose the `volume` as NVMf target for specific `clients`.
* <strong>Required if `enableNVMf` is true.</strong>
* @apiParam {boolean} [update.enableCrcCheck] Enable or disable CRC check for the `volume`.
* @apiParam {boolean} [update.isReadOnly] Set the `volume` as read-only.
* @apiParam {boolean} [update.allowAllocationOnOfflineDrives] Use offline drives for allocation.
* @apiParam {object} [update.metadata] An Object containing `volume`'s metadata. (Max size: 256KB)
* @apiParamExample {string} Payload example
* [{
*		"_id": "V5",
*		"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398",
* 		"description": "New description"
* }]
*
* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* [{
* 		"_id": "V5",
*		"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
* 		"success": true,
*		"error": null
* 		"payload": null
* }]
*/
router.post('/update', isAdminRole, function(req, res) {
	let volumes = req.body;
	let user = req.user;

	let incomingRequestSystemAdminMessages = volumes.map(volume => createAuditRequestLog(req, systemMessages.VOLUME_UPDATE_REQUEST)
		.addInfo(Entities.Volume.ID, volume._id)
		.addInfo(Entities.Volume.UUID, volume.uuid)
		.addInfo(Entities.Volume.definition, volume));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => volumeModule.updateVolumes(volumes, user, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {post} /volumes/rotatePassphrase Rotate a passphrase
* @apiName RotatePassphrase
* @apiGroup volumes
* @apiDescription Rotate a passphrase.
* @apiParam {object[]} encryptionCommandObj `encryptionCommandObj` Rotate passphrase parameters.
* @apiParam {string} encryptionCommandObj._id The `name` of the `volume`.
* @apiParam {string} encryptionCommandObj.uuid The `UUID` of the `volume`.
* @apiParam {string} encryptionCommandObj.currentPassphrase The current, valid `passphrase`.
* @apiParam {string} encryptionCommandObj.newPassphrase The new `passphrase` to rotate.
* @apiParam {integer} [encryptionCommandObj.slot] The `slot` that will be used.
* @apiParamExample {string} Payload example
* [{
*		"_id": "V5",
*		"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398",
* 		"currentPassphrase": "askjc#fk1lsdS125ffg",
* 		"newPassphrase": "wetwhekjrwkejr",
*		"slot": 1,
* }]

* @apiSuccess {object} result
*
* @apiSuccessExample Example data on success
* [{
* 		"_id": "V5",
*   	"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398",
* 		"success": true,
*		"error": null
* }]
*/

router.post('/rotatePassphrase', isAdminRole, (req, res) => {
	let rotatePassphraseObjs = req.body;

	let incomingRequestSystemAdminMessages = rotatePassphraseObjs.map(obj => createAuditRequestLog(req, systemMessages.ROTATE_PASSPHRASE_REQUEST)
		.addInfo(Entities.Volume.ID, obj._id)
		.addInfo(Entities.Volume.UUID, obj.uuid)
		.addInfo(Entities.encryptionParams, utils.extend(true, {}, obj)));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => encryptionModule.handleEncryptionRequests(rotatePassphraseObjs, consts.volumeEncryptionCommands.ROTATE_PASSPHRASE, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {post} /volumes/deletePassphrase Delete a passphrase
* @apiName DeletePassphrase
* @apiGroup volumes
* @apiDescription Delete a passphrase.
* @apiParam {object[]} encryptionCommandObj `encryptionCommandObj` Delete passphrase parameters.
* @apiParam {string} encryptionCommandObj._id The `name` of the `volume`.
* @apiParam {string} encryptionCommandObj.uuid The `UUID` of the `volume`.
* @apiParam {string} encryptionCommandObj.currentPassphrase The current, valid `passphrase`.
* @apiParamExample {string} Payload example
* [{
*		"_id": "V5",
*		"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398",
* 		"currentPassphrase": "askjc#fk1lsdS125ffg"
* }]

* @apiSuccess {object} result
*
* @apiSuccessExample Example data on success
* [{
* 		"_id": "V5",
*   	"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398",
* 		"success": true,
*		"error": null
* }]
*/

router.post('/deletePassphrase', isAdminRole, (req, res) => {
	let deletePassphraseObjs = req.body;

	let incomingRequestSystemAdminMessages = deletePassphraseObjs.map(obj => createAuditRequestLog(req, systemMessages.DELETE_PASSPHRASE_REQUEST)
		.addInfo(Entities.Volume.ID, obj._id)
		.addInfo(Entities.Volume.UUID, obj.uuid)
		.addInfo(Entities.encryptionParams, utils.extend(true, {}, obj)));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => encryptionModule.handleEncryptionRequests(deletePassphraseObjs, consts.volumeEncryptionCommands.DELETE_PASSPHRASE, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {post} /volumes/addPassphrase Add a passphrase
* @apiName AddPassphrase
* @apiGroup volumes
* @apiDescription Add a passphrase.
* @apiParam {object[]} encryptionCommandObj `encryptionCommandObj` Add passphrase parameters.
* @apiParam {string} encryptionCommandObj._id The `name` of the `volume`.
* @apiParam {string} encryptionCommandObj.uuid The `UUID` of the `volume`.
* @apiParam {string} encryptionCommandObj.currentPassphrase The current, valid `passphrase`.
* @apiParam {string} encryptionCommandObj.newPassphrase The new `passphrase` to add.
* @apiParam {integer} [encryptionCommandObj.slot] The `slot` that will be used.
* @apiParamExample {string} Payload example
* [{
*		"_id": "V5",
*		"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398",
* 		"currentPassphrase": "askjc#fk1lsdS125ffg",
* 		"newPassphrase": "wetwhekjrwkejr",
*		"slot": 1,
* }]

* @apiSuccess {object} result
*
* @apiSuccessExample Example data on success
* [{
* 		"_id": "V5",
*   	"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398",
* 		"success": true,
*		"error": null
* }]
*/

router.post('/addPassphrase', isAdminRole, (req, res) => {
	let addPassphraseObjs = req.body;

	let incomingRequestSystemAdminMessages = addPassphraseObjs.map(obj => createAuditRequestLog(req, systemMessages.ADD_PASSPHRASE_REQUEST)
		.addInfo(Entities.Volume.ID, obj._id)
		.addInfo(Entities.Volume.UUID, obj.uuid)
		.addInfo(Entities.encryptionParams, utils.extend(true, {}, obj)));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => encryptionModule.handleEncryptionRequests(addPassphraseObjs, consts.volumeEncryptionCommands.ADD_PASSPHRASE, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {post} /volumes/initEncryption Initialize volume encryption
* @apiName InitEncryption
* @apiGroup volumes
* @apiDescription Initialize volume encryption.
* @apiParam {object[]} initEncryptionObj `initEncryptionObj` Encryption initialization parameters.
* @apiParam {string} initEncryptionObj._id The `name` of the `volume`.
* @apiParam {string} initEncryptionObj.uuid The `UUID` of the `volume`.
* @apiParam {string} initEncryptionObj.passphrase The `passphrase` for initialization, the passphrase will never be saved to the DB.
* @apiParam {integer} [initEncryptionObj.slot] The `slot` that will be used.
* @apiParam {string} [initEncryptionObj.keySize] `AES-XTS` key size.<br />
* <small><i>Options: `256`, `512`</i></small>.
* @apiParamExample {string} Payload example
* [{
*		"_id": "V5",
*		"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398",
* 		"passphrase": "askjc#fk1lsdS125ffg",
		"slot": 1,
		"keySize": 512
* }]

* @apiSuccess {object} result
*
* @apiSuccessExample Example data on success
* [{
* 		"_id": "V5",
*   	"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398",
* 		"success": true,
*		"error": null
* }]
*/

router.post('/initEncryption', isAdminRole, (req, res) => {
	let initEncryptionObjs = req.body;

	let incomingRequestSystemAdminMessages = initEncryptionObjs.map(obj => createAuditRequestLog(req, systemMessages.INIT_ENCRYPTION_REQUEST)
		.addInfo(Entities.Volume.ID, obj._id)
		.addInfo(Entities.Volume.UUID, obj.uuid)
		.addInfo(Entities.encryptionParams, utils.extend(true, {}, obj)));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => encryptionModule.handleEncryptionRequests(initEncryptionObjs, consts.volumeEncryptionCommands.INIT_ENCRYPTION, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID)))
	);
});

router.post('/acknowledgeResponse', isAdminRole, (req, res) => {
	let volumes = req.body;

	let incomingRequestSystemAdminMessages = volumes.map(obj => createAuditRequestLog(req, systemMessages.ACKNOWLEDGE_RESPONSE_REQUEST)
		.addInfo(Entities.Volume.ID, obj._id)
		.addInfo(Entities.Volume.UUID, obj.uuid)
		.addInfo(Entities.encryptionParams, utils.extend(true, {}, obj)));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => encryptionModule.handleEncryptionAcknowledgeResponseError(volumes, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {post} /volumes/extend Extend volumes
* @apiName ExtendVolumes
* @apiGroup volumes
* @apiDescription Extend volumes.
* IMPORTANT: volume `extend` objects should contain all the previously configured fields as in the initial
* creation of the volume and not just the modified fields. Unconfigured fields will be deleted.
* It is recommended to first call `Get volumes`, modify the payload as needed, and send back using `Extend volumes`.
* @apiParam {object[]} volumes `volumes` to extend.
* @apiParam {string} extend._id The `ID` of the `volume` to extend.
* @apiParam {string} extend.uuid The `UUID` of the `volume` to extend.
* @apiParam {string} [extend.description] The `volume`'s description.
* @apiParam {integer} [extend.capacity] Extend the `volume` capacity in GB.
* @apiParam {boolean} [volumes.allowAllocationOnOfflineDrives] Use offline drives for allocation, defaults to false.
* @apiParamExample {string} Payload example
* [{
*		"_id": "V5",
*		"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398",
* 		"capacity": 200
* }]
*
* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* [{
* 		"_id": "V5",
*   	"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
* 		"success": true,
*		"error": null
* 		"payload": null
* }]
*/
router.post('/extend', isAdminRole, function(req, res) {
	let volumes = req.body;
	let user = req.user;

	let incomingRequestSystemAdminMessages = volumes.map(volume => createAuditRequestLog(req, systemMessages.VOLUME_EXTEND_REQUEST)
		.addInfo(Entities.Volume.ID, volume._id)
		.addInfo(Entities.Volume.UUID, volume.uuid)
		.addInfo(Entities.Volume.capacity, volume.capacity));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => volumeModule.extendVolumes(volumes, user, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID)))
	);
});


/**
* @apiVersion 1.0.0
* @api {post} /volumes/delete Delete volumes
* @apiName DeleteVolumes
* @apiGroup volumes
* @apiDescription Delete volumes.
* @apiParam {object[]} volumes `volumes` to delete.
* @apiParam {string} delete._id The `ID` of the `volume` to delete.
* @apiParam {string} delete.uuid The `UUID` of the `volume` to delete.
* @apiParamExample {string} Payload example
* [{
*		"_id": "V5"
*		"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398",
* }]
*
* @apiSuccess {object} results success statuses
*
* @apiSuccessExample Example data on success
* [{
* 		"_id": "V5",
* 	  	"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
* 		"success": true,
*		"error": null
* 		"payload": null
* }]
*/
router.post('/delete', isAdminRole, function(req, res) {
	let volumes = req.body;

	let incomingRequestSystemAdminMessages = volumes.map(volume => createAuditRequestLog(req, systemMessages.VOLUME_DELETE_REQUEST)
		.addInfo(Entities.Volume.ID, volume._id)
		.addInfo(Entities.Volume.UUID, volume.uuid));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => volumeModule.deleteVolumes(volumes, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID))));
});

/**
* @apiVersion 17.1.0
* @api {post} /volumes/tpv/update Update a TPV
* @apiName UpdateTPV
* @apiGroup volumes
* @apiDescription Update mutable fields of a Thin-Provisioned Volume. Only `description` can be changed after creation.
* @apiBody {string} _id TPV `ID`.
* @apiBody {string} [description] New description.
* @apiExample {object} Payload example
* { "_id": "myTPV", "description": "updated description" }
* @apiSuccess {object[]} results Success statuses.
* @apiSuccessExample Example data on success
* [{ "_id": "myTPV", "uuid": "...", "success": true, "error": null }]
*/
router.post('/tpv/update', isAdminRole, function(req, res) {
	let updateObj = req.body;
	let user = req.user;

	let incomingRequestSystemAdminMessages = [createAuditRequestLog(req, systemMessages.VOLUME_UPDATE_REQUEST)
		.addInfo(Entities.Volume.ID, updateObj._id)];

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => volumeModule.updateTPV(updateObj, user, m => cb([m])),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID)))
	);
});

/**
* @apiVersion 17.1.0
* @api {post} /volumes/tpv/delete Delete TPVs
* @apiName DeleteTPVs
* @apiGroup volumes
* @apiDescription Delete one or more Thin-Provisioned Volumes. Each TPV must be detached before deletion.
* @apiBody {object[]} volumes Array of TPVs to delete.
* @apiBody {string} volumes._id TPV `ID`.
* @apiBody {string} volumes.uuid TPV `UUID`.
* @apiExample {object[]} Payload example
* [{ "_id": "myTPV", "uuid": "..." }]
* @apiSuccess {object[]} results Success statuses.
* @apiSuccessExample Example data on success
* [{ "_id": "myTPV", "uuid": "...", "success": true, "error": null }]
*/
router.post('/tpv/delete', isAdminRole, function(req, res) {
	let tpvIds = req.body;
	let user = req.user;

	let incomingRequestSystemAdminMessages = tpvIds.map(({ _id }) => createAuditRequestLog(req, systemMessages.VOLUME_DELETE_REQUEST)
		.addInfo(Entities.Volume.ID, _id));

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => volumeModule.deleteTPVs(tpvIds, user, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID)))
	);
});

/**
* @apiVersion 17.1.0
* @api {post} /volumes/tpv/extend Extend a TPV
* @apiName ExtendTPV
* @apiGroup volumes
* @apiDescription Increase the virtual size of a Thin-Provisioned Volume. The new size must be larger than the current size.
* @apiBody {string} tpvId TPV `ID` to extend.
* @apiBody {number} newSizeGB New virtual size in GiB. Must be greater than the current virtual size.
* @apiExample {object} Payload example
* { "tpvId": "myTPV", "newSizeGB": 200 }
* @apiSuccess {object[]} results Success statuses.
* @apiSuccessExample Example data on success
* [{ "_id": "myTPV", "uuid": "...", "success": true, "error": null }]
*/
router.post('/tpv/extend', isAdminRole, function(req, res) {
	let { tpvId, newSizeGB } = req.body;
	let user = req.user;

	let incomingRequestSystemAdminMessages = [createAuditRequestLog(req, systemMessages.VOLUME_EXTEND_REQUEST)
		.addInfo(Entities.Volume.ID, tpvId)];

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessages,
		cb => volumeModule.extendTPV({ tpvId, newSizeGB }, user, m => cb([m])),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID)))
	);
});

// --- Offline compaction (TPV_Trimming.md Step 4) ---

/**
* @apiVersion 17.1.0
* @api {post} /volumes/tpv/compact Start or abort TPV compaction
* @apiName CompactTPV
* @apiGroup volumes
* @apiDescription Start an offline compaction job for a Thin-Provisioned Volume to reclaim unused extents,
* or abort a running compaction job. Compaction requires the TPV to be detached or attached to the specified client only.
* @apiBody {string} tpvId TPV `ID` to compact.
* @apiBody {boolean} [abort=false] When `true`, abort the running compaction job for this TPV.
* @apiBody {string} [client] Client `ID` that will perform the compaction I/O. Required when the TPV is attached.
* @apiBody {string} [aggressiveness] Compaction aggressiveness level.
* <small><i>Options: `low`, `medium` (default), `high`</i></small>
* @apiExample {object} Start compaction
* { "tpvId": "myTPV", "client": "nvme1.acme.com", "aggressiveness": "medium" }
* @apiExample {object} Abort compaction
* { "tpvId": "myTPV", "abort": true }
* @apiSuccessExample {object} Started (HTTP 202)
* { "jobId": "myTPV", "state": "running", "tpvId": "myTPV" }
* @apiSuccessExample {object} Aborted (HTTP 200)
* { "ok": true }
*/
router.post('/tpv/compact', isAdminRole, function(req, res) {
	let body = req.body || {};
	let tpvId = body.tpvId;
	if (!tpvId)
		return res.status(400).json({ error: 'missing-tpvId' });
	if (body.abort) {
		return volumeModule.abortTPVCompaction({
			tpvId: tpvId,
			user: req.user,
		}, function(err) {
			if (err)
				return res.status(err.httpStatus || 500).json({ error: err.code || 'internal-error', message: err.message });
			return res.status(200).json({ ok: true });
		});
	}
	volumeModule.startTPVCompaction({
		tpvId: tpvId,
		client: body.client,
		aggressiveness: body.aggressiveness,
		user: req.user,
	}, function(err, result) {
		if (err)
			return res.status(err.httpStatus || 500).json({ error: err.code || 'internal-error', message: err.message });
		return res.status(202).json(result);
	});
});

/**
* @apiVersion 17.1.0
* @api {post} /volumes/tpv/compactShow Get TPV compaction status
* @apiName CompactShowTPV
* @apiGroup volumes
* @apiDescription Get the current compaction job state for a Thin-Provisioned Volume.
* Returns `{ "state": "idle" }` when no job is running.
* @apiBody {string} tpvId TPV `ID` to query.
* @apiExample {object} Payload example
* { "tpvId": "myTPV" }
* @apiSuccessExample {object} Job running
* { "jobId": "myTPV", "state": "running", "tpvId": "myTPV", "aggressiveness": "medium" }
* @apiSuccessExample {object} No active job
* { "state": "idle" }
*/
router.post('/tpv/compactShow', function(req, res) {
	let tpvId = (req.body || {}).tpvId;
	if (!tpvId)
		return res.status(400).json({ error: 'missing-tpvId' });
	volumeModule.getTPVCompaction(tpvId, function(err, job) {
		if (err)
			return res.status(err.httpStatus || 500).json({ error: err.code || 'internal-error', message: err.message });
		if (!job)
			return res.json({ state: 'idle' });
		return res.json(job);
	});
});

/**
* @apiVersion 17.1.0
* @api {get} /volumes/compactionJobs List compaction jobs
* @apiName ListCompactionJobs
* @apiGroup volumes
* @apiDescription List all TPV compaction jobs, optionally filtered by state.
* @apiParam {string} [state] Filter by job state (e.g. `running`).
* @apiParamExample Example request
* /volumes/compactionJobs?state=running
* @apiSuccessExample {object[]} Example data on success
* [{ "jobId": "myTPV", "state": "running", "tpvId": "myTPV", "aggressiveness": "medium" }]
*/
router.get('/compactionJobs', function(req, res) {
	volumeModule.listTPVCompactionJobs({ state: req.query.state }, function(err, jobs) {
		if (err)
			return res.status(500).json({ error: 'internal-error', message: err.message });
		return res.json(jobs || []);
	});
});

/**
* @apiVersion 17.0.0
* @api {get} /volumes/:id Get volume by ID
* @apiName GetVolume
* @apiGroup volumes
* @apiDescription Get specific `volume` by `ID`.
*
* @apiParam {string} volume `volume's ID` to fetch.
* @apiParamExample {string} Example request
* volumes/v1
*
* @apiSuccess {object} API Response
*
* @apiSuccessExample Example data on success
* {
*         "_id": "v1",
*         "RAIDLevel": "Concatenated",
*         "capacity": 1,
*         "limitByNodes": [],
*         "limitByDisks": [],
*         "serverClasses": [],
*         "diskClasses": [],
*         "relativeRebuildPriority": 10,
*         "enableNVMf": false,
*         "name": "v1",
*         "description": "RPFF",
*         "VPG": "DEFAULT_CONCATENATED_VPG",
*         "selectedClientsForNvmf": [],
*         "stripeSize": 32,
*         "enableCrcCheck": false,
*         "isReadOnly": false,
*         "createdBy": "admin@nvidia.com",
*         "modifiedBy": "admin@nvidia.com",
*         "dateCreated": "2024-05-02T12:18:39.772Z",
*         "dateModified": "2024-05-02T12:18:39.761Z",
*         "version": 1,
*         "isReserved": false,
*         "status": "unavailable",
*         "uuid": "1bd54d40-087e-11ef-b082-796ff225eeff",
*         "reservation": {
*             "mode": 0,
*             "version": 1,
*             "reservedBy": null
*         },
*         "health": "healthy",
*         "lockServer": {
*             "maxNOwners": 1,
*             "type": 4,
*             "locksetShift": -1
*         },
*         "action": "initializing",
*         "blockSize": 4096,
*         "blocks": 243968,
*         "chunks": [
*             {
*                 "_id": "1bd99300-087e-11ef-b082-796ff225eeff",
*                 "uuid": "1bd99300-087e-11ef-b082-796ff225eeff",
*                 "vlbs": 0,
*                 "vlbe": 243967,
*                 "pRaids": [
*                     {
*                         "activated": false,
*                         "version": {
*                             "major": 0,
*                             "minor": 0
*                         },
*                         "tomaLeaderRaftTerm": 0,
*                         "zone": "1",
*                         "uuid": "1bd9ba11-087e-11ef-b082-796ff225eeff",
*                         "stripeIndex": 0,
*                         "diskSegments": [
*                             {
*                                 "_id": "1bd9ba10-087e-11ef-b082-796ff225eeff",
*                                 "uuid": "1bd9ba10-087e-11ef-b082-796ff225eeff",
*                                 "diskID": "S3HCNX0K800796.1",
*                                 "diskUUID": "ee741850-fcb5-11ee-bf5e-6b7c96cd0914",
*                                 "diskFormatRequestCounter": 2,
*                                 "nodeUUID": "0be6d3b0-fbc5-11ee-b7a0-15f31bb23eb6",
*                                 "node_id": "nvme1038",
*                                 "volumeName": "v1",
*                                 "volumeUUID": "1bd54d40-087e-11ef-b082-796ff225eeff",
*                                 "pRaidUUID": "1bd9ba11-087e-11ef-b082-796ff225eeff",
*                                 "allocationIndex": 0,
*                                 "pRaidIndex": 0,
*                                 "zone": "1",
*                                 "redundancyRatio": 0,
*                                 "lbs": 1509632,
*                                 "lbe": 1753599,
*                                 "type": "data",
*                                 "pRaidTypeIndex": 0,
*                                 "status": "initializing"
*                             }
*                         ]
*                     }
*                 ],
*                 "zone": "1"
*             }
*         ],
*         "createdByManagement": "10.242.2.155:4001",
*         "numberOfMirrors": 0
* }
*/
router.get('/:id', (req, res) => {
	fetchEntityByID('volume', req.params.id, false, {}, result => {
		if (result.diskClasses?.length) {
			result.limitByDisks = [];
		}
		if (result.serverClasses?.length) {
			result.limitByNodes = [];
		}

		return res.json(result);
	});
});

module.exports = router;
