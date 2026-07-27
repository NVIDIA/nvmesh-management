// UPGRADE SCRIPT RULES 
// --------------------
// An upgrade script should be built in an exact template showed below:
// must have a scope that contains the following:
// * attribute named 'collectionNameForUpgrade' - holds the collection that hould be upgraded
// * a function named 'getUpdatePartAndOptionsForSingleDocumentUpgrade' - which accepts a SINGLE DOCUMENT for an upgrade and a callback.
// 'getUpdatePartAndOptionsForSingleDocumentUpgrade' should return a callback with:
// * error - and error if found in the 'getUpdatePartAndOptionsForSingleDocumentUpgrade' function - this will stop the process of upgrading.
// * updatePart - the update part of an updateOne function
// * options - the options part of an updateOne function
// the mechanism runs over the collection with a cursor and calls this function each time with a single doc and runs an updateOne with the
// params returned from the function.
// The find & updateOne is atomic, so the implementer can use js conditions to decide if an object should be upgraded
// without worrying for a race condition
// IMPORTANT: the upgrade script should be written in an idempotent way - meaning that it can be run twice without causing issues.
const logger = require('../logger.js');

logger.sysINFO('Upgrading GlobalSettings DB collection to 3.3.0-1 - Convert keepaliveIntervals');

const scope = {};

scope.collectionNameForUpgrade = 'globalSettings';

scope.getUpdatePartAndOptionsForSingleDocumentUpgrade = (_, cb) => {
	let options = {};
	let updatePart = {
		$set: {
			keepaliveIntervals: {
				MANAGEMENT_AGENT: 5,
				CLIENT: 5,
				TOMA: 5,
				TOMA_LEADER: 5,
				UPGRADE_AGENT: 60 * 60,
			}
		},
		$unset: {
			keepaliveInterval: 1
		}
	};

	cb(null, updatePart, options);
};

module.exports = scope;