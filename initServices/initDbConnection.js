/* global app */

module.exports = function(callback) {
	var winston = require('winston');
	var config = require('../modules/config.js');
	var generalSettingsModule = require('../modules/generalSettings.js');
	var mongoDBModule = require('../modules/mongoDB.js');
	var logger = require('../logger.js');
	var mongodb = require('mongodb-legacy').MongoClient;
	var winstonLogger = app.get('managementLogger');
	var { Entities, SystemMessage, MongoError } = require('../modules/error.js');
	var systemMessages = require('../systemMessages.js');
	var consts = require('../consts.js');

	require('winston-mongodb').MongoDB;

	const mongoConnection = config.get('mongoConnection');
	let { URI, mongoClientOptions } = mongoDBModule.buildMongoConnectionParameters(mongoConnection);

	mongodb.connect(URI, mongoClientOptions, function(err, client) {
		if (err) {
			new MongoError(err, systemMessages.MONGO_CONNECTION_ERROR).addInfo(Entities.Error, err).log();
			process.exit(1);
		}

		function doOnClose() {
			new MongoError(null, systemMessages.MONGO_CONNECTION_CLOSED).addInfo(Entities.Error, err).log();
			process.exit(1);
		}

		client.on('close', doOnClose);
		client.on('serverClosed', doOnClose);
		client.on('topologyClosed', doOnClose);

		var db = client.db(mongoConnection.dbName);

		app.set('db', db);

		generalSettingsModule.load({}, function(err) {
			if (err) {
				new SystemMessage(systemMessages.APP_GENERAL_SETTINGS_LOAD_FAILED).log();
				process.exit(1);
			} else
				logger.sysDEBUG('Settings loaded successfully');

			if (winstonLogger) { //Add MongoDB transport.
				winstonLogger.add(new winston.transports.MongoDB({ db: client,
					collection: 'log',
					level: 'INFO',
					capped: false,
					expireAfterSeconds: consts.DEFAULT_LOG_EXPIRATION_IN_SECONDS }));
			}

			callback(db);
		});
	});
};