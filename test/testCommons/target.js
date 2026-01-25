/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

const async = require('async');
const assert = require('assert');

const { start, end } = require('../testUtils/timeUtils.js');

const { getTOMAConfiguration } = require('../../modules/websocket.js');


function getTomaConfiguration(target, callback) {
	getTOMAConfiguration(target.node_id, true, (err, res) => {
		callback(err, res);
	});
}

exports.getAllTOMAsConfigurations = (measurementName, testResultsReport, done) => {
	app.get('db').collection('server').find().project({ _id: 0, node_id: 1 }).toArray()
		.then(targets => {
			let results = [];

			function getTomaConfigurationAndSaveResult(target, callback) {
				getTomaConfiguration(target, (err, res) => {
					if (err)
						return callback(err);

					results.push(res);
					callback();
				});
			}

			start(measurementName, testResultsReport);

			async.each(targets, getTomaConfigurationAndSaveResult, (err) => {
				if (err)
					done();

				else {
					end();

					assert(results.length === targets.length);

					if (testResultsReport) {
						testResultsReport.updateTestResults('moreInfo', `${targets.length} TOMA's`);
					}

					done();
				}
			});
		})
		.catch(done);
};
