/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

var async = require('async');

var consts = require('../consts.js');
var config = require('./config.js');
var utils = require('../utils.js');

var lockModule = require('./lock.js');
var sanityAndRecover = require('./sanityAndRecover.js');
var logger = require('../logger.js');

var { MongoError, SystemAdminMessage, Entities, SystemMessage } = require('./error.js');
const systemMessages = require('../systemMessages.js');

var scope = {};

scope.fetchManagementClusterByID = function(managementClusterID, cb) {
	utils.fetchEntityByID('managementCluster', managementClusterID, false, {}, systemMessages.MANAGEMENT_CLUSTER_NOT_FOUND, cb);
};

scope.deleteManagementFromClusterAndConfiguration = (managementId, callback) => {
	const db = app.get('db');
	const managementClusterCollection = db.collection('managementCluster');
	const confCollection = db.collection('configurationVersion');

	let result;

	async.series([
		function deleteManagementFromClusterCollection(cb) {
			managementClusterCollection.findOneAndDelete(
				{ _id: managementId },
				(err, res) => {
					if (err)
						new MongoError(err).log();
					else
						result = res;

					cb(err);
				});
		},
		function deleteManagementFromClusterDoc(cb) {
			confCollection.updateOne(
				{ _id: consts.CONFIG_VER_CLUSTER_ID },
				{ $unset: { [`managements.${managementId}`]: 1 } },
				err => {
					if (err)
						new MongoError(err).log();

					cb(err);
				}
			);
		}
	], err => callback(err, result));
};

scope.deleteManagementsFromCluster = function(managementIds, callback) {
	var outboundClusterConnections = app.get('mgmtOutboundClusterConnections');
	var inboundClusterConnections = app.get('mgmtInboundClusterConnections');
	var managementId = app.get('managementId');

	var results = [];

	async.eachSeries(managementIds, function(mgmtID, callback) {
		const createSystemAdminMessage = errorSystemMessage =>
			(errorSystemMessage
				? new SystemAdminMessage(systemMessages.DELETE_MANAGEMENT_FAILED)
					.addInfo(Entities.Error, errorSystemMessage instanceof SystemMessage ? errorSystemMessage : new SystemMessage(errorSystemMessage))
				: new SystemAdminMessage(systemMessages.DELETE_MANAGEMENT_SUCCESS))
				.addInfo(Entities.ManagementID, mgmtID);

		if (mgmtID === managementId) {
			results.push(createSystemAdminMessage(systemMessages.CANT_DELETE_OWN_MANAGEMENT));
			return callback();
		}

		if ((mgmtID in outboundClusterConnections && outboundClusterConnections[mgmtID].status !== consts.socketStatus.DISCONNECTED)
				|| mgmtID in inboundClusterConnections) {
			// refuse to delete managements in CONNECTED or CONNECTING status
			// if the management was stopped we will stop trying to reconnect after consts.MANAGEMENT_TIMED_OUT_INTERVAL_IN_MINUTES (5 minutes)
			results.push(createSystemAdminMessage(systemMessages.CANT_DELETE_CONNECTED_MANAGEMENT));
			return callback();
		}

		// http/https is not relevant here as checkIfRemoteManagementIsAlive is checking against ip/port only

		lockModule.checkIfRemoteManagementIsAlive(mgmtID, function(isAlive) {
			if (isAlive) {
				results.push(createSystemAdminMessage(systemMessages.CANT_DELETE_CONNECTED_MANAGEMENT));
				return callback();
			}

			scope.deleteManagementFromClusterAndConfiguration(mgmtID, (err, result) => {
				if (err) {
					results.push(createSystemAdminMessage(new MongoError(err).log()));
				} else if (!result) {
					results.push(createSystemAdminMessage(systemMessages.CANT_FIND_MANAGEMENT));
				} else {
					results.push(createSystemAdminMessage());
				}

				callback();
			});
		});
	}, function() {
		callback(results);
	});
};

//gets the cluster which is either unhandled or staled by other mgmt
function getStaleOrReadyCluster(cb) {
	var db = app.get('db');
	var versionCollection = db.collection('configurationVersion');
	var threshold = new Date();
	threshold.setMilliseconds(threshold.getMilliseconds() - (config.get('websocket.serverConfig.outOfSyncInterval') * 2));

	versionCollection.findOne({ _id: consts.CONFIG_VER_CLUSTER_ID, $or: [{ dateModified: { $exists: 0 } }, { dateModified: { $lt: threshold } }] }
		, (err, versionDoc) => {
			if (err)
				new MongoError(err).log();

			cb(versionDoc);
		});
}

scope.pollForInactiveManagementsAndRunSanityAndRecover = function(cb) {
	cb();

	const pollingTimeout = config.get('websocket.serverConfig.outOfSyncInterval') * 2;
	function timeoutFunc() {
		setTimeout(checkAndHandle, pollingTimeout);
	}

	function checkAndHandle() {
		getStaleOrReadyCluster(cluster => {
			if (!cluster)
				timeoutFunc();
			else
				sanityAndRecover.tryToAcquireLock(cluster, currentMgmtClusterStateChangeVersion => {
					const managementIdAndBootVersion = `${app.get('managementId')}, bootVersion: ${app.get('bootVersion')}`;

					if (!currentMgmtClusterStateChangeVersion) {
						timeoutFunc();
					} else {
						logger.sysDEBUG(`Sanity and Recover lock acquired by ${managementIdAndBootVersion}, running.`);
						sanityAndRecover.run(() => { sanityAndRecover.releaseLock(currentMgmtClusterStateChangeVersion, timeoutFunc); });
					}
				});
		});
	}

	timeoutFunc();
};

module.exports = scope;
