/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global app*/

var async = require('async');

var utils = require('../utils.js');
var consts = require('../consts.js');
var profileScheme = require('./profileScheme.js');
var events = require('../events.js');
var objectNotifier = require('../objectNotifier.js');
var uuid = require('uuid');
var { Entities, SystemMessage, MongoError, SystemAdminMessage } = require('./error.js');
var systemMessages = require('../systemMessages.js');

var logger = require('../logger.js');
var kafkaModule = require('./kafka.js');
const { UpdateConfigProfile } = require('../models/kafkaMessages/UpdateConfigProfile.js');
var scope = {};

scope.afterModuleLoaded = () => {
	logger = require('../logger.js');
	events = require('../events.js');
	({ Entities, SystemMessage, MongoError, SystemAdminMessage } = require('./error.js'));
};

scope.getScheme = function(callback) {
	if (!profileScheme)
		return callback('Failed to load scheme file or scheme empty');

	callback(null, profileScheme);
};

scope.validateParameters = function(parametersDict) {
	let schemeDict = scope.getSchemeParametersDict();
	let errors = [];

	for (var key in parametersDict) {
		let parameterSchema = schemeDict[key];

		if (!parameterSchema) {
			errors.push(`Unsupported parameter ${key}`);
			continue;
		}

		let validator = parameterSchema.validationFunction;
		let value = parametersDict[key];
		let isMultiValue = parameterSchema.numOfValues === '*' || parameterSchema.numOfValues > 0;
		let hasPredefinedValues = parameterSchema.type == 'choice';

		if (isMultiValue && !Array.isArray(value)) {
			errors.push(`Parameter value has wrong type. param ${key} value "${value}" expected ${Array.name} but is not`);
			continue;
		}

		let values = isMultiValue ? value : [value];
		values.forEach(valueItem => {
			if (hasPredefinedValues) {
				if (!parameterSchema.options.includes(valueItem))
					errors.push(`Parameter value has wrong type. param ${key} value "${valueItem}" is not one of: ${parameterSchema.options}`);
			} else {
				if (typeof valueItem != parameterSchema.type)
					errors.push(`Parameter value has wrong type. param ${key} value "${valueItem}" `
						+ `expected ${parameterSchema.type} but got: ${typeof valueItem}`);
			}
		});

		if (!errors.length && validator)
			if (Array.isArray(value) ? !value.every(validator) : !validator(value))
				errors.push(`Parameter value validation failed for param ${key} value "${value}"`);
	}

	return errors;
};

scope.save = (profiles, user, callback) => {
	let messages = [];

	async.each(profiles, (profile, eachCallback) => {
		let profileID = profile.name;
		let profileUUID;
		delete profile.hosts;

		async.series([
			function validations(cb) {

				// validate Name
				let notAllowedNames = [
					consts.configurationProfile.defaults.NVMESH_DEFAULT,
					consts.configurationProfile.defaults.CLUSTER_DEFAULT,
					consts.configurationProfile.defaults.NVMESH_DEBUG
				];

				if (notAllowedNames.includes(profile.name))
					return cb(new SystemAdminMessage(systemMessages.CONFIG_PROFILE_NAME_NOT_ALLOWED));

				// validate params
				let errors = scope.validateParameters(profile.config);
				if (errors.length) {
					let err = `Config profile ${profile.name} parameters validation failed. Errors: ${errors.join(', ')}`;
					return cb(new SystemAdminMessage(systemMessages.CONFIG_PROFILE_VALIDATION_FAILED).addInfo(Entities.Error, err));
				}

				cb();
			},
			function addMetaFields(cb) {
				profile._id = profile.name;
				profile.uuid = uuid.v1();
				profile.createdBy = profile.modifiedBy = user.email;
				profile.dateCreated = profile.dateModified = new Date();
				profile.labels = profile.labels || [];
				profile.config = profile.config || {};

				cb();
			},
			function saveConfigurationProfileToDb(cb) {
				profile.version = 1;

				utils.insertToCollection(profile, 'configurationProfile', (err) => {
					if (err) {
						let systemMessage = err.isDuplicateKeyError ? systemMessages.CONFIG_PROFILE_ALREADY_EXISTS : systemMessages.CONFIG_PROFILE_SAVE_FAILED;
						return cb(new SystemAdminMessage(systemMessage));
					}

					profileUUID = profile.uuid;

					cb();
				});
			}
		], (err) => {
			const message = err ?
				new SystemAdminMessage(systemMessages.CONFIG_PROFILE_SAVE_FAILED).addInfo(Entities.Error, err) :
				new SystemAdminMessage(systemMessages.CONFIG_PROFILE_SAVED);
			message.addInfo(Entities.ConfigurationProfile.ID, profileID).addInfo(Entities.ConfigurationProfile.UUID, profileUUID);
			messages.push(message);

			eachCallback();
		});
	}, () => callback(messages));
};

scope.delete = function(profiles, callback) {
	var db = app.get('db');
	var configProfileCollection = db.collection('configurationProfile');
	var hostsToRevert = [];
	const messages = [];

	async.each(profiles, function(profile, eachCB) {
		var profileID = profile._id;
		var profileUUID = profile.uuid;

		async.waterfall([
			function fetchDoc(cb) {
				configProfileCollection.findOne({ _id: profileID, uuid: profileUUID }, function(err, docToBeRemove) {
					if (err)
						return cb(new MongoError(err));

					return cb(null, docToBeRemove);
				});
			},
			function deleteValidations(docToBeRemove, cb) {
				if (!docToBeRemove)
					return cb(new SystemMessage(systemMessages.CONFIG_PROFILE_DELETE_FAILED_NOT_FOUND));

				if (docToBeRemove.deleteNotAllowed)
					return cb(new SystemMessage(systemMessages.CONFIG_PROFILE_DELETE_FAILED_NOT_ALLOWED));

				cb(null, docToBeRemove);
			},
			function getNodes(docToBeRemove, cb) {
				scope.getNodeIDsPerProfile(docToBeRemove.name, docToBeRemove.uuid, (err, nodeIDs) => {
					if (err)
						return cb(err);

					hostsToRevert = hostsToRevert.concat(nodeIDs);
					cb();
				});
			},
			function(cb) {
				configProfileCollection.deleteOne({ _id: profileID, uuid: profileUUID, deleteNotAllowed: { $in: [null, false] } }, function(err) {
					if (err)
						err = new MongoError(err);

					cb(err);
				});
			}
		], function(err) {
			let message;

			if (err)
				message = new SystemAdminMessage(systemMessages.CONFIG_PROFILE_DELETE_FAILED).addInfo(Entities.Error, err);
			else
				message = new SystemAdminMessage(systemMessages.CONFIG_PROFILE_DELETED);

			message.addInfo(Entities.ConfigurationProfile.ID, profileID).addInfo(Entities.ConfigurationProfile.UUID, profileUUID);
			messages.push(message);
			eachCB();
		});
	}, function() {
		scope.applyClusterDefaultConfigurationToNodes(hostsToRevert, function(sysError) {
			if (sysError)
				logger.sysERROR(sysError);

			callback(messages);
		});
	});
};

scope.updateConfigurationProfiles = (profiles, user, callback) => {
	const db = app.get('db');
	const configProfileCollection = db.collection('configurationProfile');
	const messages = [];

	function updateConfigurationProfile(profile, eachCb) {
		const { _id, uuid } = profile;
		let isConfigurationChanged = false;
		delete profile.hosts;
		let prevProfile;

		async.series([
			function validations(cb) {
				let errors = scope.validateParameters(profile.config);
				if (errors.length) {
					let err = `Config profile ${_id} parameters validation failed. Errors: ${errors.join(', ')}`;
					let errMsg = new SystemAdminMessage(systemMessages.CONFIG_PROFILE_VALIDATION_FAILED)
						.addInfo(Entities.Error, err);
					return cb(errMsg);
				}

				cb();
			},
			cb => {
				const query = { _id, uuid };
				const update = { $set: {
					modifiedBy: user.email,
					dateModified: new Date()
				} };
				const options = { returnDocument: consts.mongoReturnDocument.BEFORE };

				if (profile.config) {
					query.editNotAllowed = { $ne: true };
					update.$set.config = profile.config;
					update.$set.version = { $cond: {
						if: { $setEquals: [{ '$objectToArray': '$config' }, { '$objectToArray': profile.config }] },
						then: '$version',
						else: { $add: ['$version', 1] }
					} };
				}

				if (profile.description)
					update.$set.description = profile.description;

				if (profile.labels)
					update.$set.labels = profile.labels;

				configProfileCollection.findOneAndUpdate(query, [update], options, (err, res) => {
					if (err)
						return callback(new MongoError(err).log());

					if (!res)
						return cb(new SystemMessage(systemMessages.CANT_FIND_CONFIG_PROFILE_TO_UPDATE));

					prevProfile = res;
					if (profile.config) {
						isConfigurationChanged = !utils.equalInValue(prevProfile.config, profile.config);
						if (isConfigurationChanged) {
							profile.version++;
						}
					}

					cb();
				});
			},
			function applyNewProfileVersionToExistingNodes(cb) {
				if (!isConfigurationChanged)
					return cb();

				scope.getNodeIDsPerProfile(profile.name, profile.uuid, (err, nodeIDs) => {
					if (err)
						return cb(err);

					scope.applyConfigurationToNodes(profile, nodeIDs, cb);
				});
			}
		], err => {
			const systemAdminMessage = (err
				? new SystemAdminMessage(systemMessages.CONFIG_PROFILE_UPDATE_FAILED).addInfo(Entities.Error, err)
				: new SystemAdminMessage(systemMessages.CONFIG_PROFILE_UPDATED))
				.addInfo(Entities.ConfigurationProfile.ID, _id)
				.addInfo(Entities.ConfigurationProfile.UUID, uuid);

			messages.push(systemAdminMessage);
			eachCb();
		});
	}

	async.each(profiles, updateConfigurationProfile, () => callback(messages));
};

scope.apply = function(profile, nodeIDs, user, callback) {
	let db = app.get('db');
	let configProfileCollection = db.collection('configurationProfile');
	let dbProfile = null;

	async.series([
		function fetchProfile(cb) {
			let query = { name: profile.name, uuid: profile.uuid };
			configProfileCollection.findOne(query, function(err, result) {
				if (err)
					return cb(new MongoError(err));

				if (!result)
					return cb(new SystemMessage(systemMessages.CONFIG_PROFILE_NOT_FOUND)
						.addInfo(Entities.ConfigurationProfile.name, profile.name)
						.addInfo(Entities.ConfigurationProfile.UUID, profile.uuid));

				dbProfile = result;
				cb();
			});
		},
		function applyProfile(cb) {
			scope.applyConfigurationToNodes(dbProfile, nodeIDs, cb);
		}
	], err => {
		const message = err ?
			new SystemAdminMessage(systemMessages.CONFIG_PROFILE_APPLY_FAILED).addInfo(Entities.Error, err)
			: new SystemAdminMessage(systemMessages.CONFIG_PROFILE_APPLIED);

		message.addInfo(Entities.ConfigurationProfile.ID, profile.name)
			.addInfo(Entities.ConfigurationProfile.UUID, profile.uuid);

		nodeIDs.forEach(nodeID => message.addInfo(Entities.Client.ID, nodeID));

		callback([message]);
	});
};

scope.applyClusterDefaultConfigurationToNodes = function(nodes, callback) {
	var db = app.get('db');
	var configProfileCollection = db.collection('configurationProfile');

	if (!callback)
		callback = function(){};

	if (!nodes || !nodes.length)
		return callback();

	configProfileCollection.findOne({ name: consts.configurationProfile.defaults.CLUSTER_DEFAULT }, function(err, clusterDefaultProfile) {
		if (err)
			return callback(new MongoError(err).addInfo(Entities.ConfigurationProfile.ID, consts.configurationProfile.defaults.CLUSTER_DEFAULT));

		scope.applyConfigurationToNodes(clusterDefaultProfile, nodes, callback);
	});
};

scope.applyConfigurationToNodes = function(configurationProfile, nodeIDs, callback) {
	if (!callback)
		callback = function(){};

	async.each(nodeIDs || [], function(nodeID, callback) {
		scope.applyConfigurationToNode(configurationProfile, nodeID, function(err) {
			callback(err);
		});
	}, callback);
};

scope.resendProfileToNode = function(nodeID, callback) {
	scope.getDesiredProfileByNodeID(nodeID, function(err, profile) {
		if (err)
			return callback(err);

		if (!profile)
			return scope.applyClusterDefaultConfigurationToNodes([nodeID], callback);

		scope.sendProfileToNode(nodeID, profile, function(err) {
			if (err)
				return callback(err);
		});
	});
};

scope.reapplyCurrentProfileToNode = function(nodeID, callback) {
	scope.getDesiredProfileByNodeID(nodeID, (err, fullProfile) => {
		scope.applyConfigurationToNode(fullProfile, nodeID, callback);
	});
};

function getOriginID(nodeID, cb) {
	var db = app.get('db');
	var clientCollection = db.collection('client');
	var projection = { agentOriginID: 1 };

	clientCollection.findOne(
		{ _id: nodeID },
		projection,
		(err, dbClient) => {
			if (err)
				err = MongoError(err);

			cb(err, dbClient?.agentOriginID);
		}
	);
}

scope.sendProfileToNode = function(nodeID, configurationProfile, callback) {
	var configProfileForNode = scope.getTranslatedProfileForNode(configurationProfile);
	getOriginID(nodeID, (err, agentOriginID) => {
		if (err)
			return callback(err);

		if (!agentOriginID) {
			logger.sysDEBUG('Failed to update node ConfigProfile: '
				+ 'No agentOriginID found on the client document. we will skip this profile update');
			return callback();
		}

		var msg = new UpdateConfigProfile(nodeID, configProfileForNode, agentOriginID);

		kafkaModule.sendMessages(
			cb => kafkaModule.getAgentMainTopic(nodeID, cb),
			[msg],
			callback
		);
	});
};

scope.applyConfigurationToNode = function(configurationProfile, nodeID, callback) {
	if (!nodeID)
		return callback(new SystemMessage(systemMessages.MISSING_NODE_ID_IN_CONFIGURATION_PROFILE));

	var db = app.get('db');
	var nodeConfigCollection = db.collection('nodeConfiguration');
	async.series([
		function setApplyingStatus(cb) {
			nodeConfigCollection.updateOne(
				{ _id: nodeID },
				{ $set: {
					status: consts.configurationProfile.status.APPLYING,
					desiredProfile: {
						id: configurationProfile.uuid,
						name: configurationProfile.name,
						version: configurationProfile.version
					}
				} },
				{ upsert: true },
				function(err, results) {
					if (err)
						return cb(new MongoError(err).addInfo(Entities.Target.ID, nodeID));

					if (!results.modifiedCount && !results.upsertedCount)
						logger.sysDEBUG(`Attempted to update node configuration status for node ${nodeID} but document was not update.`);

					cb(null);
				});
		},
		function sendConfigurationToHost(cb) {
			scope.sendProfileToNode(nodeID, configurationProfile, cb);
		}
	], function(err) {
		callback(err);
	});
};

scope.getTranslatedProfileForNode = function(configurationProfile) {

	var translatedParameters = scope.translateProfileParameters(configurationProfile.config);

	// Add Profile version details
	translatedParameters['CONFIG_PROFILE_ID'] = configurationProfile.uuid;
	translatedParameters['CONFIG_PROFILE_NAME'] = configurationProfile.name;
	translatedParameters['CONFIG_PROFILE_VERSION'] = configurationProfile.version;

	var translation = {
		name: configurationProfile.name,
		parameters: translatedParameters
	};

	return translation;
};

scope.translateProfileParameters = function(parametersDict) {
	const translatedDict = {};
	const schemeDict = scope.getSchemeParametersDict();

	for (const key in parametersDict){
		if (!schemeDict[key]) {
			logger.sysDEBUG(`Unsupported parameter ${key}`);
			continue;
		}
		translatedDict[key] = schemeDict[key].translationFunction ? schemeDict[key].translationFunction(parametersDict[key]) : parametersDict[key];
	}

	return translatedDict;
};

scope.getSchemeParametersDict = function() {
	var schemeDict = {};
	profileScheme.categories.forEach(function(cat) {
		cat.parameters.forEach(function(param) {
			schemeDict[param.name] = param;
		});
	});

	return schemeDict;
};

scope.getNodeConfigurationEntry = function(nodeID, callback) {
	var db = app.get('db');
	var nodeConfigCollection = db.collection('nodeConfiguration');
	nodeConfigCollection.findOne({ _id: nodeID }, function(err, nodeConfiguration) {
		if (err)
			err = new MongoError(err);

		callback(err, nodeConfiguration);
	});
};

scope.getDesiredProfileByNodeID = function(nodeID, callback) {
	scope.getNodeConfigurationEntry(nodeID, function(err, nodeConfiguration) {
		if (err)
			return callback(new MongoError(err));

		if (!nodeConfiguration)
			return callback(`Could not find nodeConfiguration entry for Node ${nodeID}`);

		if (!nodeConfiguration.desiredProfile)
			// The Node doesn't have a desired profile yet, this is not an error
			return callback(null, null);

		scope.getProfileByUUID(nodeConfiguration.desiredProfile.id, callback);
	});
};

scope.getProfileByUUID = function(profileUUID, callback) {
	var query = {
		filter: { uuid: profileUUID }
	};

	utils.loadCollection('configurationProfile', query, function(err, results) {
		callback(err, results ? results[0] : null);
	});
};

scope.getProfileByName = function(profileName, callback) {
	var query = {
		filter: { name: profileName }
	};

	utils.loadCollection('configurationProfile', query, function(err, results) {
		callback(err, results ? results[0] : null);
	});
};

scope.fetchProfileByID = function(profileID, cb) {
	const db = app.get('db');
	const configProfileCollection = db.collection('configurationProfile');

	configProfileCollection.findOne({ _id: profileID }, {}, (err, profile) => {
		if (err)
			return cb(new MongoError(err).log());

		if (!profile)
			return cb(new SystemMessage(systemMessages.CONFIG_PROFILE_NOT_FOUND));

		cb(null, profile);
	});
};

/**
 * returns a list of nodeConfigs of nodes for a given desiredProfile.
 * @param {string} profileName
 * @param {string} profileUUID
 * @param {function} callback
 * @returns {object} list of nodeConfigs in the format { _id: 'client-1', desiredProfile: {..}, status: APPLYING }
 */
scope.getNodeConfigsPerProfile = function(profileName, profileUUID, callback) {
	const db = app.get('db');
	const nodeConfigCollection = db.collection('nodeConfiguration');

	let query = { $or: [
		{
			'desiredProfile.id': profileUUID,
			'desiredProfile.name': profileName
		}
	] };

	nodeConfigCollection.find(query).toArray((err, results) => {
		if (err)
			return callback(new MongoError(err));

		callback(err, results);
	});
};

scope.getNodeIDsPerProfile = function(profileName, profileUUID, callback) {
	scope.getNodeConfigsPerProfile(profileName, profileUUID, (err, nodeConfigs) => {
		if (err)
			return callback(err);

		let nodeIDs = nodeConfigs.map(e => e._id);
		callback(err, nodeIDs);
	});
};

/** This function is called when the agent sent nodeConfigUpdate notifying the management
*	about node configuration being written to host .mgmt.nvmesh.conf
*/
scope.nodeConfigurationApplied = function(nodeID, profileInfo, callback) {
	logger.sysDEBUG(`Got nodeConfigUpdate from ${nodeID}`, profileInfo);

	// remove control job from node, and set node as restartRequired
	var noClient = false;
	var noTarget = false;

	async.series([
		function(cb) {
			var updateObj = { $set: { restartRequired: true } };
			scope.updateBothTargetAndClient(nodeID, updateObj, function(err, results) {
				noClient = !results.client;
				noTarget = !results.target;
				cb();
			});
		},
		function(cb) {
			var query = {
				_id: nodeID,
				status: consts.configurationProfile.status.APPLYING,
				'desiredProfile.id': profileInfo.id,
				'desiredProfile.version': profileInfo.version
			};

			var updateObj = { $set: { status: consts.configurationProfile.status.RESTART_REQUIRED } };

			if (noTarget)
				updateObj.$set.targetUpdated = true;

			if (noClient)
				updateObj.$set.clientUpdated = true;

			scope.updateNodeConfiguration(query, updateObj, cb);
		},
		function(cb) {
			var payload = { nodeID: nodeID, restartRequired: true };

			if (!noClient)
				events.emitEvent([events.getClientID(nodeID)], objectNotifier.events.restartRequiredChanged, payload);

			if (!noTarget)
				events.emitEvent([events.getTargetID(nodeID)], objectNotifier.events.restartRequiredChanged, payload);

			cb();
		}
	], function(err) {
		if (err)
			logger.sysDEBUG('Error in nodeConfigurationApplied', err);

		if (callback)
			callback();
	});
};

scope.updateBothTargetAndClient = function(nodeID, updateObj, callback) {
	var db = app.get('db');
	var serversCollection = db.collection('server');
	var clientsCollection = db.collection('client');

	async.parallel({
		target: function(cb) {
			serversCollection.findOneAndUpdate({ _id: nodeID }, updateObj, cb);
		},
		client: function(cb) {
			clientsCollection.findOneAndUpdate({ clientID: nodeID }, updateObj, cb);
		}
	}, function(err, results) {
		if (err)
			err = new MongoError(err);
		callback(err, results);
	});
};

scope.updateNodeConfiguration = function(nodeIdOrQuery, updateObj, callback) {
	const query = typeof nodeIdOrQuery == 'string' ? { _id: nodeIdOrQuery } : nodeIdOrQuery;
	const db = app.get('db');
	const nodeConfigCollection = db.collection('nodeConfiguration');
	const options = { returnDocument: consts.mongoReturnDocument.AFTER, includeResultMetadata: true };

	nodeConfigCollection.findOneAndUpdate(query, updateObj, options, (err, results) => {
		if (err)
			err = new MongoError(err);

		callback(err, results);
	});
};

scope.handleComponentConfigProfileReport = function(targetOrClient, nodeID, reportedProfile, callback) {
	var canRemoveRestartRequired = false;

	if (!reportedProfile)
		return callback();

	scope.getNodeConfigurationEntry(nodeID, function(err, nodeConfiguration) {
		if (err)
			return callback(err);

		if (!nodeConfiguration)
			// If this node has no nodeConfiguration entry, it's probably new, so we need to apply the Default Cluster Profile to it
			return scope.applyClusterDefaultConfigurationToNodes([nodeID], err => {
				if (err)
					return callback(err);

				// Retry processing the report
				scope.handleComponentConfigProfileReport(targetOrClient, nodeID, reportedProfile, callback);
			});

		if (nodeConfiguration.status != consts.configurationProfile.status.RESTART_REQUIRED) {
			return callback(err, nodeConfiguration.status == consts.configurationProfile.status.OK);
		}

		if (reportedProfile.id == nodeConfiguration.desiredProfile.id
			&& reportedProfile.version == nodeConfiguration.desiredProfile.version) {

			logger.sysDEBUG(`${targetOrClient} ${nodeID} updated to new Config Profile id=${reportedProfile.id} version=${reportedProfile.version}`);

			canRemoveRestartRequired = true;

			var updateObj = {};
			if (targetOrClient == 'target')
				updateObj['$set'] = { targetUpdated: true };
			else
				updateObj['$set'] = { clientUpdated: true };

			scope.updateNodeConfiguration(nodeID, updateObj, function(err, result) {
				var updatedDoc = result.value;

				var eventPayload = { nodeID: nodeID, profile: nodeConfiguration.desiredProfile };
				if (targetOrClient == 'target')
					events.emitEvent([events.getTargetID(nodeID)], objectNotifier.events.targetConfigProfileUpdated, eventPayload);
				else
					events.emitEvent([events.getClientID(nodeID)], objectNotifier.events.clientConfigProfileUpdated, eventPayload);

				// Check if both target and Client have been updated on this node
				if (updatedDoc.clientUpdated && updatedDoc.targetUpdated) {
					// remove the 'desiredProfile'
					var updateObj = {
						$set: {
							status: consts.configurationProfile.status.OK,
						},
						$unset: { targetUpdated: 1, clientUpdated: 1 }
					};

					scope.updateNodeConfiguration(nodeID, updateObj, function(err) {
						if (err)
							logger.sysDEBUG('Error updating nodeConfiguration status for ' + nodeID);

						callback(err, canRemoveRestartRequired);
					});
				} else {
					callback(err, canRemoveRestartRequired);
				}
			});
		} else {
			callback(err);
		}
	});
};

/** if the managementClient reported configuration applied before the first report from the component,
* 	then restartRequired field should be restored
*/
scope.restoreRestartRequiredField = function(nodeID, clientOrTarget, callback) {
	if (!callback)
		callback = function(){};


	var db = app.get('db');

	var query;
	var collection;

	if (clientOrTarget == 'target') {
		query = { _id: nodeID };
		collection = db.collection('server');
	} else {
		query = { _id: nodeID };
		collection = db.collection('client');
	}

	scope.getNodeConfigurationEntry(nodeID, function(err, nodeConfiguration) {
		if (nodeConfiguration
			&& nodeConfiguration.status
			&& nodeConfiguration.status == consts.configurationProfile.status.RESTART_REQUIRED) {
			collection.findOneAndUpdate(
				query,
				{ $set: { restartRequired: true } },
				function(err) {
					if (err) {
						err = new MongoError(err);
						var entityIdType = clientOrTarget == 'target' ? Entities.Target.ID : Entities.Client.ID;
						err.addInfo(entityIdType, nodeID);
						err.log();
					}

					callback(err);
				});
		} else {
			callback(null);
		}
	});
};

/**
 * This function sets userOverride - which is displayed in the GUI to indicate the user had manually
 * added additional configuration in the nvmesh.conf on the node which override the profile
 */
scope.setUserOverride = function(nodeID, configProfileInfo, retries, callback) {
	var updateObj = { $set: { userOverride: configProfileInfo.userOverride } };
	scope.updateNodeConfiguration(nodeID, updateObj, function(err, res) {
		if (err) {
			logger.sysDEBUG(`Update node configuration failed ${err}`);
			return callback(err);
		}

		if (err || !res.lastErrorObject.n)
			return setTimeout(function recursiveCall() {
				// Try Again in one second, in can happen the document, max 10 retries
				retries = retries ? retries + 1 : 1;
				if (retries < 10)
					scope.setUserOverride(nodeID, configProfileInfo, retries, callback);
				else {
					var err = new Error(`could not set userOverride on nodeConfiguration collection for node ${nodeID} max retries (10) exceeded`);
					logger.sysDEBUG(err);
					return callback(err);
				}
			}, 1000);
		else {
			var payload = { nodeID: nodeID, userOverride: configProfileInfo.userOverride };
			events.emitEvent([events.getNodeID(nodeID)], objectNotifier.events.configProfileUserOverrideChanged, payload);
			callback();
		}
	});
};

scope.getUserOverride = function(nodeIDs, callback) {
	var db = app.get('db');
	var nodeConfigCollection = db.collection('nodeConfiguration');
	nodeConfigCollection.find({ _id: { $in: nodeIDs } }, { userOverride: 1 }).toArray(function(err, userOverrideList) {
		if (err)
			err = new MongoError(err);

		callback(err, userOverrideList);
	});
};

/** This function verifies that the reported profile from the agent (what was saved to the disk)
 * is the same as the desiredProfile in the nodeConfiguration
 * NOTE: the client / target might still be running with the previous configuration - and they report their status in their own keepalives.
*/
scope.verifyConfigProfileOnAgentKeepAlive = function(nodeID, reportedProfile, callback) {
	var nodeConfigEntry;
	var shouldApplyDefaultProfile = false;

	function isSameProfile(profile1, profile2) {
		return profile1.id == profile2.id && profile1.version == profile2.version;
	}

	async.series([
		function getWishfulStateProfile(cb) {
			scope.getNodeConfigurationEntry(nodeID, function(err, nodeConfiguration) {
				if (err)
					return cb(err);

				if (!nodeConfiguration) {
					shouldApplyDefaultProfile = true;
					return cb();
				}

				nodeConfigEntry = nodeConfiguration;
				cb();
			});
		},
		function applyClusterDefaultProfile(cb) {
			if (!shouldApplyDefaultProfile)
				return cb();

			scope.applyClusterDefaultConfigurationToNodes([nodeID], cb);
		},
		function checkIfNeedsToResendProfile(cb) {
			if (shouldApplyDefaultProfile)
				return cb();

			var desiredProfile = nodeConfigEntry.desiredProfile;

			if (nodeConfigEntry.status == consts.configurationProfile.status.APPLYING ||
				nodeConfigEntry.status == consts.configurationProfile.status.RESTART_REQUIRED) {

				if (!isSameProfile(reportedProfile, desiredProfile)) {
					// node have wrong profile - resend desired profile assigned to it
					return scope.resendProfileToNode(nodeID, cb);

				} else { // reported profile is same as desired profile

					if (nodeConfigEntry.status === consts.configurationProfile.status.APPLYING) {
						// node got latest profile and we should treat this message like we treat configProfileUpdated message
						return scope.nodeConfigurationApplied(nodeID, reportedProfile, cb);

					} else {
						// status is restartRequired - nothing to do, we are just waiting for the client/target report to mark the status as ok
						return cb();
					}
				}
			} else {
				if (!isSameProfile(reportedProfile, desiredProfile)) {
					// node reported a differnet profile, and it was not in applying
					// we should re-apply the configuration to the node
					return scope.reapplyCurrentProfileToNode(nodeID, cb);
				} else {
					return cb();
				}
			}
		}
	], err => {
		callback(err);
	});
};

module.exports = scope;
