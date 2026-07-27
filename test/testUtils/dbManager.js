/* global app */

const querystring = require('querystring');
var mongodb = require('mongodb-legacy').MongoClient;
const express = require('express');
const config = require('../../modules/config.js');


// eslint-disable-next-line no-global-assign
app = express();

// To run the tests with an alternative db name use: `npm --test_db_name=my-test-db-name run test`
app.set('test-db-name', process.env.npm_config_test_db_name || 'management-test');
console.log(`Test DB Name: ${app.get('test-db-name')}`);

function buildMongoURI(mongoConf, host) {
	let URI = 'mongodb://';
	let queryString = {};

	host = host || mongoConf.hosts;

	if (mongoConf.options && mongoConf.options.replicaSetName)
		queryString['replicaSet'] = mongoConf.options.replicaSetName;

	if (mongoConf.auth && mongoConf.auth.username && mongoConf.auth.password && mongoConf.auth.authenticationDatabase)
		URI += `${mongoConf.auth.username}:${mongoConf.auth.password}@`;

	URI += `${host}/${mongoConf.dbName}?${querystring.stringify(queryString)}`;

	return URI;
}

function buildMongoConnectionOptions(mongoConf) {
	let mongoClientOptions = {};

	if (mongoConf.auth && mongoConf.auth.username && mongoConf.auth.password && mongoConf.auth.authenticationDatabase)
		mongoClientOptions['authSource'] = mongoConf.auth.authenticationDatabase;

	else if (mongoConf.transport && mongoConf.transport.TLS) {
		if (!mongoConf.transport.certificateKeyFile) {
			console.error(`TLS enabled but missing certificateKeyFile for ${mongoConf.dbName}`);
			process.exit(1);

		} else {
			mongoClientOptions['tls'] = true;
			mongoClientOptions['tlsCertificateKeyFile'] = mongoConf.transport.certificateKeyFile;
			mongoClientOptions['authMechanism'] = mongoConf.auth.authenticationMechanism;

			if (mongoConf.transport.passphrase)
				mongoClientOptions['tlsCertificateKeyFilePassword'] = mongoConf.transport.passphrase;

			if (mongoConf.transport.CAFile)
				mongoClientOptions['tlsCAFile'] = mongoConf.transport.CAFile;
		}
	}

	return mongoClientOptions;
}

function projectMongoOptions(mongoConnectionOptions = {}, mongoGlobalOptions = {}) {
	const mongoClientOptions = {
		authSource: 'authSource',
		tls: 'tls',
		tlsCertificateKeyFile: 'tlsCertificateKeyFile',
		tlsCertificateKeyFilePassword: 'tlsCertificateKeyFilePassword',
		tlsCAFile: 'tlsCAFile',
		authMechanism: 'authMechanism',
		connectTimeoutMS: 'connectTimeoutMS',
		socketTimeoutMS: 'socketTimeoutMS',
	};

	const fromMongoConnectionOptions = [
		mongoClientOptions.authSource,
		mongoClientOptions.authMechanism,
		mongoClientOptions.tls,
		mongoClientOptions.tlsCertificateKeyFile,
		mongoClientOptions.tlsCertificateKeyFilePassword,
		mongoClientOptions.tlsCAFile
	];

	const fromMongoGlobalOptions = [
		mongoClientOptions.connectTimeoutMS,
		mongoClientOptions.socketTimeoutMS,
	];

	const projectedMongoClientOptions = {};

	for (let key of fromMongoConnectionOptions)
		if (mongoConnectionOptions[key] !== null && mongoConnectionOptions[key] !== undefined)
			projectedMongoClientOptions[key] = mongoConnectionOptions[key];

	for (let key of fromMongoGlobalOptions)
		if (mongoGlobalOptions[key] !== null && mongoGlobalOptions[key] !== undefined)
			projectedMongoClientOptions[key] = mongoGlobalOptions[key];

	return projectedMongoClientOptions;
}

function buildMongoConnectionParameters(mongoConf, host) {
	const URI = buildMongoURI(mongoConf, host);
	const mongoConnectionOptions = buildMongoConnectionOptions(mongoConf);
	const mongoGlobalOptions = config.get('mongoConnectOptions') || {};
	const mongoClientOptions = projectMongoOptions(mongoConnectionOptions, mongoGlobalOptions);

	return { URI, mongoClientOptions };
}

exports.connect = function() {
	return new Promise((resolve, reject) => {
		let { URI, mongoClientOptions } = buildMongoConnectionParameters(config.get('mongoConnection'));

		mongodb.connect(URI, mongoClientOptions, function(err, mongoClient) {
			if (err)
				return reject(err);

			app.set('db', mongoClient.db(app.get('test-db-name')));
			app.set('dbClient', mongoClient);
			resolve();
		});
	});
};

exports.closeConnection = async function() {
	let dbClient = app.get('dbClient');

	if (!dbClient || !dbClient.topology || !dbClient.topology.isConnected())
		return Promise.resolve();

	return dbClient.close().catch(e => {
		console.warning(`Error when trying to close connection to MongoDB: ${e}`);
	});
};
