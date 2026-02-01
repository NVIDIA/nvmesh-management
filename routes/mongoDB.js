/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global app */

var express = require('express');

var consts = require('../consts.js');
var mongoDBModule = require('../modules/mongoDB.js');
var utils = require('../utils.js');
const { SystemMessage } = require('../modules/error.js');
const systemMessages = require('../systemMessages.js');
const isAdminRole = require('../middlewares/isAdminRole.js');

var router = express.Router();

router.get('/', function(req, res) {
	var renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };

	if (consts.userRoles.ADMIN === req.user.role) {
		renderData.isReact = true;
		renderData.componentName = consts.componentsPages.mongoDB;

		res.render('react', renderData);
	} else
		res.send('insufficient privileges');
});

router.use(isAdminRole);

/**
* @apiVersion 1.0.0
* @api {get} /mongoDB/all Get MongoDB
* @apiName GetMongoDBs
* @apiGroup mongoDB
* @apiDescription Get `mongoDB`s
*
* @apiSuccess {object[]} mongoDBs List Of `mongoDBs`.
*
* @apiSuccessExample Example data on success
* [
*     {
*         "members": [
*             {
*                 "name": "nvme82:27017",
*                 "host": "nvme82",
*                 "port": "27017",
*                 "health": 1,
*                 "state": "STAND ALONE",
*                 "dbSize": 3417334,
*                 "freeSpace": 19569094656
*             }
*         ]
*     }
* ]
*/
router.get('/all', (req, res) => mongoDBModule.getAllMongoDB(results => res.json(results)));

/**
* @apiVersion 1.0.0
* @api {get} /mongoDB/count Count mongoDB replicas
* @apiName CountMongoDB
* @apiGroup mongoDB
* @apiDescription Get total `mongoDB` replicas count.
*
* @apiSuccess {integer} count `mongoDB` replicas count.
*
* @apiSuccessExample Example data on success
* 4
*/
router.get('/count', function(req, res) {
	if (!app.get('isMongoReplicated')) {
		res.json(1);
	} else {
		mongoDBModule.loadCluster(results => {
			if (results)
				results = results.members.length;

			res.json(results);
		});
	}
});

/**
* @apiVersion 1.0.0
* @api {get} /mongoDB/:id Get mongoDB by ID
* @apiName GetMongoDB
* @apiGroup mongoDB
* @apiDescription Get specific `mongoDB` by `ID`.
*
* @apiParam {string} mongoDB `mongoDB's ID` to fetch.
* @apiParamExample {string} Example request
* mongoDB/
*
* @apiSuccess {object} API Response
*
* @apiSuccessExample Example data on success
* {
*         "name": "localhost:27017",
*         "host": "localhost",
*         "port": "27017",
*         "health": 1,
*         "state": "STAND ALONE",
*         "dbSize": 130496,
*         "freeSpace": 206712139776
* }
*/
router.get('/:id', (req, res) => {
	const mongoDBID = req.params.id;

	mongoDBModule.getAllMongoDB(results => {
		const mongoDB = results[0].members.find(r => r.name === mongoDBID);

		if (!mongoDB)
			return res.json(utils.createApiResponse(mongoDBID, null, false, new SystemMessage(systemMessages.CANT_FIND_ENTITY).toApiResponse()));

		res.json(mongoDB);
	});
});

module.exports = router;
