/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var fs = require('fs');
var path = require('path');
var async = require('async');
var childProcess = require('child_process');
const fsext = require('fs-ext');

var logger = require('./logger.js');
var events = require('./events.js');
var consts = require('./consts.js');
var objectNotifier = require('./objectNotifier.js');

var config = require('./modules/config.js');
var { buildMongoConnectionCommandlineArgs } = require('./modules/mongoCMDLineArgsBuilder.js');
var lockModule = require('./modules/lock.js');
var systemMessages = require('./systemMessages.js');
var { Entities, SystemMessage } = require('./modules/error.js');

var scope = {};

var MAIN_SAMPLING_INTERVAL_BY_MINUTES = 1;

scope.lastBackupTime = null;
scope.backupsIsInProgress = {};

function removeBackupFromFS(backupToRemove, callback) {
	fs.unlink(path.join(config.get('Backup.backupPath'), backupToRemove.fileName), function(err) {
		if (err)
			return callback(new SystemMessage(systemMessages.DBBACKUP_BACKUP_REMOVE_FAILED).addInfo(Entities.Error, err).log());

		backupToRemove.removed = true;
		events.emitEvent(null, objectNotifier.events.backupRemovedEvent, backupToRemove.fileName);
		callback();
	});
}

function isDailyBackup() {
	var hoursMinutesArr = config.get('Backup.dailyBackupTime').split(':');
	var configuredHours = 0;
	var configuredMinutes = 0;
	var dailyConfiguredTimeStart = new Date();
	var dailyConfiguredTimeEnd = new Date();
	var now = new Date();

	if (hoursMinutesArr.length == 2 && !isNaN(hoursMinutesArr[0]) && !isNaN(hoursMinutesArr[1])) {
		configuredHours = parseInt(hoursMinutesArr[0]);
		configuredMinutes = parseInt(hoursMinutesArr[1]);
	}

	dailyConfiguredTimeStart.setHours(configuredHours);
	dailyConfiguredTimeStart.setMinutes(configuredMinutes);
	dailyConfiguredTimeStart.setSeconds(0);

	dailyConfiguredTimeEnd.setHours(dailyConfiguredTimeStart.getHours());
	dailyConfiguredTimeEnd.setMinutes(dailyConfiguredTimeStart.getMinutes() + MAIN_SAMPLING_INTERVAL_BY_MINUTES);
	dailyConfiguredTimeEnd.setSeconds(0);

	if (now >= dailyConfiguredTimeStart && now < dailyConfiguredTimeEnd)
		return true;
	else
		return false;
}

function getExcludedCollectionsStr(collectionsToExclude) {
	var excludedCollections = ' ';

	collectionsToExclude.forEach(collection => {
		excludedCollections += '--excludeCollection ' + collection + ' ';
	});

	return excludedCollections;
}

function createBackup(dbName, outputDir, backupType, callback) {
	var currTime = new Date();
	currTime.setHours(currTime.getHours() - currTime.getTimezoneOffset() / 60);
	var backupId = dbName + '_' + currTime.toJSON() + '.gz';
	var backupFileName = backupType + '_' + backupId;
	var backupFilePath = path.join(outputDir, backupFileName);
	var tmpBackupFilePath = backupFilePath + '~';
	var collectionsToExclude = [];
	var mongoConnectionCommandLineArgs = buildMongoConnectionCommandlineArgs(config.get('mongoConnection'), true);
	var dumpCommand = `mongodump --gzip --archive="${tmpBackupFilePath}" ${getExcludedCollectionsStr(collectionsToExclude)} ${mongoConnectionCommandLineArgs}`;

	childProcess.exec(dumpCommand, function(err) {
		if (err) {
			delete err.cmd; // may include the password in plain text			
			new SystemMessage(systemMessages.DBBACKUP_BACKUP_DUMP_FAILED).addInfo(Entities.Error, err).addInfo(Entities.Path, tmpBackupFilePath).log();
			return callback(err, null);
		}

		// read backup file from fs and create a backup object details
		var backup = {};
		fs.rename(tmpBackupFilePath, backupFilePath, function(err) {
			if (err) {
				new SystemMessage(systemMessages.DBBACKUP_BACKUP_RENAME_AFTER_COMPLETION_FAILED)
					.addInfo(Entities.Error, err).addInfo(Entities.Path, tmpBackupFilePath).log();
				return callback(err, null);
			}

			fs.stat(backupFilePath, function(err, stats) {
				if (err) {
					new SystemMessage(systemMessages.DBBACKUP_READ_BACKUP_INFO_FROM_FS_FAILED)
						.addInfo(Entities.Error, err).addInfo(Entities.Path, backupFilePath).log();
					return callback(err, null);
				}

				backup.backup_id = backupId;
				backup.fileName = backupFileName;
				backup.dateCreated = stats.ctime;
				backup.size = stats.size;
				backup.type = backupType;

				callback(null, backup);
			});
		});
	});
}

function rotateBackupsIfNeeded(allBackups, backupType) {
	var typedRotationThreshold = consts.DEFAULT_BACKUP_ROTATION_THRESHOLD;
	var typeFilteredBackups = Object.keys(allBackups)
		.filter(function(bcp) { return bcp.indexOf(backupType) == 0; })
		.map(function(bcp) { return allBackups[bcp]; });

	switch (backupType) {
		case consts.backupTypes.HOURLY:
			typedRotationThreshold = config.get('Backup.hourlyRotationThreshold');
			break;
		case consts.backupTypes.DAILY:
			typedRotationThreshold = config.get('Backup.dailyRotationThreshold');
			break;
	}

	function sortByDateRecentFirst(a, b) {
		return b.dateCreated - a.dateCreated;
	}

	typeFilteredBackups.sort(sortByDateRecentFirst);
	var oldBackupsToRemove = typeFilteredBackups.slice(typedRotationThreshold);

	async.each(
		oldBackupsToRemove,
		function(backupToRemove, callback) {
			removeBackupFromFS(backupToRemove, function() {
				// ignore error on a single backup file and continue
				callback();
			});
		},
		function() {
			var atLeastOneFailedToRemove = oldBackupsToRemove.find(backup => !backup.removed);
			if (atLeastOneFailedToRemove)
				scope.reloadBackupsFromFileSystemToCache();
		}
	);
}

function isHourlyBackup() {
	var hourlyBcpInterval = config.get('Backup.hourlyBackupInterval');
	var currentTime = new Date();
	var hourlyBackupsIntervalInMillis = hourlyBcpInterval * 60 * 60 * 1000;
	var isHourlyBackupTime = currentTime - scope.lastBackupTime >= hourlyBackupsIntervalInMillis;
	return isHourlyBackupTime;
}

scope.startBackupProcess = function(callback) {
	var hourlyBcpInterval = config.get('Backup.hourlyBackupInterval');
	if (hourlyBcpInterval <= 0 || hourlyBcpInterval > 24) {
		new SystemMessage(systemMessages.DBBACKUP_INVALID_CONFIGURATION).addInfo(Entities.Backup.hourlyBackupInterval, hourlyBcpInterval).log();
		return callback();
	}

	callback();

	scope.backupsIsInProgress[consts.backupTypes.DAILY] = false;
	scope.backupsIsInProgress[consts.backupTypes.HOURLY] = false;

	function rescheduleNextBackupRun() {
		setTimeout(checkIfNewBackupNeeded, MAIN_SAMPLING_INTERVAL_BY_MINUTES * 60 * 1000);
	}

	function checkIfNewBackupNeeded() {
		var isHourlyBackupTime = isHourlyBackup();
		var isDailyBackupTime = isDailyBackup();

		if (isHourlyBackupTime || isDailyBackupTime) {
			var backupType = isDailyBackupTime ? consts.backupTypes.DAILY : consts.backupTypes.HOURLY;
			scope.newBackupRequired(backupType, function(err) {
				if (err) {
					if (err.command == 'fcntl' && err.errno == 11)
					//This was a warning, we should only log warning if we couldn't acquire the lock for certain amount of time.
						logger.sysDEBUG('someone else has the lock on the backups dir. will try again soon..');
					else
						new SystemMessage(systemMessages.DBBACKUP_BACKUP_CREATION_FAILED).addInfo(Entities.Error, err).log();
				}

				rescheduleNextBackupRun();
			});
		} else
			rescheduleNextBackupRun();
	}

	scope.reloadBackupsFromFileSystemToCache(checkIfNewBackupNeeded);
};

scope.reloadBackupsFromFileSystemToCache = function(callback) {
	// get the most recent backup on the filesystem
	objectNotifier.updateObject(objectNotifier.events.backupChangeEvent.name, function(err, backupsWrapper) {
		if (!err) {
			var backups = backupsWrapper.backups;
			var mostRecentBackup = scope.getMostRecentBackup(backups);
			scope.lastBackupTime = mostRecentBackup.dateCreated;
		}

		if (callback)
			callback();
	});
};

scope.getMostRecentBackup = function(backups) {
	var mostRecentBackup = { dateCreated: scope.lastBackupTime };

	Object.values(backups).forEach((bu)=> {
		if (bu.dateCreated > mostRecentBackup.dateCreated)
			mostRecentBackup = bu;
	});

	return mostRecentBackup;
};

scope.newBackupRequired = function(backupType, endBackupProcessCB) {
	var backupPath = config.get('Backup.backupPath');
	var lockFilePath = path.join(backupPath, '.lock.nvmesh-backups');
	var lockFileDescriptor;
	var backups = null;
	var inProgressErr = 'backup in progress';
	var isLocked = false;
	var isOpened = false;

	async.series([
		function isInProgress(cb) {
			if (scope.backupsIsInProgress[backupType])
				return cb(inProgressErr);

			scope.backupsIsInProgress[backupType] = true;
			cb();
		},
		function getFileLock(cb) {
			fs.open(lockFilePath, 'w', function(err, fd) {
				if (err)
					return cb(err);

				isOpened = true;
				lockFileDescriptor = fd;
				// set write lock with no wait
				// We are using fcntl instead of flock to support also nfs file system
				try {
					fsext.fcntl(lockFileDescriptor, 'setlk', fsext.constants.F_WRLCK, function(err) {
						if (err) {
							err.command = 'fcntl';
							if (err) {
								err = new SystemMessage(systemMessages.DBBACKUP_FAILED_TO_TAKE_FS_LOCK).addInfo(Entities.Error, err);
							}
						} else
							isLocked = true;

						cb(err);
					});
				} catch (ex) {
					// fcntl could throw an exception in some cases
					err = new SystemMessage(systemMessages.DBBACKUP_FAILED_TO_TAKE_FS_LOCK).addInfo(Entities.Error, ex);
					cb(err);
				}
			});
		},
		function getBackupsFromFileSystem(cb) {
			objectNotifier.updateObject(objectNotifier.events.backupChangeEvent.name, function(err, backupsWrapper) {
				if (err)
					return cb(err);

				backups = backupsWrapper.backups;
				cb();
			});
		},
		function checkIfNewerBackupExists(cb) {
			var mostRecentBackup = scope.getMostRecentBackup(backups);

			if (mostRecentBackup.dateCreated != scope.lastBackupTime) {
				// found a more recent backup in the backup directory
				// check if we still need to do a backup
				scope.lastBackupTime = mostRecentBackup.dateCreated;

				var isHourlyBackupTime = isHourlyBackup();
				var isDailyBackupTime = isDailyBackup();

				if (!(isHourlyBackupTime || isDailyBackupTime))
					return cb(new SystemMessage(systemMessages.DBBACKUP_MORE_RECENT_BACKUP_FOUND).addInfo(Entities.Path, mostRecentBackup.fileName));
			}

			cb();
		},
		function checkFileSystemAccess(cb) {
			if (fs.existsSync(backupPath))
				fs.access(backupPath, fs.W_OK, function(err) {
					if (err)
						err = new SystemMessage(systemMessages.DBBACKUP_FILESYSTEM_ACCESS_FAILED)
							.addInfo(Entities.Path, backupPath).addInfo(Entities.Error, err);

					cb(err);
				});
			else {
				return cb(new SystemMessage(systemMessages.DBBACKUP_DIRECTORY_DOES_NOT_EXISTS)
					.addInfo(Entities.Path, backupPath));
			}
		},
		function getDBLock(cb) {
			lockModule.acquireGlobalLock(cb);
		},
		function createNewBackup(cb) {
			const dbName = config.get('mongoConnection').dbName;
			createBackup(dbName, backupPath, backupType, function(err, backup) {
				if (!err) {
					rotateBackupsIfNeeded(backups, backup.type);
					scope.lastBackupTime = backup.dateCreated;
					events.emitEvent(null, objectNotifier.events.newBackupEvent, backup);
				}

				lockModule.releaseGlobalLock();

				cb(err);
			});
		}
	], function(err) {
		function closeFile() {
			fs.close(lockFileDescriptor, function(closeErr) {
				if (closeErr)
					new SystemMessage(systemMessages.DBBACKUP_CLOSE_LOCK_FD_FAILED)
						.addInfo(Entities.Path, lockFilePath).addInfo(Entities.Error, closeErr).log();

				endBackupProcessCB(err);
			});
		}

		try {
			if (isLocked) {
				// unlock file
				fsext.fcntl(lockFileDescriptor, 'setlk', fsext.constants.F_UNLCK, function(fcntlErr) {
					if (fcntlErr)
						new SystemMessage(systemMessages.DBBACKUP_RELEASE_LOCK_FAILED).addInfo(Entities.Error, fcntlErr).log();

					// close file
					closeFile();
				});
			} else if (isOpened) {
				closeFile();
			} else
				endBackupProcessCB(err);

		} catch (ex) {
			new SystemMessage(systemMessages.DBBACKUP_EXEC_FCNTL_FAILED).addInfo(Entities.Exception, ex).log();
			endBackupProcessCB(err);
		}

		if (!err || err != inProgressErr)
			scope.backupsIsInProgress[backupType] = false;
	});
};

module.exports = scope;
