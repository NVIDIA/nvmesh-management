/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

var scope = {};
module.exports = scope;

var async = require('async');

var logger = require('../logger.js');
var queue = require('../queue.js');
var consts = require('../consts.js');
var objectNotifier = require('../objectNotifier.js');

var zoneModule = require('./zone.js');
var utils = require('../utils.js');

var { SystemMessage, MongoError } = require('./error.js');
var systemMessages = require('../systemMessages.js');

const { metrics, isMetricsEnabled } = require('./openTelemetry.js');

var zonesLocks = {};
var lockTimeout = 5; // YR: This should be a param from management.js.conf
var lockReleaseSetTimeoutCounter = 25;


scope._zoneLocksCache = zonesLocks;

scope.afterModuleLoaded = () => {
	logger = require('../logger.js');
	({ SystemMessage, MongoError } = require('./error.js'));
};

class Lock {
	constructor(zone) {
		var db = app.get('db');
		this.lockCollection = db.collection('lock');
		this.zone = zone;
		this.lockingQueue = new queue.Queue('Zone(' + zone + ')LockingQueue');
		this.waitingForLock = false;
		this.releaseCounter = 0;

		if (isMetricsEnabled)
			metrics.dbLockQueueSize.addCallback(result => result.observe(this.lockingQueue.size(), { zone: this.zone }));
	}

	initialLockCreation(cb) {
		this.lockCollection.findOneAndUpdate(
			{ _id: this.zone },
			{
				$setOnInsert: {
					_id: this.zone,
					lockCounter: 1,
					status: consts.lockStatuses.UNLOCKED,
					segmentsInZone: 0,
					targetsInZone: [],
					totalTimeSpentWaitingForLock: 0,
					targetUpdatesSequence: 0
				}
			}, {
				upsert: true,
				returnDocument: consts.mongoReturnDocument.AFTER
			}, () => {
				cb({ _id: this.zone, lockCounter: 1 });
			});
	}

	createLock(oldLock, callingFunctions, startDT, cb) {
		var self = this;

		if (!oldLock)
			return this.initialLockCreation((newLock) => {
				self.createLock(newLock, callingFunctions, startDT, cb);
			});

		logger.sysVERBOSE('lock', 'Trying to create lock', oldLock);

		this.lockCollection.findOneAndUpdate(
			{ _id: oldLock._id, lockCounter: oldLock.lockCounter },
			{
				$set: {
					status: consts.lockStatuses.LOCKED,
					handledBy: utils.getHandlingMgmtParams(),
					lockedBy: callingFunctions
				},
				$currentDate: { dateModified: true },
				$inc: {
					lockCounter: 1,
					totalTimeSpentWaitingForLock: new Date() - startDT
				}
			},
			{ returnDocument: consts.mongoReturnDocument.AFTER },
			function(err, result) {
				if (err)
					cb(new MongoError(err), null);
				else if (result) {
					logger.sysVERBOSE('lock', 'LOCKED!! by ' + callingFunctions, result);
					logger.sysDEBUG('Zone(' + self.zone + ') LOCKED');
					cb(err, self.zone, Boolean(result));
				} else {
					//This may only happen in HA.
					logger.sysVERBOSE('lock', 'Somebody just stole my lock!!', oldLock);
					setTimeout(function() { self.acquireLock(cb, true, startDT, callingFunctions); }, lockTimeout);
				}
			}
		);
	}

	acquireLock(cb, shouldCheckAgain, startDT, caller) {
		if (!startDT)
			startDT = new Date();

		var callingFunctions = caller || logger.getCallingFunctions();
		if (!shouldCheckAgain && this.waitingForLock)
			return this.lockingQueue.enqueue({ cb: cb, startDT: startDT }, callingFunctions);

		//We should firstly set the bit, as someone else may be trying to acquire the lock while we enter to the first async call.
		this.waitingForLock = true;

		var self = this;
		const { managementId, bootVersion } = utils.getHandlingMgmtParams();
		const createLock = lock => self.createLock(lock, callingFunctions, startDT, cb);

		this.lockCollection.findOne({ _id: this.zone }, function(err, lock) {
			if (err)
				new MongoError(err).log();

			//Check if locked
			if (!lock || lock.status === consts.lockStatuses.UNLOCKED)
				//Create lock in db.
				createLock(lock);
			else {
				//currently locked, check if locked by me
				if (lock.handledBy.managementId === managementId)
					// check if it's a stale lock created by me
					if (lock.handledBy.bootVersion < bootVersion) {
						logger.sysDEBUG(`Taking a new lock over the stale lock created by old me ${managementId},
							current bootVersion: ${bootVersion}. stale lock: `, lock);

						createLock(lock);
					} else {
						//It's me locking the DB, and I think I'm alive, so I'll enqueue my locking request and wait for my turn patiently!
						logger.sysDEBUG('I\'m locking the DB, this is madness!! not really, i\'ll just wait');
						setTimeout(() => { self.acquireLock(cb, true, startDT, callingFunctions); }, lockTimeout);
					}
				else {
					// locked by other mgmt, let's check if it's still alive
					scope.checkIfRemoteManagementIsAlive(lock.handledBy.managementId, isAlive => {
						if (isAlive)
							setTimeout(() => { self.acquireLock(cb, true, startDT); }, lockTimeout);
						else {
							//It's ok to steal the lock
							logger.sysDEBUG(`I'm stealing the lock from a dead mgmt
								managementId: ${managementId}, bootVersion: ${bootVersion}. stale lock`, lock);

							createLock(lock);
						}
					});
				}
			}
		});
	}

	releaseLock(cb) {
		var self = this;
		var callingFunctions = logger.getCallingFunctions();

		self.lockCollection.updateOne(
			{
				_id: self.zone,
				status: consts.lockStatuses.LOCKED,
				'handledBy.managementId': app.get('managementId')
			},
			{
				$set: { status: consts.lockStatuses.UNLOCKED },
				$currentDate: { dateModified: true }
			},
			function(err, results) {
				if (err)
					new MongoError(err).log();

				if (results.modifiedCount === 1) {
					logger.sysDEBUG('Zone(' + self.zone + ') UNLOCKED');
					logger.sysVERBOSE('lock', 'UNLOCKED!! by ' + callingFunctions);
				} else
					logger.sysDEBUG('Lock has already been released or was not locked by this management!! zone ' + self.zone +
						' calling functions ' + callingFunctions);

				self.waitingForLock = false;

				if (self.lockingQueue.size()) {
					var entry = self.lockingQueue.dequeue();
					if (++self.releaseCounter < lockReleaseSetTimeoutCounter)
						self.acquireLock(entry.value.cb, false, entry.value.startDT, entry.caller);
					else {
						self.releaseCounter = 0;
						setTimeout(function() { self.acquireLock(entry.value.cb, false, entry.value.startDT, entry.caller); }, 2 * lockTimeout);
					}
				}

				if (cb)
					cb();
			});
	}
}

scope.checkIfRemoteManagementIsAlive = function(managementId, callback) {
	const db = app.get('db');
	const managementCluster = db.collection('managementCluster');

	let isAlive = false;

	managementCluster.findOne(
		{
			_id: managementId,
			$expr: {
				$gt: [
					'$dateModified',
					{ $dateSubtract: { startDate: '$$NOW', unit: 'minute', amount: consts.MANAGEMENT_TIMED_OUT_INTERVAL_IN_MINUTES } }
				]
			}
		}, (err, result) => {
			if (err) {
				new MongoError(err).log();
				return callback(isAlive);
			}

			isAlive = !!result;
			logger.sysDEBUG(`NodeJS server ${managementId} seems to be ${isAlive ? 'alive' : 'down'}!!`);
			callback(isAlive);
		});
};

scope.getAllowedZonesForRanking = (limitTargets, limitDisks, callback) => {
	var allowedZones = {};

	var diskLimitSet = !!(limitDisks && limitDisks.length);

	async.series([
		function getZonesFromDiskLimitation(cb) {
			if (!diskLimitSet)
				return cb();

			zoneModule.getZonesTargetsByDiskIDs(limitDisks, (err, zones) => {
				if (err)
					return cb(err);
				allowedZones = zones;
				cb();
			});
		},
		function getZonesFromTargetLimitation(cb) {
			if (diskLimitSet)
				// If we are limited by specific disks, we ignore limitTargets
				return cb();

			zoneModule.getZonesByTargetIDs(limitTargets, (err, results) => {
				// map the result to a zone with 'id' and 'targetsInZone' fields
				if (results && results.zones)
					for (var zoneID in results.zones)
						allowedZones[zoneID] = { id: zoneID, targetsInZone: new Set(results.zones[zoneID]) };

				cb(err);
			});
		},
		function postProcessAllowedZonesDict(cb) {
			for (var zoneID in allowedZones) {
				// Convert target set to integer count
				allowedZones[zoneID] = allowedZones[zoneID].targetsInZone.size;

				// remove zones with 0 allowed targets
				if (allowedZones[zoneID] == 0)
					delete allowedZones[zoneID];
			}

			cb();
		}
	], err => {
		callback(err, allowedZones);
	});
};

scope.getHighestScoredZone = (limitTargets, limitDisks, zonesToIgnore, cb) => {
	function getHighest(zones) {
		var highest = -1;
		var bestZone;

		for (var zone in zones)
			if (zones[zone] > highest) {
				highest = zones[zone];
				bestZone = zone;
			}

		cb(bestZone);
	}

	function subtractZonesToIgnore(zonesRanks) {
		zonesToIgnore = zonesToIgnore || [];
		zonesToIgnore.forEach((zoneToIgnore) => {
			delete zonesRanks[zoneToIgnore];
		});
		return zonesRanks;
	}

	var isLimitedByTargets = !!(limitTargets && limitTargets.length);
	var isLimitedByDisks = !!(limitDisks && limitDisks.length);
	if (!isLimitedByTargets && !isLimitedByDisks) {
		objectNotifier.getObject(objectNotifier.events.zonesRanksChangeEvent.name, (err, zonesRanking) => {
			zonesRanking = subtractZonesToIgnore(zonesRanking);
			return getHighest(zonesRanking);
		});
	} else {
		scope.getAllowedZonesForRanking(limitTargets, limitDisks, (err, allowedZones) => {
			if (Object.keys(allowedZones).length == 0)
				// If we had at least one limiter (target or disks) and we allowedZones here is empty
				// then there was no zone that met all conditions
				return cb(null);
			zoneModule.getZones(Object.keys(allowedZones), (err, zones) => {
				zones.forEach((zone) => {
					zone.targetsInZone = allowedZones[zone._id] ? allowedZones[zone._id] : 0;
				});

				zoneModule.getZonesRanks(zones, (err, zonesRanks) => {
					zonesRanks = subtractZonesToIgnore(zonesRanks);
					return getHighest(zonesRanks);
				});				
			});
		});
	}
};

scope.acquireZoneLockForAllocation = (limitTargets, limitDisks, zonesToIgnore, cb, caller) => {
	if (!caller)
		caller = logger.getCallingFunction();

	scope.getHighestScoredZone(limitTargets, limitDisks, zonesToIgnore, (zone) => {
		if (!zone)
			return cb(new SystemMessage(systemMessages.LOCK_NO_ZONE_FOR_ALLOCATION));
		scope.acquireLockByZone(zone, cb, caller);
	});
};

scope.acquireLockByZone = (zone, cb, caller) => {
	if (!caller)
		caller = logger.getCallingFunction();

	if (!zone)
		throw new Error('No zone given. zone: ' + zone + ' caller: ' + caller);

	if (!zonesLocks[zone])
		zonesLocks[zone] = new Lock(zone);

	zonesLocks[zone].acquireLock(cb, null, null, caller);
};

scope.acquireLockByZones = (zones, callback, caller) => {
	if (!caller)
		caller = logger.getCallingFunction();

	// order zones to prevent dead-locks
	let orderedZones = Array.from(zones).sort();

	async.eachSeries(orderedZones, (zone, cb) => {
		scope.acquireLockByZone(zone, cb, caller);
	},
	(err) => {
		if (err)
		// if one zone failed to acquire (can only be mongo error), release all and return the error
			scope.releaseLockByZones(zones, () => {
				callback(err);
			});
		else
			callback();
	});
};

scope.acquireLockByTarget = (targetID, cb) => {
	zoneModule.getZoneByTargetID(targetID, (err, zone) => {
		scope.acquireLockByZone(zone, cb);
	});
};

scope.acquireLockByPRaids = (pRaidUUIDs, cb, caller) => {
	if (!caller)
		caller = logger.getCallingFunction();

	zoneModule.getZonesByPRaidUUIDs(pRaidUUIDs, (err, pRaidZonesResult) => {
		if (err)
			return cb(err);

		var zonesToLock = pRaidZonesResult.getZonesList();
		scope.acquireLockByZones(zonesToLock, (err) => {
			cb(err, pRaidZonesResult);
		}, caller);
	});
};


scope.acquireLockByVolume = (volume, cb, caller) => {
	if (!caller)
		caller = logger.getCallingFunction();

	var zones = zoneModule.getZonesByVolume(volume);
	scope.acquireLockByZones(zones, (err) => {
		cb(err, zones);
	}, caller);
};

scope.releaseLockByZones = (zones, cb) => {
	if (!cb)
		cb = () => { };

	if (!zones.size)
		return cb();

	async.eachSeries(Array.from(zones), (zone, callback) => {
		scope.releaseLockByZone(zone, callback);
	}, cb);
};

scope.expandZoneLocks = function(alreadyLockedZones, zonesRequired, cb) {
	let zonesToLock = new Set(Array.from(zonesRequired).filter(x => !alreadyLockedZones.has(x)));

	async.eachSeries(Array.from(zonesToLock), (zone, callback) => {
		zonesLocks[zone].releaseLock(() => { callback(); });
	}, (err) => {
		cb(err, zonesToLock);
	});
};

//This function should be revised when we add multiple zones for a single volume.
scope.acquireLockByVPG = (vpg, cb) => {
	var db = app.get('db');
	var volumeCollection = db.collection('volume');

	volumeCollection.findOne({ _id: vpg, isReserved: true }, (err, reservedSpaceVolume) => {
		if (err)
			new MongoError(err).log();

		if (!reservedSpaceVolume)
			return cb();

		var zones = zoneModule.getZonesByVolume(reservedSpaceVolume);

		if (zones.size) {
			var zone = Array.from(zones)[0];
			return scope.acquireLockByZone(zone, cb);
		}

		cb();
	});
};

scope.acquireGlobalLock = (cb) => {
	execPerZone((zone, callback) => {
		zonesLocks[zone].acquireLock(() => { callback(); });
	}, cb);
};

scope.releaseLockByZone = (zone, cb) => {
	if (!zonesLocks[zone])
		zonesLocks[zone] = new Lock(zone);

	zonesLocks[zone].releaseLock(cb);
};

scope.releaseGlobalLock = (cb) => {
	execPerZone((zone, callback) => {
		zonesLocks[zone].releaseLock(() => { callback(); });
	}, cb);
};

scope.init = (cb) => {
	var db = app.get('db');
	var lockCollection = db.collection('lock');

	lockCollection.find({}).toArray((err, results) => {
		if (err) {
			err = new MongoError(err).log();
		}

		if (results && results.length) {
			results.forEach((lock) => {
				zonesLocks[lock._id] = new Lock(lock._id);
			});
		}

		cb(err);
	});
};

function execPerZone(fn, cb) {
	async.eachSeries(
		Object
			.keys(zonesLocks)
			.map((zone) => {
				return (callback) => {
					fn(zone, callback);
				};
			}),
		(item, callback) => {
			item(callback);
		},
		() => {
			if (cb)
				return cb();
		}
	);
}

scope.deleteZoneLock = (zoneID, callback) => {
	var db = app.get('db');
	var lockCollection = db.collection('lock');

	lockCollection.deleteOne({ _id: zoneID }, (err) => {
		if (err)
			new MongoError(err).log();
		else
			delete zonesLocks[zoneID];

		callback(err);
	});
};

module.exports = scope;