/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

var express = require('express');
var consts = require('../consts.js');
var utils = require('../utils.js');
var kafka = require('../modules/kafka.js');
var websocket = require('../modules/websocket.js');
const isAdminRole = require('../middlewares/isAdminRole.js');
var router = express.Router();

router.get('/', function(req, res) {
	var renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };
	renderData.isReact = true;
	renderData.componentName = consts.componentsPages.techniciansScreen;

	if (consts.userRoles.ADMIN === req.user.role)
		res.render('react', renderData);
	else
		res.send('Insufficient privileges.');

});

router.use(isAdminRole);

router.get('/offsetsRegistry', function(req, res) {
	const Timeout = setTimeout(() => {}, 0).constructor;
	const objStr = JSON.stringify(kafka.offsetsRegistry, (k, v) => v instanceof Timeout ? 'Timeout' : v);
	res.type('json').send(objStr);
});

router.get('/kafkaMetrics', function(req, res) {
	const kafkaMetrics = {
		subscribableTopics: Array.from(kafka.subscribableTopics),
		messagesInProcess: kafka.messagesInProcess,
		isConsumerPaused: kafka.isConsumerPaused,
		totalConsumed: kafka.totalConsumed,
		totalSent: kafka.totalSent,
		totalSentFailed: kafka.totalSentFailed,
		metrics: Object.values(kafka.metrics)
	};
	res.json(kafkaMetrics);
});

router.post('/kafkaMetrics/reset', function(req, res) {
	kafka.resetMetrics();
	res.json({});
});

router.get('/countKafkaMetrics', function(req, res) {
	var count = Object.values(kafka.metrics).length;
	res.json(count);
});

router.get('/timedIntervalsNames', function(req, res) {
	var timedIntervalsNames = Object.keys(utils.getCachedStats('timedIntervals'));
	res.json(timedIntervalsNames);
});

router.get('/commsStats', function(req, res) {
	var options = utils.tryParseJSON(req.query.options);
	var data = utils.getCachedStats('communicationStats', options.clearCache);
	res.json(data);
});

router.get('/countCommsStats', function(req, res) {
	var count = countCommsStats(utils.getCachedStats('communicationStats'));
	res.json(count);
});

router.get('/timedIntervals', function(req, res) {
	var options = utils.tryParseJSON(req.query.options);
	var data = utils.getCachedTimedIntervals(options.clearCache);
	data.isTiming = options.isTiming;
	app.set('timedIntervals', data);
	res.json(data);
});

router.get('/countTimedIntervals', function(req, res) {
	var timedIntervals = utils.getCachedStats('timedIntervals');
	var count = Object.keys(timedIntervals.intervals).length;
	res.json(count);
});

router.get('/monitoredEvents', function(req, res) {
	var data = websocket.getRemoteMonitoredEvents();
	res.json(data);
});

router.get('/countMonitoredEvents', function(req, res) {
	var count = Object.keys(websocket.getRemoteMonitoredEvents()).length;
	res.json(count);
});

function countCommsStats(data) {
	return Object.keys(data).reduce((acc, host) => { return acc += Object.keys(data[host].routes).length; }, 0);
}

module.exports = router;
