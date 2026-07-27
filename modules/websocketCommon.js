/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* global app */
var uuid = require('uuid');

var consts = require('../consts.js');
var logger = require('../logger.js');
var utils = require('../utils.js');
var config = require('./config.js');
const { LoginResponse } = require('../models/websocketMessages/LoginResponse.js');
const { ErrorResponse } = require('../models/websocketMessages/ErrorResponse.js');
const { clearExecutionTimers } = require('../models/executionTimer.js');

var scope = {};

scope.concurrentConnections = {};
var registeredToEvents = {};
scope.registeredToEvents = registeredToEvents;

// this is a list of all events the management needs to listen to on the cluster.
var remoteMonitoredEvents = {};
scope.remoteMonitoredEvents = remoteMonitoredEvents;
var socketsWithPendingClusterEventSubscriptions = {};

scope.addNewSocketIO = function(socketClientID, onEventCallback) {
	socketsWithPendingClusterEventSubscriptions[socketClientID] = {
		id: socketClientID,
		onEventCallback: onEventCallback,
		events: {}
	};
};

scope.removeSocketIO = function(socketClientID) {
	delete socketsWithPendingClusterEventSubscriptions[socketClientID];

	// if no sockets left for the GUI - clear execution timers in case one of them had recording on
	if (!socketsWithPendingClusterEventSubscriptions || !Object.keys(socketsWithPendingClusterEventSubscriptions).length)
		clearExecutionTimers();
};

scope.addEventsToPendingClusterEventSubscriptions = function(socketClientId, events, eventSubscriptionMode) {
	if (!events || !events.length)
		return;

	// skip if the socket was closed
	if (!(socketClientId in socketsWithPendingClusterEventSubscriptions))
		return;

	var socketToEventsObj = socketsWithPendingClusterEventSubscriptions[socketClientId];
	events.forEach(function(eventName) {
		if (!(eventName in socketToEventsObj.events))
			socketToEventsObj.events[eventName] = {};

		socketToEventsObj.events[eventName].subscriptionMode = eventSubscriptionMode;
		socketToEventsObj.events[eventName].dirty = true;
	});
};

scope.handleClusterEventSubscriptions = function(cb) {
	if (cb)
		cb();

	setTimeout(function() {
		for (var socketClientID in socketsWithPendingClusterEventSubscriptions) {
			var eventsToRegister = [];
			var eventsToUnRegister = [];
			var socketToEventsObj = socketsWithPendingClusterEventSubscriptions[socketClientID];

			for (var eventName in socketToEventsObj.events) {
				// delete already handled event subscription and skip
				if (!socketToEventsObj.events[eventName].dirty) {
					delete socketToEventsObj.events[eventName];
					continue;
				}

				socketToEventsObj.events[eventName].dirty = false;

				if (socketToEventsObj.events[eventName].subscriptionMode == consts.eventSubscriptionModes.REGISTER)
					eventsToRegister.push(eventName);
				else
					eventsToUnRegister.push(eventName);
			}

			if (eventsToRegister.length)
				scope.registerToEvents(socketClientID, 'GUI', eventsToRegister, true, socketToEventsObj.onEventCallback);

			if (eventsToUnRegister.length)
				scope.unregisterFromEvents(socketClientID, 'GUI', eventsToUnRegister, true);
		}

		scope.handleClusterEventSubscriptions();
	}, consts.SOCKET_IO_EVENTS_SUBSCRIPTION_INTERVAL);
};

scope.addDefaultRemoteMonitoredEvents = function(monitoredEvents) {
	for (var eventName in monitoredEvents)
		remoteMonitoredEvents[eventName] = { eventName: eventName, refCount: 1, default: true };
};

scope.getRemoteMonitoredEvents = function() {
	return remoteMonitoredEvents;
};

scope.getRegisterToEventsID = function(id, connectionGUID) {
	return id + '_' + connectionGUID;
};

scope.isProtocolVersionSupported = function(protocolVersion) {
	const wsAPIVersion = consts.WS_PROTOCOL_VERSION;
	return wsAPIVersion == protocolVersion;
};

scope.checkMessageRequiredFields = function(connection, obj) {
	if (!obj) {
		connection.sendUTF(new ErrorResponse(consts.websocketErrors.MALFORMED_JSON, `Malformed JSON: ${obj}`, obj.registrant).serialize());
		return false;
	}

	if (!obj.registrant || !obj.registrant.id) {
		connection.sendUTF(new ErrorResponse(consts.websocketErrors.MISSING_REGISTRANT_ID, 'Missing registrant.id', null).serialize());
		return false;
	}

	return true;
};

scope.handleRawSocketRequest = function(req, handleNewConnectionFunc) {
	if (!scope.concurrentConnections[req.remoteAddress])
		scope.concurrentConnections[req.remoteAddress] = { global: 0 };

	scope.concurrentConnections[req.remoteAddress].global++;

	var connection = req.accept(null, req.origin);
	connection.connectionsCounter = scope.concurrentConnections[req.remoteAddress].global;

	handleNewConnectionFunc(connection, req.remoteAddress);
};

scope.registerToEvents = function(id, registrantType, events, clusterEventsEnabled, cb) {
	var ee = app.get('eventEmitter');
	var registrantId = registrantType ? id + registrantType : id;

	var alreadyRegisteredEvents = (registeredToEvents[registrantId] || [])
		.map(function(rte) { return rte.event; })
		.filter(function(e) { return events.indexOf(e) !== -1; });

	if (alreadyRegisteredEvents.length)
		scope.unregisterFromEvents(id, registrantType, alreadyRegisteredEvents, clusterEventsEnabled);

	if (!registeredToEvents[registrantId])
		registeredToEvents[registrantId] = [];

	//Register to events
	events.forEach(function(event) {
		ee.on(event, cb);
		registeredToEvents[registrantId].push({ event: event, cb: cb });
	});

	//Register on cluster
	if (clusterEventsEnabled && registrantType != consts.originTypes.MANAGEMENT && events.length != 0) {
		scope.registerToClusterEvents(registrantId, events);
	}
};

// unregister from all socket by id (uuid) - unregistering from all it's registrant types events
scope.unregisterFromAllSocketEvents = function(connID, clusterEventsEnabled) {
	const registrantsToUnregister = Object.keys(registeredToEvents).filter(registrantId => registrantId.startsWith(connID));

	// iterating over all the registrant types that were using the same socket id to register on events
	registrantsToUnregister.forEach(function(idWithRegistrant) {
 		scope.unregisterFromEvents(idWithRegistrant, null, null, clusterEventsEnabled);
	});
};

scope.unregisterFromEvents = function(id, registrantType, events, clusterEventsEnabled) {
	var ee = app.get('eventEmitter');
	var registrantId = registrantType ? id + registrantType : id;
	var clusterEventsToUnregister = [];
	//If none specificed unregister all the events.
	if (!events)
		clusterEventsToUnregister = registeredToEvents[registrantId] ? registeredToEvents[registrantId].map(function(e) { return e.event; }) : [];

	(events || clusterEventsToUnregister).forEach(function(event) {
		if (registeredToEvents[registrantId]) {
			var eventWithCallback = registeredToEvents[registrantId].filter(function(e) { return e.event == event; })[0];
			registeredToEvents[registrantId] = registeredToEvents[registrantId].filter(function(e) { return e.event != event; });

			if (registeredToEvents[registrantId] && !registeredToEvents[registrantId].length)
				delete registeredToEvents[registrantId];

			if (eventWithCallback) {
				clusterEventsToUnregister.push(event);
				ee.removeListener(eventWithCallback.event, eventWithCallback.cb);
			}
		} else
			logger.sysDEBUG('Received unregister message, although the client is not registered to those events! probably multiple unregistration');
	});

	const isManagement = registrantType == consts.originTypes.MANAGEMENT || registrantId.endsWith(consts.originTypes.MANAGEMENT);
	if (clusterEventsEnabled && !isManagement)
		scope.unregisterFromClusterEvents(registrantId, clusterEventsToUnregister);
};

scope.registerToClusterEvents = function(id, eventsToRegister) {
	var newMonitoredEvents = [];

	// for each event decrement refCount. if 0, unregister from cluster
	if (id && !id.startsWith('GUI_client_'))
		logger.sysDEBUG('registerToClusterEvents: ' + id + ' is registering these events: ' + eventsToRegister.join(','));

	eventsToRegister.forEach(function(eventName) {
		if (!(eventName in remoteMonitoredEvents) || remoteMonitoredEvents[eventName].refCount == 0) {
			if (id && !id.startsWith('GUI_client_'))
				logger.sysVERBOSE('HA', 'I\'m adding event ' + eventName + ' to the remotely monitored events since ' + id + ' registered to it on me');
			remoteMonitoredEvents[eventName] = { eventName: eventName, refCount: 1 };
			newMonitoredEvents.push(eventName);
		} else {
			remoteMonitoredEvents[eventName].refCount += 1;
			if (id && !id.startsWith('GUI_client_'))
				logger.sysVERBOSE('HA', ' refCount is ' + remoteMonitoredEvents[eventName].refCount);
		}
	});

	// register to the event on each management from cluster
	if (newMonitoredEvents.length > 0) {
		var outboundClusterConnections = app.get('mgmtOutboundClusterConnections');

		if (outboundClusterConnections && Object.keys(outboundClusterConnections).length)
			for (var managementID in outboundClusterConnections)
				if (outboundClusterConnections[managementID].connection) {
					if (outboundClusterConnections[managementID].accessToken)
						outboundClusterConnections[managementID].registerToClusterEvents(newMonitoredEvents);
					else {
						// stale connection without accessToken - we'll close it
						logger.sysVERBOSE('HA', 'Can\'t register on remote, no accessToken, closing the connection');
						outboundClusterConnections[managementID].connection.drop(1001, 'Error - AccessToken message not received');
					}
				} else
					logger.sysVERBOSE('HA', 'Can\'t register on remote, not connected yet');
		else
			logger.sysVERBOSE('HA', 'Can\'t register on remote as the outboundClusterConnection is empty');

	}
};

scope.unregisterFromClusterEvents = function(id, eventsToRemove) {
	// for each event decrement refCount. if 0, unregister from cluster
	if (id && !id.startsWith('GUI_client_'))
		logger.sysVERBOSE('HA', 'unregisterFromClusterEvents: ' + id + ' is unregistering these events: ' + eventsToRemove.join(','));

	// reduce refCount
	var monitoredEvents = eventsToRemove.filter(function(eventName) {
		return eventName in remoteMonitoredEvents;
	}).map(function(eventName) {
		return remoteMonitoredEvents[eventName];
	});

	monitoredEvents.forEach(function(eventEntry) {
		eventEntry.refCount -= 1;
	});

	// get all that reached zero
	var eventsToUnregister = monitoredEvents.filter(function(eventEntry) {
		return eventEntry.refCount <= 0 && !eventEntry.default; // should be == 0
	});

	// unregister from cluster
	if (eventsToUnregister.length > 0) {
		var outboundClusterConnections = app.get('mgmtOutboundClusterConnections');
		var eventNamesArray = eventsToUnregister.map(function(event) { return event.eventName; });

		if (outboundClusterConnections && Object.keys(outboundClusterConnections).length)
			for (let managementID in outboundClusterConnections)
				if (outboundClusterConnections[managementID].connection)
					outboundClusterConnections[managementID].unregisterFromClusterEvents?.(eventNamesArray);
	}

	// delete key from monitored events
	eventsToUnregister.forEach(function(eventEntry) {
		delete remoteMonitoredEvents[eventEntry.eventName];
	});
};

scope.isConnectionChanged = function(id, authConn, connectionGUID, skipValidation) {
	if (!skipValidation && authConn.guid !== connectionGUID) {
		logger.sysDEBUG('It seems that we already got new connection from this host. Not handling the close event',
			{ onCloseGUID: connectionGUID, authConnGUID: authConn.guid, host: id });

		return true;
	}

	return false;
};

scope.authWebsocketClientCert = function(connection, callback) {
	let clientCert = connection.socket.getPeerCertificate();
	if (!clientCert)
		return callback('Unauthorzied - Certificate not provided', null);

	utils.authenticateClientCert(clientCert, (err, user) => {
		if (err)
			return callback('Error while trying to authenticate using client certificates. Error: ' + err, null);

		if (!user)
			return callback('Unauthorzied - Failed to authenticate using client certificates', null);

		callback(null, user);
	});
};

scope.autenticateWebsocketClient = function(connection, msg, callback) {
	const httpsServerAuthenticationMethod = config.get('server.auth.authenticationMethod');
	if (httpsServerAuthenticationMethod === consts.HTTPSServerAuthenticationMethods.CREDENTIALS)
		return utils.authenticate(msg.payload.username, msg.payload.password, callback);
	else if (httpsServerAuthenticationMethod === consts.HTTPSServerAuthenticationMethods.MTLS)
		return scope.authWebsocketClientCert(connection, callback);
	else
		return callback('Unknown server.auth.authenticationMethod in config', null);
};

scope.handleLoginMessage = function(connection, authorizedConnections, obj, remoteAddress, handleLoginWhenOldSocketStillExistsFunc, postLoginFunc) {
	let authMethodCreds = config.get('server.auth.authenticationMethod') === consts.HTTPSServerAuthenticationMethods.CREDENTIALS;
	if (authMethodCreds && (!obj.payload.username || !obj.payload.password))
		return connection.sendUTF(new ErrorResponse(consts.websocketErrors.UNAUTHORIZED, 'Unauthorzied - Please login', obj.registrant).serialize());

	return scope.autenticateWebsocketClient(connection, obj, function(err, user) {
		if (err || !user) {
			err = 'Login failed - Incorrect credentials';
			return connection.sendUTF(new LoginResponse(false, err, null, obj.registrant).serialize());
		}

		if (!logger.sysDEBUG)
			logger = require('../logger.js');

		connection.id = obj.registrant.id.split('_')[0];
		logger.sysDEBUG('new login request from ' + connection.id + ' connGUID: ' + connection.guid);

		var accessToken = uuid.v1();

		if (scope.concurrentConnections[remoteAddress][obj.registrant.id] > connection.connectionsCounter) {
			logger.sysDEBUG('We authenticated a connection but the host has a newer connection', {
				cacheIndex: scope.concurrentConnections[remoteAddress][obj.registrant.id],
				connection: connection.connectionsCounter,
				registrantId: obj.registrant.id
			});

			connection.close();
			return;
		}

		if (scope.getAuthorizedConnection(obj.registrant.id)) {
			logger.sysDEBUG('we\'re handling a new connection from this host ' + connection.id +
				' but we didn\'t clean the authConn yet! connGUID: ' + connection.guid);

			return handleLoginWhenOldSocketStillExistsFunc();
		}

		authorizedConnections[connection.id] = {
			id: connection.id,
			accessToken: accessToken,
			registrants: {},
			user: user,
			ip: remoteAddress,
			guid: connection.guid,
		};

		if (postLoginFunc)
			postLoginFunc(accessToken);
	});
};

scope.getAuthorizedConnection = function(id) {
	var authConn;
	var authorizedConnections = app.get('authorizedConnections');

	if (id) {
		authConn = authorizedConnections[id];

		if (!authConn)
			logger.sysDEBUG(`Authorized connection could not be found in the cache for ID: ${id}`);
	}

	return authConn;
};

module.exports = scope;