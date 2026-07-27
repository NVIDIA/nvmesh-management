/* global app,log,describe,before,it,after */

const dbManager = require('./testUtils/dbManager.js');
const { setup } = require('./testUtils/setup.js');
const assert = require('assert');

const consts = require('../consts.js');
const errorUtils = require('./testUtils/errorUtils.js');
const { generateTargets } = require('./testUtils/entityGenerators.js');
const { VolumeRAID10, VolumeConcatenated, VolumeRAID1 } = require('./models/volume.js');
const volumeModule = require('../modules/volume.js');
const { startVolumeRebuildByIdsAndUUIDs } = require('../utils.js');
const { markVolumesForDeletion, calculateAndUpdateVolumeStatus } = require('../modules/volume.js');
const { evictDiskByDiskIDsAndUUIDs } = require('../modules/disk.js');
const { listenToEvent } = require('./testUtils/eventUtils.js');
const { getVolumeID } = require('../events.js');
const { events } = require('../objectNotifier.js');
const { delay } = require('./testUtils/common.js');
const { UpdatePRaidReportBuilder, PRaidReport } = require('./kafkaMessages/fromTOMA/tomaMessageBuilders.js');
const { SegmentZeroingProgress } = require('./kafkaMessages/fromTOMA/segmentZeroingProgress.js');
const { reportAllSegmentsOnline, sendPRaidUpdate } = require('./testUtils/volumeUtils.js');

const ZONE_1 = '1';
const allSegmentOnline = [
	consts.diskSegmentStatuses.NORMAL,
	consts.diskSegmentStatuses.NORMAL,
	consts.diskSegmentStatuses.NORMAL
];
var volumeCollection;

describe('Volume Statuses and Actions', () => {
	before(() => {
		return dbManager.connect().then(() => {
			volumeCollection = app.get('db').collection('volume');
		});
	});

	after(()=>{
		return dbManager.closeConnection();
	});

	describe('#R10 Volume Statuses', function() {
		var dbVolume;
		let targets;

		before(() => {
			return setup.newSetup()
				.then(() => targets = generateTargets(5, ZONE_1))
				.then(() => Promise.all(targets.map(t => t.save())))
				.then(() => log.debug('finished setup'));
		});

		it('Should be Initializing-Unavailable after creation ', (done) => {

			let volume = new VolumeRAID10('v1');

			volume.save()
				.then(result => {
					assert(result.success, 'error: ' + errorUtils.getErrorChainString(result.err));

					volumeCollection.findOne({ _id: volume.name }, (err, dbVolume) => {
						assert(!err);
						assert(dbVolume);
						assert.strictEqual(dbVolume.status, consts.volumeStatuses.UNAVAILABLE);
						assert.strictEqual(dbVolume.action, consts.volumeActions.INITIALIZING);
						done();
					});
				});
		});
		let volume = new VolumeRAID10('v1');
		let cachedDBVolume = null;

		it('Should stay Initializing-Unavailable after a single pRaid online report ', (done) => {
			volumeCollection.findOne({ _id: volume.name }, (err, dbVolume) => {
				assert(!err);
				assert(dbVolume);

				cachedDBVolume = dbVolume;
				let firstPRaid = dbVolume.chunks[0].pRaids[0];

				let firstPRaidReport = PRaidReport.fromPRaid(firstPRaid)
					.setSegmentStatuses(allSegmentOnline);
				let msgBuilder = UpdatePRaidReportBuilder.fromTarget(targets[0]);
				msgBuilder.addPRaidReport(firstPRaidReport);
				let msg = msgBuilder.build();
				volumeModule.handlePRaidStatusMessage(msg, function() {
					volumeCollection.findOne({ _id: volume.name }, (err, dbVolume) => {
						assert(!err);
						assert(dbVolume);
						assert.strictEqual(dbVolume.status, consts.volumeStatuses.UNAVAILABLE);
						assert.strictEqual(dbVolume.action, consts.volumeActions.INITIALIZING);
						done();
					});
				});
			});
		});

		it('Should change to Online after second pRaid online report ', async() => {
			let dbVolume = await volumeCollection.findOne({ _id: volume.name });
			let secondPRaid = dbVolume.chunks[0].pRaids[1];
			let secondPRaidReport = PRaidReport.fromPRaid(secondPRaid)
				.setSegmentStatuses(allSegmentOnline);

			let msgBuilder = UpdatePRaidReportBuilder.fromTarget(targets[0]);
			msgBuilder.addPRaidReport(secondPRaidReport);
			let msg = msgBuilder.build();

			await new Promise(resolve => {
				volumeModule.handlePRaidStatusMessage(msg, resolve);
			});

			dbVolume = await volumeCollection.findOne({ _id: volume.name });
			assert(dbVolume);
			cachedDBVolume = dbVolume;
			assert.strictEqual(dbVolume.status, consts.volumeStatuses.ONLINE);
			assert.strictEqual(dbVolume.action, consts.volumeActions.NONE);
		});

		it('Should change to Online after all segments reported normal', (done) => {
			dbVolume = cachedDBVolume;

			let msg = UpdatePRaidReportBuilder.fromVolume(dbVolume, targets[0]).build();

			volumeModule.handlePRaidStatusMessage(msg, function() {
				volumeCollection.findOne({ _id: volume.name }, (err, dbVolume) => {
					assert(!err);
					assert(dbVolume);
					cachedDBVolume = dbVolume;
					assert.strictEqual(dbVolume.status, consts.volumeStatuses.ONLINE);
					assert.strictEqual(dbVolume.action, consts.volumeActions.NONE);
					done();
				});
			});
		});

		it('Should change to Degraded when a single data segment is offline', (done) => {
			dbVolume = cachedDBVolume;

			let secondPRaid = dbVolume.chunks[0].pRaids[1];
			let oneDead = [consts.diskSegmentStatuses.DEAD, consts.diskSegmentStatuses.NORMAL];

			let msg = UpdatePRaidReportBuilder.fromTarget(targets[0])
				.addPRaidReport(PRaidReport.fromPRaid(secondPRaid).setSegmentStatuses(oneDead))
				.build();

			volumeModule.handlePRaidStatusMessage(msg, function() {
				volumeCollection.findOne({ _id: volume.name }, (err, dbVolume) => {
					assert(!err);
					assert(dbVolume);
					assert.strictEqual(dbVolume.status, consts.volumeStatuses.DEGRADED);
					assert.strictEqual(dbVolume.action, consts.volumeActions.NONE);
					done();
				});
			});
		});

		it('Should return to Online after segment is back online ', (done) => {
			dbVolume = cachedDBVolume;

			let secondPRaid = dbVolume.chunks[0].pRaids[1];
			let pRaidReport = PRaidReport.fromPRaid(secondPRaid)
				.setSegmentStatuses(allSegmentOnline)
				.incPRaidMajorVersion();

			let msg = UpdatePRaidReportBuilder.fromTarget(targets[0])
				.addPRaidReport(pRaidReport)
				.build();

			volumeModule.handlePRaidStatusMessage(msg, function() {
				volumeCollection.findOne({ _id: volume.name }, (err, dbVolume) => {
					assert(!err);
					assert(dbVolume);
					cachedDBVolume = dbVolume;
					assert.strictEqual(dbVolume.status, consts.volumeStatuses.ONLINE);
					assert.strictEqual(dbVolume.action, consts.volumeActions.NONE);
					done();
				});
			});
		});

		it('Should change to RebuildRequired - Online after evict', (done) => {
			dbVolume = cachedDBVolume;

			let diskID = dbVolume.chunks[0].pRaids[0].diskSegments[0].diskID;
			let diskUUID = dbVolume.chunks[0].pRaids[0].diskSegments[0].diskUUID;
			let disk = { diskID: diskID, uuid: diskUUID };

			evictDiskByDiskIDsAndUUIDs([disk], volume.createdBy, false, null, null, null, logs => {
				const responses = logs.map(l => l.createApiResponse());
				assert(!responses[0].error);

				volumeCollection.findOne({ _id: volume.name }, (err, dbVolume) => {
					assert(!err);
					assert(dbVolume);
					assert.strictEqual(dbVolume.status, consts.volumeStatuses.ONLINE);
					assert.strictEqual(dbVolume.action, consts.volumeActions.REBUILD_REQUIRED);
					done();
				});
			});
		});

		it('Should change to MarkedForRebuild-Online after rebuild started in backend', (done) => {
			dbVolume = cachedDBVolume;

			startVolumeRebuildByIdsAndUUIDs([{ _id: dbVolume._id, uuid: dbVolume.uuid }], dbVolume.createdBy, (logs) => {
				const responses = logs.map(l => l.createApiResponse());
				assert(responses[0].success);
				volumeCollection.findOne({ _id: volume.name }, (err, dbVolume) => {
					assert(!err);
					assert(dbVolume);
					assert.strictEqual(dbVolume.status, consts.volumeStatuses.ONLINE);
					assert.strictEqual(dbVolume.action, consts.volumeActions.MARKED_FOR_REBUILD);
					done();
				});
			});
		});

		it('Should change to MarkedForRebuild-Degraded after toma reports replacement', (done) => {
			dbVolume = cachedDBVolume;

			let pRaid = dbVolume.chunks[0].pRaids[0];

			pRaid.diskSegments.forEach(s => {
				if (s.status == consts.diskSegmentStatuses.MARKED_FOR_REBUILD)
					s.status = consts.diskSegmentStatuses.REPLACEMENT;
				else
					s.status = consts.diskSegmentStatuses.NORMAL;
			});

			let pRaidReport = PRaidReport.fromPRaid(pRaid)
				.incPRaidMajorVersion();

			let msg = UpdatePRaidReportBuilder.fromTarget(targets[0])
				.addPRaidReport(pRaidReport)
				.build();

			volumeModule.handlePRaidStatusMessage(msg, function() {
				volumeCollection.findOne({ _id: volume.name }, (err, dbVolume) => {
					assert(!err);
					assert(dbVolume);
					cachedDBVolume = dbVolume;
					assert.strictEqual(dbVolume.status, consts.volumeStatuses.DEGRADED);
					assert.strictEqual(dbVolume.action, consts.volumeActions.MARKED_FOR_REBUILD);
					done();
				});
			});
		});

		it('Should keep MarkedForRebuild-Degraded after toma reports dead - dead not saved to the DB', (done) => {
			dbVolume = cachedDBVolume;

			let pRaid = dbVolume.chunks[0].pRaids[0];

			pRaid.diskSegments.forEach(s => {
				if (s.status == consts.diskSegmentStatuses.MARKED_FOR_REBUILD)
					s.status = consts.diskSegmentStatuses.DEAD;
				else if (s.status == consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD)
					s.status = consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD;
				else
					s.status = consts.diskSegmentStatuses.NORMAL;
			});


			let pRaidReport = PRaidReport.fromPRaid(pRaid)
				.incPRaidMajorVersion();

			let msg = UpdatePRaidReportBuilder.fromTarget(targets[0])
				.addPRaidReport(pRaidReport)
				.build();

			volumeModule.handlePRaidStatusMessage(msg, function() {
				volumeCollection.findOne({ _id: volume.name }, (err, dbVolume) => {
					assert(!err);
					assert(dbVolume);
					cachedDBVolume = dbVolume;
					assert.strictEqual(dbVolume.status, consts.volumeStatuses.DEGRADED);
					assert.strictEqual(dbVolume.action, consts.volumeActions.MARKED_FOR_REBUILD);
					done();
				});
			});
		});

		it('Should keep MarkedForRebuild-Degraded after toma reports replacement and deprecated', async() => {
			dbVolume = cachedDBVolume;

			let pRaid = dbVolume.chunks[0].pRaids[0];

			pRaid.diskSegments.forEach(s => {
				if (s.status == consts.diskSegmentStatuses.MARKED_FOR_REBUILD)
					s.status = consts.diskSegmentStatuses.REPLACEMENT;
				else if (s.status == consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD)
					s.status = consts.diskSegmentStatuses.DEPRECATED;
				else
					s.status = consts.diskSegmentStatuses.NORMAL;
			});

			let pRaidReport = PRaidReport.fromPRaid(pRaid)
				.incPRaidMajorVersion();

			let msg = UpdatePRaidReportBuilder.fromTarget(targets[0])
				.addPRaidReport(pRaidReport)
				.build();

			await new Promise(resolve => volumeModule.handlePRaidStatusMessage(msg, resolve));
			dbVolume = await volumeCollection.findOne({ _id: volume.name });
			assert(dbVolume);
			cachedDBVolume = dbVolume;
			assert.strictEqual(dbVolume.chunks[0].pRaids[0].diskSegments[0].status, consts.diskSegmentStatuses.NORMAL);
			assert.strictEqual(dbVolume.chunks[0].pRaids[0].diskSegments[1].status, consts.diskSegmentStatuses.MARKED_FOR_REBUILD);
			assert.strictEqual(dbVolume.status, consts.volumeStatuses.DEGRADED);
			assert.strictEqual(dbVolume.action, consts.volumeActions.MARKED_FOR_REBUILD);
			assert(dbVolume.chunks[0].pRaids[0].diskSegments.length < 4, 'Expected deprecated segment to be removed');
		});

		it('Should change to Rebuilding-Degraded after toma reports under_recovery', async() => {
			let pRaid = cachedDBVolume.chunks[0].pRaids[0];
			let segmentOrderedStatuses = [];
			let underRecoverySegUUID = null;

			pRaid.diskSegments.forEach(s => {
				if (s.status == consts.diskSegmentStatuses.MARKED_FOR_REBUILD) {
					segmentOrderedStatuses.push(consts.diskSegmentStatuses.UNDER_RECOVERY_TOMA);
					underRecoverySegUUID = s.uuid;
				} else
					segmentOrderedStatuses.push(consts.diskSegmentStatuses.NORMAL);
			});

			let pRaidReport = PRaidReport.fromPRaid(pRaid)
				.setSegmentStatuses(segmentOrderedStatuses)
				.incPRaidMajorVersion();

			let msg = UpdatePRaidReportBuilder.fromTarget(targets[0])
				.addPRaidReport(pRaidReport)
				.build();

			await new Promise(resolve => volumeModule.handlePRaidStatusMessage(msg, resolve));
			dbVolume = await volumeCollection.findOne({ _id: volume.name });
			assert(dbVolume);
			cachedDBVolume = dbVolume;
			assert.strictEqual(dbVolume.status, consts.volumeStatuses.DEGRADED);
			assert.strictEqual(dbVolume.action, consts.volumeActions.REBUILDING);
			let underRecoverySegment = dbVolume.chunks[0].pRaids[0].diskSegments.find(s => s.uuid == underRecoverySegUUID);
			assert.strictEqual(underRecoverySegment.status, consts.diskSegmentStatuses.UNDER_RECOVERY_TOMA);
		});

		it('Should update dirtyBits progress', () => {
			let message = {
				payload: {
					segmentsDirtyBitsUpdate: []
				}
			};

			let pRaid = cachedDBVolume.chunks[0].pRaids[0];
			let segmentInRebuild = pRaid.diskSegments.find(s => s.status == consts.diskSegmentStatuses.UNDER_RECOVERY_TOMA);

			message.payload.segmentsDirtyBitsUpdate.push({
				pRaidMajorVersion: pRaid.version.major,
				pRaidMinorVersion: pRaid.version.minor,
				segmentID: segmentInRebuild.uuid,
				remainingDirtyBits: 500,
				type: cachedDBVolume.type
			});

			return new Promise((resolve, reject) => {
				volumeModule.updateDiskSegmentsDirtyBits(message, err => {
					if (err)
						return reject(err);

					resolve();
				});
			}).then(() => {
				return volumeCollection.findOne({ _id: volume.name })
					.then(dbVolume => {
						assert(dbVolume);
						cachedDBVolume = dbVolume;
						assert.strictEqual(dbVolume.status, consts.volumeStatuses.DEGRADED);
						assert.strictEqual(dbVolume.action, consts.volumeActions.REBUILDING);

						let underRecoverySegment = dbVolume.chunks[0].pRaids[0].diskSegments.find(s => s.uuid == segmentInRebuild.uuid);
						assert.strictEqual(underRecoverySegment.remainingDirtyBits, 500);
					});
			});
		});

		it('Should change to None-Online after toma reports all normal', (done) => {
			let pRaid = cachedDBVolume.chunks[0].pRaids[0];

			pRaid.diskSegments.forEach((seg) => {
				if (seg.status == consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD)
					seg.status = consts.diskSegmentStatuses.DEPRECATED;
				else
					seg.status = consts.diskSegmentStatuses.NORMAL;
			});

			let msg = UpdatePRaidReportBuilder.fromVolume(cachedDBVolume, targets[0]).build();

			volumeModule.handlePRaidStatusMessage(msg, function() {
				volumeCollection.findOne({ _id: volume.name }, (err, dbVolume) => {
					assert(!err);
					assert(dbVolume);
					cachedDBVolume = dbVolume;
					assert.strictEqual(dbVolume.status, consts.volumeStatuses.ONLINE);
					assert.strictEqual(dbVolume.action, consts.volumeActions.NONE);
					done();
				});
			});
		});


		it('Should change to None-Online after resetVolumeStatuses', (done) => {
			volumeModule.resetVolumeStatuses(err => {
				assert(!err);

				volumeCollection.findOne({ _id: volume.name }, (err, dbVolume) => {
					assert(!err);
					assert(dbVolume);
					cachedDBVolume = dbVolume;

					assert.strictEqual(dbVolume.status, consts.volumeStatuses.ONLINE);
					assert.strictEqual(dbVolume.action, consts.volumeActions.NONE);
					done();
				});
			});
		});

		it('Should change to MarkedForDeletion-Online after delete volume', (done) => {
			app.get('db').collection('volume').findOne({ _id: volume._id }, { uuid: 1 }, (err, result) => {
				assert(!err);
				volume.uuid = result.uuid;
				markVolumesForDeletion([volume], logs => {
					const responses = logs.map(l => l.createApiResponse());
					assert(responses);
					assert(responses[0].success, responses[0]);
					volumeCollection.findOne({ _id: volume.name }, (err, dbVolume) => {
						assert(!err);
						assert(dbVolume);
						cachedDBVolume = dbVolume;

						assert.strictEqual(dbVolume.action, consts.volumeActions.MARKED_FOR_DELETION);
						done();
					});
				});
			});
		});

		it('Should update segment status to zeroing', (done) => {

			cachedDBVolume.chunks.forEach(c => {
				c.pRaids.forEach(p => {
					p.diskSegments.forEach(s => {
						s.status = consts.diskSegmentStatuses.ZEROING;
					});
				});
			});

			let msg = UpdatePRaidReportBuilder.fromVolume(cachedDBVolume, targets[0]).build();


			volumeModule.handlePRaidStatusMessage(msg, function() {
				volumeCollection.findOne({ _id: volume.name }, (err, dbVolume) => {
					assert(!err);
					assert(dbVolume);
					cachedDBVolume = dbVolume;

					dbVolume.chunks.forEach(chunk => {
						chunk.pRaids.forEach(pRaid => {
							pRaid.diskSegments.forEach(seg => {
								if (seg.status != consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD)
									assert.strictEqual(seg.status, consts.diskSegmentStatuses.ZEROING);
							});
						});
					});

					done();
				});
			});
		});

		it('Should update totalZeroedBlks on volume', (done) => {
			let pRaid = cachedDBVolume.chunks[0].pRaids[0];
			let segment = pRaid.diskSegments[0];
			let nZeroedBlks = cachedDBVolume.blocks;

			let eventID = getVolumeID(volume._id);
			let eventName = events.volumeDeletionZeroingProgressChangeEvent.name;
			listenToEvent(eventName, eventID).then(e => {
				assert(e.payload.totalZeroedPercentage >= 49);
				assert(e.payload.totalZeroedPercentage <= 51);
				done();
			});

			let msg = new SegmentZeroingProgress();
			msg.payload = {
				'praidVersion': pRaid.version,
				'segmentUUID': segment.uuid,
				'pRaidUUID': pRaid.uuid,
				'nZeroedBlks': nZeroedBlks,
				'type': segment.type
			};

			volumeModule.updateSegmentZeroingProgress(msg);
		});

		it('Deprecated segments should be removed', (done) => {
			dbVolume = cachedDBVolume;

			dbVolume.chunks[0].pRaids[0].diskSegments.forEach(s => {
				// deprecate first pRaid
				s.status = consts.diskSegmentStatuses.DEPRECATED;
			});

			let msg = UpdatePRaidReportBuilder.fromVolume(dbVolume, targets[0]).build();

			volumeModule.handlePRaidStatusMessage(msg, function() {
				volumeCollection.findOne({ _id: volume.name }, (err, dbVolume) => {
					assert(!err);
					assert(dbVolume);
					cachedDBVolume = dbVolume;
					assert.strictEqual(dbVolume.chunks[0].pRaids[0].diskSegments.length, 0, 'Expected deprecated segment to be removed');
					done();
				});
			});
		});

		it('Should be deleted', (done) => {
			dbVolume = cachedDBVolume;

			dbVolume.chunks[0].pRaids[1].diskSegments.forEach(s => {
				// deprecate second pRaid
				s.status = consts.diskSegmentStatuses.DEPRECATED;
			});

			let msg = UpdatePRaidReportBuilder.fromVolume(dbVolume, targets[0]).build();

			volumeModule.handlePRaidStatusMessage(msg, function() {
				volumeCollection.findOne({ _id: volume.name }, (err, dbVolume) => {
					assert(!err);
					assert(!dbVolume);
					done();
				});
			});
		});
	});

	describe('Volume Status Races', function() {
		let volume = new VolumeConcatenated('v1');
		let volRaid1 = new VolumeRAID1('r1');
		let targets;

		before(() => {
			return setup.newSetup()
				.then(() => targets = generateTargets(5, ZONE_1))
				.then(() => Promise.all(targets.map(t => t.save())))
				.then(() => volume.save())
				.then(() => volRaid1.save())
				.then(() => volumeCollection.updateOne({ _id: volume._id }, {
					$set: {
						'chunks.0.pRaids.0.diskSegments.0.status': consts.diskSegmentStatuses.NORMAL,
					}
				}))
				.then(() => volumeCollection.updateOne({ _id: volRaid1._id }, {
					$set: {
						'chunks.0.pRaids.0.diskSegments.0.status': consts.diskSegmentStatuses.NORMAL,
						'chunks.0.pRaids.0.diskSegments.1.status': consts.diskSegmentStatuses.NORMAL,
					}
				}))
				.then(() => log.debug('finished setup'));
		});

		it('Multiple calculations with no changes', (done) => {
			// All callbacks should be called
			let calledCallbacks = [];

			// First call to calculate status
			calculateAndUpdateVolumeStatus(volume.name, null, err => {
				assert(!err);
				calledCallbacks.push('callback1');
			});

			// Do not wait, and call 2nd time
			calculateAndUpdateVolumeStatus(volume.name, null, err => {
				assert(!err);
				calledCallbacks.push('callback2');
			});

			// Do not wait, and call 3rd time
			calculateAndUpdateVolumeStatus(volume.name, null, err => {
				assert(!err);
				calledCallbacks.push('callback3');
				assert.strictEqual(3, calledCallbacks.length, 'not all callbacks were called once - these were called: ' + calledCallbacks);
				done();
			});
		});

		it('Volume should be online', () => {
			let calledCallbacks = [];

			return Promise.resolve()
				.then(() => {
					// First call to calculate status - No segment status change
					calculateAndUpdateVolumeStatus(volume.name, null, err => {
						assert(!err);
						calledCallbacks.push('callback1');
					});
				})
				// Set segment to dead and call 2nd time
				.then(() => volumeCollection.updateOne({ _id: volume._id }, {
					$set: { 'chunks.0.pRaids.0.diskSegments.0.status': consts.diskSegmentStatuses.DEAD }
				}))
				.then(() => {
					calculateAndUpdateVolumeStatus(volume.name, null, err => {
						assert(!err);
						calledCallbacks.push('callback2');
					});
				})
				// Set segment to online and call 3rd time
				.then(() => volumeCollection.updateOne({ _id: volume._id }, {
					$set: { 'chunks.0.pRaids.0.diskSegments.0.status': consts.diskSegmentStatuses.NORMAL }
				}))
				.then(() => {
					return new Promise((resolve, reject) => {
						calculateAndUpdateVolumeStatus(volume.name, null, err => {
							if (err)
								return reject(err);

							resolve();
						});
					});
				})
				.then(() => calledCallbacks.push('callback3'))
				.then(() => delay(50))
				.then(() => assert.strictEqual(3, calledCallbacks.length, 'not all callbacks were called once - these were called: ' + calledCallbacks))
				.then(() => volumeCollection.findOne({ _id: volume._id }))
				.then(dbVolume => assert.strictEqual(dbVolume.status, consts.volumeStatuses.ONLINE));
		});

		it('Test segment status of "???"', () => {
			return Promise.resolve()
				.then(() => volumeCollection.updateOne({ _id: volume._id }, {
					$set: {
						'chunks.0.pRaids.0.diskSegments.0.status': '???',
					}
				}))
				.then(() => {
					return new Promise((resolve, reject) => {
						calculateAndUpdateVolumeStatus(volume._id, null, err => {
							if (err)	return reject(err);
							resolve();
						});
					});
				})
				.then(() => volumeCollection.findOne({ _id: volume._id }))
				.then(dbVolume => assert.strictEqual(dbVolume.status, consts.volumeStatuses.ONLINE));
		});

		it('Test status flow after evict', () => {
			let dbVolume;
			return Promise.resolve()
				.then(() => volumeCollection.findOne({ _id: volRaid1._id }))
				.then(dbVol => {
					dbVolume = dbVol;
				})
				.then(() => volumeCollection.updateOne({ _id: volRaid1._id }, {
					$set: { 'chunks.0.pRaids.0.diskSegments.1.pendingStatus': '???' }
				}))
				.then(() => {
					// 1. Evict a drive - this will run the calculateVolumeStatus from updateVolumeDiskSegmentsAfterEvict
					return new Promise((resolve, reject) => {
						let disks = [{
							diskID: dbVolume.chunks[0].pRaids[0].diskSegments[0].diskID,
							uuid: dbVolume.chunks[0].pRaids[0].diskSegments[0].diskUUID
						}];
						evictDiskByDiskIDsAndUUIDs(disks, consts.SYSTEM_USER, false, null, null, null, function(logs) {
							const responses = logs.map(l => l.createApiResponse());
							if (responses[0].error) return reject(responses[0].error);
							resolve();
						});
					});
				})
				.then(() => {
					// 2. Run first calculateAndUpdateVolumeStatus - this will copy pendingStatus > status and unset pendingStatus
					return new Promise((resolve, reject) => {
						calculateAndUpdateVolumeStatus(volRaid1._id, null, err => {
							if (err)	return reject(err);
							resolve();
						});
					});
				})
				.then(() => {
					// 3. Run second calculateAndUpdateVolumeStatus - this will make sure we don't have "left overs"
					// such as originalPendingStatus on the segment from the evict flow
					return new Promise((resolve, reject) => {
						calculateAndUpdateVolumeStatus(volRaid1._id, null, err => {
							if (err)	return reject(err);
							resolve();
						});
					});
				})
				.then(() => volumeCollection.findOne({ _id: volRaid1._id }))
				.then(dbVolume => assert.strictEqual(dbVolume.status, consts.volumeStatuses.ONLINE));
		});

		it('multiple updateUnavailablePRaids', () => {
			let volume = new VolumeRAID10('r10_1');
			let dbVolume;

			/* eslint-disable max-len */
			var pRaidReportList = [
				{ 'pRaidMajorVersion': 257, 'pRaidMinorVersion': 56, 'raftTerm': 5, 'isRaftLeader': 1, 'uuid': '0153e032-611e-11ec-bf65-d17a20f14577', 'segments': [{ 'segmentID': '0153e031-611e-11ec-bf65-d17a20f14577', 'status': 'dead', 'vitality': 'up' }, { 'segmentID': '01542e50-611e-11ec-bf65-d17a20f14577', 'status': 'dead', 'vitality': 'up' }] },
				{ 'pRaidMajorVersion': 257, 'pRaidMinorVersion': 57, 'raftTerm': 5, 'isRaftLeader': 1, 'uuid': '0153e032-611e-11ec-bf65-d17a20f14577', 'segments': [{ 'segmentID': '0153e031-611e-11ec-bf65-d17a20f14577', 'status': 'under_recovery', 'vitality': 'up' }, { 'segmentID': '01542e50-611e-11ec-bf65-d17a20f14577', 'status': 'normal', 'vitality': 'up' }] },
				{ 'pRaidMajorVersion': 258, 'pRaidMinorVersion': 0, 'raftTerm': 5, 'isRaftLeader': 1, 'uuid': '0153e032-611e-11ec-bf65-d17a20f14577', 'segments': [{ 'segmentID': '0153e031-611e-11ec-bf65-d17a20f14577', 'status': 'under_recovery', 'vitality': 'up' }, { 'segmentID': '01542e50-611e-11ec-bf65-d17a20f14577', 'status': 'dead', 'vitality': 'down' }] },
				{ 'pRaidMajorVersion': 259, 'pRaidMinorVersion': 0, 'raftTerm': 5, 'isRaftLeader': 1, 'uuid': '0153e032-611e-11ec-bf65-d17a20f14577', 'segments': [{ 'segmentID': '0153e031-611e-11ec-bf65-d17a20f14577', 'status': 'under_recovery', 'vitality': 'up' }, { 'segmentID': '01542e50-611e-11ec-bf65-d17a20f14577', 'status': 'normal', 'vitality': 'up' }] },
				{ 'pRaidMajorVersion': 259, 'pRaidMinorVersion': 1, 'raftTerm': 5, 'isRaftLeader': 1, 'uuid': '0153e032-611e-11ec-bf65-d17a20f14577', 'segments': [{ 'segmentID': '0153e031-611e-11ec-bf65-d17a20f14577', 'status': 'under_recovery', 'vitality': 'up' }, { 'segmentID': '01542e50-611e-11ec-bf65-d17a20f14577', 'status': 'normal', 'vitality': 'up' }] },
				{ 'pRaidMajorVersion': 260, 'pRaidMinorVersion': 0, 'raftTerm': 5, 'isRaftLeader': 1, 'uuid': '0153e032-611e-11ec-bf65-d17a20f14577', 'segments': [{ 'segmentID': '0153e031-611e-11ec-bf65-d17a20f14577', 'status': 'under_recovery', 'vitality': 'up' }, { 'segmentID': '01542e50-611e-11ec-bf65-d17a20f14577', 'status': 'normal', 'vitality': 'up' }] },
				{ 'pRaidMajorVersion': 260, 'pRaidMinorVersion': 1, 'raftTerm': 5, 'isRaftLeader': 1, 'uuid': '0153e032-611e-11ec-bf65-d17a20f14577', 'segments': [{ 'segmentID': '0153e031-611e-11ec-bf65-d17a20f14577', 'status': 'under_recovery', 'vitality': 'up' }, { 'segmentID': '01542e50-611e-11ec-bf65-d17a20f14577', 'status': 'normal', 'vitality': 'up' }] },
				{ 'pRaidMajorVersion': 260, 'pRaidMinorVersion': 2, 'raftTerm': 5, 'isRaftLeader': 1, 'uuid': '0153e032-611e-11ec-bf65-d17a20f14577', 'segments': [{ 'segmentID': '0153e031-611e-11ec-bf65-d17a20f14577', 'status': 'under_recovery', 'vitality': 'up' }, { 'segmentID': '01542e50-611e-11ec-bf65-d17a20f14577', 'status': 'normal', 'vitality': 'up' }] },
				{ 'pRaidMajorVersion': 261, 'pRaidMinorVersion': 0, 'raftTerm': 5, 'isRaftLeader': 1, 'uuid': '0153e032-611e-11ec-bf65-d17a20f14577', 'segments': [{ 'segmentID': '0153e031-611e-11ec-bf65-d17a20f14577', 'status': 'normal', 'vitality': 'up' }, { 'segmentID': '01542e50-611e-11ec-bf65-d17a20f14577', 'status': 'normal', 'vitality': 'up' }] },
				{ 'pRaidMajorVersion': 261, 'pRaidMinorVersion': 1, 'raftTerm': 5, 'isRaftLeader': 1, 'uuid': '0153e032-611e-11ec-bf65-d17a20f14577', 'segments': [{ 'segmentID': '0153e031-611e-11ec-bf65-d17a20f14577', 'status': 'normal', 'vitality': 'up' }, { 'segmentID': '01542e50-611e-11ec-bf65-d17a20f14577', 'status': 'normal', 'vitality': 'up' }] },
				{ 'pRaidMajorVersion': 261, 'pRaidMinorVersion': 2, 'raftTerm': 5, 'isRaftLeader': 1, 'uuid': '0153e032-611e-11ec-bf65-d17a20f14577', 'segments': [{ 'segmentID': '0153e031-611e-11ec-bf65-d17a20f14577', 'status': 'normal', 'vitality': 'up' }, { 'segmentID': '01542e50-611e-11ec-bf65-d17a20f14577', 'status': 'normal', 'vitality': 'up' }] },
			];
			/* eslint-enable max-len */

			function setMsgUUIDs(msg, pRaid) {
				msg.uuid = pRaid.uuid;
				msg.segments.forEach((seg, idx) => {
					seg.segmentID = pRaid.diskSegments[idx].uuid;
				});
			}

			// Prepare target, volume and make volume online
			return volume.save()
				.then(() => volumeCollection.findOne({ _id: volume._id }))
				.then(dbVolumeDoc => {
					dbVolume = dbVolumeDoc;
					let pRaid = dbVolume.chunks[0].pRaids[0];

					pRaidReportList.forEach(msg => {
						setMsgUUIDs(msg, pRaid);
					});
				})
				.then(() => {
					reportAllSegmentsOnline(dbVolume, targets[0]);
				})
				.then(() => {
					let chain = Promise.resolve();
					pRaidReportList.forEach(msg => {
						sendPRaidUpdate([msg], targets[0]);
					});

					return chain;
				})
				// verify volume is online
				.then(() => delay(50))
				.then(() => volumeCollection.findOne({ _id: volume._id }))
				.then(dbVolume => {
					assert.strictEqual(dbVolume.status, consts.volumeStatuses.ONLINE);
				});
		});

		it('Remove isDead when segment is persistentSegmentStatuses - markedForRebuild', (done) => {
			let volume = new VolumeRAID1('r11');

			volume.save()
				.then(() => volumeCollection.findOne({ _id: volume._id }))
				.then(dbVolume => {
					volume.uuid = dbVolume.uuid;
					let pRaid = dbVolume.chunks[0].pRaids[0];
					let deadSegmentDiskID = pRaid.diskSegments[0].diskID;
					let deadSegmentDiskUUID = pRaid.diskSegments[0].diskUUID;
					let disk = { diskID: deadSegmentDiskID, uuid: deadSegmentDiskUUID };
					let pRaidStatusesWithOnline = [consts.diskSegmentStatuses.NORMAL, consts.diskSegmentStatuses.NORMAL];
					let pRaidReport = PRaidReport.fromPRaid(pRaid).setSegmentStatuses(pRaidStatusesWithOnline).incPRaidMajorVersion();
					let msgBuilder = UpdatePRaidReportBuilder.fromTarget(targets[0]).addPRaidReport(pRaidReport);
					let msg = msgBuilder.build();

					volumeModule.handlePRaidStatusMessage(msg, () => {
						evictDiskByDiskIDsAndUUIDs([disk], volume.createdBy, false, null, null, null, logs => {
							const responses = logs.map(l => l.createApiResponse());
							assert(!responses[0].error);

							startVolumeRebuildByIdsAndUUIDs([{ _id: volume._id, uuid: volume.uuid }], volume.createdBy, () => {
								volumeCollection.findOne({ _id: volume._id }, (err, volume) => {
									pRaid = volume.chunks[0].pRaids[0];
									let pRaidStatusesWithDead =
										[consts.diskSegmentStatuses.DEPRECATED, consts.diskSegmentStatuses.NORMAL, consts.diskSegmentStatuses.DEAD];
									let pRaidReport = PRaidReport.fromPRaid(pRaid).setSegmentStatuses(pRaidStatusesWithDead).incPRaidMajorVersion();
									let msgBuilder = UpdatePRaidReportBuilder.fromTarget(targets[0]).addPRaidReport(pRaidReport);
									let msg = msgBuilder.build();

									volumeModule.handlePRaidStatusMessage(msg, () => {
										volumeCollection.findOne({ _id: volume._id }, (err, finalVolume) => {
											assert(!err);
											assert(finalVolume);
											assert.strictEqual(finalVolume.status, consts.volumeStatuses.DEGRADED);
											assert.strictEqual(finalVolume.action, consts.volumeActions.MARKED_FOR_REBUILD);
											done();
										});
									});
								});
							});
						});
					});
				});
		});

	});
});
