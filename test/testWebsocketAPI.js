/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global log,describe,before,it,after */

const dbManager = require('./testUtils/dbManager.js');
const assert = require('assert');

const { websocketMessageTypes } = require('../consts.js');
const { LoginMessage } = require('../models/websocketMessages/Login');
const { WebsocketMessage } = require('../models/websocketMessages/websocketMessage');
const { LoginResponse } = require('../models/websocketMessages/LoginResponse.js');
const { RegisterToEventsMessage } = require('../models/websocketMessages/RegisterToEvents.js');

const { setup, SetupOptions } = require('./testUtils/setup.js');
const { handleNewConnection } = require('../modules/websocket.js');
const { WSSocketRequestMock } = require('./testUtils/websocketUtils.js');
const { nextTick } = require('process');
const { handleRawSocketRequest } = require('../modules/websocketCommon.js');
const { TriggerEvent } = require('../models/websocketMessages/TriggerEvent.js');
const { EventResponse } = require('../models/websocketMessages/EventResponse.js');
const consts = require('../consts.js');
const { generateTarget } = require('./testUtils/entityGenerators.js');
const { events } = require('../objectNotifier.js');

const USER = 'admin@nvidia.com';
const PASSWORD = 'admin';

describe('WebsocketAPI', function() {
	const registrant1 = { id: 'WS-CLIENT1', type: 'TEST-CLIENT' };

	before(async() => {
		await dbManager.connect();
	});

	after(()=>{
		return dbManager.closeConnection();
	});

	describe('#Messages structure', function() {


		before(async() => {
			let opts = new SetupOptions();
	        await setup.newSetup(opts);
			log.debug('finished setup db');
		});

		it('Login', async() => {
			const username = 'myuser';
			const password = 'mypass';
			const loginMsg = new LoginMessage(username, password, registrant1);

			const jsonString = loginMsg.serialize();
			const obj = JSON.parse(jsonString);
			const genericMsg = WebsocketMessage.fromObject(obj);

			const newMsg = LoginMessage.fromObject(genericMsg);

			assert(newMsg instanceof WebsocketMessage);
			assert(newMsg instanceof LoginMessage);
			assert.strictEqual(newMsg.payload.username, username);
			assert.strictEqual(newMsg.payload.password, password);
			assert.strictEqual(newMsg.registrant.id, registrant1.id);
			assert.strictEqual(newMsg.registrant.type, registrant1.type);
			assert.strictEqual(newMsg.messageType, websocketMessageTypes.login);
			assert.strictEqual(newMsg.messageTypeVersion, 1);
		});
	});

	describe('#Errors', function() {
		const remoteAddress = '1:1:1:1';

		before(async() => {
			let opts = new SetupOptions().setEnableZones(true);
	        await setup.newSetup(opts);
			log.debug('finished setup db');


		});

		it('malformed JSON', (done) => {
			const rawSocketReq = new WSSocketRequestMock(remoteAddress);
			const connection = rawSocketReq.connection;
			connection.on('response', msg => {
				try {
					const wsMsg = WebsocketMessage.fromObject(msg);
					assert.strictEqual(wsMsg.messageType, websocketMessageTypes.errorResponse);
					assert(wsMsg.payload.error);
					assert.strictEqual(wsMsg.payload.error.code, consts.websocketErrors.MALFORMED_JSON);
					done();
				} catch (ex) {
					done(ex);
				}
			});

			handleRawSocketRequest(rawSocketReq, handleNewConnection);

			nextTick(() => {
				connection.sendMessageToMgmt('this is not JSON');
			});
		});

		it('missing registrant', (done) => {
			const rawSocketReq = new WSSocketRequestMock(remoteAddress);
			const connection = rawSocketReq.connection;
			connection.on('response', msg => {
				try {
					const wsMsg = WebsocketMessage.fromObject(msg);
					assert.strictEqual(wsMsg.messageType, websocketMessageTypes.errorResponse);
					assert(wsMsg.payload.error);
					assert.strictEqual(wsMsg.payload.error.code, consts.websocketErrors.MISSING_REGISTRANT_ID);
					done();
				} catch (ex) {
					done(ex);
				}
			});

			handleRawSocketRequest(rawSocketReq, handleNewConnection);

			nextTick(() => {
				const loginMsg = new LoginMessage(USER, PASSWORD, null);
				connection.sendMessageToMgmt(loginMsg);
			});
		});

		it('wrong protocol', (done) => {
			const rawSocketReq = new WSSocketRequestMock(remoteAddress);
			const connection = rawSocketReq.connection;
			connection.close = () => console.log('management closed the connection');
			connection.on('response', msg => {
				try {
					const wsMsg = WebsocketMessage.fromObject(msg);
					assert.strictEqual(wsMsg.messageType, websocketMessageTypes.errorResponse);
					assert(wsMsg.payload.error);
					assert.strictEqual(wsMsg.payload.error.code, consts.websocketErrors.PROTOCOL_VERSION_NOT_SUPPORTED);
					done();
				} catch (ex) {
					done(ex);
				}
			});

			handleRawSocketRequest(rawSocketReq, handleNewConnection);

			nextTick(() => {
				const loginMsg = new LoginMessage(USER, PASSWORD, registrant1);
				loginMsg.protocolVersion++;
				connection.sendMessageToMgmt(loginMsg);
			});
		});

		it('Not logged in', (done) => {
			const rawSocketReq = new WSSocketRequestMock(remoteAddress);
			const connection = rawSocketReq.connection;
			connection.on('response', msg => {
				try {
					const wsMsg = WebsocketMessage.fromObject(msg);
					assert.strictEqual(wsMsg.messageType, websocketMessageTypes.errorResponse);
					assert(wsMsg.payload.error);
					assert.strictEqual(wsMsg.payload.error.code, consts.websocketErrors.UNAUTHORIZED);
					done();
				} catch (ex) {
					done(ex);
				}
			});

			handleRawSocketRequest(rawSocketReq, handleNewConnection);

			nextTick(() => {
				const regMsg = new RegisterToEventsMessage(['event1'], registrant1);
				connection.sendMessageToMgmt(regMsg);
			});
		});
	});

	describe('#Login', function() {
		const remoteAddress = '1:1:1:1';

		before(async() => {
			let opts = new SetupOptions().setEnableZones(true);
	        await setup.newSetup(opts);
			log.debug('finished setup db');


		});

		it('Successful Login', (done) => {
			const rawSocketReq = new WSSocketRequestMock(remoteAddress);
			const connection = rawSocketReq.connection;
			connection.on('response', msg => {
				try {
					const wsMsg = WebsocketMessage.fromObject(msg);
					assert.strictEqual(wsMsg.messageType, websocketMessageTypes.loginResponse);
					const loginRes = LoginResponse.fromObject(wsMsg);
					assert(loginRes.payload.success, new Error(loginRes.payload.error));
					assert(loginRes.payload.accessToken);
					connection.close();
					done();
				} catch (ex) {
					done(ex);
				}
			});

			handleRawSocketRequest(rawSocketReq, handleNewConnection);

			nextTick(() => {
				const loginMsg = new LoginMessage(USER, PASSWORD, registrant1);
				connection.sendMessageToMgmt(loginMsg);
			});
		});

		it('Double Login', (done) => {
			const rawSocketReq = new WSSocketRequestMock(remoteAddress);
			const connection = rawSocketReq.connection;
			let responseCounter = 0;
			connection.on('response', msg => {
				try {
					const wsMsg = WebsocketMessage.fromObject(msg);
					assert.strictEqual(wsMsg.messageType, websocketMessageTypes.loginResponse);
					const loginRes = LoginResponse.fromObject(wsMsg);
					assert(loginRes.payload.success, new Error(loginRes.payload.error));
					assert(loginRes.payload.accessToken);
					responseCounter++;
					if (responseCounter == 2)
						done();
				} catch (ex) {
					done(ex);
				}
			});

			 handleRawSocketRequest(rawSocketReq, handleNewConnection);

			nextTick(() => {
				const loginMsg = new LoginMessage(USER, PASSWORD, registrant1);
				// send twice
				connection.sendMessageToMgmt(loginMsg);
				connection.sendMessageToMgmt(loginMsg);
			});
		});

		it('Failed Login - wrong credentials', (done) => {
			const rawSocketReq = new WSSocketRequestMock(remoteAddress);
			const connection = rawSocketReq.connection;
			connection.on('response', msg => {
				try {
					const wsMsg = WebsocketMessage.fromObject(msg);
					assert.strictEqual(wsMsg.messageType, websocketMessageTypes.loginResponse);
					const loginRes = LoginResponse.fromObject(wsMsg);
					assert(!loginRes.payload.success, 'expected login to fail');
					assert.strictEqual(loginRes.payload.error, 'Login failed - Incorrect credentials');
					done();
				} catch (ex) {
					done(ex);
				}
			});

			handleRawSocketRequest(rawSocketReq, handleNewConnection);

			nextTick(() => {
				const loginMsg = new LoginMessage('wrong-user', 'password', registrant1);
				connection.sendMessageToMgmt(loginMsg);
			});
		});
	});

	describe('#RegisterToEvents', function() {
		const remoteAddress = '1:1:1:1';

		before(async() => {
			let opts = new SetupOptions();
	        await setup.newSetup(opts);
			log.debug('finished setup db');
		});

		it('Send registration message and wait for event', (done) => {
			const rawSocketReq = new WSSocketRequestMock(remoteAddress);
			const connection = rawSocketReq.connection;
			connection.on('response', msg => {
				try {
					const wsMsg = WebsocketMessage.fromObject(msg);
					switch (wsMsg.messageType) {
						case websocketMessageTypes.loginResponse:
							var loginRes = LoginResponse.fromObject(wsMsg);
							assert(loginRes.payload.success, new Error(loginRes.payload.error));
							assert(loginRes.payload.accessToken);

							var regMsg = new RegisterToEventsMessage(['newTargetEvent'], registrant1);
							regMsg.accessToken = loginRes.payload.accessToken;
							connection.sendMessageToMgmt(regMsg);

							var trigEventMsg = new TriggerEvent(null, 'newTargetEvent', { _id: 'target1' }, registrant1);
							trigEventMsg.accessToken = loginRes.payload.accessToken;
							connection.sendMessageToMgmt(trigEventMsg);
							break;
						case websocketMessageTypes.eventResponse:
							var eventRes = EventResponse.fromObject(wsMsg);
							assert.strictEqual(eventRes.payload.eventName, 'newTargetEvent');
							done();
							break;
						case websocketMessageTypes.errorResponse:
							done(new Error(`received ErrorResponse: ${wsMsg.payload.error}`));
							break;
						default:
							done(new Error(`Unexpected messageType: ${wsMsg.messageType}. full msg: ${wsMsg}`));
							break;
					}
				} catch (ex) {
					done(ex);
				}
			});

			handleRawSocketRequest(rawSocketReq, handleNewConnection);

			nextTick(() => {
				const loginMsg = new LoginMessage(USER, PASSWORD, registrant1);
				connection.sendMessageToMgmt(loginMsg);
			});
		});
	});

	describe('#Management HA WS Server', function() {
		const remoteAddress = '1:1:1:1';
		const haRegistrant = { type: consts.originTypes.MANAGEMENT, id: 'mgmt2' };

		before(async() => {
			let opts = new SetupOptions();
	        await setup.newSetup(opts);
			log.debug('finished setup db');
		});

		it('Send registration message and wait for event', (done) => {
			const rawSocketReq = new WSSocketRequestMock(remoteAddress);
			const connection = rawSocketReq.connection;

			const messagesReceievd = {};
			connection.on('response', msg => {
				try {
					const wsMsg = WebsocketMessage.fromObject(msg);
					switch (wsMsg.messageType) {
						case websocketMessageTypes.loginResponse:
							var loginRes = LoginResponse.fromObject(wsMsg);
							assert(loginRes.payload.success, new Error(loginRes.payload.error));
							assert(loginRes.payload.accessToken);

							var eventsToRegister = [
								events.newTargetEvent.name,
								events.newDiskEvent.name
							];

							var regMsg = new RegisterToEventsMessage(eventsToRegister, haRegistrant);
							regMsg.accessToken = loginRes.payload.accessToken;
							connection.sendMessageToMgmt(regMsg);

							var target = generateTarget('targetA', 1, 1);
							target.save();
							break;
						case websocketMessageTypes.eventResponse:
							// make sure we get multiple events
							var eventRes = EventResponse.fromObject(wsMsg);
							messagesReceievd[eventRes.payload.eventName] = eventRes;

							if (Object.keys(messagesReceievd).length == 2)
								done();
							break;
						case websocketMessageTypes.errorResponse:
							done(new Error(`received ErrorResponse: ${wsMsg.payload.error}`));
							break;
						default:
							done(new Error(`Unexpected messageType: ${wsMsg.messageType}. full msg: ${wsMsg}`));
							break;
					}
				} catch (ex) {
					done(ex);
				}
			});

			handleRawSocketRequest(rawSocketReq, handleNewConnection);

			nextTick(() => {
				const loginMsg = new LoginMessage(USER, PASSWORD, haRegistrant);
				connection.sendMessageToMgmt(loginMsg);
			});
		});
	});
});
