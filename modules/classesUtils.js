/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

const utils = require('../utils.js');
const systemMessages = require('../systemMessages.js');
const lockModule = require('./lock.js');
let { MongoError, SystemAdminMessage, Entities } = require('./error.js');

const scope = {};

scope.getDiskIDsOfDriveClassFunc = (dClass) => {
	return (dClass.disks || []).map((d) => d.diskID);
};

// classID: the drive or target class to be added to updated
// entitiesInClass: the list of diskIDs on a new/updated drive class or targetIDs on a new/updated target class
// domainsInClass: the list of domains of the drive or target class 
// entityFieldPath: the field path for quering the entites in the class (disks or targets)
// classCollectionName: diskClass or serverClass accordingly
// getEntitiesFromClassFunc: the function to get the diskIDs from the new/updated disk class OR the targetIDs from the new/updated target class
scope.checkForProtectionDomainViolations = (classID, entitiesInClass, domainsInClass, entityFieldPath, classCollectionName, getEntitiesFromClassFunc, cb) => {
	const entitiesWithDomainConflict = [];

	const query = {
		filter: {
			[entityFieldPath]: { $in: entitiesInClass }
		},
		projection: { _id: 0, disks: 1, targetNodes: 1, domains: 1 }
	};

	if (classID)
		query.filter._id = { $ne: classID };

	utils.loadCollection(classCollectionName, query, function(err, dbMatchingClasses) {
		if (err)
			return cb(new MongoError(err).log());

		if (dbMatchingClasses.length) {
			const entitiesSet = new Set(entitiesInClass);
			const newDomainMap = new Map();

			for (const d of domainsInClass || []) {
				newDomainMap.set(d.scope, d.identifier);
			}

			// Compare with existing documents
			for (const doc of dbMatchingClasses) {
				const overlappingEntities = (getEntitiesFromClassFunc(doc) || []).filter(entityID => entitiesSet.has(entityID));

				if (overlappingEntities.length === 0) continue;

				for (const domain of doc.domains || []) {
					const newIdentifier = newDomainMap.get(domain.scope);

					if (newIdentifier && newIdentifier !== domain.identifier) {
						entitiesWithDomainConflict.push({ 
							entityIDs: overlappingEntities,
							domainScope: domain.scope,
							existingIdentifier: domain.identifier,
							classType: classCollectionName,
							newIdentifier
						});
					}
				}
			}
		}
		
		cb(err, entitiesWithDomainConflict);
	});
};

scope.checkAndAlertForDomainConflictOnDriveReappearing = (drive, oldDriveTarget, cb) => {
	const db = app.get('db');
	const serverClassCollection = db.collection('serverClass');
	let domainNodesMap = {};

	function onCompleteFunction(err) {
		lockModule.releaseGlobalLock();

		if (cb)
			cb(err);
	}

	function compareDomainsAndAlertOnConflicts(targetClasses) {
		targetClasses.forEach((tClass) => {
			(tClass.domains || []).forEach((domain) => {
				if (!(domain.scope in domainNodesMap))
					domainNodesMap[domain.scope] = { identifier: domain.identifier, targetNodes: tClass.targetNodes };

				if (domainNodesMap[domain.scope].identifier != domain.identifier)
					(new SystemAdminMessage(systemMessages.TARGETCLASS_DOMAIN_CONFLICT_ON_DRIVE_REAPPEARING))
						.addInfo(Entities.Drive.ID, drive.diskID)
						.addInfo(Entities.ServerClass.ID, tClass._id)
						.addInfo(Entities.Domain.scope, domain.scope)
						.addInfo(Entities.Target.ID, domainNodesMap[domain.scope].targetNodes).log();
			});
		});
	}

	lockModule.acquireGlobalLock(() => {
		//get all the target classes that includes the old target of the drive
		serverClassCollection.find({ targetNodes: oldDriveTarget }).project({ domains: 1, targetNodes: 1 }).toArray(function(err, oldTargetTargetClasses) {
			if (err) {
				err = new MongoError(err).log();
				return onCompleteFunction(err);
			}

			// nothing to check - the reappeared drives old target was not part of any Target class with domains
			if (!oldTargetTargetClasses || !oldTargetTargetClasses.length
				|| oldTargetTargetClasses.every((tClass) => !tClass.domains || !tClass.domains.length))
				return onCompleteFunction();

			serverClassCollection.find({ targetNodes: drive.nodeID }).project({ domains: 1, targetNodes: 1 })
				.toArray(function(err, newTargetTargetClasses) {
					if (err) {
						err = new MongoError(err).log();
						return onCompleteFunction(err);
					}

					// nothing to check - the reappeared drives new target is not part of any Target class with domains
					if (!newTargetTargetClasses || !newTargetTargetClasses.length
						|| newTargetTargetClasses.every((tClass) => !tClass.domains || !tClass.domains.length))
						return onCompleteFunction();

					compareDomainsAndAlertOnConflicts([...oldTargetTargetClasses, ...newTargetTargetClasses]);
					onCompleteFunction();
				});
		});
	});
};

module.exports = scope;
