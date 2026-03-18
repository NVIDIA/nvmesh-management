/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


const utils = require('../utils.js');

let { MongoError } = require('./error.js');

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

module.exports = scope;
