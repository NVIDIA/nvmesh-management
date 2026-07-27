/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

const express = require('express');

const consts = require('../consts.js');
const utils = require('../utils.js');
const systemMessages = require('../systemMessages.js');
const { Entities } = require('../modules/error.js');
const { createAuditRequestLog } = require('../modules/log.js');
const validateProjection = require('../middlewares/validateProjection.js');
const releaseModule = require('../modules/release.js');

const router = express.Router();

router.get('/', function(req, res) {
	const renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };

	renderData.isReact = true;
	renderData.componentName = consts.componentsPages.releases;

	res.render('react', renderData);
});

/**
* @apiVersion 1.0.0
* @api {get} /releases/all/:page/:count?filter={}&sort={} Get releases
* @apiName GetReleases
* @apiGroup releases
* @apiDescription Get `releases` by `page` and `count`.
*
* @apiParam {integer} page The `page` to fetch.
* @apiParam {integer} count Number of records per `page`.
* @apiParam {object} [filter] `Filter` before fetching.
* @apiParam {object} [sort] `Sort` before fetching.
* @apiParamExample {object[]} Example request
* /releases/all/0/2?filter={"version":"3.2.0-HF2"}&sort={"version":-1}
*
* @apiSuccess {object[]} releases List of `releases`.
*
* @apiSuccessExample Example data on success
* [{
  "ID": 1,
  "version": "3.2.0-HF2",
  "artifacts": [
    {
      "ID": 1,
      "name": "nvmesh-target-3.1.0-1357.el8_6.x86_64.rpm",
      "ReleaseArtifact": {
        "ID": 1,
        "releaseID": 1,
        "artifactID": 1
      }
    },
    {
      "ID": 2,
      "name": "nvmesh-base-3.1.0-1357.el8_6.x86_64.rpm",
      "ReleaseArtifact": {
        "ID": 2,
        "releaseID": 1,
        "artifactID": 2
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

	releaseModule.getAllReleases(queryObj, (error, releases) => {
		if (error)
			return res.json(error.createApiResponse());

		res.json(releases);
	});
});

/**
 * @apiVersion 1.0.0
 * @api {post} /releases/save Save releases
 * @apiName SaveReleases
 * @apiGroup releases
 * @apiDescription Save `releases`.
 *
 * @apiParam {object[]} releases List of `releases` to save.
 * @apiParamExample {object[]} Example request
 * [{
  "version": "3.2.0-HF2",
  "artifacts": [
    {
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
    },
    {
      "ID": 2,
      "name": "nvmesh-base-3.1.0-1357.el8_6.x86_64.rpm",
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
            "ID": 2,
            "artifactID": 2,
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
            "ID": 10,
            "artifactID": 2,
            "platformID": 2
          }
        }
      ]
    }
  ]
}]
 */
router.post('/save', (req, res) => {
	let releases = req.body;

	let incomingRequestSystemAdminMessage = releases.map((release) => createAuditRequestLog(req, systemMessages.RELEASE_SAVE_REQUEST)
		.addInfo(Entities.Release.ID, release.ID)
		.addInfo(Entities.Release.name, release.version)
	);

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => releaseModule.createReleases(releases, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Release.name, Entities.Release.ID)))
	);
});

/**
 * @apiVersion 1.0.0
 * @api {post} /releases/delete Delete releases
 * @apiName DeleteReleases
 * @apiGroup releases
 * @apiDescription Delete `releases`.
 *
 * @apiParam {object[]} releases List of `releases` to delete.
 * @apiParamExample {object[]} Example request
 * [{
 *     "ID": 1,
 *     "version": "3.2.0-HF2"
 * }]
 */
router.post('/delete', (req, res) => {
	let releases = req.body;

	let incomingRequestSystemAdminMessage = releases.map((release) => createAuditRequestLog(req, systemMessages.RELEASE_DELETE_REQUEST)
		.addInfo(Entities.Release.ID, release.ID)
		.addInfo(Entities.Release.name, release.version)
	);

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => releaseModule.deleteReleases(releases, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Release.name, Entities.Release.ID)))
	);
});

/**
 * @apiVersion 1.0.0
 * @api {post} /releases/update Update releases
 * @apiName UpdateReleases
 * @apiGroup releases
 * @apiDescription Update `releases`.
 *
 * @apiParam {object[]} releases List of `releases` to update.
 * @apiParamExample {object[]} Example request
 * [{
 *     "ID": 1,
 *     "version": "3.2.0-HF2"
 * }]
 */
router.post('/update', (req, res) => {
	let releases = req.body;

	let incomingRequestSystemAdminMessage = releases.map((release) => createAuditRequestLog(req, systemMessages.RELEASE_UPDATE_REQUEST)
		.addInfo(Entities.Release.ID, release.ID)
		.addInfo(Entities.Release.name, release.version)
	);

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => releaseModule.updateReleases(releases, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Release.name, Entities.Release.ID)))
	);
});

/**
* @apiVersion 1.0.0
* @api {get} /releases/count Count releases
* @apiName CountReleases
* @apiGroup releases
* @apiDescription Get total `releases` count.
*
* @apiParam {object} [filter] `Filter` before counting. <small><i>--MongoDB filter obj</i></small>
* @apiParamExample {object} Example request
* releases/count?filter={"archTypeID":2}
*
* @apiSuccess {integer} count `releases` count.
*
* @apiSuccessExample Example data on success
* 3606
*/
router.get('/count', (req, res) => {
	const filterObj = utils.tryParseJSON(req.query.filter) || {};

	releaseModule.count(filterObj, (count) => {
		res.json(count);
	});
});


module.exports = router;