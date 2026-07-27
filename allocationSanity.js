/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/


/* global app */
var mongodb = require('mongodb-legacy').MongoClient;
var express = require('express');
var logger = require('./logger.js');
var mongoDBModule = require('./modules/mongoDB.js');
var sanityAndRecover = require('./modules/sanityAndRecover.js');
var errorModule = require('./modules/error.js');

// eslint-disable-next-line no-global-assign
app = express();

app.set('syslogID', 'allocationSanity');
app.set('globalSettings', { loggingLevel: 'DEBUG' });
app.set('projectRoot', __dirname);

// we dont really need a logger to db here (like winston logger), but we need to set it to avoid errors
app.set('managementLogger', { log: () => {} });

errorModule.afterModuleLoaded();
sanityAndRecover.afterModuleLoaded();

function handleCriticalError(e) {
	if (!e)
		return;

	logger.sysERROR(e);
	process.exit(1);
}

var config = require('/etc/nvmesh/management.js.conf');
let { URI, mongoClientOptions } = mongoDBModule.buildMongoConnectionParameters(config.mongoConnection);

mongodb.connect(URI, mongoClientOptions, (err, client) => {
	var db = client.db(config.mongoConnection.dbName);

	app.set('db', db);

	sanityAndRecover.validateLargestSegment(e => {
		handleCriticalError(e);

		sanityAndRecover.checkForBadVolumes(() => {
			sanityAndRecover.checkForOverlappingVolumes(e => {
				handleCriticalError(e);

				sanityAndRecover.checkForZonesViolation(() => {
					if (process.pid)
						logger.logToConsole(process.pid);

					process.exit(0);
				});
			});
		});
	});
});
