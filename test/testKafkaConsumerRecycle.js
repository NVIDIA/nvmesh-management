/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global it, describe, before, after, beforeEach, app */

const assert = require('assert');

// Requiring dbManager creates the global `app` (express) the kafka module relies on.
// It does NOT open a MongoDB connection (that is a separate explicit step), so this
// suite drives the real consumer-recycle flow against a mock kafka client, no DB needed.
require('./testUtils/dbManager');
const kafka = require('../modules/kafka.js');
const logger = require('../logger.js');
const consts = require('../consts.js');

// Capture the real lifecycle functions at load time. The shared test harness (mockKafkaModule,
// used by other suites) replaces kafka.recycleConsumer on this singleton, so we hold the genuine
// implementations here to drive an actual recycle (disconnect + re-init) in isolation.
const realRecycleConsumer = kafka.recycleConsumer;
const realInitConsumers = kafka.initConsumers;

// Minimal stand-in for a kafkajs consumer: records the lifecycle calls the recycle flow makes
// and mimics kafkajs topic-level pause (a paused topic covers all of its partitions).
function makeMockConsumer() {
	const state = {
		connected: false,
		running: false,
		disconnected: false,
		subscribeArgs: null,
		pausedTopics: new Set()
	};

	return {
		state,
		events: { CRASH: 'crash', REBALANCING: 'rebalancing', CONNECT: 'connect', DISCONNECT: 'disconnect', GROUP_JOIN: 'group_join' },
		on: () => {},
		connect: async() => { state.connected = true; },
		subscribe: async(args) => { state.subscribeArgs = args; },
		run: async() => { state.running = true; },
		pause: topicPartitions => topicPartitions.forEach(({ topic }) => state.pausedTopics.add(topic)),
		resume: topicPartitions => topicPartitions.forEach(({ topic }) => state.pausedTopics.delete(topic)),
		paused: () => Array.from(state.pausedTopics).map(topic => ({ topic, partitions: [] })),
		disconnect: async() => { state.disconnected = true; }
	};
}

function createMockKafkaClient() {
	return { consumer: () => makeMockConsumer() };
}

describe('Kafka consumer recycle', () => {
	const CAP = consts.KAFKA_CONSUMER_MAX_IN_PROCESS_MESSAGES;
	const TOPICS = ['zoneA.management.keepalive.1.0.0', 'zoneA.management.priority.1.0.0', 'hostX.client.main.1.0.0'];
	const sortedTopics = [...TOPICS].sort();
	let saved;

	// Recycle (disconnect + re-init) the consumer and wait for the flow's internal bookkeeping to settle.
	function recycle() {
		return new Promise(resolve => realRecycleConsumer(resolve))
			.then(() => new Promise(resolve => setImmediate(resolve)));
	}

	before(() => {
		// Snapshot every bit of shared state we mutate so the suite is hermetic within the full run.
		saved = {
			logSysMessage: logger.logSysMessage,
			subscribableTopics: kafka.subscribableTopics,
			messagesInProcess: kafka.messagesInProcess,
			globalSettings: app.get('globalSettings'),
			kafkaClient: app.get('kafkaClient'),
			kafkaConsumer: app.get('kafkaConsumer'),
			managementId: app.get('managementId'),
			syslogID: app.get('syslogID')
		};

		app.set('managementId', 'unittest-mgmt');
		app.set('syslogID', 'nvmeshmgr-test');
		app.set('globalSettings', { loggingLevel: consts.loggingLevel.INFO, debugComponents: {} });

		// Silence the syslog sink (logging infra, not the unit under test).
		logger.logSysMessage = () => {};
	});

	after(() => {
		logger.logSysMessage = saved.logSysMessage;
		kafka.subscribableTopics = saved.subscribableTopics;
		kafka.messagesInProcess = saved.messagesInProcess;
		app.set('globalSettings', saved.globalSettings);
		app.set('kafkaClient', saved.kafkaClient);
		app.set('kafkaConsumer', saved.kafkaConsumer);
		app.set('managementId', saved.managementId);
		app.set('syslogID', saved.syslogID);
		kafka.resetConsumerState();
	});

	beforeEach(async() => {
		app.set('kafkaClient', createMockKafkaClient());
		app.set('kafkaConsumer', null);
		kafka.subscribableTopics = new Set(TOPICS);
		kafka.messagesInProcess = 0;
		kafka.resetConsumerState();

		// Establish a baseline consumer to recycle away from.
		const err = await realInitConsumers();
		assert(!err, `baseline initConsumers should succeed, got: ${err}`);
	});

	it('replaces the old consumer with a fresh, connected, subscribed one', async() => {
		const oldConsumer = app.get('kafkaConsumer');

		await recycle();

		const newConsumer = app.get('kafkaConsumer');
		assert.notStrictEqual(newConsumer, oldConsumer, 'a brand-new consumer instance must replace the old one');
		assert(newConsumer.customConsumerInstanceID > oldConsumer.customConsumerInstanceID, 'new consumer must get a fresh (higher) instance id');
		assert.strictEqual(oldConsumer.state.disconnected, true, 'the old consumer must be disconnected');
		assert.strictEqual(newConsumer.state.connected, true, 'the new consumer must be connected');
		assert.strictEqual(newConsumer.state.running, true, 'consumer.run must have been called on the new consumer');
		assert.deepStrictEqual([...newConsumer.subscribedTopics].sort(), sortedTopics, 'new consumer must track the subscribable topics');
		assert.deepStrictEqual([...newConsumer.state.subscribeArgs.topics].sort(), sortedTopics, 'new consumer must subscribe to the subscribable topics');
	});

	it('clears the stale paused flag so the next consumed message re-pauses an over-cap backlog', async() => {
		// Pre-crash condition: backlog above the cap and a STALE paused flag from the previous consumer
		// (it looks "paused", paused just moments ago). The brand-new consumer actually starts un-paused.
		kafka.messagesInProcess = CAP + 1;
		kafka.isConsumerPaused = true;
		kafka.lastConsumerPauseTime = new Date();

		const oldConsumer = app.get('kafkaConsumer');
		await recycle();
		const newConsumer = app.get('kafkaConsumer');

		// Recycle realigns the throttle state with the fresh consumer; the pause itself is applied lazily
		// by the per-message throttle check, not at recycle time.
		assert.notStrictEqual(newConsumer, oldConsumer, 'a new consumer must be created');
		assert.strictEqual(newConsumer.state.running, true);
		assert.strictEqual(kafka.isConsumerPaused, false, 'stale paused flag must be cleared so the next throttle check can act');
		assert.strictEqual(newConsumer.state.pausedTopics.size, 0, 'recycle itself must not pause the consumer');

		// The next consumed message runs the throttle check (registerOffset -> pauseConsumerIfNeeded).
		// Because the stale flag was cleared and the backlog is still over the cap, it pauses immediately
		// instead of skipping for 30s (the bypass that led to the OOM).
		kafka.pauseConsumerIfNeeded();

		assert.strictEqual(kafka.isConsumerPaused, true, 'an over-cap backlog must pause the new consumer on the next message');
		// Pause is topic-level, so it covers EVERY subscribed topic (not the 2-of-9 subset seen on the crash).
		assert.deepStrictEqual([...newConsumer.state.pausedTopics].sort(), sortedTopics, 'every subscribed topic on the new consumer must be paused');
		assert.strictEqual(oldConsumer.state.pausedTopics.size, 0, 'the pause must hit the new consumer, not the discarded old one');
	});

	it('leaves the new consumer running and un-paused when the backlog is under the cap', async() => {
		// Stale paused flag but no real backlog: the new consumer should come up un-paused and stay that way.
		kafka.messagesInProcess = 0;
		kafka.isConsumerPaused = true;
		kafka.lastConsumerPauseTime = new Date();

		await recycle();
		const newConsumer = app.get('kafkaConsumer');

		assert.strictEqual(newConsumer.state.running, true);
		assert.strictEqual(kafka.isConsumerPaused, false, 'stale paused flag must be cleared to match the un-paused new consumer');
		assert.strictEqual(kafka.lastConsumerPauseTime.getTime(), 0, 'pause timestamp must be reset for the new consumer');
		assert.strictEqual(kafka.isResumeInProgress, false);

		// Even as messages are consumed, an under-cap backlog must not pause the consumer.
		kafka.pauseConsumerIfNeeded();
		assert.strictEqual(newConsumer.state.pausedTopics.size, 0, 'a new consumer must not be paused while under the cap');
		assert.strictEqual(kafka.isConsumerPaused, false);
	});
});
