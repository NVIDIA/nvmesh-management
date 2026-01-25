/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const winston = require('winston');
const logger = require('../../logger.js');

const myFormat = winston.format.printf(({ level, message, timestamp }) => {
	return `${timestamp} ${level}: ${message}`;
});

exports.createLogger = function() {
	let testLogger = winston.createLogger({
		level: 'debug',
		transports: [
			new winston.transports.File({
				filename: 'test/test.log',
				level: 'debug',
				format: winston.format.combine(
					winston.format.timestamp(),
					myFormat
				),
				options: { flags: 'w' }
			})
		],
	});

	logger.logSysMessage = (level, msg) => {
		if (level == 'WARNING')
			level = 'warn';
		testLogger.log(level.toLowerCase(), msg);
	};

	// use empty.log function
	// because any message that will be called on this function will be also logged using logSysMessage
	logger.log = () => {};

	return testLogger;
};


