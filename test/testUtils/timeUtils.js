/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global log */

//TBD move to class

const { performance } = require('perf_hooks');

let startTime;
let measurementName;
let testResultsReportInstance;

exports.start = (name, testResultsReport = null) => {
	testResultsReportInstance = testResultsReport;
	measurementName = name;
	startTime = performance.now();
};

exports.end = () => {
	let elapsedTime = performance.now() - startTime;

	if (testResultsReportInstance)
		testResultsReportInstance.updateTestResults('time', elapsedTime.toFixed(5));

	log.debug(`${measurementName} took ${elapsedTime}`);

	return elapsedTime;
};