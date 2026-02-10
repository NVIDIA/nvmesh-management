/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


const express = require('express');

const utils = require('../utils');
const nvmeshMetadata = require('../modules/nvmeshMetadata');
const systemMessages = require('../systemMessages.js');
const { createAuditRequestLog } = require('../modules/log.js');
const { Entities } = require('../modules/error.js');
const isAdminRole = require('../middlewares/isAdminRole.js');

const router = express.Router();

/**
* @apiVersion 17.0.0
* @api {get} /nvmeshMetadata/clusterID Get Cluster ID
* @apiName GetClusterID
* @apiGroup ClusterID
* @apiDescription Get `clusterID`.
* @apiSuccess {object} result `clusterID`.
* @apiSuccessExample Example data on success
* {
*	"_id": "681b2992bb63df4991752be2",
*	"id": "My Cluster",
*	"needReconfirm": false,
*	"uuid": "ba491a30-2b26-11f0-894c-c56163572fbc"
* }
*/
router.get('/clusterID', (req, res) => nvmeshMetadata.getClusterID(clusterID => res.json(clusterID)));

/**
* @apiVersion 17.0.0
* @api {post} /nvmeshMetadata/updateClusterID Update Cluster ID
* @apiName updateClusterID
* @apiGroup ClusterID
* @apiDescription update `clusterID`.
* @apiBody {object} Object including the clusterID.
* @apiBody {string} clusterID clusterID to update.
* @apiExample {string} Payload example
* { 'clusterID': 'myClusterID' }
* @apiSuccess {object} results success status
* @apiSuccessExample Example data on success
* {
*	"_id": "myClusterID",
*   "uuid": null,
*	"success": true,
*	"error": null,
*	"payload": null
* }
*/
router.post('/updateClusterID', isAdminRole, (req, res) => {
	const newClusterID = req.body.clusterID;

	const incomingRequestSystemAdminMessage = createAuditRequestLog(req, systemMessages.UPDATE_CLUSTER_ID_REQUEST)
		.addInfo(Entities.ManagementCluster.ID, newClusterID);

	utils.handleRESTAndLog(
		[incomingRequestSystemAdminMessage],
		cb => nvmeshMetadata.updateClusterID(newClusterID, cb),
		systemAdminMessages => res.json(systemAdminMessages.map(m => m.createApiResponse(Entities.ManagementCluster.ID))[0])
	);
});

module.exports = router;
