/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

const async = require('async');
const uuid = require('uuid');

const utils = require('../utils.js');
const logger = require('../logger.js');
const systemMessages = require('../systemMessages.js');
const { MongoError, Entities, SystemAdminMessage, SystemMessage, Differentiators } = require('../modules/error.js');
const consts = require('../consts.js');
const lockModule = require('./lock.js');

const scope = {};

scope.createReservedSpaceVolume = (vpgWithReserve, user, callback) => {
	vpgWithReserve.forEach(function(e) {
		if (e.capacity && e.capacity > 0) {
			e.VPG = e.name;
			e.isReserved = true;
		}
	});
	//Save reserved volume.
	utils.saveVolumes(vpgWithReserve, false, user, callback);
};

scope.saveVPGs = (vpgs, user, mainCallback) => {
	var db = app.get('db');
	var vpgCollection = db.collection('volumeProvisioningGroup');

	//Use the name as the ID of the document.
	vpgs.forEach(function(e) {
		e._id = e.name;
		e.uuid = uuid.v1();
		e.modifiedBy = user.email;
		e.createdBy = user.email;
		e.dateCreated = new Date();
		e.dateModified = new Date();
		utils.applyProtectionLevelDefaults(e);
	});

	let messages = [];
	let vpgsToRemove = [];

	utils.validateVolumesFeatureCompatibility(vpgs, (err) => {
		if (err)
			return mainCallback([new SystemAdminMessage(systemMessages.VPG_SAVE_FAILURE).addInfo(Entities.Error, err)]);

		vpgCollection.insertMany(vpgs, function(error) {
			if (error) {
				var err = new MongoError(error);

				if (err.isDuplicateKeyError) {
					err = new SystemAdminMessage(systemMessages.VPG_SAVE_FAILURE_DUP_KEY);
				} else {
					err = new SystemAdminMessage(systemMessages.VPG_SAVE_FAILURE).addInfo(Entities.Error, err);
				}

				return mainCallback([err]);
			}

			var vpgWithReserve = vpgs.filter(function(e) { return e.capacity && e.capacity > 0; });
			var vpgWithoutReserve = vpgs.filter(function(e) { return !e.capacity || e.capacity <= 0; });

			async.series([
				function(callback) {
					scope.createReservedSpaceVolume(vpgWithReserve, user, (newLogs) => {
						vpgsToRemove = newLogs
							.filter(l => l.systemMessage.id !== systemMessages.VPG_RESERVATION_MADE.id)
							.map(l => ({ _id: l.getAdditionalInfoByKey(Entities.VPG.ID) }));

						messages = messages.concat(newLogs);

						callback();
					});
				},
				function(callback) {
					vpgWithoutReserve.forEach(function(e) {
						messages.push(new SystemAdminMessage(systemMessages.VPG_SAVED).addInfo(Entities.VPG.ID, e._id).addInfo(Entities.VPG.UUID, e.uuid));
					});

					callback();
				}
			], function() {
				//Removing unsuccessfull VPG.
				utils.deleteFromCollection(vpgsToRemove, 'volumeProvisioningGroup', false, function(err) {
					if (err)
						new MongoError(err).log();

					const isMessageFromVpgsToRemove = message => vpgsToRemove
						.map(vpg => vpg._id)
						.includes(message.getAdditionalInfoByKey(Entities.VPG.ID));

					const finalLogs = messages
						.map(message => (isMessageFromVpgsToRemove(message)
							? new SystemAdminMessage(systemMessages.VPG_SAVE_FAILED).addInfo(Entities.Error, message)
							: new SystemAdminMessage(systemMessages.VPG_SAVED).addInfo(Entities.VPG.UUID, message.getAdditionalInfoByKey(Entities.VPG.UUID)))
							.addInfo(Entities.VPG.ID, message.getAdditionalInfoByKey(Entities.VPG.ID)));

					mainCallback(finalLogs);
				});
			});
		});
	});
};

scope.deleteVPGs = (vpgs, mainCallback) => {
	var db = app.get('db');
	var vpgCollection = db.collection('volumeProvisioningGroup');
	var volumeCollection = db.collection('volume');
	const messages = [];

	async.each(vpgs, function(vpg, callback) {
		const createSysMessage = systemMessage =>
			new SystemMessage(systemMessage).addInfo(Entities.VPG.ID, vpg._id).addInfo(Entities.VPG.UUID, vpg.uuid);

		vpgCollection.findOne({ _id: vpg._id, uuid: vpg.uuid }, function(err, vpgFromDB) {
			if (!vpgFromDB) {
				messages.push(createSysMessage(systemMessages.DELETE_VPG_NOT_FOUND));
				return callback();
			}
			if (vpgFromDB.isDefault) {
				messages.push(createSysMessage(systemMessages.DELETE_VPG_FAILED_DEFAULT_VPG));
				return callback();
			}

			//Check if the VPG has derived volumes.
			volumeCollection.find({ VPG: vpg._id }).toArray(function(err, results) {
				if (err) {
					messages.push(new MongoError(err).log());
					return callback(err);
				}

				var volumesUsingTheVPGReserved = results.filter(function(v) { return v.VPG === vpg._id && v._id !== vpg._id; });

				//Check if the VPG has derived volumes
				if (volumesUsingTheVPGReserved && volumesUsingTheVPGReserved.length) {
					//Got derived volumes don't delete this VPG!
					var volumeNames = volumesUsingTheVPGReserved.map(function(v) { return v.name; });
					messages.push(createSysMessage(systemMessages.DELETE_VPG_FAILED_IN_USE).addInfo(Entities.Error, volumeNames));
					callback();
				} else {
					//None derived, lets delete his reserved space, and itself.
					utils.forceDeleteVolumes(results, null, null, function(err) {
						if (err) {
							messages.push(createSysMessage(systemMessages.DELETE_VPG_FAILED).addInfo(Entities.Error, err));
							callback(err);
						} else {
							//Delete the VPG
							utils.deleteFromCollection([vpg], 'volumeProvisioningGroup', false, function(err) {
								messages.push(createSysMessage(err ? systemMessages.DELETE_VPG_FAILED_DELETE : systemMessages.VPG_DELETED));

								callback(err);
							});
						}
					});
				}
			});
		});
	}, function(err) {
		if (err)
			new SystemAdminMessage(systemMessages.VPG_DELETE_FAILURE).addInfo(Entities.Error, err).log();

		const finalLogs = messages.map(l => {
			return (l.systemMessage.id === systemMessages.VPG_DELETED.id
				? new SystemAdminMessage(systemMessages.VPG_DELETED)
				: new SystemAdminMessage(systemMessages.VPG_DELETE_FAILED).addInfo(Entities.Error, l)
			).addInfo(Entities.VPG.ID, l.getAdditionalInfoByKey(Entities.VPG.ID)).addInfo(Entities.VPG.UUID, l.getAdditionalInfoByKey(Entities.VPG.UUID));
		});

		mainCallback(finalLogs);
	});
};

scope.extendVPGs = (vpgs, user, mainCallback) => {
	const messages = [];
	const db = app.get('db');
	const vpgCollection = db.collection('volumeProvisioningGroup');

	async.each(vpgs, (vpg, eachCallback) => {
		let vpgFromDB, volume;

		const createSysMessage = systemErrorMessage => (systemErrorMessage ?
			new SystemAdminMessage(systemMessages.VPG_EXTEND_FAILED).addInfo(Entities.Error, systemErrorMessage) :
			new SystemAdminMessage(systemMessages.VPG_EXTENDED))
			.addInfo(Entities.VPG.ID, vpg._id).addInfo(Entities.VPG.UUID, vpg.uuid);

		async.series([
			function fetchVPG(cb) {
				const projection = {
					name: 1,
					isDefault: 1,
					capacity: 1,
					RAIDLevel: 1,
					numberOfMirrors: 1,
					dataBlocks: 1,
					parityBlocks: 1,
					stripeWidth: 1,
					stripeSize: 1,
					enableCrcCheck: 1,
					protectionLevel: 1,
					diskClasses: 1,
					serverClasses: 1,
					allowAllocationOnOfflineDrives: 1,
				};

				vpgCollection.findOne({ _id: vpg._id, uuid: vpg.uuid }, { projection }, (err, result) => {
					if (err) {
						messages.push(new MongoError(err).log());
						return cb(true);
					}

					vpgFromDB = result;

					if (!vpgFromDB) {
						messages.push(createSysMessage(systemMessages.VPG_NOT_FOUND));
						return cb(true);
					}

					if (vpgFromDB.isDefault) {
						messages.push(createSysMessage(systemMessages.DEFAULT_VPG_NOT_EDITABLE));
						return cb(true);
					}

					if (vpgFromDB.capacity >= vpg.capacity) {
						messages.push(createSysMessage(systemMessages.UNSUPPORTED_VPG_CAPACITY)
							.addInfo(Differentiators.Existing, Entities.VPG.capacity, vpgFromDB.capacity)
							.addInfo(Differentiators.New, Entities.VPG.capacity, vpg.capacity));
						return cb(true);
					}

					volume = { ...vpg, RAIDLevel: vpgFromDB.RAIDLevel, name: vpgFromDB.name };

					['stripeSize', 'stripeWidth', 'numberOfMirrors', 'dataBlocks', 'parityBlocks', 'enableCrcCheck',
						'protectionLevel', 'diskClasses', 'serverClasses', 'allowAllocationOnOfflineDrives'].forEach(k => {
						if (vpgFromDB[k])
							volume[k] = vpgFromDB[k];
					});

					cb();
				});
			},
			function fetchVolumeUUIDIfNeeded(cb) {
				if (!vpgFromDB.capacity)
					return cb();

				// reserved space volume exists
				const volumeCollection = db.collection('volume');

				volumeCollection.findOne({ _id: vpg._id }, { projection: { uuid: 1 } }, (err, result) => {
					if (err) {
						messages.push(new MongoError(err).log());
						return cb(true);
					}

					if (!result) {
						messages.push(createSysMessage(systemMessages.VPG_RESERVED_VOLUME_NOT_FOUND));
						return cb(true);
					}

					volume.uuid = result.uuid;

					cb();
				});
			},
			function createOrExtendReservedSpaceVolume(cb) {
				const operation = !vpgFromDB.capacity ? scope.createReservedSpaceVolume : utils.extendVolumes;

				operation([volume], user, newLogs => {
					const operationLog = newLogs[0];
					const success = [systemMessages.VPG_RESERVATION_MADE.id, systemMessages.VOLUME_EXTENDED.id].includes(operationLog.systemMessage.id);
					if (!success) {
						const error = operationLog.getAdditionalInfoByKey(Entities.Error) || operationLog;
						messages.push(createSysMessage(error));
						return cb(true);
					}

					messages.push(createSysMessage());

					cb();
				});
			},
			function updateVPG(cb) {
				const query = { _id: vpg._id, capacity: vpgFromDB.capacity };
				const update = { $set: { capacity: volume.capacity } };

				vpgCollection.updateOne(query, update, (err, res) => {
					if (err)
						return cb(new MongoError(err).log());

					if (!res.matchedCount) {
						// this condition is not problematic - it means that another extend happen at the same time, finished earlier than us,
						// and extended to something bigger than us (otherwise, we will get failed to extend volumes as we can't shrink a volume)
						logger.sysDEBUG('Looks like the VPG capacity was extended while this VPG extend.');
					}

					cb();
				});
			}
		], () => eachCallback());
	}, () => mainCallback(messages));
};

scope.reclaimVPGs = (vpgs, user, mainCallback) => {
	const messages = [];
	const db = app.get('db');
	const vpgCollection = db.collection('volumeProvisioningGroup');
	const volumeCollection = db.collection('volume');

	async.each(vpgs, (vpg, eachCallback) => {
		let vpgFromDB;

		const createSysMessage = systemErrorMessage => (systemErrorMessage ?
			new SystemAdminMessage(systemMessages.VPG_RECLAIM_FAILED).addInfo(Entities.Error, systemErrorMessage) :
			new SystemAdminMessage(systemMessages.VPG_RECLAIMED)).addInfo(Entities.VPG.ID, vpg._id).addInfo(Entities.VPG.UUID, vpg.uuid);

		async.series([
			function fetchVPG(cb) {
				vpgCollection.findOne({ _id: vpg._id, uuid: vpg.uuid }, (err, result) => {
					if (err) {
						messages.push(new MongoError(err).log());
						return cb(true);
					}

					vpgFromDB = result;

					if (!vpgFromDB) {
						messages.push(createSysMessage(systemMessages.VPG_NOT_FOUND));
						return cb(true);
					}

					if (vpgFromDB.isDefault) {
						messages.push(createSysMessage(systemMessages.DEFAULT_VPG_NOT_EDITABLE));
						return cb(true);
					}

					if (!vpgFromDB.capacity) {
						messages.push(createSysMessage(systemMessages.VPG_RECLAIM_NOTHING_TO_RECLAIM));
						return cb(true);
					}

					cb();
				});
			},
			function acquireLockAndReclaim(cb) {
				let zone;

				const reclaimDone = (err) => {
					if (err) {
						messages.push(createSysMessage(err));
						lockModule.releaseLockByZone(zone, () => { cb(err); });

						return;
					}

					updateVPGCapacityFromReservedVolume(vpg._id, user, (err) => {
						lockModule.releaseLockByZone(zone, () => {
							if (err)
								messages.push(createSysMessage(err));
							else
								messages.push(createSysMessage());

							cb(err);
						});
					});
				};

				lockModule.acquireLockByVPG(vpg._id, (err, lockedZone) => {
					if (err) {
						messages.push(createSysMessage(err));
						return cb(err);
					}
					zone = lockedZone;

					// Re-check allocated capacity under lock since volumes may have been created/deleted.
					getVolumesUsageCapacity(vpg._id, result => {
						if (result instanceof MongoError)
							return reclaimDone(result);

						const allocatedCapacity = (result && result.allocatedCapacity) || 0;
						const allocatedBlocks = (result && result.allocatedBlocks) || 0;
						const reservedBlocks = (result && result.reservedBlocks) || 0;

						if (allocatedBlocks >= reservedBlocks) {
							messages.push(createSysMessage(systemMessages.VPG_RECLAIM_NOTHING_TO_RECLAIM));
							lockModule.releaseLockByZone(zone, () => { cb(true); });
							return;
						}

						volumeCollection.findOneAndUpdate(
							{ _id: vpg._id, isReserved: true },
							{ $set: { reclaimAction: consts.reservedVolumeReclaimActions.IN_PROGRESS, handledBy: utils.getHandlingMgmtParams() } },
							{ returnDocument: consts.mongoReturnDocument.AFTER },
							(err, reservedVol) => {
								if (err)
									return reclaimDone(new MongoError(err).log());

								if (!reservedVol)
									return reclaimDone(new SystemMessage(systemMessages.VPG_RESERVED_VOLUME_NOT_FOUND));

								if (allocatedCapacity) {
									utils.shrinkReservedSpaceVolume(vpg._id, allocatedCapacity, reclaimDone);
								} else {
									utils.forceDeleteVolume(reservedVol, zone, null, reclaimDone);
								}
							}
						);
					});
				});
			}
		], () => eachCallback());
	}, () => mainCallback(messages));
};

function updateVPGCapacityFromReservedVolume(vpgId, user, cb) {
	const db = app.get('db');
	const vpgCollection = db.collection('volumeProvisioningGroup');
	const volumeCollection = db.collection('volume');

	volumeCollection.findOne({ _id: vpgId, isReserved: true }, { projection: { capacity: 1 } }, (err, reservedVol) => {
		if (err)
			return cb(new MongoError(err).log());

		const newCapacity = reservedVol ? reservedVol.capacity : 0;
		vpgCollection.updateOne(
			{ _id: vpgId },
			{ $set: { capacity: newCapacity, modifiedBy: user.email, dateModified: new Date() } },
			(err) => {
				if (err)
					return cb(new MongoError(err).log());
				cb();
			}
		);
	});
}

scope.updateVPGs = (vpgs, user, mainCallback) => {
	var db = app.get('db');
	var vpgCollection = db.collection('volumeProvisioningGroup');
	const messages = [];

	async.each(vpgs, function(vpg, callback) {
		async.series([
			function fetchVPG(cb) {
				if (vpg.capacity)
					return cb(new SystemMessage(systemMessages.VPG_CAPACITY_UPDATE_NOT_ALLOWED));

				vpgCollection.findOne({ _id: vpg._id, uuid: vpg.uuid }, function(err, dbVPG) {
					if (!dbVPG)
						err = new SystemMessage(systemMessages.VPG_NOT_FOUND);
					else if (dbVPG.isDefault)
						err = new SystemMessage(systemMessages.DEFAULT_VPG_NOT_EDITABLE);
					else if (Object.prototype.hasOwnProperty.call(vpg, 'allowAllocationOnOfflineDrives')) {
						utils.validateAllocationOnOfflineDrives(dbVPG, vpg, (validationErr) => {
							return cb(validationErr);
						});
					} else {
						cb(err);
					}
				});
			},
			function updateVPG(cb) {
				const query = { _id: vpg._id, $or: [{ isDefault: { $exists: 0 } }, { isDefault: false }] };
				const $set = {};

				consts.updatableVpgProperties.forEach(k => {
					if (Object.prototype.hasOwnProperty.call(vpg, k))
						$set[k] = vpg[k];
				});

				if (!Object.keys($set).length)
					return cb();

				$set.modifiedBy = user.email;
				$set.dateModified = new Date();

				vpgCollection.updateOne(query, { $set }, err => {
					if (err) {
						err = new MongoError(err).log();
					}

					cb(err);
				});
			}
		], function endOfWaterfall(err) {
			var message = err
				? new SystemAdminMessage(systemMessages.VPG_UPDATE_FAILED).addInfo(Entities.Error, err)
				: new SystemAdminMessage(systemMessages.VPG_UPDATED);

			message.addInfo(Entities.VPG.ID, vpg._id).addInfo(Entities.VPG.UUID, vpg.uuid);

			messages.push(message);

			callback();
		});
	}, function() {
		mainCallback(messages);
	});
};

function getVolumesUsageCapacity(vpgID, cb) {
	const db = app.get('db');
	const vpgCollection = db.collection('volumeProvisioningGroup');

	let pipeline = [
		{
			$lookup: {
				from: 'volume',
				localField: '_id',
				foreignField: 'VPG',
				as: 'volumes'
			}
		},
		{
			$addFields: {
				reservedBlocks: {
					$let: {
						vars: {
							reservedVol: {
								$first: {
									$filter: {
										input: '$volumes',
										as: 'vol',
										cond: { $eq: ['$$vol._id', '$_id'] }
									}
								}
							}
						},
						in: { $ifNull: ['$$reservedVol.blocks', 0] }
					}
				},
				volumes: {
					$filter: {
						input: '$volumes',
						as: 'vol',
						cond: { $ne: ['$$vol._id', '$_id'] }
					}
				}
			}
		},
		{
			$addFields: {
				allocatedBlocks: {
					$sum: {
						$map: {
							input: '$volumes',
							as: 'vol',
							in: {
								$sum: {
									$map: {
										input: '$$vol.chunks',
										as: 'chunk',
										in: {
											$let: {
												vars: {
													firstSeg: { $first: { $first: '$$chunk.pRaids.diskSegments' } }
												},
												in: {
													$cond: [
														{ $eq: ['$$firstSeg.fromReserved', true] },
														{ $add: [{ $subtract: ['$$chunk.vlbe', '$$chunk.vlbs'] }, 1] },
														0
													]
												}
											}
										}
									}
								}
							}
						}
					}
				},
				volumesInUse: {
					$map: {
						input: '$volumes',
						as: 'vol',
						in: { name: '$$vol._id', uuid: '$$vol.uuid' }
					}
				}
			}
		},
		{
			$addFields: {
				allocatedCapacity: {
					$divide: [
						{ $multiply: ['$allocatedBlocks', consts.BLOCK_SIZE] },
						consts.GB
					]
				},
			}
		},
		{
			$addFields: {
				freeCapacity: {
					$cond: [
						'$allowOverflow',
						null,
						{ $subtract: ['$capacity', '$allocatedCapacity'] }
					]
				}
			}
		},
		{
			$project: {
				_id: 0,
				VPG: '$_id',
				allowOverflow: 1,
				totalCapacity: '$capacity',
				allocatedCapacity: 1,
				allocatedBlocks: 1,
				reservedBlocks: 1,
				freeCapacity: 1,
				volumesInUse: 1
			}
		}
	];

	if (vpgID)
		pipeline = [{ $match: { _id: vpgID } }, ...pipeline];

	vpgCollection.aggregate(pipeline).toArray((err, result) => {
		if (err)
			return cb(new MongoError(err));

		if (vpgID) {
			result = result[0];
			if (!result)
				result = {};
		}

		cb(result);
	});
}

scope.fetchVPGByID = (id, cb) => {
	utils.fetchEntityByID('volumeProvisioningGroup', id, false, {}, systemMessages.VPG_NOT_FOUND, cb);

};

scope.getVolumesCapacityUsageByID = (id, callback) => {
	getVolumesUsageCapacity(id, callback);
};

scope.getVolumesCapacityUsageAll = callback => {
	getVolumesUsageCapacity(null, callback);
};

module.exports = scope;
