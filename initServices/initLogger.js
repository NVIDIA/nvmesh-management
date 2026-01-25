/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

module.exports = function(loggerId) {
	var winston = require('winston');
	app.set('syslogID', loggerId);


	var winstonLogLevelsColors = {
		DEBUG: 'green',
		INFO: 'cyan',
		WARNING: 'yellow',
		ERROR: 'red'
	};

	var winstonLogLevels = {
		DEBUG: 0,
		INFO: 1,
		WARNING: 2,
		ERROR: 3
	};

	var winstonLogger = winston.createLogger({ levels: winstonLogLevels });
	winston.addColors(winstonLogLevelsColors);

	app.set('managementLogger', winstonLogger);
};
