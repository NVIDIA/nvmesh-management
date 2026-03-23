/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

const winston = require('winston');
const logger = require('../../logger.js');
const consts = require('../../consts.js');

require('winston-mongodb').MongoDB;

const myFormat = winston.format.printf(({ level, message, timestamp }) => {
	return `${timestamp} ${level}: ${message}`;
});

let testLogger;
let originalLogFn;

exports.createLogger = function() {
	testLogger = winston.createLogger({
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

	originalLogFn = logger.log;

	// use empty.log function
	// because any message that will be called on this function will be also logged using logSysMessage
	logger.log = () => {};

	return testLogger;
};

exports.disableMongoLog = function() {
	logger.log = () => {};
};

exports.enableMongoLog = function() {
	if (!originalLogFn)
		throw new Error('createLogger must be called before enableMongoLog');

	logger.log = originalLogFn;

	const db = app.get('db');
	if (!db)
		throw new Error('MongoDB not connected, cannot enable mongo log');

	const managementLogger = winston.createLogger({
		levels: { DEBUG: 0, INFO: 1, WARNING: 2, ERROR: 3 },
		level: 'ERROR',
		transports: [
			new winston.transports.MongoDB({
				db: db,
				collection: 'log',
				level: 'ERROR',
				metaKey: 'meta',
				capped: false,
				expireAfterSeconds: consts.DEFAULT_LOG_EXPIRATION_IN_SECONDS
			})
		]
	});

	app.set('managementLogger', managementLogger);
};
