var uuid = require('uuid');

var utils = require('/opt/nvmesh/management/utils.js');
var config = require('/opt/nvmesh/management/modules/config.js');
var cert = require('/opt/nvmesh/management/modules/cert.js');
var consts = require('/opt/nvmesh/management/consts.js');

var mongodb = require('mongodb-legacy').MongoClient;
var querystring = require('querystring');

const { exec } = require('child_process');

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

function buildMongoConnectionOptions(mongoConf, dbName) {
	let mongoClientOptions = {};

	if (mongoConf.auth && mongoConf.auth.username && mongoConf.auth.password && mongoConf.auth.authenticationDatabase)
		mongoClientOptions['authSource'] = mongoConf.auth.authenticationDatabase;

	else if (mongoConf.transport && mongoConf.transport.TLS) {
		if (!mongoConf.transport.certificateKeyFile) {
			console.error(`TLS enabled but missing certificateKeyFile for ${dbName}`);
			process.exit(1);

		} else {
			const activeCertSubDir = cert.prepareCertSubDir('mongo');

			mongoClientOptions['tls'] = true;
			mongoClientOptions['tlsCertificateKeyFile'] =
				cert.getCertFilePath(activeCertSubDir, mongoConf.transport.certificateKeyFile, consts.CERT_TYPES.CERT);
			mongoClientOptions['authMechanism'] = mongoConf.auth.authenticationMechanism;

			if (mongoConf.transport.passphrase)
				mongoClientOptions['tlsCertificateKeyFilePassword'] = mongoConf.transport.passphrase;

			if (mongoConf.transport.CAFile)
				mongoClientOptions['tlsCAFile'] =
					cert.getCertFilePath(activeCertSubDir, mongoConf.transport.CAFile, consts.CERT_TYPES.CA);
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

function setupDBConnections(cb) {
	const mongoConnection = config.get('mongoConnection');
	let { URI, mongoClientOptions } = buildMongoConnectionParameters(mongoConnection);

	mongodb.connect(URI, mongoClientOptions, function mongoConnectCallback(err, client) {
		if (err) {
			console.log(`Failed to connect to management DB err: ${err}`);
			process.exit(1);
		}

		var managementDB = client.db(mongoConnection.dbName);

		const nvmeshMetadataMongoConnection = config.get('nvmeshMetadataMongoConnection');
		let { URI, mongoClientOptions } = buildMongoConnectionParameters(nvmeshMetadataMongoConnection);

		mongodb.connect(URI, mongoClientOptions, (err, matadataClient) => {
			if (err) {
				console.log(`Failed to connect to nvmesh metadata DB err: ${err}`);
				process.exit(1);
			}

			var metadataDB = matadataClient.db(nvmeshMetadataMongoConnection.dbName);

			cb(managementDB, metadataDB);
		});
	});
}

var args = process.argv.slice(1);

if (args.length !== 2) {
	console.log(`The command requires 2 arguments, ${args.length} were provided`);
	console.log(`Usage example: ${process.argv.slice(0, 1).join(' ')} <clusterID> <newPassword>`);
	process.exit(1);
}

exec('/bin/bash -c \'source /opt/nvmesh/management/services/services_common; \
	init_nodeuse; fetch_management_cluster_from_config; try_run_initdb_on_mongo "$mongoManagementCommandLineArguments"\'', (err) => {
	if (err) {
		// node couldn't execute the command
		console.log('initDB failed', err);
		return;
	}

	var clusterID = args[0];
	var password = args[1];

	setupDBConnections((managementDB, metadataDB) => {
		var userCollection = managementDB.collection('user');
		var clusterCollection = metadataDB.collection('cluster');

		userCollection.updateOne(
			{ _id: 'admin@nvidia.com' },
			{
				$set: {
					password: utils.getHash(password),
					shouldChangePassword: false
				}
			}
		);

		var clusterDocSet = {
			id: clusterID,
			needReconfirm: false
		};

		clusterCollection.updateOne({}, { $set: clusterDocSet }, { upsert: true }, (results) => {
			if (results && results.upsertedCount) {
				clusterCollection.updateOne({}, { $set: { uuid: uuid.v1() } }, () => {
					process.exit(0);
				});
			} else
				process.exit(0);
		});
	});
});
