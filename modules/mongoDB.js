/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* global app */

var async = require('async');
var mongodb = require('mongodb-legacy').MongoClient;
var querystring = require('querystring');
var mongoDBWrapper = require('./mongoDBWrapper.js');
var uuid = require('uuid');

var logger = require('../logger.js');
var consts = require('../consts.js');
var config = require('./config.js');
var log = require('./log.js');
var utils = require('../utils.js');

var { MongoError, SystemAdminMessage, Entities } = require('./error.js');
var systemMessages = require('../systemMessages.js');

var scope = {};

scope.loadCluster = (cb) => {
	var db = app.get('db');
	var adminDb = db.admin();

	adminDb.replSetGetStatus((err, results) => {
		if (err)
			new MongoError(err).log();

		cb(results);
	});
};

scope.getDbStorageStats = (members, cb) => {
	async.each(members, (member, callback) => {
		if (member.health === consts.mongoMemberHealth.CRITICAL)
			return callback();

		const mongoConnection = config.get('mongoConnection');
		let { URI, mongoClientOptions } = scope.buildMongoConnectionParameters(mongoConnection, member.name);
		if (URI.includes(consts.mongoConnectionProtocols.SRV))
			URI = URI.replace(consts.mongoConnectionProtocols.SRV, consts.mongoConnectionProtocols.STANDARD);

		mongodb.connect(URI, mongoClientOptions, (err, client) => {
			if (err) {
				new MongoError(err, systemMessages.MONGO_CONNECTION_ERROR).addInfo(Entities.Mongo.host, member.name).log();
				callback();
			} else {
				var currentDB = client.db(mongoConnection.dbName);

				currentDB.stats((err, stats) => {
					if (err) {
						new MongoError(err).addInfo(Entities.Mongo.host, member.name).log();
					} else {
						member.dbSize = stats.dataSize;
						member.freeSpace = stats.fsTotalSize - stats.fsUsedSize;
					}

					callback();
				});

			}

		});
	}, () => {
		cb(members);
	});
};

scope.checkClusterHealthPeriodically = () => {
	if (app.get('isMongoReplicated')) {
		app.set('mongoReplicaStatus', {});
		checkClusterHealth();
	}
};

function checkClusterHealth() {
	setTimeout(() => {
		scope.loadCluster(results => {
			if (results) {
				var mongoReplicaStatus = app.get('mongoReplicaStatus');
				var updateCache = false;
				results.members.map(member => { return member.name; })
					.forEach(member => {
						if (!mongoReplicaStatus[member]) {
							updateCache = true;
							mongoReplicaStatus[member] = {};
						}
					});

				var membersDown = results.members
					.filter(member => { return member.state === consts.mongoMemberState.DOWN; })
					.map(member => { return member.name; });

				var mongoReplicaCacheMembers = Object.keys(mongoReplicaStatus);
				mongoReplicaCacheMembers.forEach(cacheMember => {
					if (membersDown.indexOf(cacheMember) === -1 && mongoReplicaStatus[cacheMember].isDown) {
						updateCache = true;
						mongoReplicaStatus[cacheMember].isDown = false;

						// ack by id
						log.acknowledgeByQuery({
							'meta.id': cacheMember,
							'meta.header': 'Mongo replica set member failure'
						}, consts.SYSTEM_USER, result => {
							if (result.success)
								new SystemAdminMessage(systemMessages.MONGODB_REPLICA_SET_HOST_WENT_UP)
									.addInfo(Entities.Mongo.host, cacheMember).addInfo(Entities.Mongo.replicaName, results.set).log();
						});
					}
				});

				membersDown.forEach(member => {
					if (!mongoReplicaStatus[member].isDown) {
						updateCache = true;
						mongoReplicaStatus[member].isDown = true;

						new SystemAdminMessage(systemMessages.MONGODB_REPLICA_SET_HOST_WENT_DOWN)
							.addInfo(Entities.Mongo.host, member).addInfo(Entities.Mongo.replicaName, results.set).log();
					}
				});

				if (updateCache)
					app.set('mongoReplicaStatus', mongoReplicaStatus);

				checkClusterHealth();
			}
		});
	}, consts.MONGO_DB_HEALTH_MONITORING_INTERVAL);
}

function buildMongoURI(mongoConf, host) {
	let URI = `${mongoConf.protocol}://`;

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

	mongoClientOptions['tls'] = false;
	if (mongoConf.transport && mongoConf.transport.TLS) {
		if (!mongoConf.transport.certificateKeyFile) {
			logger.sysERROR(`TLS enabled but missing certificateKeyFile for ${mongoConf.dbName}`);
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
	const projectedMongoClientOptions = {};

	const fromMongoConnectionOptions = [
		consts.mongoClientOptions.authSource,
		consts.mongoClientOptions.authMechanism,
		consts.mongoClientOptions.tls,
		consts.mongoClientOptions.tlsCertificateKeyFile,
		consts.mongoClientOptions.tlsCertificateKeyFilePassword,
		consts.mongoClientOptions.tlsCAFile
	];

	const fromMongoGlobalOptions = [
		consts.mongoClientOptions.connectTimeoutMS,
		consts.mongoClientOptions.socketTimeoutMS,
	];

	for (let key of fromMongoConnectionOptions)
		if (mongoConnectionOptions[key] !== null && mongoConnectionOptions[key] !== undefined)
			projectedMongoClientOptions[key] = mongoConnectionOptions[key];

	for (let key of fromMongoGlobalOptions)
		if (mongoGlobalOptions[key] !== null && mongoGlobalOptions[key] !== undefined)
			projectedMongoClientOptions[key] = mongoGlobalOptions[key];

	return projectedMongoClientOptions;
}

scope.buildMongoConnectionParameters = (mongoConf, host) => {
	const URI = buildMongoURI(mongoConf, host);
	app.set(mongoConf.dbName + 'DBConnString', URI);

	const mongoConnectionOptions = buildMongoConnectionOptions(mongoConf);
	const mongoGlobalOptions = config.get('mongoConnectOptions') || {};
	const mongoClientOptions = projectMongoOptions(mongoConnectionOptions, mongoGlobalOptions);

	return { URI, mongoClientOptions };
};

function exitOnConnectionError(err, URI) {
	if (err) {
		new MongoError(err, systemMessages.MONGO_CONNECTION_ERROR).addInfo(Entities.Mongo.URI, URI).log();
		process.exit(1);
	}
}

function setMongoClientEventListeners(client, URI) {
	function doOnClose() {
		new MongoError(null, systemMessages.MONGO_CONNECTION_CLOSED).addInfo(Entities.Mongo.URI, URI).log();
		process.exit(1);
	}

	client.on('close', doOnClose);
	client.on('serverClosed', doOnClose);
	client.on('topologyClosed', doOnClose);
}

scope.initManagementDBConnection = (cb) => {
	const mongoConnection = config.get('mongoConnection');
	const { URI, mongoClientOptions } = scope.buildMongoConnectionParameters(mongoConnection);

	mongodb.connect(URI, mongoClientOptions, (err, client) => {
		if (err)
			return cb({ err: err, URI: URI });

		setMongoClientEventListeners(client, URI);

		let db = client.db(mongoConnection.dbName);
		let mongoDBWrapperInstance = new mongoDBWrapper.MongoDBWrapper(db);
		let mongoDBWrapperProxy = mongoDBWrapperInstance.createOriginalDBProxy();

		app.set('db', mongoDBWrapperProxy);
		app.set('mongoClient', client);

		logger.sysINFO('Connected to Management Database!');

		cb();
	});
};

scope.initNVMeshMetadataDBConnection = (cb) => {
	const nvmeshMetadataMongoConnection = config.get('nvmeshMetadataMongoConnection');
	const { URI, mongoClientOptions } = scope.buildMongoConnectionParameters(nvmeshMetadataMongoConnection, null);

	mongodb.connect(URI, mongoClientOptions, (err, client) => {
		if (err)
			return cb({ err: err, URI: URI });

		setMongoClientEventListeners(client, URI);

		let db = client.db(nvmeshMetadataMongoConnection.dbName);
		let mongoDBWrapperInstance = new mongoDBWrapper.MongoDBWrapper(db);
		let mongoDBWrapperProxy = mongoDBWrapperInstance.createOriginalDBProxy();

		app.set('nvmeshMetadataDB', mongoDBWrapperProxy);

		logger.sysINFO('Connected to NVMesh Metadata Database!');

		db.createCollection('cluster', (err) => {
			if (err && err.codeName !== 'NamespaceExists') {
				new MongoError(err, systemMessages.MONGO_CONNECTION_CLOSED).addInfo(Entities.Mongo.URI, URI).log();
				process.exit(1);
			}

			cb();
		});
	});
};

scope.initDBsConnections = (callback) => {
	var mongoConf = config.get('mongoConnection');

	async.series([
		function connectToMgmtDB(cb) {
			utils.iterativeConnect(scope.initManagementDBConnection,
				consts.connectionEntities.MONGO_DB,
				mongoConf.mongoMaxConnectTries,
				mongoConf.mongoTimeBetweenConnectTries,
				cb);
		},
		function connectToNVMeshMetadataDB(cb) {
			utils.iterativeConnect(scope.initNVMeshMetadataDBConnection,
				consts.connectionEntities.MONGO_DB,
				mongoConf.mongoMaxConnectTries,
				mongoConf.mongoTimeBetweenConnectTries,
				cb);
		}
	], (err) => {
		if (err)
			exitOnConnectionError(err.err, err.URI);

		callback();
	});
};

scope.getAllMongoDB = (callback) => {
	function setDbStorageStats(results) {
		scope.getDbStorageStats(results.members, (members) => {
			results.members = members;
			callback([results]);
		});
	}

	if (app.get('isMongoReplicated')) {
		scope.loadCluster(results => {
			if (!results) {
				callback(results);
			} else {
				results.members.forEach(member => {
					member.host = member.name.split(':')[0];
					member.port = member.name.split(':')[1];
					delete member.self;
				});
				var finalResults = { set: results.set, members: results.members };
				setDbStorageStats(finalResults);
			}
		});
	} else {
		var results = {};
		var mongoConf = config.get('mongoConnection');

		results.members = [
			{
				name: mongoConf.hosts,
				host: mongoConf.hosts.split(':')[0],
				port: mongoConf.hosts.split(':')[1],
				health: consts.mongoMemberHealth.HEALTHY,
				state: 'STAND ALONE'
			}
		];
		setDbStorageStats(results);
	}
};

scope.populateInitialDBCollections = (mainCallback) => {
	// the original initDB.js script
	const db = app.get('db');
	const userCollection = db.collection('user');
	const globalSettingsCollection = db.collection('globalSettings');
	const configurationVersionCollection = db.collection('configurationVersion');
	const vpgCollection = db.collection('volumeProvisioningGroup');
	const configProfileCollection = db.collection('configurationProfile');
	const volumeCollection = db.collection('volume');
	const lastMessageLogCollection = db.collection('lastMessageLog');
	const logCollection = db.collection('log');

	async.parallel([
		function(callback) {
			//Create admin user
			userCollection.findOneAndUpdate(
				{ _id: consts.ADMIN_USER },
				{
					$setOnInsert: {
						_id: consts.ADMIN_USER,
						role: consts.userRoles.ADMIN,
						email: consts.ADMIN_USER,
						password:
							'f5daad97d445dfb5e0b379b15c3e77577659de3642483336b0cdb3208c1371847121d05523edffe1b1ff8695c9f3e055239da0cc04641b06ff9ca6445b540f45',
						dateCreated: new Date(),
						notificationLevel: 'NONE',
						shouldChangePassword: true,
						isImmutable: true,
						uuid: uuid.v1()
					}
				},
				{ upsert: true },
				callback
			);
		},
		function(callback) {
			//Create phoneHome user
			userCollection.findOneAndUpdate(
				{ _id: consts.PHONE_HOME_USER },
				{
					$setOnInsert: {
						_id: consts.PHONE_HOME_USER,
						role: consts.userRoles.ADMIN,
						email: consts.PHONE_HOME_USER,
						sendStats: true,
						dateCreated: new Date(),
						notificationLevel: 'NONE',
						uuid: uuid.v1()
					}
				},
				{ upsert: true },
				callback
			);
		},
		function(callback) {
			//Create global object
			var debugComponents = {
				lock: true,
				events: true,
				counters: false,
				client: false,
				diskSegments: false,
				HA: true,
				updatePRaidStatus: false,
				kafka: false
			};

			globalSettingsCollection.findOneAndUpdate(
				{},
				{
					$setOnInsert: {
						dateModified: new Date(),
						domain: '@nvidia.com',
						enableNVMf: false,
						enableDistributedRAID: true,
						autoLogOutThreshold: 60 * 60,
						keepaliveIntervals: {
							MANAGEMENT_AGENT: 5,
							CLIENT: 5,
							TOMA: 5,
							TOMA_LEADER: 5,
							UPGRADE_AGENT: 60 * 60,
						},
						MAX_JSON_SIZE: 2,
						RESERVED_BLOCKS: 0.5,
						compatibilityMode: false,
						enableLegacyFormatting: false,
						loggingLevel: consts.loggingLevel.INFO,
						debugComponents: debugComponents,
						sendStatsInterval: 60 * 60 * 24 * 7,
						cacheUpdateInterval: 60,
						snapshotAttachTimeout: 60 * 1000,
						snapshotExportTimeout: 60 * 1000,
						enableZones: false,
						defaultUnitType: consts.unitType.DECIMAL,
						forceUpgradeUpToDateComponents: false,
						zoneRanking: {
							fuzziness: 20,
							criterias: {
								segmentsInZone: 150,
								targetsInZone: 120,
								avgTimeSpentWaitingForLock: 50
							}
						},
						kafka: {
							partitionsFactorForManagementTopics: 10
						},
						hidden: {
							autoEvictMissingDrive: false,
							autoFormatDrive: false,
							isElectDisabled: false
						},
						fixInSanityAndRecover: {
							availableBlocks: false
						},
						disableOldManagements: true
					}
				},
				{ upsert: true },
				callback
			);
		},
		function(callback) {
			//Create Default Zone 1
			configurationVersionCollection.findOneAndUpdate(
				{ _id: '1' },
				{
					$setOnInsert: {
						_id: '1',
						configurationVersion: 1,
						leaderToken: 1
					}
				},
				{ upsert: true },
				callback
			);
		},
		function(callback) {
			//Create Default Concatenated VPG
			vpgCollection.findOneAndUpdate(
				{ _id: 'DEFAULT_CONCATENATED_VPG' },
				{
					$setOnInsert: {
						_id: 'DEFAULT_CONCATENATED_VPG',
						uuid: uuid.v1(),
						isDefault: true,
						diskClasses: [],
						serverClasses: [],
						RAIDLevel: consts.RAIDLevel.CONCATENATED,
						serviceResources: 'RDDA',
						capacity: 0,
						allowOverflow: true,
						enableCrcCheck: false,
						name: 'DEFAULT_CONCATENATED_VPG',
						modifiedBy: consts.ADMIN_USER,
						createdBy: consts.ADMIN_USER,
						dateCreated: new Date(),
						dateModified: new Date()
					}
				},
				{ upsert: true },
				callback
			);
		},
		function(callback) {
			//Create Default RAID 0 VPG
			vpgCollection.findOneAndUpdate(
				{ _id: 'DEFAULT_RAID_0_VPG' },
				{
					$setOnInsert: {
						_id: 'DEFAULT_RAID_0_VPG',
						uuid: uuid.v1(),
						isDefault: true,
						diskClasses: [],
						serverClasses: [],
						RAIDLevel: consts.RAIDLevel.STRIPED_RAID_0,
						serviceResources: 'RDDA',
						stripeSize: 32,
						stripeWidth: 2,
						capacity: 0,
						allowOverflow: true,
						enableCrcCheck: false,
						name: 'DEFAULT_RAID_0_VPG',
						modifiedBy: consts.ADMIN_USER,
						createdBy: consts.ADMIN_USER,
						dateCreated: new Date(),
						dateModified: new Date()
					}
				},
				{ upsert: true },
				callback
			);
		},
		function(callback) {
			let RAID_1_VPG = {
				_id: 'DEFAULT_RAID_1_VPG',
				uuid: uuid.v1(),
				isDefault: true,
				diskClasses: [],
				serverClasses: [],
				RAIDLevel: consts.RAIDLevel.MIRRORED_RAID_1,
				serviceResources: 'RDDA',
				numberOfMirrors: 1,
				capacity: 0,
				allowOverflow: true,
				enableCrcCheck: false,
				name: 'DEFAULT_RAID_1_VPG',
				modifiedBy: consts.ADMIN_USER,
				createdBy: consts.ADMIN_USER,
				dateCreated: new Date(),
				dateModified: new Date()
			};
			//Create Default RAID 1 VPG
			vpgCollection.findOneAndUpdate(
				{ _id: 'DEFAULT_RAID_1_VPG' },
				{
					$setOnInsert: RAID_1_VPG
				},
				{ upsert: true },
				(err) => {
					if (err)
						return callback(err);

					RAID_1_VPG._id = RAID_1_VPG.name = 'DEFAULT_METADATA_RAID_1_VPG';
					RAID_1_VPG.type = consts.volumeTypes.METADATA_VOLUME;
					RAID_1_VPG.uuid = uuid.v1();

					//Create Default RAID 1 MD VPG
					vpgCollection.findOneAndUpdate(
						{ _id: 'DEFAULT_METADATA_RAID_1_VPG' },
						{
							$setOnInsert: RAID_1_VPG
						},
						{ upsert: true },
						callback
					);
				}
			);
		},
		function(callback) {
			//Create Default RAID 10 VPG
			vpgCollection.findOneAndUpdate(
				{ _id: 'DEFAULT_RAID_10_VPG' },
				{
					$setOnInsert: {
						_id: 'DEFAULT_RAID_10_VPG',
						uuid: uuid.v1(),
						isDefault: true,
						diskClasses: [],
						serverClasses: [],
						RAIDLevel: consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10,
						serviceResources: 'RDDA',
						numberOfMirrors: 1,
						stripeSize: 32,
						stripeWidth: 2,
						capacity: 0,
						allowOverflow: true,
						enableCrcCheck: false,
						name: 'DEFAULT_RAID_10_VPG',
						modifiedBy: consts.ADMIN_USER,
						createdBy: consts.ADMIN_USER,
						dateCreated: new Date(),
						dateModified: new Date()
					}
				},
				{ upsert: true },
				callback
			);
		},
		function(callback) {
			//Create DEFAULT_EC_DUAL_TARGET_REDUNDANCY_VPG
			vpgCollection.findOneAndUpdate(
				{ _id: 'DEFAULT_EC_DUAL_TARGET_REDUNDANCY_VPG' },
				{
					$setOnInsert: {
						_id: 'DEFAULT_EC_DUAL_TARGET_REDUNDANCY_VPG',
						uuid: uuid.v1(),
						isDefault: true,
						diskClasses: [],
						serverClasses: [],
						RAIDLevel: consts.RAIDLevel.ERASURE_CODING,
						serviceResources: 'RDDA',
						stripeWidth: 1,
						capacity: 0,
						allowOverflow: true,
						enableCrcCheck: false,
						name: 'DEFAULT_EC_DUAL_TARGET_REDUNDANCY_VPG',
						dataBlocks: 8,
						parityBlocks: 2,
						stripeSize: 32,
						protectionLevel: consts.ecSeparationTypes.FULL,
						modifiedBy: consts.ADMIN_USER,
						createdBy: consts.ADMIN_USER,
						dateCreated: new Date(),
						dateModified: new Date()
					}
				},
				{ upsert: true },
				callback
			);
		},
		function(callback) {
			//Create DEFAULT_EC_SINGLE_TARGET_REDUNDANCY_VPG
			vpgCollection.findOneAndUpdate(
				{ _id: 'DEFAULT_EC_SINGLE_TARGET_REDUNDANCY_VPG' },
				{
					$setOnInsert: {
						_id: 'DEFAULT_EC_SINGLE_TARGET_REDUNDANCY_VPG',
						uuid: uuid.v1(),
						isDefault: true,
						diskClasses: [],
						serverClasses: [],
						RAIDLevel: consts.RAIDLevel.ERASURE_CODING,
						serviceResources: 'RDDA',
						stripeWidth: 1,
						capacity: 0,
						allowOverflow: true,
						enableCrcCheck: false,
						name: 'DEFAULT_EC_SINGLE_TARGET_REDUNDANCY_VPG',
						dataBlocks: 8,
						parityBlocks: 2,
						stripeSize: 32,
						protectionLevel: consts.ecSeparationTypes.MINIMAL,
						modifiedBy: consts.ADMIN_USER,
						createdBy: consts.ADMIN_USER,
						dateCreated: new Date(),
						dateModified: new Date()
					}
				},
				{ upsert: true },
				callback
			);
		},
		function(callback) {
			//Create DEFAULT_STRIPED_EC_DUAL_TARGET_REDUNDANCY_VPG
			vpgCollection.findOneAndUpdate(
				{ _id: 'DEFAULT_STRIPED_EC_DUAL_TARGET_REDUNDANCY_VPG' },
				{
					$setOnInsert: {
						_id: 'DEFAULT_STRIPED_EC_DUAL_TARGET_REDUNDANCY_VPG',
						uuid: uuid.v1(),
						isDefault: true,
						diskClasses: [],
						serverClasses: [],
						RAIDLevel: consts.RAIDLevel.STRIPED_ERASURE_CODING,
						serviceResources: 'RDDA',
						stripeWidth: 2,
						capacity: 0,
						allowOverflow: true,
						enableCrcCheck: false,
						name: 'DEFAULT_STRIPED_EC_DUAL_TARGET_REDUNDANCY_VPG',
						dataBlocks: 8,
						parityBlocks: 2,
						stripeSize: 32,
						protectionLevel: consts.ecSeparationTypes.FULL,
						modifiedBy: consts.ADMIN_USER,
						createdBy: consts.ADMIN_USER,
						dateCreated: new Date(),
						dateModified: new Date()
					}
				},
				{ upsert: true },
				callback
			);
		},
		function(callback) {
			//Create NVMesh Default Configuration Profile
			configProfileCollection.findOneAndUpdate(
				{ _id: 'NVMesh Default' },
				{
					$setOnInsert: {
						'_id': 'NVMesh Default',
						'name': 'NVMesh Default',
						'uuid': uuid.v1(),
						'labels': [],
						'config': {
							'IPV4_ONLY': true,
							'TCP_ENABLED': false,
							'DUMP_FTRACE_ON_OOPS': false,
							'MCS_LOGGING_LEVEL': consts.loggingLevel.INFO,
							'AGENT_LOGGING_LEVEL': consts.loggingLevel.INFO
						},
						'modifiedBy': consts.ADMIN_USER,
						'createdBy': consts.ADMIN_USER,
						'dateModified': new Date(),
						'dateCreated': new Date(),
						'editNotAllowed': true,
						'deleteNotAllowed': true,
						'hosts': [],
						'version': 1.0
					}
				},
				{ upsert: true },
				callback
			);
		},
		function(callback) {
			//Create Cluster Default Configuration Profile
			configProfileCollection.findOneAndUpdate(
				{ _id: 'Cluster Default' },
				{
					$setOnInsert: {
						'_id': 'Cluster Default',
						'name': 'Cluster Default',
						'uuid': uuid.v1(),
						'labels': [],
						'config': {
							'IPV4_ONLY': true,
							'DUMP_FTRACE_ON_OOPS': false,
							'MCS_LOGGING_LEVEL': consts.loggingLevel.INFO,
							'AGENT_LOGGING_LEVEL': consts.loggingLevel.INFO
						},
						'modifiedBy': consts.ADMIN_USER,
						'createdBy': consts.ADMIN_USER,
						'dateModified': new Date(),
						'dateCreated': new Date(),
						'editNotAllowed': false,
						'deleteNotAllowed': true,
						'hosts': [],
						'version': 1.0
					}
				},
				{ upsert: true },
				callback
			);
		},
		function(callback) {
			//Create NVMesh Debug Configuration Profile
			configProfileCollection.findOneAndUpdate(
				{ _id: 'NVMesh Debug' },
				{
					$setOnInsert: {
						'_id': 'NVMesh Debug',
						'name': 'NVMesh Debug',
						'uuid': uuid.v1(),
						'labels': [],
						'config': {
							'DUMP_FTRACE_ON_OOPS': true,
							'MCS_LOGGING_LEVEL': consts.loggingLevel.DEBUG,
							'AGENT_LOGGING_LEVEL': consts.loggingLevel.DEBUG
						},
						'modifiedBy': consts.ADMIN_USER,
						'createdBy': consts.ADMIN_USER,
						'dateModified': new Date(),
						'dateCreated': new Date(),
						'editNotAllowed': false,
						'deleteNotAllowed': true,
						'hosts': [],
						'version': 1.0
					}
				},
				{ upsert: true },
				callback
			);
		},
		function(callback) {
			//Create NVMesh User Mode Default Configuration Profile
			configProfileCollection.findOneAndUpdate(
				{ _id: 'NVMesh User Mode Default' },
				{
					$setOnInsert: {
						_id: 'NVMesh User Mode Default',
						name: 'NVMesh User Mode Default',
						uuid: uuid.v1(),
						labels: [],
						config: {
							IPV4_ONLY: true,
							DUMP_FTRACE_ON_OOPS: false,
							MCS_LOGGING_LEVEL: consts.loggingLevel.INFO,
							AGENT_LOGGING_LEVEL: consts.loggingLevel.INFO,
							NVMESHUM_CLIENT: true,
							NVMESH_MODE: 'nvmesh_dpu'
						},
						modifiedBy: consts.ADMIN_USER,
						createdBy: consts.ADMIN_USER,
						dateModified: new Date(),
						dateCreated: new Date(),
						editNotAllowed: false,
						deleteNotAllowed: true,
						hosts: [],
						version: 1.0
					}
				},
				{ upsert: true },
				callback
			);
		},
		function(callback) {
			configProfileCollection.createIndex({ 'uuid': 1 }, { unique: true }, callback);
		},
		function(callback) {
			volumeCollection.createIndex({ 'chunks.pRaids.diskSegments._id': 1 }, callback);
		},
		function(callback) {
			volumeCollection.createIndex({ 'chunks.pRaids.uuid': 1 }, callback);
		},
		function(callback) {
			lastMessageLogCollection.createIndex({ '_id.id': 1 }, callback);
		},
		function(callback) {
			logCollection.createIndex({ 'meta.id': 1 }, async(err) => {
				if (err)
					return callback(err);

				const logIndexes = await logCollection.listIndexes().toArray();
				const logTimestampIndexes = logIndexes.filter(i => 'timestamp' in i.key);
				if (!logTimestampIndexes.length)
					return logCollection.createIndex(
						{ timestamp: -1 },
						{ name: 'timestamp_1', expireAfterSeconds: 30 * 60 * 60 * 24, background: true },
						callback);

				callback();
			});
		}
	], function(err) {
		return mainCallback(err);
	});
};

module.exports = scope;
