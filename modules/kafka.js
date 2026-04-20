/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

var scope = {};
module.exports = scope;

var async = require('async');
const { Kafka, logLevel: kafkaLogLevel, AclResourceTypes, AclOperationTypes, AclPermissionTypes, ResourcePatternTypes } = require('kafkajs');
const { Backoff } = require('../models/backoff.js');
const uuid = require('uuid');

var lockModule = require('./lock.js');
var config = require('./config.js');
var logger = require('../logger.js');
var consts = require('../consts.js');
var utils = require('../utils.js');
var events = require('../events.js');
var objectNotifier = require('../objectNotifier.js');
var systemMessages = require('../systemMessages.js');
var kafkaRouter = require('./kafkaRouter.js');
var { MongoError, SystemMessage, Entities, InteropDBError } = require('./error.js');

const { metrics, isMetricsEnabled } = require('./openTelemetry.js');
const { CDVAllocatorFreeAll } = require('../models/kafkaMessages/CDVAllocatorFreeAll');
const { trace, context } = require('@opentelemetry/api');
const cert = require('./cert.js');

let isRecycleProducerInProgress = false;
let lastConsumerRecycleTime = null;
let consumerIdOnRecycle = null;
let currentConsumerIdCounter = 0;
let consumerRecycleBackoff = new Backoff({
	name: 'consumerRecycleBackoff',
	initialBackoff: consts.kafka.RECYCLE_CONSUMER.INITIAL_BACKOFF,
	maxBackoff: consts.kafka.RECYCLE_CONSUMER.MAX_BACKOFF
});

consumerRecycleBackoff.on('event', (event) => {
	logger.sysDEBUG(`consumerRecycleBackoff::${event.event}: ${event.message}`);
});

scope.offsetsRegistry = {};
scope.messagesInProcess = 0;
scope.isConsumerPaused = false;
scope.lastConsumerPauseTime = new Date(0);
scope.totalConsumed = 0;
scope.totalSent = 0;
scope.totalSentFailed = 0;
scope.metrics = {};
scope.subscribableTopics = new Set();
scope.topicsInitialized = false;

scope.afterModuleLoaded = () => {
	logger = require('../logger');
	kafkaRouter.afterModuleLoaded();
	setupMetricsCollection();
};

function setupMetricsCollection() {
	if (!isMetricsEnabled)
		return;

	metrics.kafkaMessagesInProcessGauge.addCallback(result => result.observe(scope.messagesInProcess));
	metrics.kafkaIsConsumerPausedGauge.addCallback(result => result.observe(scope.isConsumerPaused ? 1 : 0));
}

function addMetricsEvent(key, topic, messageType) {
	if (!scope.metrics[key]) {
		scope.metrics[key] = {
			topic,
			messageType,
			count: 0
		};
	}
	scope.metrics[key].count++;
}

scope.resetMetrics = () => {
	scope.totalConsumed = 0;
	scope.totalSentFailed = 0;
	scope.totalSent = 0;
	scope.metrics = {};
};

scope.clearPendingCommits = () => {
	logger.sysDEBUG('Clearing all offset registry pending commits');

	for (const topic in scope.offsetsRegistry) {
		for (const partition in scope.offsetsRegistry[topic]) {
			const commitTimeout = scope.offsetsRegistry[topic][partition].commitTimeout;
			if (commitTimeout) {
				clearTimeout(commitTimeout);
			}
		}
	}
};

const isOffsetRegistryHasPendingCommits = () => {
	for (const topic in scope.offsetsRegistry) {
		for (const partition in scope.offsetsRegistry[topic]) {
			if (!utils.isEmpty(scope.offsetsRegistry[topic][partition].offsets)) {
				return true;
			}
		}
	}
	return false;
};

scope.gracefulClearPendingCommits = () => {
	const periodicCheckForPendingCommitsInSeconds = 5;
	const maxTimeoutInSeconds = config.get('clearPendingCommitsMaxTimeout');
	let isTimedOut = false;
	const delay = t => new Promise(resolve => setTimeout(resolve, t));

	logger.sysDEBUG('Gracefully clearing pending commits');

	async function periodicCheckForPendingCommits() {
		if (isTimedOut) {
			return;
		}

		const hasPendingCommits = isOffsetRegistryHasPendingCommits();
		if (!hasPendingCommits) {
			logger.sysDEBUG('pending commits - No pending commits. Exiting.');
			return;
		}
		logger.sysDEBUG(`pending commits - Pending commits found. Checking again in ${periodicCheckForPendingCommitsInSeconds} seconds.`);
		await delay(periodicCheckForPendingCommitsInSeconds * 1000);
		return periodicCheckForPendingCommits();
	}

	async function maxClearCommitsTimeout() {
		await delay(maxTimeoutInSeconds * 1000);
		logger.sysDEBUG('graceful clear pending commits timed out');
		isTimedOut = true;
		scope.clearPendingCommits();
	}

	return Promise.race([periodicCheckForPendingCommits(), maxClearCommitsTimeout()]);
};

scope.setTopicsCreated = (collectionName, _id, property, value, callback) => {
	const db = app.get('db');
	const collection = db.collection(collectionName);
	const $set = { [property]: value };

	collection.updateOne({ _id }, { $set }, (err) => {
		if (err)
			new MongoError(err).log();

		callback();
	});
};

function getACLsFromTopics(topics) {
	const acls = [];

	topics.forEach((topic) => {
		if (topic.ACL) {
			topic.ACL.operations.forEach((operation) => {
				acls.push({
					resourceType: AclResourceTypes.TOPIC,
					resourceName: topic.name,
					resourcePatternType: ResourcePatternTypes.LITERAL,
					principal: `User:${topic.ACL.principal}`,
					host: topic.ACL.allowedHost,
					operation: operation,
					permissionType: AclPermissionTypes.ALLOW
				});
			});

			if (topic.ACL.groupID) {
				[AclOperationTypes.READ, AclOperationTypes.DESCRIBE].forEach(operation => {
					acls.push({
						resourceType: AclResourceTypes.GROUP,
						resourceName: topic.ACL.groupID,
						resourcePatternType: ResourcePatternTypes.LITERAL,
						principal: `User:${topic.ACL.principal}`,
						host: topic.ACL.allowedHost,
						operation,
						permissionType: AclPermissionTypes.ALLOW
					});
				});
			}
		}
	});

	return acls;
}

scope.createACL = (topics, callback) => {
	const acls = getACLsFromTopics(topics);
	const admin = app.get('kafkaAdmin');
	let err;

	(async() => {
		try {
			// createAcls will resolve also if it tries to (re)create an already existing ACL
			logger.sysDEBUG(`Trying to create ACLs for topics ${topics.map(topic => topic.name)}`);
			await scope.runKafkaCommand(admin.createAcls, [{ acl: acls }]);
		} catch (ex) {
			err = new SystemMessage(systemMessages.FAILED_TO_CREATE_TOPIC_ACL)
				.addInfo(Entities.KafkaTopics, topics.map(t => t.name)).addInfo(Entities.Exception, ex).log();
		} finally {
			callback(err);
		}
	})();
};

scope.createTopics = (topics, callback) => {
	let admin = app.get('kafkaAdmin');
	let err;

	(async() => {
		let topicsCreated;
		const topicNames = topics.map(topic => topic.name);
		logger.sysDEBUG(`Trying to create topics: ${topicNames}`);

		try {
			// createTopics will resolve to true if topics were created successfully or false if all of them already exists.
			// The method will throw exceptions in case of errors
			const params = {
				topics: topics.map(topic => ({
					topic: topic.name,
					numPartitions: topic.numPartitions,
					configEntries: topic.configEntries || []
				}))
			};
			topicsCreated = await scope.runKafkaCommand(admin.createTopics, [params]);

			if (!topicsCreated)
				logger.sysDEBUG(`At least one of ${topicNames} topics already exists!`);

		} catch (ex) {
			err = new SystemMessage(systemMessages.KAFKA_CREATE_TOPIC_ERROR).addInfo(Entities.Exception, ex).addInfo(Entities.KafkaTopics, topics).log();
		}

		callback(err);
	})();
};

scope.createTopicsAndACLs = (topics, callback) => {
	async.series([
		function topicCreation(cb) {
			scope.createTopics(topics, err => {
				if (err)
					return cb(err);

				cb();
			});
		},
		function ACLCreation(cb) {
			if (!config.get('kafkaConnection').enableACL)
				return cb();

			scope.createACL(topics, cb);
		},
		function topicsConfigurationValidation(cb) {
			isValidTopicsConfiguration(topics, cb);
		}
	], err => {
		if (err)
			err.log();

		callback(!err, err);
	});
};

scope.listTopics = callback => {
	const admin = app.get('kafkaAdmin');
	let err, topics = [];

	(async() => {
		try {
			topics = await scope.runKafkaCommand(admin.listTopics);
		} catch (ex) {
			err = new SystemMessage(systemMessages.KAFKA_LIST_TOPICS_ERROR).addInfo(Entities.Exception, ex).log();
		} finally {
			callback(err, topics);
		}
	})();
};

scope.getZonePrefix = (zoneID) => `zone${zoneID}`;

async function shouldRetryToSendMessages(topic, ex) {
	let shouldRetryToSendMessages;

	if (ex.cause && ex.cause.code === consts.kafkaErrors.UNKNOWN_TOPIC_OR_PARTITION) {
		await new Promise(resolve => {
			scope.listTopics((err, topics) => {
				shouldRetryToSendMessages = (!err && topics.includes(topic));

				if (shouldRetryToSendMessages)
					logger.sysDEBUG(`Got UNKNOWN_TOPIC_OR_PARTITION when trying to send message to topic ${topic} but topic exists!`);

				resolve();
			});
		});

	} else if (ex.message === consts.kafkaErrorMessages.PRODUCER_DISCONNECTED) {
		logger.sysDEBUG(`Failed to produce to topic ${topic} because producer disconnected!`);
		shouldRetryToSendMessages = true;
	}

	return shouldRetryToSendMessages;
}

function toggleForceSanityAndRecoverIfNeeded() {
	const db = app.get('db');
	const configurationVersionCollection = db.collection('configurationVersion');

	configurationVersionCollection.updateOne({ _id: consts.CONFIG_VER_CLUSTER_ID }, { $set: { forceSanityAndRecover: true } }, (err) => {
		if (err)
			new MongoError(err).log();
		else
			logger.sysDEBUG('Detected a failure while trying to send message to Kafka, toggling forceSanityAndRecover to true');
	});
}

scope.sendMessages = (topicOrGetterFn, messages, callback, shouldRetryOnFailure = true) => {
	const kafkaProducer = app.get('kafkaProducer');
	let err, topic;

	(async() => {
		try {
			topic = await new Promise(resolve => typeof topicOrGetterFn === 'function' ? topicOrGetterFn(resolve) : resolve(topicOrGetterFn));
			const serializedMsgs = messages.map(m => m.toJSON());
			serializedMsgs.forEach(m => logger.sysDEBUG(`Sending ${m.messageType} to topic ${topic}:`, m));
			await kafkaProducer.send({ topic: topic, messages: serializedMsgs.map((m) => ({ value: JSON.stringify(m) })) });
			scope.totalSent++;
			serializedMsgs.forEach(m => addMetricsEvent(`sendMessage-${topic}`, topic, m.messageType));

		} catch (ex) {
			if (!shouldRetryOnFailure)
				logger.sysDEBUG('No more retry attempts for sending message, going to fail sendMessages');

			else if (await shouldRetryToSendMessages(topic, ex)) {
				await recycleProducerIfNeeded(kafkaProducer);
				return scope.sendMessages(topicOrGetterFn, messages, callback, false);
			}

			err = new SystemMessage(systemMessages.KAFKA_SEND_MESSAGE_ERROR).addInfo(Entities.Exception, ex).addInfo(Entities.KafkaTopics, topic).log();

			toggleForceSanityAndRecoverIfNeeded();

			scope.totalSentFailed++;
		}

		if (callback)
			callback(err);
	})();
};

scope.getIncrementalUpdatesTopic = (zone, callback) => {
	getTopicFromDB('configurationVersion', zone, consts.topicSuffix.LEADER_INCREMENTAL_UPDATES, callback);
};

scope.getIncrementalTargetUpdatesTopic = (zone, callback) => {
	getTopicFromDB('configurationVersion', zone, consts.topicSuffix.LEADER_INCREMENTAL_TARGET_UPDATES, callback);
};

scope.getClientMainTopic = (clientID, callback) => {
	getTopicFromDB('client', clientID, consts.topicSuffix.CLIENT_MAIN, callback);
};

scope.getAgentMainTopic = (clientID, callback) => {
	getTopicFromDB('client', clientID, consts.topicSuffix.AGENT_MAIN, callback);
};

function getTopicFromDB(collectionName, _id, topicSuffix, callback) {
	const db = app.get('db');
	const collection = db.collection(collectionName);

	collection.findOne({ _id }, { projection: { topics: 1 } }, (err, document) => {
		if (err)
			new MongoError(err).log();

		callback(document?.topics?.[topicSuffix]);
	});
}

scope.getLeaderGroupID = (zoneID) => {
	return `LEADER_${zoneID}`;
};

scope.getTargetCommandGroupID = (targetID) => {
	return `CMD_${targetID}`;
};

scope.getTargetHardwareGroupID = (targetID) => {
	return `HW_${targetID}`;
};

scope.getMCSGroupID = (clientID) => {
	return `MCS_${clientID}`;
};

scope.getUpgradeAgentGroupID = (upgradeAgentID) => {
	return `UPGRADE_AGENT_${upgradeAgentID}`;
};

scope.deleteTopics = (topicsToDelete, callback) => {
	let err;

	(async() => {
		const kafkaAdmin = app.get('kafkaAdmin');

		logger.sysDEBUG(`Going to delete topics: ${topicsToDelete}`);

		try {
			await scope.runKafkaCommand(kafkaAdmin.deleteTopics, [{ topics: topicsToDelete }]);
		} catch (ex) {
			if (ex?.cause?.code === consts.kafkaErrors.UNKNOWN_TOPIC_OR_PARTITION)
				logger.sysDEBUG(`We tried to delete the topics ${topicsToDelete} but at least one does not exist.`);
			else
				err = new SystemMessage(systemMessages.KAFKA_DELETE_TOPICS_ERROR)
					.addInfo(Entities.Error, ex)
					.addInfo(Entities.KafkaTopics, topicsToDelete)
					.log();

		} finally {
			callback(err);
		}
	})();
};

scope.deleteTopicRecords = (topic, callback) => {
	let err;

	(async() => {
		const kafkaAdmin = app.get('kafkaAdmin');

		try {
			logger.sysDEBUG(`Removing topic records for topic: ${topic.topic} partitions:`, topic.partitions);
			await scope.runKafkaCommand(kafkaAdmin.deleteTopicRecords, [topic]);
		} catch (ex) {
			err = new SystemMessage(systemMessages.KAFKA_DELETE_RECORDS_ERROR).addInfo(Entities.KafkaTopics, topic).addInfo(Entities.Exception, ex).log();
		} finally {
			callback(err);
		}
	})();
};

function buildKafkaOptions() {
	let kafkaOptions = {};
	let kafkaConfiguration = config.get('kafkaConnection');

	try {
		buildKafkaBasicOption(kafkaOptions, kafkaConfiguration);
		buildKafkaLoggerOptions(kafkaOptions, kafkaConfiguration);

		if (kafkaConfiguration.transport && kafkaConfiguration.transport.TLS)
			buildKafkaTLSOptions(kafkaOptions, kafkaConfiguration);
	} catch (e) {
		logger.sysERROR(`${e}, Exiting...`);
		process.exit(1);
	}

	return kafkaOptions;
}

function buildKafkaLoggerOptions(kafkaOptions, kafkaConfiguration) {
	kafkaOptions.logLevel = kafkaConfiguration.logLevel || kafkaLogLevel.WARN;
	kafkaOptions.logCreator = () => {
		return ({ namespace, level, label, log }) => {
			logger.sysVERBOSE('kafka', `kafkaLogger namespace: ${namespace} level: ${level} label: ${label}`, log);
		};
	};
}

function buildKafkaBasicOption(kafkaOptions, kafkaConfiguration) {
	if (!kafkaConfiguration || !kafkaConfiguration.hosts)
		throw new Error('Missing kafkaConnection.hosts configuration!');

	kafkaOptions.clientId = app.get('managementId');
	kafkaOptions.brokers = kafkaConfiguration.hosts.split(',');
}

function buildKafkaTLSOptions(kafkaOptions, kafkaConfiguration) {
	if (!kafkaConfiguration.transport.certFile)
		throw new Error('TLS enabled but missing kafkaConnection.transport.certFile configuration!');

	if (!kafkaConfiguration.transport.keyFile)
		throw new Error('TLS enabled but missing kafkaConnection.transport.keyFile configuration!');

	const activeCertSubDir = cert.prepareCertSubDir('kafka');

	kafkaOptions.ssl = {};
	kafkaOptions.ssl.cert = [cert.getCertFile(activeCertSubDir, kafkaConfiguration.transport.certFile, consts.CERT_TYPES.CERT, 'utf-8')];
	kafkaOptions.ssl.key = [cert.getCertFile(activeCertSubDir, kafkaConfiguration.transport.keyFile, consts.CERT_TYPES.KEY, 'utf-8')];

	if (kafkaConfiguration.transport.CAFile)
		kafkaOptions.ssl.ca = [cert.getCertFile(activeCertSubDir, kafkaConfiguration.transport.CAFile, consts.CERT_TYPES.CA, 'utf-8')];

	if (kafkaConfiguration.transport.passphrase)
		kafkaOptions.ssl.passphrase = kafkaConfiguration.transport.passphrase;
}

scope.connectToKafka = (callback) => {
	utils.iterativeConnect(scope.connect,
		consts.connectionEntities.KAFKA,
		consts.kafka.MAX_CONNECT_TRIES,
		consts.kafka.TIME_BETWEEN_CONNECT_TRIES,
		callback);
};

scope.connect = (callback) => {
	let kafkaClient = new Kafka(buildKafkaOptions());
	app.set('kafkaClient', kafkaClient);

	(async() => {
		let err = null;

		try {
			await initKafkaAdmin();
			await initProducer();
		} catch (ex) {
			err = ex;
			new SystemMessage(systemMessages.KAFKA_CONNECTION_ERROR).addInfo(Entities.Exception, ex).log();
		} finally {
			callback(err);
		}
	})();
};

scope.getSubscribableTopics = (callback) => {
	async.parallel([
		cb => {
			const rpmVersion = utils.getVRPartsObj(app.get('rpmVersion')).version;
			scope.getTopicNames(consts.components.MANAGEMENT, rpmVersion, null, null, null, topics => {
				cb(null, topics);
			});
		},
		cb => {
			scope.getZoneUpstreamTopics((err, upstreamTopicsByZone) => {
				if (err)
					return cb(err);

				cb(null, Object.values(upstreamTopicsByZone).flat());
			});
		}
	], (err, [managementTopics, zoneTopics]) => {
		if (err)
			return callback(err, []);

		callback(null, [...managementTopics, ...zoneTopics]);
	});
};

scope.getZoneUpstreamTopics = (callback) => {
	const db = app.get('db');
	const configurationVersionCollection = db.collection('configurationVersion');

	configurationVersionCollection.find({}, { projection: { topics: 1 } }).toArray((err, configurationVersions) => {
		if (err)
			return callback(new MongoError(err).log());

		const upstreamTopicsByZone = {};

		configurationVersions.forEach(configurationVersion => {
			if (configurationVersion.topics) {
				const upstreamTopics = Object.values(configurationVersion.topics).filter(scope.isUpstreamTopicByName);
				upstreamTopicsByZone[configurationVersion._id] = upstreamTopics;
			}
		});
		callback(null, upstreamTopicsByZone);
	});
};

scope.initTopics = (callback) => {
	async.parallel([
		initManagementTopics,
		initZoneTopics,
	], err => {
		if (err)
			return callback(new SystemMessage(systemMessages.FAILED_TO_INIT_KAFKA_TOPICS).addInfo(Entities.Error, err).log());

		scope.topicsInitialized = true;
		scope.requestConsumerRecycle(null, callback);
	});
};

function initManagementTopics(callback) {
	const db = app.get('db');
	const lockCollection = db.collection('lock');

	lockCollection.findOne({ _id: '1' }, { projection: { lastKafkaTopicsManagementVersionCreated: 1 } }, (err, lock) => {
		if (err)
			return callback(new MongoError(err).log());

		if (!lock)
			lock = { _id: '1' };

		const rpmVersion = utils.getVRPartsObj(app.get('rpmVersion')).version;

		if (lock.lastKafkaTopicsManagementVersionCreated && utils.compareVersionRelease(rpmVersion, lock.lastKafkaTopicsManagementVersionCreated) === 0) {
			return scope.getTopicNames(consts.components.MANAGEMENT, rpmVersion, null, null, null, topics => {
				events.emitEvent(null, objectNotifier.events.newUpstreamTopicEvent, { topics });
				callback();
			});
		}

		scope.createManagementTopics(rpmVersion, false, callback);
	});
}

function initZoneTopics(callback) {
	scope.getZoneUpstreamTopics((err, upstreamTopicsByZone) => {
		if (err)
			return callback(err);

		Object.entries(upstreamTopicsByZone).forEach(([zoneID, upstreamTopics]) => {
			events.emitEvent([events.getZoneID(zoneID)], objectNotifier.events.newUpstreamTopicEvent, { topics: upstreamTopics });
		});
		callback();
	});
}

scope.getZoneTopicsToCreate = (leaderCompatibilityVersion, zoneID, underlock, callback) => {
	scope.getTopicNames(consts.FEATURE_COMPATIBILITY_TYPES.LEADER, leaderCompatibilityVersion, null, zoneID, underlock ? zoneID : null, topicNames => {
		const GLOBAL_SETTINGS = app.get('globalSettings');

		const TOMAReadACL = {
			allowedHost: '*',
			principal: `${scope.getZonePrefix(zoneID)}.${consts.kafkaPrincipals.TOMA}`,
			operations: [AclOperationTypes.READ, AclOperationTypes.DESCRIBE],
			groupID: scope.getLeaderGroupID(zoneID)
		};

		const TOMAWriteACL = {
			allowedHost: '*',
			principal: `${scope.getZonePrefix(zoneID)}.${consts.kafkaPrincipals.TOMA}`,
			operations: [AclOperationTypes.WRITE, AclOperationTypes.DESCRIBE],
			groupID: scope.getLeaderGroupID(zoneID)
		};

		const topics = topicNames.map(name => {
			const topic = { name };

			if (scope.isUpstreamTopicByName(name)) {
				topic.numPartitions = GLOBAL_SETTINGS.kafka.partitionsFactorForManagementTopics;
				topic.ACL = TOMAWriteACL;
			} else {
				topic.numPartitions = 1;
				topic.ACL = TOMAReadACL;
			}

			return topic;
		});

		callback(topics);
	});
};

scope.getTargetTopicsToCreate = (targetCompatibilityVersion, targetID, zone, underlock, callback) => {
	scope.getTopicNames(consts.FEATURE_COMPATIBILITY_TYPES.TARGET, targetCompatibilityVersion, targetID, zone, underlock ? zone : null, topicNames => {
		const topics = topicNames.map(name => {
			const ACL = {
				allowedHost: '*',
				principal: `${scope.getZonePrefix(zone)}.${consts.kafkaPrincipals.TOMA}`,
				operations: [AclOperationTypes.READ, AclOperationTypes.DESCRIBE]
			};

			ACL.groupID = name.includes(consts.topicSuffix.TOMA_HARDWARE_CONF)
				? scope.getTargetHardwareGroupID(targetID)
				: scope.getTargetCommandGroupID(targetID);

			return {
				name,
				numPartitions: 1,
				ACL
			};
		});

		callback(topics);
	});
};

scope.getClientTopicsToCreate = (clientCompatibilityVersion, clientID, callback) => {
	scope.getTopicNames(consts.FEATURE_COMPATIBILITY_TYPES.CLIENT, clientCompatibilityVersion, clientID, null, null, topicNames => {
		const ACLForMCS = {
			allowedHost: '*',
			principal: `${consts.kafkaPrincipals.MCS}`,
			operations: [AclOperationTypes.READ, AclOperationTypes.DESCRIBE],
			groupID: scope.getMCSGroupID(clientID)
		};

		const topics = topicNames.map(name => ({
			name,
			numPartitions: 1,
			ACL: ACLForMCS
		}));

		callback(topics);
	});
};

scope.getManagementTopicsToCreate = (rpmVersion, callback) => {
	const GLOBAL_SETTINGS = app.get('globalSettings');

	scope.getTopicNames(consts.components.MANAGEMENT, rpmVersion, null, null, '1', topicNames => {
		const configEntries = [
			{ name: 'cleanup.policy', value: 'compact,delete' },
			{ name: 'segment.bytes', value: String(consts.kafka.LOG_COMPACTION.SEGMENT_BYTES) },
			{ name: 'segment.ms', value: String(consts.kafka.LOG_COMPACTION.SEGMENT_MS) }
		];

		const topics = topicNames.map(name => ({
			name,
			numPartitions: GLOBAL_SETTINGS.kafka.partitionsFactorForManagementTopics,
			configEntries: name.includes(consts.topicSuffix.MANAGEMENT_KEEPALIVE) ? configEntries : [],
			ACL: {
				allowedHost: '*',
				principal: '*',
				operations: [AclOperationTypes.WRITE, AclOperationTypes.DESCRIBE, AclOperationTypes.DESCRIBE_CONFIGS]
			}
		}));

		callback(topics);
	});
};

scope.getUpgradeAgentTopicsToCreate = (upgradeAgentCompatibilityVersion, upgradeAgentID, callback) => {
	scope.getTopicNames(consts.FEATURE_COMPATIBILITY_TYPES.UPGRADE_AGENT, upgradeAgentCompatibilityVersion, upgradeAgentID, null, null, topicNames => {
		const ACL = {
			allowedHost: '*',
			principal: `${consts.kafkaPrincipals.UPGRADE_AGENT}`,
			operations: [AclOperationTypes.READ, AclOperationTypes.DESCRIBE],
			groupID: scope.getUpgradeAgentGroupID(upgradeAgentID)
		};

		const topics = topicNames.map(name => ({
			name,
			numPartitions: 1,
			ACL
		}));

		callback(topics);
	});
};

scope.createManagementTopics = (rpmVersion, underlock, callback) => {
	const zoneID = '1';

	async.series([
		cb => {
			if (underlock)
				return cb();

			lockModule.acquireLockByZone(zoneID, cb);
		},
		cb => {
			scope.getManagementTopicsToCreate(rpmVersion, topics => {
				scope.createTopicsAndACLs(topics, (success, err) => {
					if (success) {
						events.emitEvent(null, objectNotifier.events.newUpstreamTopicEvent, { topics: topics.map(topic => topic.name) });
						return scope.setTopicsCreated('lock', zoneID, 'lastKafkaTopicsManagementVersionCreated', rpmVersion, () => cb());
					}

					cb(err);
				});
			});
		}
	], (err) => {
		if (underlock)
			return callback(err);

		lockModule.releaseLockByZone(zoneID, () => callback(err));
	});
};

scope.createZoneTopics = (zoneID, leaderCompatibilityVersion, underlock, callback) => {
	async.series([
		cb => {
			if (underlock)
				return cb();

			lockModule.acquireLockByZone(zoneID, (err, dbZone) => {
				if (dbZone.lastKafkaTopicsVersionCreated && utils.compareVersionRelease(leaderCompatibilityVersion, dbZone.lastKafkaTopicsVersionCreated) === 0)
					return cb(true);

				cb();
			});
		},
		cb => {
			scope.getZoneTopicsToCreate(leaderCompatibilityVersion, zoneID, true, topics => {
				scope.createTopicsAndACLs(topics, success => {
					if (!success)
						return cb();

					const topicNames = topics.map(topic => topic.name);
					const db = app.get('db');
					const confCollection = db.collection('configurationVersion');
					const query = {
						_id: zoneID,
						// Only save leader topics if no topics exist yet - otherwise topics are determined by leader keepalive with new compatibility version
						topics: { $exists: false }
					};
					const update = {
						$set: {
							featureCompatibilityVersion: leaderCompatibilityVersion,
							topics: scope.mapTopicNamesToTopicSuffix(topicNames)
						}
					};

					confCollection.updateOne(query, update, err => {
						if (err)
							new MongoError(err).log();

						scope.setTopicsCreated('lock', zoneID, 'lastKafkaTopicsVersionCreated', leaderCompatibilityVersion, () => {
							logger.sysDEBUG(`Done creating topics for zone ${zoneID}`);

							const upstreamTopics = topicNames.filter(scope.isUpstreamTopicByName);
							events.emitEvent([events.getZoneID(zoneID)], objectNotifier.events.newUpstreamTopicEvent, { topics: upstreamTopics });
							cb();
						});
					});
				});
			});
		},
	], () => {
		if (underlock)
			return callback();

		lockModule.releaseLockByZone(zoneID, callback);
	});
};

scope.createClientTopics = (clientID, clientCompatibilityVersion, callback) => {
	scope.getClientTopicsToCreate(clientCompatibilityVersion, clientID, topics => {
		scope.createTopicsAndACLs(topics, (success, err) => {
			callback(err, scope.mapTopicNamesToTopicSuffix(topics.map(topic => topic.name)));
		});
	});
};

scope.createTargetTopics = (targetID, zone, targetCompatibilityVersion, underlock, callback) => {
	scope.getTargetTopicsToCreate(targetCompatibilityVersion, targetID, zone, underlock, topics => {

		// if zones enabled, we shouldn't create the hardware config topic as long as zone is not assigned
		if (!zone)
			topics = topics.filter(topic => !topic.name.includes(consts.topicSuffix.TOMA_HARDWARE_CONF));

		scope.createTopicsAndACLs(topics, (success, err) => {
			callback(err, scope.mapTopicNamesToTopicSuffix(topics.map(topic => topic.name)));
		});
	});
};

scope.createUpgradeAgentTopics = (upgradeAgentID, upgradeAgentCompatibilityVersion, callback) => {
	scope.getUpgradeAgentTopicsToCreate(upgradeAgentCompatibilityVersion, upgradeAgentID, topics => {
		scope.createTopicsAndACLs(topics, (success, err) => {
			callback(err, scope.mapTopicNamesToTopicSuffix(topics.map(topic => topic.name)));
		});
	});
};

function commitOffsets(topic, partition) {
	let offsetToCommit;
	let offsets = Object.keys(scope.offsetsRegistry[topic][partition].offsets);

	for (let offset of offsets) {
		if (scope.offsetsRegistry[topic][partition]['offsets'][offset])
			offsetToCommit = offset;
		else break;
	}

	if (!offsetToCommit) {
		scope.offsetsRegistry[topic][partition].commitInProgress = false;
		return logger.sysVERBOSE('kafka',
			'although I\'ve being called to commit offsets, couldn\'t find a streak', scope.offsetsRegistry[topic][partition].offsets);
	}

	logger.sysVERBOSE('kafka', `Going to commit offset:: topic: ${topic} partition: ${partition} offset: ${offsetToCommit}`);
	logger.sysVERBOSE('kafka', `Pending offsets for commit:: topic: ${topic} partition: ${partition}`, scope.offsetsRegistry[topic][partition].offsets);

	let consumer = app.get('kafkaConsumer');
	(async() => {
		try {
			await scope.runKafkaCommand(
				consumer?.commitOffsets, [[{ topic, partition, offset: (Number(offsetToCommit) + 1).toString() }]]
			);

			let offsets = Object.keys(scope.offsetsRegistry[topic][partition].offsets);

			for (let offset of offsets) {
				if (parseInt(offset) <= parseInt(offsetToCommit))
					delete scope.offsetsRegistry[topic][partition]['offsets'][offset];
				else break;
			}

			scope.offsetsRegistry[topic][partition].lastCommit = new Date();
		} catch (e) {
			new SystemMessage(systemMessages.KAFKA_COMMIT_OFFSET_ERROR)
				.addInfo(Entities.Exception, e)
				.addInfo(Entities.Error, e.message)
				.addInfo(Entities.KafkaConsumer.ID, consumer?.customConsumerInstanceID)
				.log();
		} finally {
			scope.offsetsRegistry[topic][partition].commitInProgress = false;
			logger.sysVERBOSE('kafka', `Pending offsets after commit:: topic: ${topic} partition: ${partition}`,
				scope.offsetsRegistry[topic][partition].offsets);
		}
	})();
}

function registerOffset(topic, partition, offset, canBeCommitted, finishedProcessingMsg) {
	function getOffsetInfoForLogging() {
		return `topic: ${topic}, partition: ${partition}, offset: ${offset}, messagesInProcess: ${scope.messagesInProcess}`
			+ `, isConsumerPaused: ${scope.isConsumerPaused}, lastPauseTime: ${scope.lastConsumerPauseTime.toISOString()}`;
	}

	if (!scope.offsetsRegistry[topic])
		scope.offsetsRegistry[topic] = {};

	if (!scope.offsetsRegistry[topic][partition])
		scope.offsetsRegistry[topic][partition] = { offsets: {} };

	if (offset in scope.offsetsRegistry[topic][partition]['offsets']) {
		if (finishedProcessingMsg) {
			scope.messagesInProcess--;
			scope.resumeConsumerIfNeeded();
		} else {
			logger.sysVERBOSE('kafka', `Message is already registered in the registry. ${getOffsetInfoForLogging()}`);
			return true;
		}
	} else {
		if (finishedProcessingMsg) {
			logger.sysVERBOSE('kafka', `Message is not in the registry but finished to be processed. ${getOffsetInfoForLogging()}`);
			return true;
		} else {
			scope.messagesInProcess++;
			scope.pauseConsumerIfNeeded();
		}
	}

	// Add new offset to registry
	scope.offsetsRegistry[topic][partition]['offsets'][offset] = canBeCommitted;
	logger.sysVERBOSE('kafka', `Registering offset:: ${getOffsetInfoForLogging()}`);
	logger.sysVERBOSE('kafka', `Offsets Listing:: topic ${topic} partition: ${partition}`, scope.offsetsRegistry[topic][partition].offsets);

	if (canBeCommitted) {
		logger.sysVERBOSE('kafka', `offset: ${offset} can be commited`);
		const timeSinceLastCommit = new Date() - scope.offsetsRegistry[topic][partition].lastCommit;
		if (!scope.offsetsRegistry[topic][partition].commitInProgress &&
			(!scope.offsetsRegistry[topic][partition].lastCommit ||
				timeSinceLastCommit > consts.kafka.MINIMAL_TIME_BETWEEN_COMMITS)) {
			scope.offsetsRegistry[topic][partition].commitInProgress = true;
			logger.sysVERBOSE('kafka', `Commiting offsets as we didn't commit for more than ${consts.kafka.MINIMAL_TIME_BETWEEN_COMMITS}ms`);
			commitOffsets(topic, partition);
		} else {
			logger.sysVERBOSE('kafka', `Scheduling commit commitInProgress: ${scope.offsetsRegistry[topic][partition].commitInProgress} `
				+ ` timeSinceLastCommit: ${timeSinceLastCommit}`);

			if (scope.offsetsRegistry[topic][partition].commitTimeout)
				return;

			scope.offsetsRegistry[topic][partition].commitTimeout = setTimeout(() => {
				logger.sysVERBOSE('kafka', `Commiting offsets after timeout for topic: ${topic} partition: ${partition}`);
				scope.offsetsRegistry[topic][partition].commitTimeout = null;
				scope.offsetsRegistry[topic][partition].commitInProgress = true;
				commitOffsets(topic, partition);
			}, scope.offsetsRegistry[topic][partition].commitInProgress
				? consts.kafka.MINIMAL_TIME_BETWEEN_COMMITS
				: consts.kafka.MINIMAL_TIME_BETWEEN_COMMITS - (new Date() - scope.offsetsRegistry[topic][partition].lastCommit)
			);
		}
	}
}

// This should only be used for logging
scope.getConsumerPausedTopics = () => {
	const consumer = app.get('kafkaConsumer');

	try {
		const pausedTopicsAndPartitions = consumer.paused();
		return pausedTopicsAndPartitions.map(topic => topic.topic);
	} catch (ex) {
		new SystemMessage(systemMessages.KAFKA_GET_PAUSED_TOPICS_FAILED).addInfo(Entities.Exception, ex).log();
		return;
	}
};

scope.pauseConsumer = function() {
	const consumer = app.get('kafkaConsumer');
	try {
		consumer.pause(Array.from(scope.subscribableTopics).map(topicName => ({ topic: topicName })));
	} catch (ex) {
		new SystemMessage(systemMessages.KAFKA_CONSUMER_PAUSE_FAILED).addInfo(Entities.Exception, ex).log();
		defaultOnKafkaCommandError(ex, consumer.customConsumerInstanceID);
		return;
	}

	const previousPauseInfo = scope.isConsumerPaused ? ` - Was already paused at ${scope.lastConsumerPauseTime }` : '';
	logger.sysDEBUG(`Kafka Consumer Paused ${previousPauseInfo}`);

	scope.isConsumerPaused = true;
	scope.lastConsumerPauseTime = new Date();
	const pausedTopics = scope.getConsumerPausedTopics();

	logger.sysWARNING('Consumer Throttling: Kafka Consumer Paused');
	logger.sysVERBOSE('kafka', `Consumer Throtteling stats: messagesInProcess: ${scope.messagesInProcess} `
		+ ` isConsumerPaused: ${scope.isConsumerPaused} pausedTopics: ${pausedTopics}`);
};

scope.resumeConsumer = function() {
	const consumer = app.get('kafkaConsumer');
	try {
		consumer.resume(Array.from(scope.subscribableTopics).map(topicName => ({ topic: topicName })));
	} catch (ex) {
		new SystemMessage(systemMessages.KAFKA_CONSUMER_RESUME_FAILED).addInfo(Entities.Exception, ex).log();
		defaultOnKafkaCommandError(ex, consumer.customConsumerInstanceID);
		// we have to retry, in case this is the last messageInProcess.
		if (scope.messagesInProcess < 2)
			setTimeout(() => scope.resumeConsumerIfNeeded(), 5 * 1000);
		return;
	}

	scope.isConsumerPaused = false;
	scope.lastConsumerPauseTime = new Date(0);
	const pausedTopics = scope.getConsumerPausedTopics();

	logger.sysDEBUG('Kafka Consumer Resumed');
	logger.sysWARNING('Consumer Throttling: Kafka Consumer Resumed');
	logger.sysVERBOSE('kafka', `Consumer Throtteling stats: messagesInProcess: ${scope.messagesInProcess} isConsumerPaused: ${scope.isConsumerPaused} `
		+ `pausedTopics: ${pausedTopics}`);
};

scope.pauseConsumerIfNeeded = function() {
	const tooManyMessages = scope.messagesInProcess > consts.KAFKA_CONSUMER_MAX_IN_PROCESS_MESSAGES;

	if (tooManyMessages) {
		const timeSinceLastPause = new Date() - scope.lastConsumerPauseTime;
		const enoughTimePassed = timeSinceLastPause > consts.KAFKA_CONSUMER_PAUSE_AGAIN_THRESHOLD;
		if (!scope.isConsumerPaused || enoughTimePassed)
			scope.pauseConsumer();
	}
};

scope.resumeConsumerIfNeeded = function() {
	if (scope.isConsumerPaused && scope.messagesInProcess < consts.KAFKA_CONSUMER_MAX_IN_PROCESS_MESSAGES / 2)
		scope.resumeConsumer();
};

scope.handleMessage = async function({ topic, partition, message }) {
	let alreadyHandled = registerOffset(topic, partition, message.offset, false, false);

	if (alreadyHandled)
		return logger.sysVERBOSE('kafka', `Not handling message:: topic: ${topic}, partition: ${partition}, offset: ${message.offset}`);

	let messageValue;

	try {
		messageValue = JSON.parse(message.value.toString());
	} catch (err) {
		logger.sysERROR(`Failed to parse kafka message.value, dropping it - message: ${message.value.toString()}, err: ${err}`);
	}

	if (!messageValue) {
		logger.sysERROR('Parsing kafka message.value lead to null, meaning the received message.value '
			+ `may be null or an error happened earlier, message: ${message.value.toString()}`);
		return registerOffset(topic, partition, message.offset, true, true);
	}

	// Get the current active span
	const span = trace.getSpan(context.active());
	if (span) {
		span.setAttributes({
			messageType: messageValue.messageType,
			originType: messageValue.originType,
			originID: messageValue.hostname || messageValue.clientID
		});
	}

	try {
		const messageLogDetails = `topic ${topic} partition: ${partition} offset: ${message.offset} `
			+ `- ${messageValue.messageType} from ${messageValue.originType} ${messageValue.hostname || messageValue.clientID}`;
		const consumerDetails = `messagesInProcess: ${scope.messagesInProcess} isConsumerPaused: ${scope.isConsumerPaused}`;

		logger.sysVERBOSE('kafka', `Start Processing ${messageLogDetails} ${consumerDetails}`);
		kafkaRouter.routeMessage(messageValue, topic, partition, message.offset, (err) => {
			logger.sysVERBOSE('kafka', `Finished processing ${messageLogDetails} ${consumerDetails}`);

			if (!err) {
				scope.totalConsumed++;
				addMetricsEvent(`handleMessage-${topic}-${messageValue.messageType}`, topic, messageValue.messageType);
			}
			if (err) {
				logger.sysVERBOSE('kafka', `Completion of message ${messageValue.messageType} `
						+ `from ${messageValue.originType} ${messageValue.hostname || messageValue.clientID} `
						+ `returned an error: ${err} - message will not be committed`);
			}
			registerOffset(topic, partition, message.offset, !err, true);
		});
	} catch (ex) {
		logger.sysERROR(`Error in kafkaRouter.routeMessage Error: ${ex}`);
		throw ex;
	}
};

async function initKafkaAdmin(kafkaClient = app.get('kafkaClient')) {
	logger.sysDEBUG('Initializing Kafka Admin');

	try {
		const kafkaAdmin = kafkaClient.admin();
		await scope.runKafkaCommand(kafkaAdmin.connect);

		app.set('kafkaAdmin', kafkaAdmin);
	} catch (ex) {
		new SystemMessage(systemMessages.FAILED_TO_INIT_KAFKA_ADMIN).addInfo(Entities.Exception, ex).log();
		throw ex;
	}
}

async function initProducer(kafkaClient = app.get('kafkaClient')) {
	logger.sysDEBUG('Initializing Kafka Producer');

	try {
		const kafkaProducer = kafkaClient.producer();
		await kafkaProducer.connect();

		app.set('kafkaProducer', kafkaProducer);
	} catch (ex) {
		new SystemMessage(systemMessages.FAILED_TO_INIT_KAFKA_PRODUCER).addInfo(Entities.Exception, ex).log();
		throw ex;
	}
}

scope.initConsumers = async function(id = app.get('managementId')) {
	let kafkaClient = app.get('kafkaClient');
	let consumer = kafkaClient.consumer({ id: id, groupId: consts.kafka.MANAGEMENT_GROUP_ID });
	consumer.customConsumerInstanceID = ++currentConsumerIdCounter;

	function logConsumerEvent(event) {
		logger.sysDEBUG(`Consumer event consumerId: ${consumer.customConsumerInstanceID}: ${JSON.stringify(event)}`);
	}

	consumer.on(consumer.events.CRASH, (event) => doOnConsumerCrash(event, consumer.customConsumerInstanceID));
	consumer.on(consumer.events.REBALANCING, logConsumerEvent);
	consumer.on(consumer.events.CONNECT, logConsumerEvent);
	consumer.on(consumer.events.DISCONNECT, logConsumerEvent);
	consumer.on(consumer.events.GROUP_JOIN, logConsumerEvent);

	try {
		const topics = Array.from(scope.subscribableTopics);
		logger.sysDEBUG(`Starting Kafka Consumer and subscribe on ${topics}`);

		await scope.runKafkaCommand(consumer.connect);
		await scope.runKafkaCommand(consumer.subscribe, [{ topics: topics, fromBeginning: true }]);

		await scope.runKafkaCommand(consumer.run, [{
			autoCommit: false,
			eachMessage: scope.handleMessage
		}]);

		consumer.subscribedTopics = new Set(scope.subscribableTopics);
		consumer.debug = { runCalled: true };
		app.set('kafkaConsumer', consumer);

		logger.sysDEBUG(`Finished initiating kafka consumer with unique ID: ${consumer.customConsumerInstanceID}`);
	} catch (ex) {
		new SystemMessage(systemMessages.KAFKA_GENERIC_CONSUMER_ERROR).addInfo(Entities.Exception, ex).log();
		return ex;
	}
};

async function disconnectConsumers() {
	let consumerToDisconnect = app.get('kafkaConsumer');

	try {
		logger.sysDEBUG(`Disconnecting consumer: ${consumerToDisconnect.customConsumerInstanceID}`);
		await consumerToDisconnect.disconnect();
		logger.sysDEBUG(`Consumer disconnected: ${consumerToDisconnect.customConsumerInstanceID}`);
	} catch (ex) {
		return new SystemMessage(systemMessages.KAFKA_DISCONNECT_CONSUMER_ERROR).addInfo(Entities.Exception, ex).log();
	}
}

async function disconnectProducer() {
	const producer = app.get('kafkaProducer');

	if (!producer)
		return;

	try {
		await producer.disconnect();
	} catch (ex) {
		new SystemMessage(systemMessages.KAFKA_DISCONNECT_PRODUCER_ERROR).addInfo(Entities.Exception, ex).log();
		throw ex;
	}
}

scope.recycleConsumer = callback => {
	(async() => {
		logger.sysWARNING('Going to recycle consumer');
		lastConsumerRecycleTime = new Date();

		const consumer = app.get('kafkaConsumer');
		let error;

		if (consumer)
			error = await disconnectConsumers();

		logger.sysDEBUG(`recycleConsumer:: disconnected consumers ${error ? error.toString() : ''}`);

		if (!error) {
			logger.sysDEBUG('recycleConsumer:: Initializing new consumer');
			error = await scope.initConsumers();
			logger.sysDEBUG('recycleConsumer:: initConsumers finished');
		}

		if (error)
			return callback(new SystemMessage(systemMessages.KAFKA_RECYCLE_CONSUMER_ERROR).addInfo(Entities.Error, error).log());

		logger.sysWARNING('Consumer recycled successfully');
		callback();
	})();
};

scope.requestConsumerRecycle = (requestingConsumerId, callback = () => {}, requestID = uuid.v4(), retrying = false) => {
	const currentConsumer = app.get('kafkaConsumer');
	const currentConsumerId = currentConsumer?.customConsumerInstanceID;
	const currentConsumerSubscribedTopics = currentConsumer?.subscribedTopics || new Set();
	const loggingInfo = `requestingConsumerId: ${requestingConsumerId}, currentConsumerId: ${currentConsumerId}, runTimeID: ${requestID}`;
	const retryRequestConsumerRecycle = () => scope.requestConsumerRecycle(requestingConsumerId, callback, requestID, true);

	logger.sysDEBUG(`Got a recycle consumer request, ${loggingInfo}`);

	if (currentConsumerId) {
		if (requestingConsumerId < currentConsumerId) {
			logger.sysDEBUG(`Ignoring recycle consumer request, consumer already changed from request submission time, ${loggingInfo}`);
			return callback();
		}

		if (consumerIdOnRecycle && (consumerIdOnRecycle > requestingConsumerId || (!retrying && consumerIdOnRecycle === requestingConsumerId))
			&& utils.isEqualSet(currentConsumerSubscribedTopics, scope.subscribableTopics)) {
			logger.sysDEBUG(`Recycle for consumer is already in progress, continuing... , ${loggingInfo}`);
			return callback();
		}
	}

	logger.sysWARNING(`Processing recycle consumer request, ${loggingInfo}`);

	consumerIdOnRecycle = requestingConsumerId;

	let timePassedSinceLastRecycleTime = lastConsumerRecycleTime ? new Date() - lastConsumerRecycleTime : 0;
	if (!lastConsumerRecycleTime || timePassedSinceLastRecycleTime >= consts.kafka.RECYCLE_CONSUMER.DEBOUNCER_MINIMUM_WAIT)
		scope.recycleConsumer(error => {
			let consumer = app.get('kafkaConsumer');
			if (!error) {
				logger.sysDEBUG(`Successfully processed recycle consumer request. consumerDebug: ${JSON.stringify(consumer?.debug)}, ${loggingInfo}`);
				consumerIdOnRecycle = null;
				// success - reset backoff
				consumerRecycleBackoff.reset();
				return callback();
			}

			logger.sysERROR(`Failed to process recycle consumer request with error: ${error.toString()}, `
				+ `will retry... consumerDebug: ${JSON.stringify(consumer?.debug)}, ${loggingInfo}`);
			consumerRecycleBackoff.backoff(retryRequestConsumerRecycle);
		});
	else {
		let consumer = app.get('kafkaConsumer');
		logger.sysDEBUG(`Not enough time passed since last consumer recycle , will retry in
			${consts.kafka.RECYCLE_CONSUMER.DEBOUNCER_MINIMUM_WAIT - timePassedSinceLastRecycleTime}ms
			${loggingInfo} consumerDebug: ${JSON.stringify(consumer?.debug)}`);
		setTimeout(retryRequestConsumerRecycle, (consts.kafka.RECYCLE_CONSUMER.DEBOUNCER_MINIMUM_WAIT - timePassedSinceLastRecycleTime));
	}
};

scope.clearRecycleConsumerCooldown = () => {
	lastConsumerRecycleTime = null;
};

async function recycleProducer() {
	logger.sysDEBUG('recycleProducer:: Disconnecting existing producer');
	await disconnectProducer();

	logger.sysDEBUG('recycleProducer:: Initializing new producer');
	await initProducer();

	logger.sysDEBUG('recycleProducer:: Producer recycled successfully');
}

async function recycleProducerIfNeeded(currentProducer) {
	const isProducerChanged = currentProducer !== app.get('kafkaProducer');
	const shouldRecycleProducer = !isProducerChanged && !isRecycleProducerInProgress;

	if (shouldRecycleProducer) {
		isRecycleProducerInProgress = true;

		try {
			await recycleProducer();
		} catch (ex) {
			new SystemMessage(systemMessages.KAFKA_RECYCLE_PRODUCER_ERROR).addInfo(Entities.Exception, ex).log();
		} finally {
			isRecycleProducerInProgress = false;
		}
	}
}


scope.deleteCommittedRecords = (groupID, topics, callback) => {
	logger.sysDEBUG(`Starting delete process for groupID: ${groupID} topics: ${topics}`);

	scope.getGroupOffsets(groupID, topics, (err, offsets) => {
		if (err)
			return callback(err);

		async.eachSeries(offsets, (offset, callback) => {
			deleteTopicRecordsForGC(offset.topic, offset.partitions, () => {
				callback();
			});
		}, () => {
			callback();
		});
	});
};

scope.getGroupOffsets = (groupID, topics, callback) => {
	let admin = app.get('kafkaAdmin');
	let results;
	let err;

	(async() => {
		try {
			results = await scope.runKafkaCommand(admin.fetchOffsets, [{ groupId: groupID, topics }]);
		} catch (ex) {
			err = new SystemMessage(systemMessages.KAFKA_FETCH_OFFSETS_ERROR)
				.addInfo(Entities.Exception, ex)
				.addInfo(Entities.KafkaTopics, topics)
				.addInfo(Entities.KafkaConsumerGroup.ID, groupID)
				.log();
		} finally {
			callback(err, results);
		}
	})();
};

function deleteTopicRecordsForGC(topic, partitions, callback) {
	partitions = partitions.filter((partition) => { return partition.offset > -1; });

	if (!partitions.length)
		return callback();

	scope.deleteTopicRecords({ topic, partitions }, callback);
}

scope.GCLeaderTopics = (versionDocument, callback) => {
	const { _id, topics } = versionDocument;
	const groupID = scope.getLeaderGroupID(_id);
	const leaderTopics = [topics[consts.topicSuffix.LEADER_INCREMENTAL_UPDATES], topics[consts.topicSuffix.LEADER_INCREMENTAL_TARGET_UPDATES]];

	scope.deleteCommittedRecords(groupID, leaderTopics, callback);
};

scope.GCTomaTopics = (versionDocument, callback) => {
	const db = app.get('db');
	const targetCollection = db.collection('server');

	let maximumHardwareOffset = -1;

	targetCollection.find({ zone: versionDocument.zone }, { projection: { topics: 1 } }).toArray((err, targets) => {
		if (err)
			return callback(new MongoError(err).log());

		async.eachSeries(targets, (target, callback) => {
			let targetCommandsGroupID = scope.getTargetCommandGroupID(target._id);
			let targetHardwareGroupID = scope.getTargetHardwareGroupID(target._id);
			let targetCommandsTopic = target.topics[consts.topicSuffix.TOMA_COMMANDS];

			async.series([
				(callback) => {
					scope.deleteCommittedRecords(targetCommandsGroupID, [targetCommandsTopic], () => { callback(); });
				},
				(callback) => {
					const hardwareTopic = target.topics[consts.topicSuffix.TOMA_HARDWARE_CONF];

					scope.getGroupOffsets(targetHardwareGroupID, [hardwareTopic], (_, offsets) => {
						if (offsets.length !== 1) {
							logger.sysDEBUG(`GCTomaTopics:Received odd number of offsets for target ${target._id}`, offsets);
							return callback();
						}

						let offset = offsets[0];

						if (maximumHardwareOffset === -1 || maximumHardwareOffset.partitions[0] < offset.partitions[0])
							maximumHardwareOffset = offset;

						callback();
					});
				}
			], callback);
		}, () => {
			if (maximumHardwareOffset === -1)
				return callback();

			deleteTopicRecordsForGC(maximumHardwareOffset.topic, maximumHardwareOffset.partitions, () => { callback(); });
		});
	});
};

scope.GCZoneTopics = (versionDocument, callback) => {
	if (!versionDocument.topics)
		return callback();

	logger.sysDEBUG(`Clearing topics for zone: ${versionDocument._id}`);

	async.series([
		callback => { scope.GCLeaderTopics(versionDocument, callback); },
		callback => { scope.GCTomaTopics(versionDocument, callback); },
		callback => { scope.GCManagementZoneTopics(versionDocument, callback); }
	], callback);
};

scope.GCClientTopics = (client, callback) => {
	const { _id, topics } = client;
	const groupID = scope.getMCSGroupID(_id);

	scope.deleteCommittedRecords(groupID, Object.values(topics), callback);
};

scope.GCClientsTopics = (callback) => {
	let db = app.get('db');
	let clientCollection = db.collection('client');
	let clientsCursor = clientCollection.find({}, { projection: { _id: 1, topics: 1 } });

	utils.asyncIterCursor(clientsCursor, (client, callback) => {
		scope.GCClientTopics(client, callback);
	}, err => {
		callback(err);
	});
};

scope.GCUpgradeAgentTopics = (upgradeAgent, callback) => {
	const { _id, topics } = upgradeAgent;
	const groupID = scope.getUpgradeAgentGroupID(_id);

	scope.deleteCommittedRecords(groupID, Object.values(topics), callback);
};

scope.GCUpgradeAgentsTopics = (callback) => {
	const db = app.get('db');
	const upgradeAgentCollection = db.collection('upgradeAgent');
	const upgradeAgentsCursor = upgradeAgentCollection.find({}, { projection: { _id: 1, topics: 1 } });

	utils.asyncIterCursor(upgradeAgentsCursor, (upgradeAgent, callback) => {
		scope.GCUpgradeAgentTopics(upgradeAgent, callback);
	}, callback);
};

scope.GCManagementZoneTopics = (versionDocument, callback) => {
	const { topics } = versionDocument;
	const groupID = consts.kafka.MANAGEMENT_GROUP_ID;
	const managementZoneTopics = [
		topics[consts.topicSuffix.MANAGEMENT_LOW],
		topics[consts.topicSuffix.MANAGEMENT_PRIORITY],
	];

	scope.deleteCommittedRecords(groupID, managementZoneTopics, callback);
};

scope.GCManagementTopics = (callback) => {
	let groupID = consts.kafka.MANAGEMENT_GROUP_ID;
	const rpmVersion = utils.getVRPartsObj(app.get('rpmVersion')).version;

	scope.getTopicNames(consts.components.MANAGEMENT, rpmVersion, null, null, null, topics =>
		scope.deleteCommittedRecords(groupID, topics, callback));
};

scope.getClusterMetadata = function(callback) {
	const admin = app.get('kafkaAdmin');
	let err, clusterInfo;

	(async() => {
		try {
			clusterInfo = await admin.describeCluster();
		} catch (ex) {
			err = new SystemMessage(systemMessages.FAILED_TO_FETCH_TOPICS_METADATA).addInfo(Entities.Exception, ex);
			logger.sysERROR(err);
		} finally {
			callback(err, clusterInfo);
		}
	})();
};

function doOnConsumerCrash(event, consumerId) {
	new SystemMessage(systemMessages.KAFKA_CRASH_CONSUMER_ERROR)
		.addInfo(Entities.ErrorEvent, event)
		.addInfo(Entities.Error, event?.payload?.error)
		.addInfo(Entities.KafkaConsumer.ID, consumerId)
		.log();

	logger.sysWARNING(`doOnConsumerCrash: consumer ID ${consumerId} requesting recycle`);
	scope.requestConsumerRecycle(consumerId);
}

function createTopicPartitions(topicName, partitionCount, callback) {
	const admin = app.get('kafkaAdmin');
	const createPartitionsPayload = { topicPartitions: [{ topic: topicName, count: partitionCount }] };
	let err;

	(async() => {
		try {
			await scope.runKafkaCommand(admin.createPartitions, [createPartitionsPayload]);
		} catch (ex) {
			err = new SystemMessage(systemMessages.FAILED_TO_CREATE_PARTITIONS).addInfo(Entities.KafkaTopics, topicName)
				.addInfo(Entities.KafkaConfigs.Partition, partitionCount).addInfo(Entities.Exception, ex).log();
		} finally {
			callback(err);
		}
	})();
}

function isValidTopicsPartitionsConfiguration(topicName, expectedPartitionCount, foundPartitionCount, callback) {
	if (expectedPartitionCount === foundPartitionCount)
		return callback();

	if (expectedPartitionCount < foundPartitionCount) {
		logger.sysDEBUG(`${topicName} found with higher partitions than expected (${foundPartitionCount} > ${expectedPartitionCount}), ignoring`);
		return callback();
	}

	// expectedPartitionCount > foundPartitionCount
	logger.sysDEBUG(`${topicName} found with lower partitions than expected (${foundPartitionCount} < ${expectedPartitionCount}), creating new partitions`);
	createTopicPartitions(topicName, expectedPartitionCount, callback);
}

function isValidTopicsConfiguration(topics, callback) {
	const topicsNames = topics.map(t => t.name);

	fetchTopicsMetadata(topicsNames, (err, topicsMetadata) => {
		if (err)
			return callback(err);

		if (!topicsMetadata || !topicsMetadata.topics) {
			if (err)
				return callback(new SystemMessage(systemMessages.KAFKA_TOPICS_METADATA_NO_FOUND).addInfo(Entities.KafkaTopics, topicsNames).log());
		}

		async.each(topicsMetadata.topics, (topicMetadata, cb) => {
			const topicCreationPayload = topics.find(t => t.name === topicMetadata.name);

			isValidTopicsPartitionsConfiguration(topicMetadata.name, topicCreationPayload.numPartitions, topicMetadata.partitions.length, cb);
		}, err => {
			if (err)
				err.log();

			callback(err);
		});
	});
}

function fetchTopicsMetadata(topicNames, callback) {
	const admin = app.get('kafkaAdmin');
	const fetchTopicMetadataParams = { topics: topicNames };
	let err, topicsMetadata = [];

	(async() => {
		try {
			topicsMetadata = await scope.runKafkaCommand(admin.fetchTopicMetadata, [fetchTopicMetadataParams]);
		} catch (ex) {
			err = new SystemMessage(systemMessages.FAILED_TO_FETCH_TOPICS_METADATA)
				.addInfo(Entities.KafkaTopics, topicNames).addInfo(Entities.Exception, ex).log();
		} finally {
			callback(err, topicsMetadata);
		}
	})();
}

// Return true if the command exception is retriable
function isRetriableException(ex) {
	return ex.retriable;
}

let consumerErrorsGraceTimer = null;
let consumerErrorsGracePeriodStartedAt = null;

const recycleConsumerAfterGracePeriod = (consumerId) => {
	consumerErrorsGraceTimer = null;
	consumerErrorsGracePeriodStartedAt = new Date();
	logger.sysWARNING(`doAfterGracePeriod: consumer ID ${consumerId} got errors for too long, triggering recycle`);
	scope.requestConsumerRecycle(consumerId);
};

async function defaultOnKafkaCommandError(ex, consumerId) {
	// May happen during recycle consumer - after consumer is disconnected and before it is reconnected
	const isNotInitializedConsumerError = ex.message.includes('Consumer group was not initialized, consumer#run must be called first');

	// This is a non-retriable exception that requires rejoining the group to get the correct generation id
	const isGenerationIdError = ex.message.includes('Specified group generation id is not valid');
	let currentConsumerId = app.get('kafkaConsumer')?.customConsumerInstanceID;

	logger.sysDEBUG(`defaultOnKafkaCommandError: consumer (req consumer ID: ${consumerId}, current: ${currentConsumerId}) error ${ex.message}`);
	if (isNotInitializedConsumerError || isGenerationIdError) {
		if (consumerId == currentConsumerId) {
			logger.sysDEBUG(`defaultOnKafkaCommandError: consumer (req consumer ID: ${consumerId}, current: ${currentConsumerId}) error ${ex.message}`);
			if (!consumerErrorsGraceTimer) {
				logger.sysWARNING(`defaultOnKafkaCommandError: ex.message: ${ex.message}, consumer ID ${consumerId} `
						+ ' is the same as the current consumer ID, starting grace period');
				consumerErrorsGraceTimer = setTimeout(recycleConsumerAfterGracePeriod, consts.kafka.NON_RETRYABLE_ERRORS_GRACE_PERIOD, consumerId);
				consumerErrorsGracePeriodStartedAt = new Date();
			} else {
				logger.sysDEBUG(`defaultOnKafkaCommandError: ex.message: ${ex.message}, consumer ID ${consumerId} `
					+ ` grace period is active since ${consumerErrorsGracePeriodStartedAt}`);
			}
			//retry - during grace period
			logger.sysDEBUG('defaultOnKafkaCommandError: retrying...');
			return true;
		} else {
			// now that consumer is reconnected, we can retry the command
			logger.sysDEBUG(`defaultOnKafkaCommandError: current consumer ID ${currentConsumerId} is different than the failed consumer ID: ${consumerId},
				the consumer was prabably recycled already, continuing...`);
			return true;
		}
	}

	return isRetriableException(ex);
}

// Executes an asynchronous Kafka command with automatic retries of retriable exceptions.
// It employs exponential backoff for retries with configurable delay between attempts.
// eslint-disable-next-line max-len
scope.runKafkaCommand = async(commandFn, args = [], options = {}) => {
	let result;
	const {
		retriesLeft = consts.kafka.RETRY.LEFT,
		retryDelayMs = consts.kafka.RETRY.DELAY,
		retryDelayFactor = consts.kafka.RETRY.FACTOR,
		onErrorFn = defaultOnKafkaCommandError
	} = options;

	const consumerId = app.get('kafkaConsumer')?.customConsumerInstanceID;

	try {
		result = await commandFn(...args);

		// command succeeded
		if (consumerErrorsGraceTimer) {
			logger.sysDEBUG('defaultOnKafkaCommandError: command succeeded, resetting grace period');
			clearTimeout(consumerErrorsGraceTimer);
			consumerErrorsGraceTimer = null;
		}
	} catch (ex) {
		const shouldRetry = await onErrorFn(ex, consumerId);
		if (!shouldRetry || !retriesLeft)
			throw ex;

		logger.sysDEBUG(`Retriable exception encountered while running Kafka command: ${commandFn?.name || commandFn?.toString()} `
			+ `${JSON.stringify(ex)}, (${retriesLeft} retries left)`);
		const newRetryDelay = Math.min(consts.kafka.RETRY.MAX_DELAY, retryDelayMs * retryDelayFactor);
		const newOptions = { ...options, retriesLeft: retriesLeft - 1, retryDelayMs: newRetryDelay };

		return new Promise((resolve, reject) =>
			setTimeout(() => {
				scope.runKafkaCommand(commandFn, args, newOptions)
					.then(resolve)
					.catch(reject);
			}, options.retryDelayMs));
	}

	return result;
};

scope.isUpstreamTopicByName = topicName => {
	const managementTopicsSuffixes = [consts.topicSuffix.MANAGEMENT_LOW, consts.topicSuffix.MANAGEMENT_PRIORITY, consts.topicSuffix.MANAGEMENT_KEEPALIVE];
	return managementTopicsSuffixes.some(suffix => topicName.includes(suffix));

};

scope.getTopicChangesBetweenCompatibilityVersions = (featureCompatibilityType, hostname, zone, newCompatibilityVersion, oldCompatibilityVersion, callback) => {
	const existingTopics = [], requiredTopics = [];

	async.parallel([
		cb => scope.getTopicNames(featureCompatibilityType, newCompatibilityVersion, hostname, zone, null, topics => { requiredTopics.push(...topics); cb(); }),
		cb => scope.getTopicNames(featureCompatibilityType, oldCompatibilityVersion, hostname, zone, null, topics => { existingTopics.push(...topics); cb(); }),
	], () => {
		const requiredTopicsSet = new Set(requiredTopics);
		const existingTopicsSet = new Set(existingTopics);

		const topicsToCreate = [...requiredTopicsSet].filter(newRequiredTopic => !existingTopicsSet.has(newRequiredTopic));
		const topicsToDelete = [...existingTopicsSet].filter(existingTopic => !requiredTopicsSet.has(existingTopic));

		callback(topicsToCreate, topicsToDelete);
	});
};

scope.getTopicNames = (component, version, hostname, zone, zoneLocked, callback) => {
	const interopDB = app.get('interopDB');

	interopDB.getSupportedKafkaTopics(component, version, ({ success, data, error }) => {
		if (!success || utils.isEmpty(data)) {
			new SystemMessage(systemMessages.KAFKA_TOPIC_LOOKUP_FAILED)
				.addInfo(Entities.Component.name, component)
				.addInfo(Entities.Component.version, version)
				.addInfo(Entities.Error, error ? new InteropDBError(error) : new SystemMessage(systemMessages.NO_TOPICS_FOUND_IN_INTEROPDB))
				.log();

			if (zoneLocked)
				return lockModule.releaseLockByZone(zoneLocked, () => process.exit(1));

			process.exit(1);
		}

		const replacerFn = topicName =>
			topicName
				.replace(consts.TOPIC_NAME_PLACEHOLDERS.HOSTNAME, hostname)
				.replace(consts.TOPIC_NAME_PLACEHOLDERS.ZONE, scope.getZonePrefix(zone));

		const topicNames = Object.entries(data)
			.reduce((acc, [name, topicVersions]) => {
				const topicBase = (hostname || zone) ? replacerFn(name) : name;
				return [...acc, ...topicVersions.map(topicVersion => `${topicBase}.${topicVersion}`)];
			}, []);

		callback(topicNames);
	});
};

scope.mapTopicNamesToTopicSuffix = (topics) => {
	return topics.reduce((acc, topic) => {
		const suffixes = Object.values(consts.topicSuffix);
		const topicSuffix = suffixes.find(suffix => topic.includes(suffix));

		if (!topicSuffix) {
			logger.sysDEBUG(`Topic ${topic} does not have a valid suffix, skipping`);
			return acc;
		}

		if (acc[topicSuffix]) {
			logger.sysDEBUG(`More than one topic with the same suffix ${topicSuffix}, skipping topic ${topic}`);
			return acc;
		}

		acc[topicSuffix] = topic;
		return acc;
	}, {});
};

// this function should return a set of topics that are owned by nvmesh/management only
function getOwnedExistingTopics(callback) {
	scope.listTopics((err, topics) => {
		if (err)
			return callback(err);

		const interestTopicsSuffixes = Object.values(consts.topicSuffix);
		const interestTopics = topics.filter(topic => interestTopicsSuffixes.some(suffix => topic.includes(suffix)));

		callback(null, new Set(interestTopics));
	});
}

function getTopicsInUseByCollectionName(collectionName, callback) {
	const db = app.get('db');
	const collection = db.collection(collectionName);

	const pipeline = [
		{ '$project': { topicValues: { '$objectToArray': '$topics' } } },
		{ '$unwind': '$topicValues' },
		{ '$project': { _id: 0, topic: '$topicValues.v' } },
		{ '$group': { _id: null, uniqueTopics: { '$addToSet': '$topic' } } },
		{ '$project': { _id: 0, uniqueTopics: 1 } },
	];

	collection.aggregate(pipeline).toArray((err, results) => {
		if (err)
			return callback(new MongoError(err).log());

		const topics = results[0]?.uniqueTopics || [];
		callback(null, new Set(topics));
	});
}

function getManagementTopicsInUse(callback) {
	const db = app.get('db');
	const managementClusterCollection = db.collection('managementCluster');
	const query = { rpmVersion: { $exists: true } };
	const projection = { _id: 0, rpmVersion: 1 };

	managementClusterCollection.find(query, { projection }).toArray((err, results) => {
		if (err)
			return callback(new MongoError(err).log());

		const topicsInUse = new Set();
		const rpmVersions = [...new Set(results.map(result => utils.getVRPartsObj(result.rpmVersion).version))];

		async.each(rpmVersions, (rpmVersion, cb) => {
			scope.getTopicNames(consts.components.MANAGEMENT, rpmVersion, null, null, null, topics => {
				topics.forEach(topic => topicsInUse.add(topic));
				cb();
			});
		}, () => callback(null, topicsInUse));
	});
}

function getTopicsInUse(callback) {
	async.parallel([
		cb => getTopicsInUseByCollectionName(consts.dbCollections.CLIENT, cb),
		cb => getTopicsInUseByCollectionName(consts.dbCollections.TARGET, cb),
		cb => getTopicsInUseByCollectionName(consts.dbCollections.UPGRADE_AGENT, cb),
		cb => getTopicsInUseByCollectionName(consts.dbCollections.CONFIGURATION_VERSION, cb),
		cb => getManagementTopicsInUse(cb)
	], (err, topicsSetsInUse) => {
		if (err)
			return callback(err);

		const topicsInUse = new Set(topicsSetsInUse.flatMap(set => [...set]));
		callback(null, topicsInUse);
	});
}

scope.getUnusedTopics = (callback) => {
	async.parallel({
		existing: getOwnedExistingTopics,
		inUse: getTopicsInUse,
	}, (err, topicsBySource) => {
		if (err)
			return callback(err);

		const unusedTopics = [...topicsBySource.existing].filter(topic => !topicsBySource.inUse.has(topic));
		callback(null, unusedTopics);
	});
};

function getGroupIdForTopic(topicName) {
	const [prefix] = topicName.split('.');
	const mcsConsumingSuffixes = [
		consts.topicSuffix.CLIENT_MAIN,
		consts.topicSuffix.AGENT_MAIN
	];
	const managementConsumingSuffixes = [
		consts.topicSuffix.MANAGEMENT_LOW,
		consts.topicSuffix.MANAGEMENT_PRIORITY,
		consts.topicSuffix.MANAGEMENT_KEEPALIVE,
	];
	const leaderConsumingSuffixes = [
		consts.topicSuffix.LEADER_INCREMENTAL_UPDATES,
		consts.topicSuffix.LEADER_INCREMENTAL_TARGET_UPDATES
	];

	if (mcsConsumingSuffixes.some(suffix => topicName.includes(suffix)))
		return scope.getMCSGroupID(prefix);

	if (topicName.includes(consts.topicSuffix.TOMA_COMMANDS))
		return scope.getTargetCommandGroupID(prefix);

	if (topicName.includes(consts.topicSuffix.TOMA_HARDWARE_CONF))
		return scope.getTargetHardwareGroupID(prefix);

	if (managementConsumingSuffixes.some(suffix => topicName.includes(suffix)))
		return consts.kafka.MANAGEMENT_GROUP_ID;

	if (leaderConsumingSuffixes.some(suffix => topicName.includes(suffix))) {
		const zoneID = prefix.replace(/\D/g, '');
		return scope.getLeaderGroupID(zoneID);
	}

	if (topicName.includes(consts.topicSuffix.UPGRADE_AGENT_COMMANDS))
		return scope.getUpgradeAgentGroupID(prefix);

	new SystemMessage(systemMessages.KAFKA_GROUP_ID_NOT_FOUND).addInfo(Entities.KafkaTopics, topicName).log();
}

// Sends CDVAllocatorFreeAll to every first-pRAID TOMA node for the given CDV.
// Used when a TPV is deleted so TOMA can reclaim all CDV_extents owned by that TPV
// and zero CDV_extent[0] (the flat-L1 tree) so the next TPV starts clean.
scope.sendCDVAllocatorFreeAll = (cdvUUID, tpvUUID, cb = () => {}) => {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');
	const serverCollection = db.collection('server');

	volumeCollection.findOne({ uuid: cdvUUID, volumeClass: consts.volumeClass.CDV },
		{ projection: { chunks: 1, cdvConfig: 1 } },
		(err, cdv) => {
			if (err || !cdv) {
				logger.sysDEBUG(`sendCDVAllocatorFreeAll: CDV ${cdvUUID} not found`);
				return cb();
			}

			const allocatorSizeGib = (cdv.cdvConfig?.allocatorSizeGib) ?? 1;
			const cdvExtentSizeMib = cdv.cdvConfig && cdv.cdvConfig.cdvExtentSizeMib != null ? cdv.cdvConfig.cdvExtentSizeMib : 64;

			const nodeIds = (cdv.chunks && cdv.chunks[0])
				? [...new Set(
					cdv.chunks[0].pRaids
						.flatMap(pRaid => pRaid.diskSegments)
						.filter(seg => seg.status === consts.diskSegmentStatuses.NORMAL)
						.map(seg => seg.node_id)
				)]
				: [];

			if (!nodeIds.length)
				return cb();

			serverCollection.find({ node_id: { $in: nodeIds } }, { projection: { node_id: 1, topics: 1 } }).toArray((err2, targets) => {
				if (err2 || !targets || !targets.length) {
					logger.sysDEBUG(`sendCDVAllocatorFreeAll: no targets found for CDV ${cdvUUID}`);
					return cb();
				}

				async.each(targets, (target, next) => {
					scope.sendMessages(target.topics[consts.topicSuffix.TOMA_COMMANDS],
						[new CDVAllocatorFreeAll(cdvUUID, tpvUUID, allocatorSizeGib, cdvExtentSizeMib)], next);
				}, () => cb());
			});
		});
};

// return an object mapping topic names to their offsets information (which is an object mapping partition numbers to offsets)
// i.e. { 'default.management.priority': { 0: 100, 1: 200 }, 'scale-1.client.main': { 0: 300, 1: 400 } }
scope.getOffsetsInformationByTopics = (topicNames, callback) => {
	const offsetsInfo = {};

	const groupIdToTopics = topicNames.reduce((acc, topicName) => {
		const groupId = getGroupIdForTopic(topicName);

		if (!groupId)
			return acc;

		return {
			...acc,
			[groupId]: [...(acc[groupId] || []), topicName]
		};
	}, {});

	async.each(Object.entries(groupIdToTopics), ([groupId, topics], cb) => {
		scope.getGroupOffsets(groupId, topics, (err, offsets) => {
			if (err)
				return cb(err);

			offsets.forEach(({ topic, partitions }) =>
				offsetsInfo[topic] = Object.fromEntries(partitions.map(({ partition, offset }) => [partition, offset])));

			cb();
		});
	}, err => callback(err, offsetsInfo));
};

module.exports = scope;
