/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

const async = require('async');
const uuid = require('uuid');

const utils = require('../utils.js');
const consts = require('../consts.js');
const lockModule = require('./lock.js');
const systemMessages = require('../systemMessages.js');
const classesUtils = require('./classesUtils.js');
var { MongoError, SystemAdminMessage, Entities, SystemMessage } = require('./error.js');

const scope = {};

scope.fetchServerClassByID = function(serverClassID, cb) {
	utils.fetchEntityByID('serverClass', serverClassID, false, {}, systemMessages.TARGETCLASS_NOT_FOUND, cb);
};

function checkForTargetClassProtectionDomainViolations(targetClass, messages, cb) {
	// this check is crucial to make sure getDisksByNodes below not returning all the drives in the DB - not suppose to happen
	if (!targetClass.targetNodes || !targetClass.targetNodes.length)
		return cb();

	function handleConflictResponses(err, entitiesWithDomainConflict, isDriveClassConflict, targetClassDrives) {
		if (err) {
			messages.push(new SystemAdminMessage(systemMessages.TARGETCLASS_SAVE_FAILED)
				.addInfo(Entities.Error, err)
				.addInfo(Entities.ServerClass.ID, targetClass._id));
			return err;
		} else if (entitiesWithDomainConflict.length) {
			const message = new SystemAdminMessage(systemMessages.TARGETCLASS_SAVE_FAILED_TARGET_WITH_DOMAIN_CONFLICT);
			entitiesWithDomainConflict.forEach(e => {
				message.addInfo(isDriveClassConflict ? Entities.Drive.ID : Entities.Target.ID, e.entityIDs).addInfo(Entities.Domain.scope, e.domainScope);
				if (isDriveClassConflict)
					message.addInfo(Entities.Target.ID, targetClassDrives.filter((d) => e.entityIDs.includes(d._id)).map((d) => d.node_id));
			});
			messages.push(message.addInfo(Entities.ServerClass.ID, targetClass._id));
			return message;
		}

		return;
	}

	classesUtils.checkForProtectionDomainViolations(
		targetClass._id,
		targetClass.targetNodes,
		targetClass.domains,
		'targetNodes',
		consts.dbCollections.TARGET_CLASS,
		(tClass) => tClass.targetNodes,
		(err, targetsWithDomainConflict) => {
			let errorOrConflictMessage = handleConflictResponses(err, targetsWithDomainConflict, false, null);
			if (errorOrConflictMessage)
				return cb(errorOrConflictMessage);

			utils.getDisksByNodes(targetClass.targetNodes.map((nodeID) => { return { 'serverID': nodeID }; }), (err, disks) => {
				if (err)
					return cb(handleConflictResponses(err));
				else if (!disks || !disks.length)
					return cb();

				// make sure that the drives of the targets in the target class does not have a conflict with their Drive Classes domains
				classesUtils.checkForProtectionDomainViolations(
					null,
					disks.map((d) => d._id), // the drive IDs of the targets in the Target Class
					targetClass.domains,
					'disks.diskID',
					consts.dbCollections.DRIVE_CLASS,
					classesUtils.getDiskIDsOfDriveClassFunc,
					(err, drivesWithDomainConflict) => {
						let errorOrConflictMessage = handleConflictResponses(err, drivesWithDomainConflict, true, disks);
						if (errorOrConflictMessage)
							return cb(errorOrConflictMessage);

						return cb();
					});
			});
		});
}

function validateTargets(targetClasses, executeForEachClassFn, callback) {
	const query = { projection: { _id: 0, node_id: 1 } };

	targetClasses.forEach((targetClass) => {
		// remove duplicated targetNodes
		targetClass.targetNodes = [...new Set(targetClass.targetNodes)];

		// remove duplicated domains
		if (targetClass.domains && targetClass.domains.length > 1) {
			var distinctSet = [];

			targetClass.domains.forEach(function(domain) {
				var aID = domain.scope + ':' + domain.identifier;
				if (distinctSet.indexOf(aID) === -1)
					distinctSet.push(aID);
			});

			targetClass.domains = distinctSet
				.map(function(aID) {
					var parts = aID.split(':');

					return { scope: parts[0], identifier: parts[1] };
				});
		}
	});

	utils.loadCollection('server', query, (err, results) => {
		if (err)
			return callback(new MongoError(err).log());

		const existingTargets = utils.getCollectionSetByKey(results, target => target.node_id);
		const validatorFn = (targetClass, eachCallback) => {
			// the payload from save includes name, the payload from update includes _id
			targetClass._id = targetClass._id || targetClass.name;

			const unknownTargets = targetClass.targetNodes.filter(target => !existingTargets.has(target));
			executeForEachClassFn(targetClass, unknownTargets, eachCallback);
		};

		async.eachSeries(targetClasses, validatorFn, callback);
	});
}

scope.saveTargetClasses = (targetClasses, user, cb) => {
	const messages = [];
	const executeForEachServerClassFn = (targetClass, unknownTargets, callback) => {
		const addInfoToMessage = message => message.addInfo(Entities.ServerClass.ID, targetClass.name);

		if (unknownTargets.length) {
			const message = new SystemAdminMessage(systemMessages.TARGETCLASS_FAILED_TARGET_NOT_FOUND);
			unknownTargets.forEach(t => message.addInfo(Entities.Target.ID, t));
			messages.push(addInfoToMessage(message));
			return callback();
		}

		checkForTargetClassProtectionDomainViolations(targetClass, messages, (err) => {
			if (err)
				return callback();

			targetClass.createdBy = targetClass.modifiedBy = user.email;
			targetClass.dateCreated = targetClass.dateModified = new Date();
			targetClass.uuid = uuid.v1();

			utils.insertToCollection(targetClass, 'serverClass', err => {
				if (err)
					messages.push(addInfoToMessage(new SystemAdminMessage(systemMessages.TARGETCLASS_SAVE_FAILED)
						.addInfo(Entities.Error, err.isDuplicateKeyError ? new SystemMessage(systemMessages.TARGETCLASS_SAVE_NAME_ALREADY_EXISTS) : err)));
				else
					messages.push(addInfoToMessage(new SystemAdminMessage(systemMessages.TARGETCLASS_SAVED)
						.addInfo(Entities.ServerClass.UUID, targetClass.uuid)));

				callback();
			});
		});
	};

	lockModule.acquireGlobalLock(() => {
		validateTargets(targetClasses, executeForEachServerClassFn, err => {
			if (err)
				messages.push(new SystemAdminMessage(systemMessages.TARGETCLASS_SAVE_FAILED).addInfo(Entities.Error, err));

			lockModule.releaseGlobalLock();
			cb(messages);
		});
	});
};

scope.updateTargetClasses = (targetClasses, user, callback) => {
	const messages = [];
	const targetClassesToUpdate = [];
	const targetClassesGettingLarger = [];

	function onCompleteFunction() {
		lockModule.releaseGlobalLock();
		callback(messages);
	}

	const executeForEachTargetClassFn = (targetClass, unknownTargets, callback) => {
		const addInfoToMessage = message => message.addInfo(Entities.ServerClass.ID, targetClass.name);

		if (unknownTargets.length) {
			const message = new SystemAdminMessage(systemMessages.TARGETCLASS_UPDATE_FAILED_TARGET_NOT_FOUND);
			unknownTargets.forEach(t => message.addInfo(Entities.Target.ID, t));
			messages.push(addInfoToMessage(message));
			return callback();
		}

		checkForTargetClassProtectionDomainViolations(targetClass, messages, (err) => {
			if (err)
				return callback();

			utils.getServersByServerClass([{ _id: targetClass._id, uuid: targetClass.uuid }], null, null, (err, classDocs) => {
				if (err) {
					messages.push(addInfoToMessage(
						new SystemAdminMessage(systemMessages.TARGETCLASS_UPDATE_FAILED).addInfo(Entities.Error, err)));
					return callback();
				}

				if (!classDocs.length) {
					messages.push(addInfoToMessage(new SystemAdminMessage(systemMessages.TARGETCLASS_UPDATE_NOT_FOUND)));
					return callback();
				}

				const existingServerIDs = classDocs[0].targetNodes || [];
				const serverIDsToUpdate = targetClass.targetNodes;
				const newServerIDs = serverIDsToUpdate.filter(targetID => !existingServerIDs.includes(targetID));
				const deleteServerIDs = existingServerIDs.filter(targetID => !serverIDsToUpdate.includes(targetID));

				async.series([
					cb => {
						if (!deleteServerIDs.length)
							return cb();

						utils.getVolumesAffectedServerClass(targetClass, deleteServerIDs, (err, results) => {
							let systemMessage;

							if (err)
								systemMessage = err;
							else if (results.length) {
								systemMessage = new SystemMessage(systemMessages.TARGETCLASS_UPDATE_VOLUME_IN_USE);
								results.forEach(r => systemMessage.addInfo(Entities.Volume.ID, r._id));
							}

							if (systemMessage) {
								messages.push(addInfoToMessage(new SystemAdminMessage(systemMessages.TARGETCLASS_UPDATE_FAILED)));
								return cb(true);
							}

							//No volumes were allocated with this targetClass it's safe to remove it.
							utils.deleteServersFromVolumeLimiter(targetClass, existingServerIDs, deleteServerIDs, cb);
						});
					},
					cb => {
						if (newServerIDs.length) {
							utils.addObjectsToVolumeLimiter('serverClasses', targetClass._id, newServerIDs, 'limitByNodes');
							targetClassesGettingLarger.push(targetClass);
						}

						targetClass.modifiedBy = user.email;
						targetClass.dateModified = new Date();

						cb();
					}
				], err => {
					if (!err)
						targetClassesToUpdate.push(targetClass);

					callback();
				});
			});
		});
	};

	lockModule.acquireGlobalLock(() => {
		validateTargets(targetClasses, executeForEachTargetClassFn, err => {
			if (err)
				messages.push(new SystemAdminMessage(systemMessages.TARGETCLASS_UPDATE_FAILED).addInfo(Entities.Error, err));

			if (!targetClassesToUpdate.length)
				return onCompleteFunction();

			utils.updateCollection(targetClassesToUpdate, 'serverClass', false, (err, results) => {
				if (err)
					new MongoError(err).log();
				else
					utils.startVolumeRebuildByServerClasses(targetClassesGettingLarger, user.email);


				targetClassesToUpdate.forEach(targetClass => {
					let error;
					const targetClassResult = results[targetClass._id];

					if (targetClassResult.matchedCount == 0)
						error = new SystemMessage(systemMessages.TARGETCLASS_NOT_FOUND);
					else
						error = targetClassResult.err;

					const systemAdminMessage = new SystemAdminMessage(error ? systemMessages.TARGETCLASS_UPDATE_FAILED : systemMessages.TARGETCLASS_UPDATED)
						.addInfo(Entities.ServerClass.ID, targetClass._id)
						.addInfo(Entities.ServerClass.UUID, targetClass.uuid);

					if (error)
						systemAdminMessage.addInfo(Entities.Error, error);

					messages.push(systemAdminMessage);
				});

				onCompleteFunction();
			});
		});
	});
};

scope.deleteTargetClasses = (targetClasses, callback) => {
	const messages = [];
	const db = app.get('db');
	const volumeCollection = db.collection('volume');

	const deleteTargetClass = (targetClass, eachCallback) => {
		let errorLog;
		const query = { serverClasses: targetClass._id, status: { $ne: consts.volumeStatuses.PENDING } };
		const onError = () => done(new SystemAdminMessage(systemMessages.TARGETCLASS_DELETE_FAILED).addInfo(Entities.Error, errorLog));
		const done = systemAdminMessage => {
			messages.push(systemAdminMessage.addInfo(Entities.ServerClass.ID, targetClass._id).addInfo(Entities.ServerClass.UUID, targetClass.uuid));
			return eachCallback();
		};

		volumeCollection.countDocuments(query, (err, count) => {
			if (err)
				errorLog = new MongoError(err).log();
			else if (count > 0)
				errorLog = new SystemMessage(systemMessages.TARGETCLASS_DELETE_USED);

			if (errorLog)
				return onError();

			utils.deleteFromCollection([targetClass], 'serverClass', false, (err, results) => {
				if (err)
					errorLog = new MongoError(err).log();
				else if (!results.deletedCount)
					errorLog = new SystemMessage(systemMessages.TARGETCLASS_DELETE_NOT_FOUND);

				if (errorLog)
					return onError();

				done(new SystemAdminMessage(systemMessages.TARGETCLASS_DELETED));
			});
		});
	};

	async.each(targetClasses, deleteTargetClass, () => callback(messages));
};

scope.getDomains = (projection, cb) => {
	const db = app.get('db');
	const serverClassCollection = db.collection('serverClass');
	const field = projection ? `domains.${projection}` : 'domains';

	return serverClassCollection.distinct(field, (err, results) => {
		if (err)
			new MongoError(err).log();

		cb(results);
	});
};

module.exports = scope;
