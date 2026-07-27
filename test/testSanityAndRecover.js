/* global app,log,describe,before,beforeEach,it,after */

const assert = require('assert');

const dbManager = require('./testUtils/dbManager.js');
const errorUtils = require('./testUtils/errorUtils.js');
const { setup } = require('./testUtils/setup.js');
const { generateTargets } = require('./testUtils/entityGenerators.js');
const {
	checkForZeroedLargestSegmentAvailable,
	checkForSnapshotsWithoutMetadata, checkForSnapshotsMetadataWithNoData,
	checkPendingAttachments
} = require('../modules/sanityAndRecover.js');
const { VolumeConcatenated, VolumeRAID10 } = require('./models/volume.js');
const { Snapshot } = require('./models/snapshot.js');
const systemMessages = require('../systemMessages.js');
const consts = require('../consts.js');
const { Client } = require('./models/client.js');
//const { Client } = require('./models/client.js');

const ZONE_1 = '1';
const RAID_1_VPG = 'DEFAULT_RAID_1_VPG';

var serverCollection;

function generateAndSaveTargets(count, numOfDisks, zone) {
	let targets = generateTargets(count, zone, numOfDisks);
	return Promise.all(targets.map(t => t.save()));
}

function setupEnvironment() {
	return setup.newSetup()
		.then(() => generateAndSaveTargets(3, 3, ZONE_1))
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
});