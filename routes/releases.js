/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


const express = require('express');

const consts = require('../consts.js');
const utils = require('../utils.js');
const systemMessages = require('../systemMessages.js');
const { Entities, Differentiators } = require('../modules/error.js');
const { createAuditRequestLog } = require('../modules/log.js');
const validateProjection = require('../middlewares/validateProjection.js');
const releaseModule = require('../modules/release.js');
const releaseBuilderModule = require('../modules/releaseBuilder.js');

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
 * @api {post} /releases/delete Delete releases
 * @apiName DeleteReleases
 * @apiGroup releases
 * @apiDescription Delete `releases`.
 *
 * @apiParam {object[]} releases List of `releases` to delete.
 * @apiParam {integer} releases.ID The `ID` of the `release`.
 * @apiParamExample {object[]} Example request
 * [{"ID": 1}]
 * @apiSuccess {object[]} results Success statuses
 * @apiSuccessExample {object[]} Example data on success
 * [{
 *     "ID": 1,
 *     "uuid": null,
 *     "success": true,
 *     "error": null,
 *     "payload": null
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
 * @apiParam {integer} releases.ID The `ID` of the `release`.
 * @apiParam {string} [releases.version] The version of the release.
 * @apiParam {object[]} [releases.artifacts] List of `artifacts` to update.
 * @apiParam {integer} releases.artifacts.ID The `ID` of the `artifact`.
 * @apiParamExample {object[]} Example request
 * [{
 *     "ID": 1,
 *     "version": "3.2.0-HF2",
 *     "artifacts": [{ "ID": 1 }]
 * }]
 * @apiSuccess {object[]} results Success statuses
 * @apiSuccessExample {object[]} Example data on success
 * [{
 *     "ID": 1,
 *     "uuid": null,
 *     "success": true,
 *     "error": null,
 *     "payload": null
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

/**
 * @apiVersion 1.0.0
 * @api {post} /releases/save Save a new release
 * @apiName SaveRelease
 * @apiGroup releases
 * @apiDescription Saves a release from a payload. This complex operation can perform the following actions:
 *
 * - **Platform Creation**: Creates new platforms, including their OS, kernel, OFED, and architecture definitions.
 * - **Artifact Association**: Creates and associates artifacts with new or existing platforms.
 * - **Release Management**: Creates a new release or updates an existing one by linking the specified artifacts.
 * This will append the new artifacts to the existing release artifacts.
 * - **Component Compatibility Inheritance**: Inherits NVMesh package compatibilities from a previous release (`inheritRelationsFrom`).
 *   For each component in the new release, this process establishes its compatibility with other `NVMESH_PACKAGE` components based on the following logic:
 *   - The system first identifies the corresponding component in the release specified by `inheritRelationsFrom` (release `n-1`).
 *     If no corresponding component is found, the inheritance for that component is skipped.
 *   - It then adds compatibility with the latest version of related `NVMESH_PACKAGE` components from release `n-1`.
 *   - Subsequently, it attempts to add compatibility with the new version (`n`) of those components if they are part of the current save payload.
 *
 *   For each component in the previous release, this process will add compatibility with the new version (`n`) of that component.
 * - **Upgrade Scenario Inheritance**: Inherits and adapts upgrade scenarios from the `inheritRelationsFrom` release.
 *   - For a hotfix release, scenarios targeting the previous release (e.g., `* -> n-1`) are adapted to target the new release (`* -> n`).
 *   - For a standard release, scenarios for the previous release (`n-1 -> n-1`) are adapted for the new release (`n-1 -> n` and `n -> n`).
 *
 * **Note:** This endpoint will not update any other existing entities, with the exception of:
 *  - linking new artifacts to an existing release
 *  - linking new artifacts to an existing platform
 *  - updating the version of previous release nvmesh components to be compatible with the new release nvmesh components
 *
 * @apiParam {object[]} releases Array of release objects.
 * @apiParam {string} releases.releaseName Version of the release to save. Can be a new or an existing release.
 * @apiParam {string} [releases.inheritRelationsFrom] Version of an existing release to inherit component relationships and upgrade scenarios from.
 * @apiParam {boolean} [releases.createPlatforms=false] If true, new platform definitions and dependencies will be created.
 * @apiParam {object[]} releases.platforms Array of platform objects. If `createPlatforms` is true, platforms are created; otherwise,
 * existing platforms are updated with artifacts.
 * @apiParam {string} releases.platforms.name The name of the platform. If null, given artifacts will not be associated with any platform.
 * @apiParam {string[]} releases.platforms.artifacts Array of artifact names to associate with this platform.
 * @apiParam {object} [releases.platforms.os] Operating system definition. This object is required if `createPlatforms` is true.
 * @apiParam {string} [releases.platforms.os.distributionType] OS distribution type (e.g., 'ubuntu', 'rocky'). Required if `os` is provided.
 * @apiParam {string} [releases.platforms.os.version] OS version. Required if `os` is provided.
 * @apiParam {string} [releases.platforms.kernel] Kernel version for the platform. Required if `createPlatforms` is true.
 * @apiParam {string} [releases.platforms.ofed] OFED version for the platform. Required if `createPlatforms` is true.
 * @apiParam {string} [releases.platforms.arch] Platform architecture. Required if `createPlatforms` is true.
 *
 * @apiParamExample {json} Request Body Example:
 * [{
 *     "releaseName": "3.4.0",
 *     "inheritRelationsFrom": "3.3.2",
 *     "createPlatforms": false,
 *     "platforms": [
 *         {
 *             "name": "GFN1",
 *             "os": {
 *                 "distributionType": "rocky",
 *                 "version": "8.10"
 *             },
 *             "kernel": "4.18.0-553.51.1.el8.1746466718.fd884b6339.x86_64",
 *             "ofed": "24.10-2.1.8.0.101",
 *             "arch": "x86_64",
 *             "artifacts": [
 *                 "nvmesh-client-3.4.0-237.el8_10.1.1089.x86_64.rpm",
 *                 "nvmesh-target-3.4.0-237.el8_10.1.1089.x86_64.rpm"
 *             ]
 *         }
 *     ]
 * }]
 *
 * @apiSuccessExample {json} Success-Response:
 * [{
 *     "_id": null,
 *     "uuid": null,
 *     "success": true,
 *     "error": null,
 *     "payload": null
 * }]
 */
router.post('/save', (req, res) => {
	const payload = req.body;

	const incomingRequestSystemAdminMessage = payload.map((release) => {
		const message = createAuditRequestLog(req, systemMessages.RELEASE_SAVE_REQUEST)
			.addInfo(Entities.Release.name, release.releaseName, Differentiators.Destination);

		if (release.inheritRelationsFrom)
			message.addInfo(Entities.Release.name, release.inheritRelationsFrom, Differentiators.Source);

		return message;
	});

	utils.handleRESTAndLog(
		incomingRequestSystemAdminMessage,
		cb => releaseBuilderModule.saveReleases(payload, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.Release.name)))
	);
});

module.exports = router;
