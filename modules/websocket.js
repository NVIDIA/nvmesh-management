/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

var uuid = require('uuid');
var async = require('async');
const fs = require('fs');

var utils = require('../utils.js');
const { getVRPartsObj, compareVersions } = require('./versionUtils.js');
var logger = require('../logger.js');
var eventsModule = require('../events.js');
var consts = require('../consts.js');
var systemMessages = require('../systemMessages.js');
var websocketCommon = require('./websocketCommon.js');
var WebSocketClient = require('websocket').client;
var objectNotifier = require('../objectNotifier.js');
var config = require('./config.js');
var managementClusterModule = require('./managementCluster.js');
var lastMessageLog = require('./lastMessageLog.js');

var { Entities, MongoError, SystemMessage, SystemAdminMessage, Differentiators } = require('./error.js');
const { LoginResponse } = require('../models/websocketMessages/LoginResponse.js');
const { ErrorResponse } = require('../models/websocketMessages/ErrorResponse.js');
const { EventResponse } = require('../models/websocketMessages/EventResponse.js');
const { WebsocketMessage } = require('../models/websocketMessages/websocketMessage.js');
const { RegisterToEventsMessage } = require('../models/websocketMessages/RegisterToEvents.js');
const { TriggerEvent } = require('../models/websocketMessages/TriggerEvent.js');
const { UnregisterFromEvents } = require('../models/websocketMessages/UnregisterFromEvents.js');
const { LoginMessage } = require('../models/websocketMessages/Login.js');

var scope = {};

scope.afterModuleLoaded = function() {
	// init remoteMonitoredEvents with all default events required for cache
	websocketCommon.addDefaultRemoteMonitoredEvents(objectNotifier.monitoredObjects);
	({ Entities, MongoError, SystemMessage, SystemAdminMessage, Differentiators } = require('./error.js'));
	logger = require('../logger.js');
};

scope.getRemoteMonitoredEvents = function() {
	return websocketCommon.getRemoteMonitoredEvents();
};

scope.handleNewConnection = function(connection, remoteAddress) {
	var authorizedConnections = app.get('authorizedConnections');
	connection.guid = uuid.v1();
	connection.id;

	function onSocketClosed(reasonCode, description, skipValidation, cb) {
		if (!connection.id || !authorizedConnections[connection.id]) {
			logger.sysDEBUG(remoteAddress + ' disconnected! called onSocketClosed but the socket was already closed errorCode: ' +
				reasonCode + '. Error: ' + description);

			return cb ? cb() : {};
		}

		websocketCommon.unregisterFromAllSocketEvents(websocketCommon.getRegisterToEventsID(connection.id, connection.guid), true);

		if (websocketCommon.isConnectionChanged(connection.id, authorizedConnections[connection.id], connection.guid, skipValidation))
			return cb ? cb() : {};

		async.series([
			function cleanManagementsAndClients(callback) {
				if (!authorizedConnections[connection.id]) {
					logger.sysDEBUG('Was handling a socketClose::cleanManagementAndClients but it seems like someone else is already handled this.');
					return callback();
				}

				var authConn = authorizedConnections[connection.id];
				var registrants = authConn.registrants;

				if (websocketCommon.isConnectionChanged(connection.id, authorizedConnections[connection.id], connection.guid, skipValidation))
					return callback();

				if (Object.keys(registrants).length != 0)
					logger.sysDEBUG(authConn.id + ' disconnected from websocket with registrants '
						+ Array.from(Object.keys(registrants)).join(', ') + ' errorCode: ' + reasonCode + ' ' + description);

				if (consts.originTypes.MANAGEMENT in registrants) {
					var inboundClusterConnections = app.get('mgmtInboundClusterConnections');

					if (authConn) {
						logger.sysVERBOSE('HA', 'Deleting management: ' + authConn.id + ' from inboundConns connGuid: ' +
							connection.guid + ' authGuid: ' + authConn.guid);
						var managementID = authConn.id;
						delete inboundClusterConnections[managementID];
					}
				}

				delete authorizedConnections[connection.id];

				callback();
			}
		], cb);
	}

	connection.on('message', message => scope.handleWebsocketMessage(message, connection, remoteAddress, onSocketClosed));

	connection.on('close', function() {
		onSocketClosed();
	});

	connection.on('error', function(error) {
		new SystemMessage(systemMessages.WEBSOCKET_CONNECTION_ERROR)
			.addInfo(Entities.Error, error.toString())
			.addInfo(Entities.Socket.ID, connection.id)
			.addInfo(Entities.Socket.state, connection.state)
			.addInfo(Entities.Socket.isConnected, connection.connected).log();

		onSocketClosed(-1, error.toString());
	});
};


function handleManagementEventRegistration(request, connection) {
	var inboundClusterConnections = app.get('mgmtInboundClusterConnections');
	var authorizedConnections = app.get('authorizedConnections');

	// adding the new management to the inbound sockets
	logger.sysVERBOSE('HA', 'Adding management: ' + request.registrant.id + ' from inboundConns connGuid: ' +
		connection.guid + ' authGuid: ' + authorizedConnections[request.registrant.id].guid);
	inboundClusterConnections[request.registrant.id] = {};
}

function handleComponentRegistration(request, connection) {
	switch (request.registrant.type) {
		case consts.originTypes.MANAGEMENT:
			handleManagementEventRegistration(request, connection);

			break;
		default:
			//No special handling
			break;
	}

	return request && request.payload ? request.payload.events : [];
}

scope.sendResponse = function(connection, responseMsg) {
	logger.sysVERBOSE('HA', `Websocket sending response: ${responseMsg.messageType}`, responseMsg);
	connection.sendUTF(JSON.stringify(responseMsg));
};

scope.handleWebsocketMessage = function handleMessage(message, connection, remoteAddress, onSocketClosed) {
	const authorizedConnections = app.get('authorizedConnections');

	var obj = utils.tryParseJSON(message.utf8Data);

	if (!websocketCommon.checkMessageRequiredFields(connection, obj))
		return;

	new SystemMessage(systemMessages.WEBSOCKET_MSG_RECEIVED)
		.addInfo(Entities.Registrant.Type, obj.registrant.type)
		.addInfo(Entities.Registrant.ID, obj.registrant.id)
		.addInfo(Entities.Message, utils.tryParseJSON(message.utf8Data))
		.log();

	if (!websocketCommon.isProtocolVersionSupported(obj.protocolVersion)) {
		scope.sendResponse(connection, new ErrorResponse(consts.websocketErrors.PROTOCOL_VERSION_NOT_SUPPORTED, 'Protocol version not supported'));
		// we don't close the connection so that clients can switch protocols without the need to reconnect
		return;
	}

	if (!websocketCommon.concurrentConnections[remoteAddress][obj.registrant.id])
		websocketCommon.concurrentConnections[remoteAddress][obj.registrant.id] = connection.connectionsCounter;
	else
		websocketCommon.concurrentConnections[remoteAddress][obj.registrant.id] = Math.max(
			connection.connectionsCounter,
			websocketCommon.concurrentConnections[remoteAddress][obj.registrant.id]
		);

	utils.collectCommStats(obj);

	function handleLoginWhenOldSocketStillExists() {
		onSocketClosed(null, null, true, () => {
			logger.sysDEBUG('Websocket: cleaned the authConn, id: ' + connection.id + ', handling the message again. connGUID: ' + connection.guid);
			handleMessage(message, connection, remoteAddress, onSocketClosed);
		});
	}

	function postLogin(accessToken) {
		let err;
		if (!authorizedConnections[connection.id]) {
			err = `Closing websocket connection to ${obj.registrant.id}, err: ${err}`;

			if (!authorizedConnections[connection.id])
				err = `After post login no entry in authorizedConnections for ${obj.registrant.id}, err: ${err}`;

			logger.sysDEBUG(err);
			connection.close();
			return;
		}

		logger.sysDEBUG(`Websocket: New connection from ${obj.registrant.id}`);
		const loginResponse = new LoginResponse(true, null, accessToken, obj.registrant);
		scope.sendResponse(connection, loginResponse);
	}

	logger.sysDEBUG(
		`connection.id = ${connection.id}, obj.registrant.id = ${obj.registrant.id}, authorizedConnections keys = ${Object.keys(authorizedConnections)}`
	);

	const msg = WebsocketMessage.fromObject(obj);
	const isLoggedIn = authorizedConnections[connection.id] && msg.accessToken && (msg.accessToken == authorizedConnections[connection.id].accessToken);
	if (!isLoggedIn)
		return websocketCommon.handleLoginMessage(connection, authorizedConnections, obj, remoteAddress,
			handleLoginWhenOldSocketStillExists, postLogin);

	const authConn = websocketCommon.getAuthorizedConnection(obj.registrant.id);
	if (!(obj.registrant.type in authConn.registrants))
		logger.sysDEBUG('Websocket: added registrant: ' + obj.registrant.type + ' ' + obj.registrant.id);

	authConn.registrants[obj.registrant.type] = obj.registrant;

	lastMessageLog.logMessage({ obj: obj, id: connection.id });

	switch (msg.messageType) {
		case consts.websocketMessageTypes.login:
			// client is already logged in
			scope.sendResponse(connection, new LoginResponse(true, null, msg.accessToken, msg.registrant));
			break;
		case consts.websocketMessageTypes.registerToEvents:
			scope.handleRegisterToEvents(msg, connection);
			break;
		case consts.websocketMessageTypes.unregisterFromEvents:
			websocketCommon.unregisterFromEvents(websocketCommon.getRegisterToEventsID(connection.id, connection.guid),
				msg.registrant.type || 'Someone', msg.payload.events, true);
			break;
		case consts.websocketMessageTypes.triggerEvent:
			logger.sysDEBUG('emitEvent from triggerEvent route: ', msg);
			eventsModule.emitEvent(msg.payload.eventIDs, { name: msg.payload.eventName }, msg.payload.eventPayload);
			break;
		default:
			scope.sendResponse(new ErrorResponse(consts.websocketErrors.UNKNOWN_MESSAGE_TYPE, `Unknown message type ${msg.messageType}`));
			break;
	}
};

scope.handleRegisterToEvents = function(obj, connection) {
	var events = handleComponentRegistration(obj, connection);
	var { id: registrantID, type: registrantType } = obj.registrant;

	if (events && events.length) {
		logger.sysDEBUG(`${registrantID} ${registrantType} is registering on my events: ${events.join(', ')} connGUID: ${connection.guid}`);

		websocketCommon.registerToEvents(websocketCommon.getRegisterToEventsID(connection.id, connection.guid), registrantType,
			events, true, function(args) {
				logger.sysDEBUG(`Websocket: event ${args.eventName} is sent to ${registrantID} ${registrantType}`);

				//check that the event was not triggered by a remote management and that we're going to send it to a management!
				//Currently we don't have any management as a proxy so this code .
				if (args.triggeredBy && args.triggeredBy.type === consts.originTypes.MANAGEMENT &&
					registrantType === consts.originTypes.MANAGEMENT)
					return logger.sysVERBOSE('HA', 'registerToEventsCB: triggeredBy management');

				scope.sendResponse(connection, new EventResponse(args.eventName, args.payload, obj.registrant));
				return;
			});
	}
};

scope.getRegistrant = function() {
	return {
		type: consts.originTypes.MANAGEMENT,
		id: app.get('managementId'),
		ip: utils.getIPAddress(),
		port: config.get('webSocketServerPort')
	};
};

function getTimespan(date1, date2) {
	function zeroPad(int) {
		var str = '' + int;
		var pad = '00';

		return pad.substring(0, pad.length - str.length) + str;
	}

	var diff = date2 - date1;

	var days = Math.floor(diff / (1000 * 60 * 60 * 24));
	diff -= days * (1000 * 60 * 60 * 24);

	var hours = Math.floor(diff / (1000 * 60 * 60));
	diff -= hours * (1000 * 60 * 60);

	var minutes = Math.floor(diff / (1000 * 60));
	diff -= minutes * (1000 * 60);

	var seconds = Math.floor(diff / (1000));
	diff -= seconds * (1000);

	return days > 0
		? 'More than ' + days + 'days since last communication'
		: zeroPad(hours) + ':' + zeroPad(minutes) + ':' + zeroPad(seconds) + '.' + zeroPad(diff);
}

function setMTLSOptions(websocketClientConfig) {
	const haClientTLSConfig = config.get('websocket.auth.tlsOptions');

	websocketClientConfig.tlsOptions = {
		cert: fs.readFileSync(haClientTLSConfig.cert),
		key: fs.readFileSync(haClientTLSConfig.key),
		ca: fs.readFileSync(haClientTLSConfig.ca)
	};
}

//Avoid calling this function directly use scope.connectToRemoteManagements instead, as it has validations.
scope.connectToClusterManagement = function(remoteManagementId, ip, port, useSSL, callback) {
	var iport = ip + ':' + port;
	var outboundClusterConnections = app.get('mgmtOutboundClusterConnections');
	var connectionGUID = uuid.v1();

	logger.sysVERBOSE('HA', 'Trying to connect to management id: ' + remoteManagementId + ' at: ' + iport);

	if (!outboundClusterConnections[remoteManagementId]) {
		outboundClusterConnections[remoteManagementId] = {};
	} else {
		// if we already had a previous client connection, close it
		logger.sysDEBUG(`HA:Management ${remoteManagementId} already had a websocket connection, closing the previous connection`);
		const connection = outboundClusterConnections[remoteManagementId].connection;
		if (connection) {
			connection.close(1000, 'Mgmt reconnecting');
			connection.removeAllListeners();
		}
	}

	// we should re-use the same object
	outboundClusterConnections[remoteManagementId].guid = connectionGUID;
	outboundClusterConnections[remoteManagementId].creationDate = new Date();
	outboundClusterConnections[remoteManagementId].setLastResponse = function(d) {
		this.elapsedTimeSinceLastReponse = getTimespan(this.lastResponse, d);
		this.lastResponse = d;
	};
	outboundClusterConnections[remoteManagementId].status = consts.socketStatus.CONNECTING;
	outboundClusterConnections[remoteManagementId].isLoggedIn = false;

	const isUpToDateConnection = () => outboundClusterConnections[remoteManagementId].guid === connectionGUID;

	let websocketClientConfig = utils.extend(true, {}, config.get('websocket.clientConfig'));

	if (config.get('websocket.auth.useHAWithMTLS'))
		setMTLSOptions(websocketClientConfig);

	var client = new WebSocketClient(websocketClientConfig);
	var pingTimeout;
	var pingInterval;
	var prefix = (useSSL) ? 'wss' : 'ws';
	var address = `${prefix}://${ip}:${port}`;

	client.on('connectFailed', function(error) {
		if (!isUpToDateConnection())
			return logger.sysVERBOSE('HA', 'Management socket connection failed, but there\'s a new connection already, not handling the connectFailed event');

		logger.sysDEBUG(`HA:Could not connect to management on ${iport}. error: ${error}`);

		outboundClusterConnections[remoteManagementId].connection = null;
		outboundClusterConnections[remoteManagementId].status = consts.socketStatus.DISCONNECTED;
		outboundClusterConnections[remoteManagementId].isLoggedIn = false;
	});

	client.on('connect', function(connection) {
		if (!isUpToDateConnection())
			return logger.sysVERBOSE('HA', 'Management socket connect, but there\'s a new connection already, not handling the connect event');

		outboundClusterConnections[remoteManagementId].connection = connection;
		outboundClusterConnections[remoteManagementId].connectionTime = new Date();
		outboundClusterConnections[remoteManagementId].setLastResponse(new Date());
		outboundClusterConnections[remoteManagementId].status = consts.socketStatus.CONNECTED;
		outboundClusterConnections[remoteManagementId].isLoggedIn = false;

		logger.sysDEBUG(`HA:Connected to management on: ${iport}`);

		eventsModule.emitEvent(null, objectNotifier.events.connectedToClusterManagementEvent, { managementId: remoteManagementId });

		function onClose() {
			if (!isUpToDateConnection())
				return logger.sysVERBOSE('HA', 'Management socket closed, but there\'s a new connection already, not handling the close event');

			logger.sysVERBOSE('HA', 'Management on: ' + iport + ':  disconnected from cluster WebSocket Client');

			outboundClusterConnections[remoteManagementId].status = consts.socketStatus.DISCONNECTED;
			outboundClusterConnections[remoteManagementId].isLoggedIn = false;

			objectNotifier.updateCache();
			clearTimeout(pingTimeout);
		}

		function sendMessage(msg) {
			logger.sysVERBOSE('HA', 'Sending Message to Management on: ' + iport, msg);
			connection.sendUTF(msg.serialize());
		}

		function sendRegistrationMessage(eventsToRegister) {
			logger.sysVERBOSE('HA', 'I\'m registering on events ' + eventsToRegister.join(', ') + ' on management: ' + ip + ':' + port);
			const regMsg = new RegisterToEventsMessage(eventsToRegister, scope.getRegistrant(), connection.accessToken);
			sendMessage(regMsg);
		}

		function setKeepAliveTimeout() {
			return setTimeout(function() {
				logger.sysVERBOSE('HA', 'client keep-alive failed');
				connection.drop(1001, 'client keep-alive failed');
			}, config.get('websocket.keepAliveTimeout'));
		}

		pingTimeout = setKeepAliveTimeout();

		connection.on('pong', function() {
			clearTimeout(pingTimeout);
			pingTimeout = setKeepAliveTimeout();
			outboundClusterConnections[remoteManagementId].setLastResponse(new Date());

			pingInterval = setTimeout(function() {
				connection.ping('ping');
			}, config.get('websocket.keepAliveInterval'));
		});

		connection.ping('ping');

		connection.on('error', function(error) {
			logger.sysDEBUG(`HA:WebSocketClient Connection Error: ${error.toString()}`);
		});

		connection.on('close', function(reasonCode, description) {
			logger.sysDEBUG(`HA:WebSocketClient Connection Closed: reasonCode: ${reasonCode}, description:${description}`);
			clearTimeout(pingInterval);
			clearTimeout(pingTimeout);
			onClose();
		});

		connection.on('message', function(message) {
			outboundClusterConnections[remoteManagementId].setLastResponse(new Date());
			var obj = utils.tryParseJSON(message.utf8Data);

			function sendNewManagementInClusterEvent() {
				const trigEventMsg = new TriggerEvent(
					null,
					objectNotifier.events.newManagementInClusterEvent.name,
					scope.getOwnClusterManagement(),
					scope.getRegistrant(),
					connection.accessToken
				);
				sendMessage(trigEventMsg);
			}

			function sendUnregisterMessage(eventsToUnregister) {
				logger.sysVERBOSE('HA', 'I\'m unregistering from events ' + eventsToUnregister.join(', ') + ' on management: ' + ip + ':' + port);
				const unregMsg = new UnregisterFromEvents(
					eventsToUnregister,
					scope.getRegistrant(),
					connection.accessToken
				);

				sendMessage(unregMsg);
			}

			if (!obj) {
				logger.sysDEBUG(`Received Malformed JSON message from ${ip}:${port}`, message.utf8Data);
				return sendMessage(new ErrorResponse(consts.websocketErrors.MALFORMED_JSON, `Malformed JSON: ${JSON.stringify(obj)}`));
			}

			logger.sysVERBOSE('HA', 'Received this message from ' + iport, obj);

			if (!outboundClusterConnections[remoteManagementId].isLoggedIn) {
				if (obj.payload.error || !obj.payload.success) {
					new SystemAdminMessage(systemMessages.WEBSOCKET_HA_LOGIN_FAILURE)
						.addInfo(Entities.Error, obj.err).addInfo(Entities.Iport, iport).addInfo(Entities.UseSSL, useSSL).log();

				} else {
					logger.sysVERBOSE('HA', 'Cluster WebSocket Logged In to management on: ' + iport);
					connection.accessToken = obj.payload.accessToken;

					outboundClusterConnections[remoteManagementId].accessToken = obj.payload.accessToken;
					outboundClusterConnections[remoteManagementId].registerToClusterEvents = sendRegistrationMessage;
					outboundClusterConnections[remoteManagementId].unregisterFromClusterEvents = sendUnregisterMessage;
					outboundClusterConnections[remoteManagementId].isLoggedIn = true;

					sendNewManagementInClusterEvent();
					sendRegistrationMessage(Object.keys(websocketCommon.getRemoteMonitoredEvents()));

					// update cache in-case this management connection was lost before
					// and events happened when the connection was down
					objectNotifier.updateCache();
				}
			} else {
				if (obj.messageType == consts.websocketMessageTypes.eventResponse) {
					var event = obj.payload;

					if (!event) {
						logger.sysVERBOSE('HA', 'Received an abnormal message!', obj);
						return;
					}

					logger.sysVERBOSE('HA', 'triggering event ' + event.eventName + ' from websocket client');

					//We have an already processed eventObject so we don't need to call emitEvent
					//We can already call the "raw" emitOnAllSockets
					event.triggeredBy = { type: consts.originTypes.MANAGEMENT, id: remoteManagementId };
					eventsModule.emitOnAllSockets(event.eventName, event);
				} else if (obj.messageType == consts.websocketMessageTypes.errorResponse) {
					logger.sysVERBOSE('HA', 'Received errorResponse message', obj);
					// 1003 - Unprocessable data
					connection.close(1003, `Recieved unexpected errorResponse - Closing the connection to ws server ${iport}`);
				} else {
					logger.sysVERBOSE('HA', 'I was expecting only events here, but I got from management ' + ip + ':' + port + ' this:', obj);
				}
			}
		});

		function login() {
			if (connection.connected) {
				// when useHAWithMTLS enabled email and password are ignored
				logger.sysVERBOSE('HA', 'trying to login to management on ' + iport);
				var { email, password } = config.get('websocket.auth.credentials');
				sendMessage(new LoginMessage(email, password, scope.getRegistrant()));
			}
		}

		login();
	});

	logger.sysVERBOSE('HA', 'Trying to connect to: ' + address);
	client.connect(address);

	if (callback)
		callback();
};

scope.joinManagementCluster = function(cb) {
	//do transaction-like sequence:
	//1. Insert this management to the cluster document
	//2. Get all other management nodes
	//3. Connect to management cluster with websocket
	//4. Detect and recover from caching synchronization issues
	async.waterfall([
		insertThisManagementToCluster,
		registerToClusterManagementsEvents,
		monitorCacheSynchronization,
		managementClusterModule.pollForInactiveManagementsAndRunSanityAndRecover
	], function(err) {
		if (err) {
			err = new SystemMessage(systemMessages.WEBSOCKET_HA_JOIN_MANAGEMENTS_CLUSTER_FAILURE).addInfo(Entities.Error, err).log();
		} else
			logger.sysDEBUG('Management joined cluster successfully, and is listening to cluster events');

		if (cb)
			cb(err);
	});
};

function checkForOutOfSyncManagementsAndSync(cb) {
	var outboundConnections = app.get('mgmtOutboundClusterConnections');
	const db = app.get('db');
	const managementClusterCollection = db.collection('managementCluster');
	const managementId = app.get('managementId');

	async.series([
		function(callback) {
			updateOrInsertManagementToCluster(managementId, callback);
		},
		function(callback) {
			var nin = [managementId];

			for (var mgmt in outboundConnections)
				if (outboundConnections[mgmt].status == consts.socketStatus.CONNECTED)
					nin.push(mgmt);

			const notMeOrMgmtsImConnectedTo = { $nin: nin };

			const isAlive = {
				$gt: [
					'$dateModified',
					{ $dateSubtract: { startDate: '$$NOW', unit: 'minute', amount: consts.MANAGEMENT_TIMED_OUT_INTERVAL_IN_MINUTES } }
				]
			};

			managementClusterCollection.find({
				_id: notMeOrMgmtsImConnectedTo,
				$expr: isAlive
			}).toArray(function(err, aliveButDicsonnectedMgmts) {
				if (err)
					new MongoError(err).log();

				if (aliveButDicsonnectedMgmts && aliveButDicsonnectedMgmts.length > 0) {
					logger.sysDEBUG('Detected possible communication problem between me: ' + managementId +
						' and: ' + aliveButDicsonnectedMgmts[0]._id + ' Syncing myself from DB.');

					return objectNotifier.updateCache(callback);
				}

				callback();
			});
		},
		function(callback) {
			registerToClusterManagementsEvents(function() {
				callback();
			});
		}
	], cb);
}

//1.Log that I'm alive.
//2.Get all the managements that I'm not connected to them and was active in the past 5 minutes.
function monitorCacheSynchronization(cb) {
	checkForOutOfSyncManagementsAndSync(() => {
		setInterval(checkForOutOfSyncManagementsAndSync, config.get('websocket.serverConfig.outOfSyncInterval'));
		cb();
	});
}

scope.getOwnClusterManagement = () => {
	const ipAddress = app.get('ipAddress');
	const hostname = app.get('hostname');
	const port = config.get('webSocketServerPort');
	const managementVersion = app.get('managementVersion');
	const changeID = app.get('changeID');
	const bootVersion = app.get('bootVersion');
	const managementId = app.get('managementId');
	const rpmVersion = app.get('rpmVersion');

	return {
		_id: managementId,
		ip: ipAddress,
		port: port,
		hostname: hostname,
		useSSL: config.get('useSSL'),
		managementVersion: managementVersion,
		changeID: changeID,
		wsProtocolVersion: consts.WS_PROTOCOL_VERSION,
		bootVersion: bootVersion,
		nonLatestVersion: true,
		featureCompatibilityVersion: app.get('managementCompatibilityVersion'),
		rpmVersion: rpmVersion
	};
};

function updateOrInsertManagementToCluster(managementId, cb) {
	const db = app.get('db');
	const managementClusterCollection = db.collection('managementCluster');

	managementClusterCollection.findOneAndUpdate(
		{ _id: managementId },
		{
			$currentDate: { dateModified: true }, //using mongo server clock to prevent time drift errors
			$setOnInsert: scope.getOwnClusterManagement()
		},
		{ upsert: true },
		(err, dbMgmt) => {
			if (err)
				new MongoError(err).log();

			// if updated -> set to the value from the db
			// if inserted -> set to true
			app.set('nonLatestVersion', dbMgmt ? dbMgmt.nonLatestVersion : true);

			if (!dbMgmt) {
				// if inserted -> check for non latest managements
				checkForNonLatestManagements(cb);
			} else {
				cb();
			}
		}
	);
}

function checkForNonLatestManagements(cb) {
	const db = app.get('db');
	const managementClusterCollection = db.collection('managementCluster');
	const managementId = app.get('managementId');
	const managementVersion = app.get('managementVersion');
	const myMgmtVersion = getVRPartsObj(managementVersion).version;

	managementClusterCollection.find({ _id: { $ne: managementId } }).toArray((err, managements) => {
		if (err) {
			new MongoError(err).log();
			return cb(err);
		}

		const olderManagements = [];
		const newerManagementsIDs = [];

		managements.forEach(mgmt => {
			const mgmtVersion = getVRPartsObj(mgmt.managementVersion).version;
			const comparison = compareVersions(mgmtVersion, myMgmtVersion);

			if (comparison < 0) {
				olderManagements.push(mgmt);
			} else if (comparison > 0) {
				newerManagementsIDs.push(mgmt._id);
			}
		});

		async.parallel([
			function(callback) {
				if (newerManagementsIDs.length) {
					return callback();
				}

				logger.sysDEBUG('No managements with a newer version than me. setting nonLatestVersion to false...');
				managementClusterCollection.updateOne(
					{ _id: managementId },
					{ $set: { nonLatestVersion: false } },
					(err) => {
						if (err) {
							new MongoError(err).log();
							return callback(err);
						}

						callback();
					}
				);
			},
			function(callback) {
				if (!olderManagements.length) {
					return callback();
				}

				async.each(olderManagements, function(mgmt, cb) {
					const mgmtVersion = getVRPartsObj(mgmt.managementVersion).version;

					// update only if the version didn't change
					managementClusterCollection.updateOne(
						{ _id: mgmt._id, managementVersion: { $regex: `^${mgmtVersion}.*` } },
						{ $set: { nonLatestVersion: true } },
						(err, result) => {
							if (err) {
								new MongoError(err).log();
								return cb(err);
							}
							if (result.modifiedCount > 0) {
								logger.sysDEBUG(`Identified a management with a non latest version, nonLatestVersion has been updated to true.
								ID: ${mgmt._id}, Version: ${mgmt.managementVersion}`);
							}

							cb();
						}
					);
				}, function(err) {
					callback(err);
				});
			}
		], function(err) {
			if (err) return cb(err);

			cb();
		});
	});
}


function insertThisManagementToCluster(cb) {
	const db = app.get('db');
	const managementClusterCollection = db.collection('managementCluster');
	const managementId = app.get('managementId');
	const ipAddress = app.get('ipAddress');
	const port = config.get('webSocketServerPort');
	const bootVersion = app.get('bootVersion');

	logger.sysDEBUG(`my management ID: ${managementId}, my bootVersion: ${bootVersion}`);

	managementClusterCollection.deleteMany({ ip: ipAddress, port: port }, function() {
		// pay attention that managementId contains the ipAddress and the port so the managementCluster doc of managementId is deleted
		updateOrInsertManagementToCluster(managementId, cb);
	});
}

/**
 * Validating remote management has a supported websocket protocol version
 */
scope.shouldConnectToRemoteManagement = (clusterManagement) => {
	const isProtocolSupported = websocketCommon.isProtocolVersionSupported(clusterManagement.wsProtocolVersion);

	if (!isProtocolSupported)
		new SystemMessage(systemMessages.MANAGEMENT_HA_WS_PROTOCOL_UNSUPPORTED)
			.addInfo(Entities.ManagementID, clusterManagement._id)
			.addInfo(Entities.ManagementHostname, clusterManagement.hostname)
			.addInfo(Entities.WSProtocolVersion, clusterManagement.wsProtocolVersion, Differentiators.Remote)
			.addInfo(Entities.WSProtocolVersion, consts.WS_PROTOCOL_VERSION, Differentiators.Local)
			.addInfo(Entities.ChangeID, clusterManagement.changeID, Differentiators.Remote)
			.addInfo(Entities.ChangeID, app.get('changeID'), Differentiators.Local)
			.addInfo(Entities.ManagementVersion, clusterManagement.managementVersion, Differentiators.Remote)
			.addInfo(Entities.ManagementVersion, app.get('managementVersion'), Differentiators.Local)
			.addInfo(Entities.ConnectionDirection, consts.connectionDirection.OUT)
			.log();

	return isProtocolSupported;
};

scope.connectToRemoteManagements = (managements, callback) => {
	const CONNECTION_TIMEOUT = 10000;
	async.each(managements, function(management, callback) {
		var outboundClusterConnections = app.get('mgmtOutboundClusterConnections');
		var remoteManagementId = management.ip + ':' + management.port;
		var remoteManagement = outboundClusterConnections[remoteManagementId];

		if (!remoteManagement ||
			(remoteManagement.status !== consts.socketStatus.CONNECTED ||
				remoteManagement.status === consts.socketStatus.CONNECTING &&
				(!remoteManagement.elapsedTimeSinceLastReponse || (new Date() - remoteManagement.elapsedTimeSinceLastReponse) > CONNECTION_TIMEOUT))) {

			if (remoteManagement && remoteManagement.status === consts.socketStatus.CONNECTING) {
				logger.sysVERBOSE('HA', 'It seems that we\'re trying to connect to management: ' + remoteManagementId +
					' for more than: ' + CONNECTION_TIMEOUT + 'ms. Closing the connection and retrying');
				if (remoteManagement.connection)
					remoteManagement.connection.close();
			}

			scope.connectToClusterManagement(remoteManagementId, management.ip, management.port, management.useSSL, callback);
		} else {
			logger.sysVERBOSE('HA', 'It seems that we don\'t need to connect to this management', management);
			callback();
		}
	}, callback);
};

function registerToClusterManagementsEvents(cb) {
	var db = app.get('db');
	var managementClusterCollection = db.collection('managementCluster');

	var managementId = app.get('managementId');
	var outboundConnections = app.get('mgmtOutboundClusterConnections');

	var nin = [managementId];

	for (var mgmt in outboundConnections)
		if (outboundConnections[mgmt].status === consts.socketStatus.CONNECTED) {
			//Check for zombie bug
			if (!outboundConnections[mgmt].isLoggedIn)
				logger.sysDEBUG('It seems like although I\'m connected to ' + mgmt +
					' I\'m not logged in to it. In case this message reoccure a lot it may indicate a problem in ' + mgmt);

			nin.push(mgmt);
		}

	logger.sysVERBOSE('HA', 'Validating I\'m connected to all managements. skipping', nin);

	const mgmtIsAlive = {
		$gt: [
			'$dateModified',
			{ $dateSubtract: { startDate: '$$NOW', unit: 'minute', amount: consts.MANAGEMENT_TIMED_OUT_INTERVAL_IN_MINUTES } }
		]
	};

	managementClusterCollection.find({ _id: { $nin: nin }, $expr: mgmtIsAlive }).toArray(function(err, clusterManagements) {
		if (err)
			new MongoError(err).log();

		// Validating connection to managements with same version
		clusterManagements = clusterManagements.filter((clusterManagement) => {
			return scope.shouldConnectToRemoteManagement(clusterManagement);
		});

		if (clusterManagements && clusterManagements.length) {
			logger.sysVERBOSE('HA', 'calling connectToRemoteManagements with: ', clusterManagements);
			scope.connectToRemoteManagements(clusterManagements, () => {
				cb();
			});
		} else
			cb();
	});
}

module.exports = scope;
