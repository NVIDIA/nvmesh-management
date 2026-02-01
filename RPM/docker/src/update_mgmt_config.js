/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const CONFIG_FILE_PATH = '/etc/nvmesh/management.js.conf';

const fs = require('fs');
const config = require(CONFIG_FILE_PATH);
const logger = require('/opt/nvmesh/management/logger.js');

const mongoServers = process.env.MONGO_SERVERS;
const forceIP = process.env.FORCE_IP;
var configUpdateObj = (process.env.CONFIG) ? JSON.parse(process.env.CONFIG) : {};

logger.logToConsole('Got config update:' + configUpdateObj);

function extend(obj, update) {
	for (var key in update) {
		if (typeof obj[key] === 'object' && obj[key] !== null)
			extend(obj[key], update[key]);
		else
			obj[key] = update[key];
	}
}

extend(config, configUpdateObj);

if (mongoServers)
	config.mongoConnection.hosts = mongoServers;

if (forceIP)
	config.forceIP = forceIP;

if (!('logToConsole' in config))
	// set logging to console so it will show on the docker logs
	config.logToConsole = config.logToConsole || true;

// write config to file as a NodeJS module
var fileContent = 'var config = ' + JSON.stringify(config) + '; module.exports = config;';
fs.writeFileSync(CONFIG_FILE_PATH, fileContent);

logger.logToConsole(CONFIG_FILE_PATH + ' updated');
