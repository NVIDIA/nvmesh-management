/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */
const uuid = require('uuid');
const kafkaModule = require('../../modules/kafka.js');
const consts = require('../../consts.js');

function log(msg) {
	const logger = app.get('testLogger');
	logger.debug(`MockKafkaModule: ${msg}`);
}

class KafkaMockQueue {
	constructor(topic) {
		this.topic = topic;
		this.q = [];
		this.history = [];
		this.messageListeners = {};
	}

	readMessageOrWait(timeoutMS) {
		let msg = this.readMessage();
		if (msg)
			return Promise.resolve(msg);

		timeoutMS = timeoutMS || 1000;
		return this.waitForMessage(timeoutMS);
	}

	waitForMessage(timeoutMS) {
		let waitUUID = uuid.v1();
		let self = this;
		return new Promise((resolve, reject) => {
			let timer = setTimeout(() => {
				const err = new Error(`timed-out waiting for Kafka Message topic: ${this.topic} timeoutMS: ${timeoutMS}`);
				console.log(err);
				reject(err);
				delete self.messageListeners[waitUUID];
			}, timeoutMS);
			self.messageListeners[waitUUID] = {
				func: function NewMessage(msg) {
					clearTimeout(timer);
					resolve(msg);
					delete self.messageListeners[waitUUID];
				},
				reject: reject,
				timer: timer
			};
		});
	}

	readMessage() {
		if (this.q.length) {
			let msg = this.q.shift();
			this.history.push(msg);
			return msg;
		} else
			return null;
	}

	sendMessage(msg) {
		if (Object.values(this.messageListeners).length > 0) {
			// someone is waiting for messages
			Object.values(this.messageListeners).forEach(listener => {
				listener.func(msg);
			});

			this.history.push(msg);
		} else {
			this.q.push(msg);
		}
	}

	destroy() {
		Object.values(this.messageListeners).forEach(listener => {
			clearTimeout(listener.timer);
			listener.reject(new Error(`KafkaMockQueue destroyed for topic: ${this.topic}`));
		});
		this.messageListeners = {};
		this.clear();
	}

	clear() {
		this.q = [];
		this.history = [];
	}
}

/** @type {Object.<string, KafkaMockQueue>} **/
const kafkaQueues = {};
exports.kafkaQueues = kafkaQueues;

exports.getOrCreateQueue = function(topic) {
	if (!kafkaQueues[topic])
		kafkaQueues[topic] = new KafkaMockQueue(topic);

	return kafkaQueues[topic];
};

exports.isTopicExists = function(topic) {
	return topic in kafkaQueues;
};

exports.resetKafkaQueues = function() {
	for (var topic in kafkaQueues) {
		exports.resetKafkaQueue(topic);
	}
};

exports.resetKafkaQueue = function(topic) {
	if (kafkaQueues[topic]) {
		kafkaQueues[topic].destroy();
		delete kafkaQueues[topic];
	}
};

exports.initMockKafka = function() {
	return new Promise(resolve => {
		kafkaModule.clearRecycleConsumerCooldown();
		kafkaModule.initTopics(() => {
			resolve();
		});
	});
};

// This function will also clear all queues
exports.mockKafkaModule = function() {
	exports.resetKafkaQueues();
	let currentConsumerIdCounter = 0;

	// override functions in kafka module
	log('Mocking Kafka module functions for unittests');
	kafkaModule.connect = function(cb) {
		log('connect');
		cb();
	};

	kafkaModule.createTopicsAndACLs = function(topicsConfig, callback) {
		log(`createTopicsAndACLs: ${topicsConfig.map(c => c.name)}`);
		topicsConfig.forEach(config => {
			if (!(config.name in kafkaQueues))
				kafkaQueues[config.name] = new KafkaMockQueue(config.name);
		});

		callback(true);
	};

	kafkaModule.sendMessages = async function(topicOrGetterFn, messages, callback) {
		const topic = await new Promise(resolve => typeof topicOrGetterFn === 'function' ? topicOrGetterFn(resolve) : resolve(topicOrGetterFn));

		messages.forEach(m => {
			if (!(topic in kafkaQueues))
				throw new Error(`Expected topic to be created before sending message topic: ${topic} msg.type: ${m.type}`);
			kafkaQueues[topic].sendMessage(m);
		});
		if (callback)
			callback();
	};

	kafkaModule.deleteTopics = function(topicsToDelete, callback) {
		log(`deleteTopics: ${JSON.stringify(topicsToDelete)}`);
		topicsToDelete.forEach(topic => {
			if (topic in kafkaQueues)
				delete kafkaQueues[topic];
		});

		callback();
	};

	kafkaModule.deleteTopicRecords = function(topic, callback) {
		log(`deleteTopicRecords: ${topic}`);

		if (topic in kafkaQueues)
			kafkaQueues[topic].clear();

		callback();
	};

	kafkaModule.listTopics = function(callback) {
		callback(null, Object.keys(kafkaQueues));
	};

	kafkaModule.getTopicNames = (component, version, hostname, zone, zoneLocked, callback) => {
		if (component === consts.components.MANAGEMENT)
			callback(['default.management.priority.1.0.0']);
		else if (component === consts.FEATURE_COMPATIBILITY_TYPES.LEADER)
			callback([
				'<ZONE>.management.priority.1.0.0',
				'<ZONE>.management.low.1.0.0',
				'<ZONE>.leader.incrementalUpdates.1.0.0',
				'<ZONE>.leader.incrementalTargetUpdates.1.0.0'
			].map(topicName => topicName.replace(consts.TOPIC_NAME_PLACEHOLDERS.ZONE, kafkaModule.getZonePrefix(zone))));
		else if (component === consts.FEATURE_COMPATIBILITY_TYPES.CLIENT)
			callback([
				'<HOSTNAME>.client.main.1.0.0',
				'<HOSTNAME>.managementAgent.main.1.0.0'
			].map(topicName => topicName.replace(consts.TOPIC_NAME_PLACEHOLDERS.HOSTNAME, hostname)));
		else if (component === consts.FEATURE_COMPATIBILITY_TYPES.TARGET)
			callback([
				'<ZONE>.TOMA.hardwareConfiguration.1.0.0',
				'<HOSTNAME>.TOMA.commands.1.0.0'
			].map(topicName => topicName.replace(consts.TOPIC_NAME_PLACEHOLDERS.HOSTNAME, hostname)));
	};

	kafkaModule.recycleConsumer = callback => {
		const customConsumerInstanceID = ++currentConsumerIdCounter;
		const subscribedTopics = kafkaModule.subscribableTopics;
		app.set('kafkaConsumer', { customConsumerInstanceID, subscribedTopics });
		log(`Mocking recycleConsumer with consumer ID: ${customConsumerInstanceID}`);
		callback();
	};

	return exports.initMockKafka();
};