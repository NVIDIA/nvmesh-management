/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* global app */

const async = require('async');
const path = require('path');
const fs = require('fs');
const consts = require('../consts.js');
const utils = require('../utils.js');
const logger = require('../logger.js');
const systemMessages = require('../systemMessages.js');
const { Backoff } = require('../models/backoff.js');

var { Entities, MongoError, SystemMessage, SystemAdminMessage } = require('./error.js');

const scope = {};
const scriptsDir = path.join(__dirname, '..', 'upgradeScripts');

function stripOSAndBuildNumberFromVersion(rpmVersion) {
	let rpmVersionParts = rpmVersion.split('-');
	return `${rpmVersionParts[0]}-${rpmVersionParts[1].split('.')[0]}`;
}

function updateConfCollectionVersion(version, cb) {
	var db = app.get('db');
	var confCollection = db.collection('configurationVersion');

	var $query = { _id: consts.CONFIG_VER_CLUSTER_ID };

	confCollection.updateOne($query, { $set: { dbVersion: version } }, () => {
		cb();
	});
}

scope.checkDBEraCompatibility = (myDBEra, cb) => {
	var db = app.get('db');
	var confCollection = db.collection('configurationVersion');

	var $query = { _id: consts.CONFIG_VER_CLUSTER_ID };

	confCollection.findOne($query, (err, conf) => {
		if (err) {
			new MongoError(err).log();
			return cb();
		}

		if (conf && !((!conf.dbEra || conf.dbEra <= myDBEra) && (!conf.pendingDBEra || conf.pendingDBEra <= myDBEra))) {
			new SystemMessage(systemMessages.INCOMPATIBLE_DB_ERA).addInfo(Entities.dbEra, myDBEra).log();
			process.exit(1);
		}

		cb();
	});
};

function checkIfCanAndNeedToRunDBUpgrade(cb) {
	const db = app.get('db');
	const managementClusterCollection = db.collection('managementCluster');
	const confCollection = db.collection('configurationVersion');
	const currentVersion = app.get('rpmVersion');
	let currentInstalledVersion = stripOSAndBuildNumberFromVersion(currentVersion);

	// fetching all MGMTs to determine if all of them are at the same version
	managementClusterCollection.find().toArray((err, managements) => {
		if (err)
			return cb(new MongoError(err).log());

		if (managements.length) {
			// verifying all MGMTs have the same version installed and running
			let allMGMTsAtSameDocVersion = managements.every((mgmt) => stripOSAndBuildNumberFromVersion(mgmt.managementVersion) == currentInstalledVersion);

			if (!allMGMTsAtSameDocVersion) {
				logger.sysDEBUG('Not all the MGMTs are at the same version, skip checking if upgrade scripts needs to be run');
				return cb(false);
			}

			// fetching the dbVersion which is the latest version/upgrdeScript that the db is at
			confCollection.findOne({ _id: consts.CONFIG_VER_CLUSTER_ID }, { dbVersion: 1 }, (err, conf) => {
				if (err)
					return cb(new MongoError(err).log());

				if (!conf)
					conf = {};

				if (!conf.dbVersion) {
					try {
						conf.dbVersion = fs.readFileSync('/opt/nvmesh/management/dbVersion').toString().trim();
					} catch (e) {
						//This should only happen on new installs
						new SystemMessage(systemMessages.DB_UPGRADE_FAILED_TO_READ_DB_VERSION_FILE).addInfo(Entities.Exception, e).log();

						return updateConfCollectionVersion(currentVersion, () => cb(false));
					}
				}

				// we need to update to the latest version
				let currentDBVersion = stripOSAndBuildNumberFromVersion(conf.dbVersion);
				if (utils.compareVersionRelease(currentInstalledVersion, currentDBVersion) > 0)
					return cb(true, currentInstalledVersion, currentDBVersion);

				cb(false);
			});
		} else
			cb(false);
	});
}

function tryAcquiringLockForDBUpgrade(cb) {
	const db = app.get('db');
	const confCollection = db.collection('configurationVersion');
	// either there is no one else running the or it is me (me = previous run with a mgmt restart/stop in the middle)
	const query = {
		_id: consts.CONFIG_VER_CLUSTER_ID,
		$or: [{ runningDBUpgrade: { $exists: false } }, { 'runningDBUpgrade.createdBy.managementId': app.get('managementId') }]
	};

	confCollection.findOneAndUpdate(query, {
		$set: {
			pendingDBEra: app.get('dbEra'),
			'runningDBUpgrade.createdBy': utils.getHandlingMgmtParams()
		},
		$currentDate: { 'runningDBUpgrade.dateModified': true }
	}, {
		returnDocument: consts.mongoReturnDocument.BEFORE
	}, (err, clusterDoc) => {
		if (err)
			new MongoError(err).log();

		if (!clusterDoc) {
			new SystemAdminMessage(systemMessages.DB_UPGRADE_FAILED_TO_TAKE_LOCK).log();
			logger.sysDEBUG('Could not start running DB upgrade, probably someone else already started');
			return cb(false);
		}

		return cb(true);
	});
}

function releaseDBUpgradeLock(newDBVersion, cb) {
	const db = app.get('db');
	const confCollection = db.collection('configurationVersion');
	const query = {
		_id: consts.CONFIG_VER_CLUSTER_ID,
		'runningDBUpgrade.createdBy.managementId': app.get('managementId'),
		'runningDBUpgrade.createdBy.bootVersion': app.get('bootVersion')
	};
	let update;

	// on success
	if (newDBVersion)
		update = [
			{ $set: { dbVersion: newDBVersion, dbEra: '$pendingDBEra' } },
			{ $unset: ['runningDBUpgrade', 'pendingDBEra'] }
		];
	else // on abort
		update.$unset = { runningDBUpgrade: 1 };

	confCollection.findOneAndUpdate(query, update, {
		returnDocument: consts.mongoReturnDocument.AFTER
	}, (err, clusterDoc) => {
		if (err)
			new MongoError(err).log();

		if (!clusterDoc) {
			new SystemAdminMessage(systemMessages.DB_UPGRADE_FAILED_TO_RELEASE_LOCK).log();
			logger.sysDEBUG('Could not release DB upgrade lock');
		}

		return cb();
	});
}

// this function releases a previous lock that was put there by a management that started the DB upgrade and died in the middle (stopped/restarted/crashed)
function releaseStaleLockFromPreviousDBUpgradeRun(cb) {
	const db = app.get('db');
	const managementClusterCollection = db.collection('managementCluster');
	const confCollection = db.collection('configurationVersion');

	const query = {	_id: consts.CONFIG_VER_CLUSTER_ID, runningDBUpgrade: { $exists: true } };

	confCollection.findOne(query, { runningDBUpgrade: 1 }, (err, clusterDoc) => {
		if (err)
			new MongoError(err).log();

		if (clusterDoc) {
			managementClusterCollection.findOne({ _id: clusterDoc.runningDBUpgrade.createdBy.managementId }, (err, mgmt) => {
				if (err)
					new MongoError(err).log();

				if (!mgmt)
					// releasing the lock of a previous mgmt that started the run
					confCollection.updateOne({
						_id: consts.CONFIG_VER_CLUSTER_ID, 
						'runningDBUpgrade.createdBy.managementId': clusterDoc.runningDBUpgrade.createdBy.managementId,
						'runningDBUpgrade.createdBy.bootVersion': clusterDoc.runningDBUpgrade.createdBy.bootVersion
					},
					{ $unset: { 'runningDBUpgrade': 1 } },
					(err, result) => {
						if (err)
							new MongoError(err).log();

						if (!result.modifiedCount)
							logger.sysDEBUG('Could not remove staled runningDBUpgrade lock for a previous Mgmt that died, it probably got restarted');

						cb(err);
					});
				else
					cb(err);
			});
		} else
			cb(err);
	});
}

function removeJSExtensionSuffix(upgradeScript) {
	if (upgradeScript.endsWith('.js'))
		return upgradeScript.slice(0, -3);
	else
		logger.sysWARNING('Found a non-javascript upgrade script, this script might not run correctly!');

	return upgradeScript;
}

function isInRange(vr, minVR, maxVR) {
	return utils.compareVersionRelease(vr, minVR) === 1 && utils.compareVersionRelease(vr, maxVR) <= 0;
}

function performSingleDocUpgradeWithRetries(upgradeScript, collectionToUpgrade, loadedUpgradeScriptModule, doc, newDocVersion, mainCallback) {
	const backoff = new Backoff({ maxBackoff: 2000 });
	const syncTestFunc = cb => cb(null, shouldContinue);
	let shouldContinue = true;

	async.whilst(syncTestFunc, cb => {
		performSingleDocUpgrade(collectionToUpgrade, loadedUpgradeScriptModule, doc, newDocVersion, (err, shouldRetry) => {
			if (err || !shouldRetry) {
				shouldContinue = false;
				return cb(err);
			}

			logger.sysDEBUG(`Could not run upgrade script ${upgradeScript} on for document _id ${doc._id}, 
				the doc was probably changed during the upgrade process, retrying...`);

			//fetch the latest doc and retry with backoff
			collectionToUpgrade.findOne({ _id: doc._id }, (err, latestDoc) => {
				if (err)
					return cb(new MongoError(err).log());
				
				doc = latestDoc;

				backoff.backoff(err => cb(err));
			});
		});
	}, err => mainCallback(err));
}

function performSingleDocUpgrade(collectionToUpgrade, loadedUpgradeScriptModule, doc, newDocVersion, mainCallback) {
	let shouldRetry = false;

	async.waterfall([
		function getUpdatePartAndOptionsFromUpgradeScript(cb) {
			loadedUpgradeScriptModule.getUpdatePartAndOptionsForSingleDocumentUpgrade(doc, (err, updatePart, options) => {
				if (err && !(err instanceof SystemMessage))
					err = new SystemAdminMessage(systemMessages.DB_UPGRADE_FAILED_TO_EXECUTE_DOCUMENT_UPGRADE)
						.addInfo(Entities.DocumentID, doc._id)
						.addInfo(Entities.Collection, collectionToUpgrade).log();

				if (err)
					cb(err);
				else // this is on purpose because async acts weird if false is passed to cb (if an implementer of the upgrade script will return false)
					cb(null, updatePart, options);
			});
		},
		// update the doc while setting the new docVersion)
		function upgrdeSingleDocument(updatePart, options, cb) {
			// making sure that the document wasn't change since the fetching (both full object comparision + verifying first level key size)
			const compareDocFirstLevelSize = { $eq: [{ $size: { $objectToArray: '$$ROOT' } }, Object.keys(doc).length] };
			doc.$expr = compareDocFirstLevelSize;
			if (!('$set' in updatePart))
				updatePart.$set = {};

			updatePart.$set.docVersion = newDocVersion;

			collectionToUpgrade.updateOne(doc, updatePart, options, (err, result) => {
				if (err)
					return cb(new MongoError(err).log());

				if (!result.modifiedCount)
					shouldRetry = true;

				cb();
			});
		}
	], (err) => {
		mainCallback(err, shouldRetry);
	});
}

function runUpgradeScript(upgradeScript, mainCallback) {
	const db = app.get('db');
	const loadedUpgradeScriptModule = require(path.join(scriptsDir, upgradeScript));
	let err;

	if (!loadedUpgradeScriptModule.collectionNameForUpgrade) {
		err = new SystemMessage(systemMessages.DB_UPGRADE_SCRIPT_MISSING_COLLECTION_NAME);
		return mainCallback(err);
	}

	const collectionDocVersions = app.get('supportedDBCollectionVersions')[loadedUpgradeScriptModule.collectionNameForUpgrade];
	const newestCollectionDocVersion = collectionDocVersions.sort(utils.compareVersionRelease)[collectionDocVersions.length - 1];
	const collectionToUpgrade = db.collection(loadedUpgradeScriptModule.collectionNameForUpgrade);
	const collectionCursor = collectionToUpgrade.getOriginalCollection().find({ docVersion: { $ne: newestCollectionDocVersion } });

	utils.asyncIterCursor(collectionCursor, (doc, nextDocCallback) => {
		performSingleDocUpgradeWithRetries(upgradeScript, collectionToUpgrade, loadedUpgradeScriptModule, doc, newestCollectionDocVersion, nextDocCallback);
	}, mainCallback);
}

function runUpgradeScripts(minVersion, maxVersion, cb) {
	var scripts = getAllUpgradeScripts();

	async.eachSeries(scripts, (script, callback) => {
		let pureScriptVersion = removeJSExtensionSuffix(script);
		if (isInRange(pureScriptVersion, minVersion, maxVersion)) {
			logger.sysDEBUG('Going to run upgrade script: ' + script);
			runUpgradeScript(script, (err) => {
				if (err) {
					err = new SystemMessage(systemMessages.DB_UPGRADE_FAILED_TO_RUN_UPGRADE_SCRIPT)
						.addInfo(Entities.UpgradeScript, script).addInfo(Entities.Error, err).log();
					return callback(err);
				}

				logger.sysDEBUG(`Finished to run upgrade script ${script} successfully`);

				return updateConfCollectionVersion(pureScriptVersion, callback);
			});
		} else
			callback();
	}, cb);
}

function getAllUpgradeScripts() {
	var scripts = fs.readdirSync(scriptsDir);

	return scripts.sort(utils.compareVersionRelease).slice(1);
}

scope.upgradeDBIfNeeded = (cb) => {
	let shouldRunDBUpgrade = false;
	let shouldAbortDBUpgrade = false;
	let minVersion;
	let maxVersion;

	async.series([
		(cb) => {
			checkIfCanAndNeedToRunDBUpgrade((shouldRunUpgradeScripts) => {
				shouldRunDBUpgrade = shouldRunUpgradeScripts;
				cb();
			});
		},
		(cb) => {
			if (!shouldRunDBUpgrade)
				return cb();

			releaseStaleLockFromPreviousDBUpgradeRun(cb);
		},
		(cb) => {
			if (!shouldRunDBUpgrade)
				return cb();

			tryAcquiringLockForDBUpgrade((lockAcquired) => {
				shouldRunDBUpgrade = lockAcquired;

				if (!lockAcquired)
					logger.sysDEBUG('Could not take lock in order to run upgrade scripts for DB Upgrade, probably other MGMT started the upgrade already');
				cb();
			});
		},
		(cb) => {
			if (!shouldRunDBUpgrade)
				return cb();

			//two phase for making sure the mgmt cluster was not changed and an old mgmt succeeded to startup in the middle
			checkIfCanAndNeedToRunDBUpgrade((shouldRunUpgradeScripts, currentInstalledVersion, currentDBVersion) => {
				shouldAbortDBUpgrade = !shouldRunUpgradeScripts;
				shouldRunDBUpgrade = shouldRunUpgradeScripts;
				minVersion = currentDBVersion;
				maxVersion = currentInstalledVersion;

				cb();
			});
		},
		(cb) => {
			if (!shouldRunDBUpgrade)
				return cb();

			runUpgradeScripts(minVersion, maxVersion, cb);
		}
	], (err) => {
		if (shouldAbortDBUpgrade)
			return releaseDBUpgradeLock(null, cb);
		
		if (shouldRunDBUpgrade)
			return releaseDBUpgradeLock(err ? null : maxVersion, cb);

		cb();
	});
};

module.exports = scope;
