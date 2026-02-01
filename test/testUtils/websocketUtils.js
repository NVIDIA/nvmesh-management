/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* globals log */
const WebSocketClient = require('websocket').client;
const WebSocketServer = require('websocket').server;
const fs = require('fs');
const path = require('path');
const https = require('https');
const express = require('express');
const EventEmitter = require('eventemitter3');

const websocketCommon = require('../../modules/websocketCommon.js');
const { delay } = require('./common.js');
const consts = require('../../consts');


exports.SequenceInfo = class {
	constructor(connectionSequence, messageSequence) {
		this.connectionSequence = connectionSequence;
		this.messageSequence = messageSequence;
	}

	toDict() {
		return {
			connectionSequence: this.connectionSequence,
			messageSequence: this.messageSequence
		};
	}

	toString() {
		return JSON.stringify(this.toDict());
	}
};


const oneGiB = Math.pow(1024, 3);

exports.MgmtWebSocketClient = class MgmtWebSocketClient {
	constructor(hostname, type) {
		this.events = new EventEmitter();
		this.registrant = {
			id: hostname,
			type: type
		};
		this.connectionSequence = null;
		this.messageSequence = 0;

		this.pingTimeout = null;
		this.accessToken = null;

		this.keepAliveTimeout = 1000 * 15;

		this.config = {
			closeTimeout: 3000,
			fragmentOutgoingMessages: true,
			maxReceivedMessageSize: oneGiB,
			maxReceivedFrameSize: oneGiB
		};

		this.client = new WebSocketClient(this.config);
	}

	close() {
		this.connection.close();
	}

	onClose() {
		log.debug('close');
	}

	abort() {
		return new Promise(resolve => {
			this.close();
			this.client.abort();
			clearTimeout(this.pingTimeout);
			clearTimeout(this.pingInterval);
			delay(15).then(() => resolve());
		});
	}

	sendMessage(payload) {
		payload.accessToken = this.accessToken;
		payload.registrant = this.registrant;
		payload.connectionSequence = this.connectionSequence;
		this.messageSequence += 1;
		payload.messageSequence = this.messageSequence;
		this.connection.sendUTF(JSON.stringify(payload));
	}

	onMessage(rawMessage) {
		let message = JSON.parse(rawMessage.utf8Data);
		log.debug(`received message: ${rawMessage.utf8Data}`);
		if (!message.route && message.success) {
			this.accessToken = message.accessToken;
			this.events.emit('loggedIn', message);
		} else {
			this.events.emit('message', message);
		}
	}

	setKeepAliveTimeout() {
		let self = this;
		clearTimeout(this.pingTimeout);
		this.pingTimeout = setTimeout(function() {
			log.debug('client keep-alive failed');
			self.connection.drop(1001, 'client keep-alive failed');
		}, this.keepAliveTimeout);
	}

	pong() {
		var self = this;
		log.debug('sending pong');
		this.setKeepAliveTimeout();
		clearTimeout(this.pingInterval);
		this.pingInterval = setTimeout(function() {
			self.connection.ping('ping');
		}, this.keepAliveInterval);
	}

	ping() {
		this.connection.ping('ping');
	}

	connect(address) {
		let self = this;
		self.address = address;
		return new Promise((resolve, reject) => {
			this.client.on('connect', function(connection) {
				if (!connection)
					return reject();

				self.connection = connection;

				self.setKeepAliveTimeout();

				connection.on('pong', function() {
					self.pong();
				});

				connection.on('error', function(error) {
					log.debug(`WebSocketClient Connection Error: ${error.toString()}`);
				});

				connection.on('close', function(reasonCode, description) {
					log.debug(`WebSocketClient Connection Closed: reasonCode: ${reasonCode}, description:${description}`);
					clearTimeout(self.pingInterval);
					clearTimeout(self.pingTimeout);
					self.onClose();
				});

				connection.on('message', function(message) {
					self.onMessage(message);
				});

				resolve();
			});

			this.client.on('connectFailed', () => {
				log.debug(`Failed to connect to ${address}`);
			});

			log.debug('Trying to connect to: ' + address);
			this.client.connect(address);
		});
	}

	login() {
		let self = this;
		let loggedInPromise = this.promiseEventOnce('loggedIn').then((msg) => {
			self.connectionSequence = msg.connectionSequence;
			return msg;
		});

		this.sendLoginMessage();
		return loggedInPromise;
	}

	promiseEventOnce(eventName) {
		// return a promise that will be resolved only once on the first time eventName is emitted
		let self = this;
		return new Promise(resolve => {

			function onFirstEvent(data) {
				removeListener();
				resolve(data);
			}

			function removeListener() {
				self.events.removeListener(eventName, onFirstEvent);
			}

			self.events.on(eventName, onFirstEvent);
		});
	}

	sendLoginMessage() {
		let loginCredentials = { email: consts.ADMIN_USER, password: 'admin', registrant: this.registrant };
		log.debug('trying to login to management on ' + this.address);
		this.connection.sendUTF(JSON.stringify(loginCredentials));
	}
};


exports.MgmtWebSocketServer = class MgmtWebSocketServer {
	constructor(port = 4001, useSSL = true) {
		this.server = null;
		this.port = port;
		this.useSSL = useSSL;

		this.serverConfig = {
			keepalive: true,
			keepaliveInterval: 2000,
			dropConnectionOnKeepaliveTimeout: true,
			keepaliveGracePeriod: 30000,
			closeTimeout: 3000,
			outOfSyncInterval: 5000,
			outOfsyncThreshold: 5000,
			fragmentOutgoingMessages: true,
			maxReceivedMessageSize: oneGiB,
			maxReceivedFrameSize: oneGiB
		};
	}

	setHandleNewConnectionFunc(func) {
		this.handleNewConnection = func;
	}

	start() {
		let self = this;
		if (this.useSSL) {
			let appRoot = '.';
			var options = {
				key: fs.readFileSync(path.join(appRoot, 'newCert/key.pem')),
				cert: fs.readFileSync(path.join(appRoot, 'newCert/cert.pem'))
			};

			this.server = https.createServer(options, express()).listen(this.port, function() {
				log.debug(`Management WebSocket Server listening on port ${self.port} with ssl`);
			});
		} else {
			this.server = express().listen(this.port, function() {
				log.debug(`Management WebSocket Server listening on port ${self.port} without ssl`);
			});
		}

		if (!this.server) {
			log.debug('Failed to create server');
			return;
		}

		this.serverConfig.httpServer = this.server;
		this.wsServer = new WebSocketServer(this.serverConfig);
		this.wsServer.on('request', req => {
			websocketCommon.handleRawSocketRequest(req, self.handleNewConnection);
		});
	}

	stop() {
		this.server.close();

		if (this.httpServer)
			this.httpServer.close();
	}
};

exports.WSConnectionMock = class WSConnectionMock extends EventEmitter {
	sendUTF(utfString) {
		const obj = JSON.parse(utfString);
		this.emit('response', obj);
	}

	close() {
		console.log('management server closed the connection');
		this.emit('close');
	}

	sendMessageToMgmt(msg) {
		const rawWebsocketMsg = { utf8Data: JSON.stringify(msg) };
		this.emit('message', rawWebsocketMsg);
	}
};

exports.WSSocketRequestMock = class WSSocketRequestMock {
	constructor(remoteAddress, connection) {
		this.remoteAddress = remoteAddress;
		this.connection = connection || new exports.WSConnectionMock();
	}

	accept() {
		return this.connection;
	}
};
