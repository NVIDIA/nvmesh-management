/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


const express = require('express');

const artifactsModule = require('../modules/artifacts.js');
const consts = require('../consts.js');
const utils = require('../utils.js');
const systemMessages = require('../systemMessages.js');
const { Entities } = require('../modules/error.js');
const { createAuditRequestLog } = require('../modules/log.js');
const validateProjection = require('../middlewares/validateProjection.js');

const router = express.Router();

router.get('/', function(req, res) {
	var renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };
	renderData.componentName = consts.componentsPages.artifacts;

	res.render('react', renderData);
});

/**
* @apiVersion 1.0.0
* @api {get} /artifacts/all/:page/:count?filter={}&sort={} Get artifacts
* @apiName GetArtifacts
* @apiGroup artifacts
* @apiDescription Get `artifacts` by `page` and `count`.
*
* @apiParam {integer} page The `page` to fetch.
* @apiParam {integer} count Number of records per `page`.
* @apiParam {object} [filter] `Filter` before fetching.
* @apiParam {object} [sort] `Sort` before fetching.
* @apiParamExample {object[]} Example request
* /artifacts/all/0/2?sort={"name":1}
*
* @apiSuccess {object[]} artifacts List of `artifacts`.
*
* @apiSuccessExample Example data on success
* [{
  "ID": 1,
  "name": "nvmesh-target-3.1.0-1357.el8_6.x86_64.rpm",
  "platforms": [
    {
      "ID": 1,
      "name": "SetupName",
      "description": "Setup description",
      "archTypeID": 1,
      "operatingSystemID": 1,
      "kernelID": 8,
      "ofedID": 4,
      "ArtifactPlatform": {
        "ID": 1,
        "artifactID": 1,
        "platformID": 1
      }
    },
    {
      "ID": 2,
      "name": "name2",
      "description": "new description2",
      "archTypeID": 1,
      "operatingSystemID": 1,
      "kernelID": 9,
      "ofedID": 5,
      "ArtifactPlatform": {
        "ID": 9,
        "artifactID": 1,
        "platformID": 2
      }
    }
  ]
}]
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

	artifactsModule.getAllArtifacts(queryObj, (error, artifacts) => {
		if (error)
			return res.json(error.createApiResponse());

		res.json(artifacts);
	});
});

/**
 * @apiVersion 1.0.0
 * @api {post} /artifacts/save Save artifacts
 * @apiName SaveArtifacts
 * @apiGroup artifacts
 * @apiDescription Save `artifacts`.
 *
 * @apiParam {object[]} artifacts List of `artifacts` to save.
 * @apiParamExample {object[]} Example request
 * [{
  "name": "nvmesh-target-3.1.0-1357.el8_6.x86_64.rpm",
  "platforms": [
    {
      "ID": 1,
      "name": "SetupName",
      "description": "Setup description",
      "archTypeID": 1,
      "operatingSystemID": 1,
      "kernelID": 8,
      "ofedID": 4,
      "ArtifactPlatform": {
        "ID": 1,
        "artifactID": 1,
        "platformID": 1
      }
    },
    {
      "ID": 2,
      "name": "name2",
      "description": "new description2",
      "archTypeID": 1,
      "operatingSystemID": 1,
      "kernelID": 9,
      "ofedID": 5,
      "ArtifactPlatform": {
        "ID": 9,
        "artifactID": 1,
        "platformID": 2
      }
    }
  ]
}]
 */
router.post('/save', (req, res) => {
	let artifacts = req.body;

	let incomingRequestSystemAdminMessage = artifacts.map((artifact) => createAuditRequestLog(req, systemMessages.ARTIFACT_SAVE_REQUEST)
		.addInfo(Entities.Artifact.ID, artifact.ID)
		.addInfo(Entities.Artifact.name, artifact.name)
	);

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => artifactsModule.createArtifacts(artifacts, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Artifact.name, Entities.Artifact.ID)))
	);
});

/**
 * @apiVersion 1.0.0
 * @api {post} /artifacts/delete Delete artifacts
 * @apiName DeleteArtifacts
 * @apiGroup artifacts
 * @apiDescription Delete `artifacts`.
 *
 * @apiParam {object[]} artifacts List of `artifacts` to delete.
 * @apiParamExample {object[]} Example request
 * [{
 *     "ID": 1,
 *     "name": "nvmesh-target-3.1.0-1357.el8_6.x86_64.rpm"
 * }]
 */
router.post('/delete', (req, res) => {
	let artifacts = req.body;

	let incomingRequestSystemAdminMessage = artifacts.map((artifact) => createAuditRequestLog(req, systemMessages.ARTIFACT_DELETE_REQUEST)
		.addInfo(Entities.Artifact.ID, artifact.ID)
		.addInfo(Entities.Artifact.name, artifact.name)
	);

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => artifactsModule.deleteArtifacts(artifacts, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Artifact.name, Entities.Artifact.ID)))
	);
});

/**
 * @apiVersion 1.0.0
 * @api {post} /artifacts/update Update artifacts
 * @apiName UpdateArtifacts
 * @apiGroup artifacts
 * @apiDescription Update `artifacts`.
 *
 * @apiParam {object[]} artifacts List of `artifacts` to update.
 * @apiParamExample {object[]} Example request
 * [{
 *     "ID": 1,
 *     "name": "nvmesh-target-3.1.0-1357.el8_6.x86_64.rpm"
 */
router.post('/update', (req, res) => {
	let artifacts = req.body;

	let incomingRequestSystemAdminMessage = artifacts.map((artifact) => createAuditRequestLog(req, systemMessages.ARTIFACT_UPDATE_REQUEST)
		.addInfo(Entities.Artifact.ID, artifact.ID)
		.addInfo(Entities.Artifact.name, artifact.name)
	);

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => artifactsModule.updateArtifacts(artifacts, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Artifact.name, Entities.Artifact.ID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {get} /artifacts/count Count artifacts
* @apiName CountArtifacts
* @apiGroup artifacts
* @apiDescription Get total `artifacts` count.
*
* @apiParam {object} [filter] `Filter` before counting. <small><i>--MongoDB filter obj</i></small>
* @apiParamExample {object} Example request
* artifacts/count?filter={}
*
* @apiSuccess {integer} count `artifacts` count.
*
* @apiSuccessExample Example data on success
* 3606
*/
router.get('/count', (req, res) => {
	const filterObj = utils.tryParseJSON(req.query.filter) || {};

	artifactsModule.countArtifacts(filterObj, (count) => {
		res.json(count);
	});
});

module.exports = router;
