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
const uuid = require('uuid');

const utils = require('../utils.js');
const consts = require('../consts.js');
const systemMessages = require('../systemMessages.js');
let { MongoError, SystemAdminMessage, Entities, SystemMessage, getDriveID } = require('./error.js');

const scope = {};

scope.afterModuleLoaded = () => {
	({ MongoError, SystemAdminMessage, Entities, SystemMessage } = require('./error.js'));
};

function validateDrives(driveClasses, executeForEachClassFn, callback) {
	const db = app.get('db');
	const serverCollection = db.collection('server');

	driveClasses.forEach(dc => dc.disks = removeDuplicateDrivesByDiskID(dc.disks));

	const ids = driveClasses
		.reduce((disks, currDiskClass) => currDiskClass.disks.concat(disks), [])
		.map(d => d.diskID);

	const pipeline = [
		{ $unwind: '$disks' },
		{ $match: { 'disks.diskID': { $in: ids } } },
		{ $project: {
			_id: 0,
			diskID: '$disks.diskID',
			nodeID: '$disks.node_id',
			isOutOfService: '$disks.isOutOfService',
			status: '$disks.status'
		} }
	];

	serverCollection.aggregate(pipeline).toArray((err, dbDrives) => {
		if (err)
			return callback(new MongoError(err).log());

		const validatorFn = (driveClass, eachCallback) => {
			const driveErrors = {};

			driveClass.disks.forEach(drive => {
				const dbDrive = dbDrives.find(d => d.diskID === drive.diskID);
				let error;

				if (!dbDrive)
					error = new SystemMessage(systemMessages.DRIVECLASS_DRIVE_NOT_FOUND);
				else if (dbDrive.isOutOfService)
					error = new SystemMessage(systemMessages.DRIVECLASS_DRIVE_OUT_OF_SERVICE);
				else if ([consts.diskStatus.OK, consts.diskStatus.INITIALIZING].every(status => dbDrive.status !== status))
					error = new SystemMessage(systemMessages.DRIVECLASS_DRIVE_BAD_STATUS).addInfo(Entities.Drive.status, dbDrive.status);
				
				if (error)
					driveErrors[drive.diskID] = error.addInfo(Entities.Drive.ID, getDriveID(drive.diskID, drive.nodeID));
			});

			executeForEachClassFn(driveClass, driveErrors, eachCallback);
		};

		async.each(driveClasses, validatorFn, callback);
	});
}

function removeDuplicateDrivesByDiskID(drivesWithPotentialDuplicates) {
	let drivesByID = {};

	drivesWithPotentialDuplicates.forEach(d => drivesByID[d.diskID] = d);

	return Object.values(drivesByID);
}

scope.saveDriveClasses = function(driveClasses, user, cb) {
	const messages = [];
	const executeForEachDriveClassFn = (driveClass, driveErrors, callback) => {
		const addInfoToMessage = message => message.addInfo(Entities.DriveClass.ID, driveClass._id);
		
		if (Object.keys(driveErrors).length) {
			const message = new SystemAdminMessage(systemMessages.DRIVECLASS_SAVE_FAILED);
			Object.values(driveErrors).forEach(e => message.addInfo(Entities.Error, e.toApiResponse()));
			messages.push(addInfoToMessage(message));
			return callback();
		}

		driveClass.createdBy = driveClass.modifiedBy = user.email;
		driveClass.dateCreated = driveClass.dateModified = new Date();
		driveClass.uuid = uuid.v1();

		utils.insertToCollection(driveClass, 'diskClass', err => {
			if (err)
				messages.push(addInfoToMessage(new SystemAdminMessage(systemMessages.DRIVECLASS_SAVE_FAILED)
					.addInfo(Entities.Error, err.isDuplicateKeyError ? new SystemMessage(systemMessages.DRIVECLASS_SAVE_NAME_ALREADY_EXISTS) : err)));
			else 
				messages.push(addInfoToMessage(new SystemAdminMessage(systemMessages.DRIVECLASS_SAVED).addInfo(Entities.DriveClass.UUID, driveClass.uuid)));
			
			callback();
		});
	};

	validateDrives(driveClasses, executeForEachDriveClassFn, err => { 
		if (err) 
			messages.push(new SystemAdminMessage(systemMessages.DRIVECLASS_SAVE_FAILED).addInfo(Entities.Error, err));
			
		cb(messages);
	});
};

scope.updateDriveClasses = (driveClasses, user, callback) => {
	const messages = [];
	const driveClassesToUpdate = [];
	const diskClassesGettingLarger = [];
	const executeForEachDriveClassFn = (driveClass, driveErrors, callback) => {
		const addInfoToMessage = message => message.addInfo(Entities.DriveClass.ID, driveClass._id).addInfo(Entities.DriveClass.UUID, driveClass.uuid);

		if (Object.keys(driveErrors).length) {
			const message = new SystemAdminMessage(systemMessages.DRIVECLASS_UPDATE_FAILED);
			Object.keys(driveErrors).forEach(e => message.addInfo(Entities.Error, e));
			messages.push(addInfoToMessage(message));
			return callback();
		}

		utils.getDisksByDiskClass([{ _id: driveClass._id, uuid: driveClass.uuid }], null, null, (err, results) => {
			if (err) {
				messages.push(addInfoToMessage(
					new SystemAdminMessage(systemMessages.DRIVECLASS_UPDATE_FAILED).addInfo(Entities.Error, new MongoError(err).log())));
				return callback();
			}

			if (!results?.length) {
				messages.push(addInfoToMessage(new SystemAdminMessage(systemMessages.DRIVECLASS_UPDATE_NOT_FOUND)));
				return callback();
			}

			const existingDiskIDs = results.map(e => e._id);
			const diskIDsToUpdate = driveClass.disks.map(drive => drive.diskID);
			const newDiskIDs = diskIDsToUpdate.filter(diskID => !existingDiskIDs.includes(diskID));
			const deleteDiskIDs = existingDiskIDs.filter(diskID => !diskIDsToUpdate.includes(diskID));

			async.series([
				cb => {
					if (!deleteDiskIDs.length)
						return cb();

					utils.getVolumesAffectedDiskClass(driveClass, deleteDiskIDs, (err, results) => {
						let systemMessage;

						if (err)
							systemMessage = err;
						else if (results.length) {
							systemMessage = new SystemMessage(systemMessages.DRIVECLASS_UPDATE_VOLUME_IN_USE);
							results.forEach(r => systemMessage.addInfo(Entities.Volume.ID, r._id));
						}

						if (systemMessage) {
							messages.push(addInfoToMessage(new SystemAdminMessage(systemMessages.DRIVECLASS_UPDATE_FAILED)));
							return cb(true);
						}
						
						//No volumes were allocated with this diskClass it's safe to remove it.
						utils.deleteDisksFromVolumeLimiter(driveClass, existingDiskIDs, deleteDiskIDs, cb);
					});
				},
				cb => {
					if (newDiskIDs.length) {
						utils.addObjectsToVolumeLimiter('diskClasses', driveClass._id, newDiskIDs, 'limitByDisks');
						diskClassesGettingLarger.push(driveClass);
					}

					driveClass.modifiedBy = user.email;
					driveClass.dateModified = new Date();

					cb();
				}
			], err => { 
				if (!err)
					driveClassesToUpdate.push(driveClass);
				
				callback();
			});
		});
	};

	validateDrives(driveClasses, executeForEachDriveClassFn, err => { 
		if (err) 
			messages.push(new SystemAdminMessage(systemMessages.DRIVECLASS_UPDATE_FAILED).addInfo(Entities.Error, err));

		if (!driveClassesToUpdate.length) 
			return callback(messages);

		utils.updateCollection(driveClassesToUpdate, 'diskClass', false, (err, results) => {
			if (err)
				new MongoError(err).log();
			else
				utils.startVolumeRebuildByDiskClasses(diskClassesGettingLarger, user.email);


			driveClassesToUpdate.forEach(driveClass => {
				let error;
				const driveClassResult = results[driveClass._id];
				
				if (driveClassResult.matchedCount == 0)
					error = new SystemMessage(systemMessages.DRIVECLASS_UPDATED_NOT_FOUND);	
				else
					error = driveClassResult.err;

				const systemAdminMessage = new SystemAdminMessage(error ? systemMessages.DRIVECLASS_UPDATE_FAILED : systemMessages.DRIVECLASS_UPDATED)
					.addInfo(Entities.DriveClass.ID, driveClass._id)
					.addInfo(Entities.DriveClass.UUID, driveClass.uuid); 

				if (error)
					systemAdminMessage.addInfo(Entities.Error, error);

				messages.push(systemAdminMessage);
			});
			
			callback(messages);
		});
	});
};

scope.deleteDriveClasses = (driveClasses, callback) => {
	const messages = [];
	const db = app.get('db');
	const volumeCollection = db.collection('volume');

	const deleteDriveClass = (driveClass, eachCallback) => {
		let errorLog;
		const query = { diskClasses: driveClass._id };
		const onError = () => done(new SystemAdminMessage(systemMessages.DRIVECLASS_DELETE_FAILED).addInfo(Entities.Error, errorLog));
		const done = systemAdminMessage => {
			messages.push(systemAdminMessage.addInfo(Entities.DriveClass.ID, driveClass._id).addInfo(Entities.DriveClass.UUID, driveClass.uuid));
			return eachCallback();
		};

		volumeCollection.countDocuments(query, (err, count) => {
			if (err)
				errorLog = new MongoError(err).log();
			else if (count > 0)
				errorLog = new SystemMessage(systemMessages.DRIVECLASS_DELETE_USED);
			
			if (errorLog)
				return onError();
			
			utils.deleteFromCollection([driveClass], 'diskClass', false, (err, results) => {
				if (err)
					errorLog = new MongoError(err).log();
				else if (!results.deletedCount)
					errorLog = new SystemMessage(systemMessages.DRIVECLASS_DELETE_NOT_FOUND);
				
				if (errorLog)
					return onError();

				done(new SystemAdminMessage(systemMessages.DRIVECLASS_DELETED));
			});
		});
	};

	async.each(driveClasses, deleteDriveClass, () => callback(messages));
};

scope.getDomains = (projection, cb) => {
	const db = app.get('db');
	const diskClassCollection = db.collection('diskClass');
	const field = projection ? `domains.${projection}` : 'domains';

	return diskClassCollection.distinct(field, (err, results) => {
		if (err)
			new MongoError(err).log();

		cb(results);
	});
};

scope.removeEvictedDrivesFromClasses = (disks, cb) => {
	var db = app.get('db');
	var diskClassCollection = db.collection('diskClass');
	var diskIDs = disks.map(disk => disk.diskID);

	diskClassCollection.updateMany({}, { $pull: { disks: { diskID: { $in: diskIDs } } } }, err => {
		if (err)
			new MongoError(err).log();

		cb();
	});
};

scope.updateDriveClassNodeIDFromReappearingDrive = reappearingDrive => {
	const { diskID, Model, nodeID } = reappearingDrive;
	const db = app.get('db');
	const diskClassCollection = db.collection('diskClass');
	const query = { 'disks.diskID': diskID, 'disks.model': Model };
	const update = { $set: { 'disks.$[].node_id': nodeID } };

	diskClassCollection.updateMany(query, update, err => {
		if (err)
			new MongoError(err).log();
	});
};

scope.fetchDriveClassByID = function(driveClassID, cb) {
	utils.fetchEntityByID('diskClass', driveClassID, false, {}, systemMessages.DRIVECLASS_DRIVE_NOT_FOUND, cb);
};

module.exports = scope;