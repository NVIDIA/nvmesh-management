/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app,log,describe,before,beforeEach,it,after */

const assert = require('assert');

const dbManager = require('./testUtils/dbManager.js');
const errorUtils = require('./testUtils/errorUtils.js');
const { setup } = require('./testUtils/setup.js');
const { generateTargets } = require('./testUtils/entityGenerators.js');
const {
	checkForZeroedLargestSegmentAvailable,
	checkForSnapshotsWithoutMetadata, checkForSnapshotsMetadataWithNoData,
	checkPendingAttachments,
	checkAndRecoverReclaimingReservedVolumes,
	checkVPGReservedVolumeCapacitySync
} = require('../modules/sanityAndRecover.js');
const { VolumeConcatenated, VolumeRAID10 } = require('./models/volume.js');
const { Snapshot } = require('./models/snapshot.js');
const systemMessages = require('../systemMessages.js');
const consts = require('../consts.js');
const { Client } = require('./models/client.js');
const VPGModule = require('../modules/volumeProvisioningGroup.js');
const utils = require('../utils.js');
const { Entities } = require('../modules/error.js');

const ZONE_1 = '1';
const RAID_1_VPG = 'DEFAULT_RAID_1_VPG';
const USER = { email: consts.SYSTEM_USER };

var serverCollection;

function generateAndSaveTargets(count, numOfDisks) {
	let targets = generateTargets(count, numOfDisks);
	return Promise.all(targets.map(t => t.save()));
}

function setupEnvironment() {
	return setup.newSetup()
		.then(() => generateAndSaveTargets(3, 3))
		.then(() => log.debug('setupEnvironment finished'));
}

function convertCallbackToPromise(functionWithCallback) {
	let args = Array.prototype.slice.call(arguments, 1);
	return new Promise((resolve, reject) => {
		functionWithCallback(...args, function(err) {
			if (err)
				return reject(err);

			let returnValues = Array.prototype.slice.call(arguments, 1);
			resolve(...returnValues);
		});
	});
}


describe('Sanity And Recover', function() {

	before(() => {
		return dbManager.connect().then(() => {
			// Sanity and Recover global initialization
			serverCollection = app.get('db').collection('server');
		});
	});

	after(() => {
		return dbManager.closeConnection();
	});

	describe('verifyCorrectLargestSegmentAvailable', function() {

		beforeEach(() => {
			return setupEnvironment();
		});

		it('Should not warn - no volumes', () => {
			return convertCallbackToPromise(checkForZeroedLargestSegmentAvailable)
				.then((issues) => {
					assert.strictEqual(issues.warnings.length, 0);
				});
		});

		it('Should not warn - when segments are using all disk', () => {
			let volumeMaxCapacity = new VolumeConcatenated('max-vol');
			volumeMaxCapacity.capacity = 'MAX';

			return volumeMaxCapacity.save()
				.then(result => {
					assert(result.success, 'error: ' + errorUtils.getErrorChainString(result.err));
				})
				.then(() => convertCallbackToPromise(checkForZeroedLargestSegmentAvailable))
				.then((issues) => {
					assert.strictEqual(issues.warnings.length, 0);
				});
		});

		it('Should warn SANITY_ZEROED_LARGEST_SEGMENT', async() => {
			let volumeMaxCapacity = new VolumeConcatenated('c1');

			let result = await volumeMaxCapacity.save();
			assert(result.success, 'error: ' + errorUtils.getErrorChainString(result.err));
			await serverCollection.updateOne({ 'node_id': 'test-server-0' }, { $set: {
				'disks.0.largestSegmentAvailable.blocks': 0,
				'disks.0.largestSegmentAvailable.lbs': 0,
				'disks.0.largestSegmentAvailable.lbe': 0
			} });

			let issues = await convertCallbackToPromise(checkForZeroedLargestSegmentAvailable);
			assert.strictEqual(issues.warnings.length, 1);
			errorUtils.assertIsCausedBy(issues.warnings[0].systemMessage, systemMessages.SANITY_ZEROED_LARGEST_SEGMENT);
		});
	});

	describe('checkForIncompleteSnapshots', function() {
		let volumeCollection;

		let sourceVolume = new VolumeRAID10('source1');
		sourceVolume.isReadOnly = true;

		let snapshot1 = new Snapshot('snapshot1', 'source1', { VPG: RAID_1_VPG });
		let snapshot2 = new Snapshot('snapshot2', 'source1', { VPG: RAID_1_VPG });

		// This extra snapshot is added to make sure we don't delete volumes we shouldn't
		let snapshotExtra = new Snapshot('snapshotExtra', 'source1', { VPG: RAID_1_VPG });

		before(async() => {
			volumeCollection = app.get('db').collection('volume');
			app.set('managementId', 'test');
			app.set('bootVersion', 1);
			await setup.newSetup();
			await generateAndSaveTargets(5, ZONE_1);
			await sourceVolume.createOrReject();
			await snapshotExtra.createOrReject();
			log.debug('finished setup');
		});

		it('should find missing metadata volume', async() => {
			await snapshot1.createOrReject();

			// remove the snapshot metadata document (snapshot volume doc still remains)
			let res = await volumeCollection.deleteOne({ _id: snapshot1.metadataVolumeID });
			assert.strictEqual(res.deletedCount, 1);

			app.set('bootVersion', 2);

			await new Promise(resolve => {
				checkForSnapshotsWithoutMetadata(snapshotsWithoutMD => {
					// make sure we got one and only one volume
					assert.strictEqual(snapshotsWithoutMD.length, 1);

					let v = snapshotsWithoutMD[0];
					assert.strictEqual(v._id, snapshot1._id);
					assert.strictEqual(v.uuid, snapshot1.uuid);
					resolve();
				});
			});


		});

		it('should find metadata with missing snapshot', async() => {
			await snapshot2.createOrReject();
			app.set('bootVersion', 3);

			// remove the snapshot document (metadata volume doc still remains)
			let res = await volumeCollection.deleteOne({ _id: snapshot2._id });

			// make sure deleted
			assert.strictEqual(res.deletedCount, 1);

			await new Promise(resolve => {
				checkForSnapshotsMetadataWithNoData(mdWithoutData => {
					// make sure we got one and only one volume
					assert.strictEqual(mdWithoutData.length, 1);

					let v = mdWithoutData[0];
					assert.strictEqual(v._id, snapshot2.metadataVolumeID);
					assert.strictEqual(v.uuid, snapshot2.metadataVolumeUUID);
					resolve();
				});
			});
		});
	});

	describe('check pending attachments', function() {
		let volumeCollection, clientCollection;

		let volume = new VolumeRAID10('vol');
		let client1 = 'client-1';
		let client2 = 'client-2';

		before(async() => {
			volumeCollection = app.get('db').collection('volume');
			clientCollection = app.get('db').collection('client');
			await setup.newSetup();
			await generateAndSaveTargets(5, ZONE_1);
			await volume.createOrReject();
			const clientObj1 = new Client(client1);
			await clientObj1.save();
			const clientObj2 = new Client(client2);
			await clientObj2.save();
			app.set('managementId', 'test');
			app.set('bootVersion', 1);
			log.debug('finished setup');
		});

		it('should complete pending attach', async() => {
			const refID = 'testi-test-toast';
			await clientCollection.findOneAndUpdate(
				{ _id: client1 },
				{ $set: {
					[`attachments.${volume.uuid}`]: {
						uuid: volume.uuid,
						name: volume.name,
						pending: {
							action: consts.volumeAttachmentActions.ATTACHING,
							reservation: {
								mode: consts.reservationModes.SHARED_READ_WRITE,
								version: 2
							},
							handledBy: {
								managementId: app.get('managementId'),
								bootVersion: app.get('bootVersion')

							},
							referenceID: refID
						}
					}
				} }
			);
			await volumeCollection.findOneAndUpdate(
				{ _id: volume._id },
				{ $set: {
					'reservation.mode': consts.reservationModes.SHARED_READ_WRITE,
					'reservation.version': 2,
					'reservation.attachedClients': [client1]
				} }
			);

			await new Promise(resolve => {
				app.set('bootVersion', app.get('bootVersion') + 1);
				checkPendingAttachments(() => {
					clientCollection.findOne({ _id: client1 }, (err, client) => {
						assert(!client.attachments[volume.uuid].pending);
						assert.strictEqual(client.attachments[volume.uuid].reservation.mode, consts.reservationModes.SHARED_READ_WRITE);
						assert.strictEqual(client.attachments[volume.uuid].reservation.version, 2);
						assert(client.attachments[volume.uuid].referenceIDs.includes(refID));
						resolve();
					});
				});
			});
		});

		it('should remove the attachment from the wishful state', async() => {
			await clientCollection.findOneAndUpdate(
				{ _id: client1 },
				{ $set: {
					[`attachments.${volume.uuid}`]: {
						uuid: volume.uuid,
						name: volume.name,
						pending: {
							action: consts.volumeAttachmentActions.ATTACHING,
							reservation: {
								mode: consts.reservationModes.SHARED_READ_ONLY,
								version: 3,
								preempt: consts.reservationModePreempts.PREEMPT
							},
							handledBy: {
								managementId: app.get('managementId'),
								bootVersion: app.get('bootVersion')

							}
						}
					}
				} }
			);

			await new Promise(resolve => {
				app.set('bootVersion', app.get('bootVersion') + 1);
				checkPendingAttachments(() => {
					clientCollection.findOne({ _id: client1 }, (err, client) => {
						assert(!client.attachments[volume.uuid]);
						resolve();
					});
				});
			});
		});

		it('should complete pending attach/detach and detach preempted clients', async() => {
			const refID1 = 'tetetest';
			const refID2 = 'imatestyo';

			await clientCollection.findOneAndUpdate(
				{ _id: client1 },
				{ $set: {
					[`attachments.${volume.uuid}`]: {
						uuid: volume.uuid,
						name: volume.name,
						action: consts.volumeAttachmentActions.ATTACHING,
						version: 1,
						reservation: {
							mode: consts.reservationModes.SHARED_READ_WRITE,
							version: 1
						},
						pending: {
							action: consts.volumeAttachmentActions.DETACHING,
							referenceID: refID1,
							handledBy: {
								managementId: app.get('managementId'),
								bootVersion: app.get('bootVersion')
							}
						},
						referenceIDs: [refID1, refID2]
					},
					block_devices: [
						{
							uuid: volume.uuid,
							name: volume.name,
							vol_status: 4
						}
					]
				} }
			);
			await clientCollection.findOneAndUpdate(
				{ _id: client2 },
				{ $set: {
					[`attachments.${volume.uuid}`]: {
						uuid: volume.uuid,
						name: volume.name,
						pending: {
							action: consts.volumeAttachmentActions.ATTACHING,
							reservation: {
								mode: consts.reservationModes.EXCLUSIVE_READ_WRITE,
								version: 2,
								preempt: consts.reservationModePreempts.PREEMPT,
								isDetachOthers: true
							},
							handledBy: {
								managementId: app.get('managementId'),
								bootVersion: app.get('bootVersion')

							},
							referenceID: refID2
						}
					}
				} }
			);
			await volumeCollection.findOneAndUpdate(
				{ _id: volume._id },
				{ $set: {
					'reservation.mode': consts.reservationModes.EXCLUSIVE_READ_WRITE,
					'reservation.version': 2,
					'reservation.attachedClients': [client2]
				} }
			);

			await new Promise(resolve => {
				app.set('bootVersion', app.get('bootVersion') + 1);

				checkPendingAttachments(() => {
					clientCollection.find({ _id: { $in: [client1, client2] } }).toArray((err, clients) => {
						const dbClient1 = clients.filter(c => c._id === client1)[0];
						const dbClient2 = clients.filter(c => c._id === client2)[0];
						assert(!dbClient2.attachments[volume.uuid].pending);
						assert.strictEqual(dbClient2.attachments[volume.uuid].reservation.mode, consts.reservationModes.EXCLUSIVE_READ_WRITE);
						assert.strictEqual(dbClient2.attachments[volume.uuid].reservation.version, 2);
						assert.strictEqual(dbClient1.attachments[volume.uuid].action, consts.volumeAttachmentActions.DETACHING);
						resolve();
					});
				});
			});
		});
	});


	describe('VPG Reclaim - Sanity Recovery', () => {
		let vpgCollection, volumeCollection;

		function saveVPG(name, capacity, RAIDLevel, extraAttrs = {}) {
			return new Promise((resolve, reject) => {
				const vpg = { name, RAIDLevel, capacity, allowOverflow: true, ...extraAttrs };
				VPGModule.saveVPGs([vpg], USER, logs => {
					const res = logs.map(l => l.createApiResponse(Entities.VPG.ID, Entities.VPG.UUID))[0];
					if (res.error) return reject(res.error);
					resolve(res);
				});
			});
		}

		function createVolume(name, capacity, RAIDLevel, vpgName, extraAttrs = {}) {
			return new Promise((resolve, reject) => {
				const volume = { _id: name, name, capacity, RAIDLevel, VPG: vpgName, ...extraAttrs };
				utils.createVolumes([volume], USER, logs => {
					const res = logs.map(l => l.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID))[0];
					if (res.error) return reject(res.error);
					resolve(res);
				});
			});
		}

		function getReservedVolume(vpgId) {
			return volumeCollection.findOne({ _id: vpgId, isReserved: true });
		}

		function getReservedDiskSegments(vpgId) {
			return serverCollection.aggregate([
				{ $unwind: '$disks' },
				{ $unwind: '$disks.diskSegments' },
				{ $match: { 'disks.diskSegments.isReserved': true, 'disks.diskSegments.volumeName': vpgId } },
				{ $project: { diskSegment: '$disks.diskSegments' } }
			]).toArray().then(results => results.map(r => r.diskSegment));
		}

		function getPendingSegments(vpgId) {
			return serverCollection.aggregate([
				{ $unwind: '$disks' },
				{ $unwind: '$disks.diskSegments' },
				{ $match: { 'disks.diskSegments.pendingReclaim.vpgId': vpgId } },
				{ $project: { diskSegment: '$disks.diskSegments' } }
			]).toArray().then(results => results.map(r => r.diskSegment));
		}

		before(() => {
			vpgCollection = app.get('db').collection('volumeProvisioningGroup');
			volumeCollection = app.get('db').collection('volume');
		});

		describe('Rollback IN_PROGRESS (crash before commit point)', () => {
			const VPG_NAME = 'reclaim_rollback';
			const VPG_CAPACITY = 50;
			let originalCapacity;

			before(() => {
				app.set('bootVersion', 1);
				return setup.newSetup()
					.then(() => generateAndSaveTargets(10, 8))
					.then(() => saveVPG(VPG_NAME, VPG_CAPACITY, consts.RAIDLevel.MIRRORED_RAID_1, { numberOfMirrors: 1 }))
					.then(() => createVolume(`${VPG_NAME}_v1`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
					.then(() => createVolume(`${VPG_NAME}_v2`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
					.then(() => getReservedVolume(VPG_NAME))
					.then(vol => { originalCapacity = vol.capacity; });
			});

			it('simulate crash: set IN_PROGRESS + pendingReclaim flags', () => {
				const handledBy = { managementId: app.get('managementId'), bootVersion: app.get('bootVersion') };
				return volumeCollection.updateOne(
					{ _id: VPG_NAME, isReserved: true },
					{ $set: { reclaimAction: consts.reservedVolumeReclaimActions.IN_PROGRESS, handledBy } }
				).then(() => serverCollection.updateMany(
					{ 'disks.diskSegments.isReserved': true, 'disks.diskSegments.volumeName': VPG_NAME },
					{
						$set: {
							'disks.$[disk].diskSegments.$[seg].pendingReclaim': {
								vpgId: VPG_NAME,
								type: consts.segmentPendingReclaimTypes.REMOVAL
							}
						}
					},
					{ arrayFilters: [{ 'disk.diskSegments.volumeName': VPG_NAME }, { 'seg.isReserved': true, 'seg.volumeName': VPG_NAME }] }
				)).then(() => {
					app.set('bootVersion', app.get('bootVersion') + 1);
				});
			});

			it('sanity should rollback: clear pending flags and action', () => {
				return convertCallbackToPromise(checkAndRecoverReclaimingReservedVolumes);
			});

			it('reserved volume should be restored to original state', () => {
				return getReservedVolume(VPG_NAME).then(vol => {
					assert.ok(vol, 'Reserved volume should exist');
					assert.strictEqual(vol.reclaimAction, undefined, 'reclaimAction should be cleared');
					assert.strictEqual(vol.capacity, originalCapacity, 'capacity should be unchanged');
				});
			});

			it('no pending segments should remain', () => {
				return getPendingSegments(VPG_NAME).then(segs => {
					assert.strictEqual(segs.length, 0, 'No pending segments after rollback');
				});
			});

			it('VPG capacity should be unchanged', () => {
				return vpgCollection.findOne({ _id: VPG_NAME }).then(vpg => {
					assert.strictEqual(vpg.capacity, VPG_CAPACITY, 'VPG capacity unchanged');
				});
			});
		});

		describe('Commit COMMITTING (crash after commit point)', () => {
			const VPG_NAME = 'reclaim_commit';
			const VPG_CAPACITY = 50;

			before(() => {
				app.set('managementId', 'test');
				app.set('bootVersion', 1);
				return setup.newSetup()
					.then(() => generateAndSaveTargets(10, 8))
					.then(() => saveVPG(VPG_NAME, VPG_CAPACITY, consts.RAIDLevel.MIRRORED_RAID_1, { numberOfMirrors: 1 }))
					.then(() => createVolume(`${VPG_NAME}_v1`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
					.then(() => createVolume(`${VPG_NAME}_v2`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }));
			});

			it('simulate crash: set COMMITTING + pendingReclaim flags + reclaimUUIDMap', () => {
				const handledBy = { managementId: app.get('managementId'), bootVersion: app.get('bootVersion') };
				return getReservedDiskSegments(VPG_NAME).then(reservedSegs => {
					const reclaimUUIDMap = {};
					reservedSegs.forEach(seg => {
						reclaimUUIDMap[seg.uuid] = [{ uuid: 'fake-new-uuid-' + seg.uuid, lbs: seg.lbs, lbe: seg.lbe }];
					});

					const markPromises = reservedSegs.map(seg =>
						serverCollection.updateMany(
							{ 'disks.diskSegments._id': seg._id },
							{
								$set: {
									'disks.$[disk].diskSegments.$[s].pendingReclaim': {
										vpgId: VPG_NAME,
										type: consts.segmentPendingReclaimTypes.REMOVAL
									}
								}
							},
							{ arrayFilters: [{ 'disk.diskSegments._id': seg._id }, { 's._id': seg._id }] }
						)
					);
					return Promise.all(markPromises).then(() => volumeCollection.updateOne(
						{ _id: VPG_NAME, isReserved: true },
						{ $set: { reclaimAction: consts.reservedVolumeReclaimActions.COMMITTING, handledBy, reclaimUUIDMap } }
					));
				}).then(() => {
					app.set('bootVersion', app.get('bootVersion') + 1);
				});
			});

			it('sanity should commit: apply pending removals and clear action', () => {
				return convertCallbackToPromise(checkAndRecoverReclaimingReservedVolumes);
			});

			it('reclaimAction and reclaimUUIDMap should be cleared', () => {
				return getReservedVolume(VPG_NAME).then(vol => {
					if (vol) {
						assert.strictEqual(vol.reclaimAction, undefined, 'reclaimAction should be cleared');
						assert.strictEqual(vol.reclaimUUIDMap, undefined, 'reclaimUUIDMap should be cleared');
					}
				});
			});

			it('no pending segments should remain', () => {
				return getPendingSegments(VPG_NAME).then(segs => {
					assert.strictEqual(segs.length, 0, 'No pending segments after commit');
				});
			});
		});

		describe('VPG capacity mismatch (crash after shrink, before VPG update)', () => {
			const VPG_NAME = 'reclaim_capacity';
			const VPG_CAPACITY = 50;

			before(() => {
				app.set('managementId', 'test');
				app.set('bootVersion', 1);
				return setup.newSetup()
					.then(() => generateAndSaveTargets(10, 8))
					.then(() => saveVPG(VPG_NAME, VPG_CAPACITY, consts.RAIDLevel.MIRRORED_RAID_1, { numberOfMirrors: 1 }))
					.then(() => createVolume(`${VPG_NAME}_v1`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
					.then(() => createVolume(`${VPG_NAME}_v2`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }));
			});

			it('simulate crash: update reserved volume capacity but not VPG', () => {
				return volumeCollection.updateOne(
					{ _id: VPG_NAME, isReserved: true },
					{ $set: { capacity: 20, action: null, handledBy: null } }
				);
			});

			it('sanity should sync VPG capacity to reserved volume', () => {
				return convertCallbackToPromise(checkVPGReservedVolumeCapacitySync);
			});

			it('VPG capacity should match reserved volume', () => {
				return vpgCollection.findOne({ _id: VPG_NAME }).then(vpg => {
					assert.strictEqual(vpg.capacity, 20, 'VPG capacity should be synced to 20');
				});
			});
		});
	});
});
