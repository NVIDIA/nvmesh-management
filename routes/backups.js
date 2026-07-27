/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

var express = require('express');

var objectNotifier = require('../objectNotifier.js');
var utils = require('../utils.js');
var consts = require('../consts.js');
const { SystemMessage } = require('../modules/error.js');
const systemMessages = require('../systemMessages.js');
const isAdminRole = require('../middlewares/isAdminRole.js');

var router = express.Router();

router.get('/', function(req, res) {
	const renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };

	if (consts.userRoles.ADMIN === req.user.role) {
		renderData.isReact = true;
		renderData.componentName = consts.componentsPages.backups;

		res.render('react', renderData);
	} else
		res.send('insufficient privileges');
});

function getFilteredBackups(backups, filter) {
	var filterKeys = Object.keys(filter);

	if (filterKeys.length > 0) {
		var filteredResults = backups.filter(function(bcp) {
			for (var key in filter) {
				if (filter[key].$regex)
					if (bcp[key].toLowerCase().indexOf(filter[key].$regex.toLowerCase()) == -1)
						return false;
					else (filter[key].$gt && filter[key].$lt);
				if (bcp[key] < filter[key].$gt || bcp[key] >= filter[key].$lt)
					return false;
			}

			return true;
		});

		return filteredResults;
	}

	return backups;
}

function adjustingBackupResults(backups, query) {
	var results = backups;
	var sortKeys = Object.keys(query.sort);

	results = getFilteredBackups(backups, query.filter);

	if (sortKeys.length > 0) {
		var sortByKey = sortKeys[0];
		var asc = query.sort[sortByKey] === 1 ? true : false;

		results.sort(function(a, b) {
			if (a[sortByKey] < b[sortByKey])
				return asc ? -1 : 1;
			if (a[sortByKey] > b[sortByKey])
				return asc ? 1 : -1;
			return 0;
		});
	}

	if (query.skip < backups.length) {
		results = results.splice(query.skip, query.limit);
	} else {
		results = results.splice(0, query.limit);
	}

	return results;
}

router.use(isAdminRole);

/**
* @apiVersion 1.0.0
* @api {get} /backups/all/:page/:count?filter={}&sort={} Get Backups
* @apiName GetBackups
* @apiGroup backups
* @apiDescription Get `backups` by `page` and `count`.
*
* @apiParam {integer} page The `page` number to fetch.
* @apiParam {integer} count Number of records per `page`.
* @apiParam {object} [filter] `Filter` before fetching. <small><i>--MongoDB filter obj</i></small>
* @apiParam {object} [sort] `Sort` before fetching. <small><i>--MongoDB sort obj</i></small>
* @apiSuccess {object[]} backups List Of `backups`
*
* @apiSuccessExample Example data on success
* [
*     {
*         "backup_id": "management_2024-05-06T10:08:56.913Z.tar.gz",
*         "fileName": "hourly_management_2024-05-06T10:08:56.913Z.tar.gz",
*         "dateCreated": "2024-05-06T07:08:56.964Z",
*         "size": 3193,
*         "type": "hourly"
*     }
* ]
*/
router.get('/all/:page/:count', function(req, res) {
	var page = parseInt(req.params.page);
	var count = parseInt(req.params.count);

	var query = {
		filter: utils.tryParseJSON(req.query.filter) || {},
		sort: utils.tryParseJSON(req.query.sort) || {},
		skip: page * count,
		limit: count
	};

	objectNotifier.getObject(objectNotifier.events.backupChangeEvent.name, function(err, backupsWrapper) {
		if (err)
			return res.json(null);

		var backups = backupsWrapper.backups;
		var backupArr = Object.keys(backups).map(function(bcp) { return backups[bcp]; });
		var adjustedBackupArr = adjustingBackupResults(backupArr, query);

		res.json(adjustedBackupArr);
	});
});

/**
* @apiVersion 1.0.0
* @api {get} /backups/count Count Backups
* @apiName CountBackups
* @apiGroup backups
* @apiDescription Get total `backups` count.
*
* @apiSuccess {integer} count `backups` count.
*
* @apiSuccessExample Example data on success
* 4
*/
router.get('/count', function(req, res) {
	var filter = utils.tryParseJSON(req.query.filter) || {};

	objectNotifier.getObject(objectNotifier.events.backupChangeEvent.name, function(err, backupsWrapper) {
		if (err)
			return res.json(null);

		var backups = backupsWrapper.backups;
		var backupArr = Object.keys(backups).map(function(bcp) { return backups[bcp]; });
		var filteredBackupArr = getFilteredBackups(backupArr, filter);

		res.json(filteredBackupArr.length);
	});
});

/**
* @apiVersion 1.0.0
* @api {get} /backups/:id Get backup by ID
* @apiName GetBackup
* @apiGroup backups
* @apiDescription Get specific `backup` by `ID`.
*
* @apiParam {string} backup `backup's ID` to fetch.
* @apiParamExample {string} Example request
* backups/daily_management_2023-10-26T00:00:05.578Z.tar.gz
*
* @apiSuccess {object} API Response
*
* @apiSuccessExample Example data on success
* {
*		"backup_id": "management_2023-10-26T00:00:05.578Z.tar.gz",
*		"fileName": "daily_management_2023-10-26T00:00:05.578Z.tar.gz",
*		"dateCreated": "2023-10-25T21:00:05.850Z",
*		"size": 40653,
*		"type": "daily"
* }
*/
router.get('/:id', (req, res) => {
	const backupID = req.params.id;

	objectNotifier.getObject(objectNotifier.events.backupChangeEvent.name, (err, backupsWrapper) => {
		if (err)
			return res.json(utils.createApiResponse(backupID, null, false, err));

		const backup = backupsWrapper.backups[backupID];

		if (!backup)
			return res.json(utils.createApiResponse(backupID, null, false, new SystemMessage(systemMessages.CANT_FIND_ENTITY).toApiResponse()));

		res.json(backup);
	});

});

module.exports = router;
