/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app,log,describe,before,beforeEach,it,after */

const dbManager = require('./testUtils/dbManager.js');
const { setup } = require('./testUtils/setup.js');
const assert = require('assert');

const consts = require('../consts.js');
const errorUtils = require('./testUtils/errorUtils.js');
const { generateAndSaveTargets, generateTargets } = require('./testUtils/entityGenerators.js');
const { VolumeRAID10 } = require('./models/volume.js');
const { Snapshot } = require('./models/snapshot.js');
const systemMessages = require('../systemMessages.js');
const { Client } = require('./models/client.js');
const { attachVolumes, attachSnapshot, detachSnapshot } = require('../modules/client.js');
const { deleteVolumes, handlePRaidStatusMessage } = require('../modules/volume.js');
const { delay } = require('./testUtils/common.js');
const { UpdatePRaidReportBuilder } = require('./kafkaMessages/fromTOMA/tomaMessageBuilders.js');
const { promiseAttachVolume, promiseAttachSnapshot, reportAttachOnConfigurationResponse, reportDetachedOnDetachVolume } = require('./testUtils/clientUtils.js');
const { createSnapshot } = require('../modules/volume.js');
const { Entities } = require('../modules/error.js');


const ZONE_1 = '1';
const TB = Math.pow(1000, 4);

//const user = { email: 'admin@nvidia.com' };
const SERVER_0 = 'test-server-0';

var volumeCollection;
var clientCollection;

describe('Snapshots', () => {
	before(() => {
		return dbManager.connect().then(() => {
			volumeCollection = app.get('db').collection('volume');
			clientCollection = app.get('db').collection('client');
		});
	});

	after(()=>{
		return dbManager.closeConnection();
	});

	describe('#Create Snapshot', function() {
		describe('Create Snapshot without VPG', function() {
			let sourceVolume = new VolumeRAID10('source1');
			sourceVolume.isReadOnly = true;
			let snapshot = new Snapshot('snapshot1', 'source1');

			before(() => {
				return setup.newSetup()
					.then(() => generateAndSaveTargets(5, ZONE_1))
					.then(() => log.debug('finished setup'));
			});

			it('Data and Metadata volumes should be successfully saved', () => {
				return sourceVolume.createOrReject()
					.then (() => snapshot.createOrReject())
					.then(() => volumeCollection.findOne({ _id: snapshot.name }))
					.then(dbVolume => {
						assert(dbVolume, 'Snapshot Data Volume not found in volume collection');
						assert.strictEqual(dbVolume.status, consts.volumeStatuses.UNAVAILABLE);
						assert.strictEqual(dbVolume.action, consts.volumeActions.INITIALIZING);
					})
					.then(() => volumeCollection.findOne({ _id: snapshot.name + consts.MetadataVolumeEnding }))
					.then(dbVolume => {
						assert(dbVolume, 'Metadata Volume not found in volume collection');
						assert.strictEqual(dbVolume.status, consts.volumeStatuses.UNAVAILABLE);
						assert.strictEqual(dbVolume.action, consts.volumeActions.INITIALIZING);
					});
			});

			it('Source volume uses should be incremented', () => {
				return volumeCollection.findOne({ _id: snapshot.sourceID })
					.then(dbVolume => {
						assert.strictEqual(dbVolume.usedAsSourceCount, 1);
					});
			});
		});

		describe('Create Snapshot from VPG', function() {
			let sourceVolume = new VolumeRAID10('source1');
			sourceVolume.isReadOnly = true;
			let snapshot = new Snapshot('snapshot1', 'source1');
			const RAID_1_VPG = 'DEFAULT_RAID_1_VPG';

			snapshot.VPG = RAID_1_VPG;

			before(() => {
				return setup.newSetup()
					.then(() => generateAndSaveTargets(5, ZONE_1))
					.then(() => log.debug('finished setup'));
			});

			it('Data and Metadata volumes should be successfully saved', () => {
				return sourceVolume.createOrReject()
					.then (() => snapshot.createOrReject())
					.then(() => volumeCollection.findOne({ _id: snapshot.name }))
					.then(dbVolume => {
						assert(dbVolume, 'Snapshot Data Volume not found in volume collection');
						assert.strictEqual(dbVolume.status, consts.volumeStatuses.UNAVAILABLE);
						assert.strictEqual(dbVolume.action, consts.volumeActions.INITIALIZING);
						assert.strictEqual(dbVolume.RAIDLevel, consts.RAIDLevel.MIRRORED_RAID_1);
					})
					.then(() => volumeCollection.findOne({ _id: snapshot.name + consts.MetadataVolumeEnding }))
					.then(dbVolume => {
						assert(dbVolume, 'Metadata Volume not found in volume collection');
						assert.strictEqual(dbVolume.status, consts.volumeStatuses.UNAVAILABLE);
						assert.strictEqual(dbVolume.action, consts.volumeActions.INITIALIZING);
						assert.strictEqual(dbVolume.RAIDLevel, consts.RAIDLevel.MIRRORED_RAID_1);
					});
			});

			it('Source volume uses should be incremented', () => {
				return volumeCollection.findOne({ _id: snapshot.sourceID })
					.then(dbVolume => {
						assert.strictEqual(dbVolume.usedAsSourceCount, 1);
					});
			});
		});

		describe('Create Snapshot Failures', function() {
			beforeEach(() => {
				return delay(100)
					.then(() => setup.newSetup())
					.then(() => generateAndSaveTargets(5, ZONE_1))
					.then(() => delay(5))
					.then(() => log.debug('finished setup'));
			});

			function makeSureNotCreated() {
				let snapshot = new Snapshot('snapshot1', 'source1');
				return volumeCollection.findOne({ _id: snapshot.name })
					.then(dbVolume => {
						assert(!dbVolume, 'Snapshot Data Volume found in volume collection');
					})
					.then(() => volumeCollection.findOne({ _id: snapshot.name + consts.MetadataVolumeEnding }))
					.then(dbVolume => {
						if (dbVolume)
							assert.strictEqual(dbVolume.action, consts.volumeActions.MARKED_FOR_DELETION,
								'Snapshot Metadata Data Volume found in volume collection');
					});
			}

			it('Should fail when Source Volume not found', () => {
				let snapshot = new Snapshot('snapshot1', 'source1');
				return snapshot.save()
					.then(result => errorUtils.assertIsCausedBy(result.error, systemMessages.SNAPSHOT_SOURCE_VOLUME_NOT_FOUND))
					.then(() => makeSureNotCreated());
			});

			it('Should fail when Source Volume is not read-only', () => {
				let snapshot = new Snapshot('snapshot1', 'source1');
				let sourceVolumeNotReadOnly = new VolumeRAID10('source1');
				return sourceVolumeNotReadOnly.createOrReject()
					.then(() => snapshot.save())
					.then(result => errorUtils.assertIsCausedBy(result.error, systemMessages.SNAPSHOT_SOURCE_VOLUME_NOT_READ_ONLY))
					.then(() => makeSureNotCreated());
			});

			it('Should fail when not enough space for Data Volume', () => {
				let snapshot = new Snapshot('snapshot1', 'source1');
				snapshot.capacity = 10 * TB;
				let source1 = new VolumeRAID10('source1');
				source1.isReadOnly = true;
				return source1.createOrReject()
					.then(() => snapshot.save())
					.then(result => errorUtils.assertIsCausedBy(result.error, systemMessages.SNAPSHOT_CREATE_DATA_VOLUME_FAILURE))
					.then(() => makeSureNotCreated());
			});

			it('Should fail when not enough space for Metadata Volume', () => {
				let snapshot = new Snapshot('snapshot1', 'source1');
				snapshot.capacity = 2;
				let source1 = new VolumeRAID10('source1');
				source1.isReadOnly = true;
				const origianlMdvVpg = consts.defaultMetadataVPG;
				consts.defaultMetadataVPG = 'DEFAULT_EC_DUAL_TARGET_REDUNDANCY_VPG';
				return source1.createOrReject()
					.then(() => snapshot.save())
					.then(result =>{
						errorUtils.assertIsCausedBy(result.error, systemMessages.SNAPSHOT_CREATE_MDV_FAILURE);
					})
					.then(() => makeSureNotCreated())
					.finally(() => 	consts.defaultMetadataVPG = origianlMdvVpg);
			});

			it('Should fail when VPG not found', () => {
				let snapshot = new Snapshot('snapshot1', 'source1');
				snapshot.VPG = 'THIS_VPG_DOES_NOT_EXIST';
				let source1 = new VolumeRAID10('source1');
				source1.isReadOnly = true;
				return source1.createOrReject()
					.then(() => snapshot.save())
					.then(result => {
						errorUtils.assertIsCausedBy(result.error, systemMessages.SNAPSHOT_CREATE_DATA_VOLUME_FAILURE);
					})
					.then(() => makeSureNotCreated());
			});

			it('Should fail when data volume capacity lower than source volume capacity', () => {
				let snapshot = new Snapshot('snapshot1', 'source1');
				snapshot.capacity = 1;
				snapshot.VPG = 'THIS_VPG_DOES_NOT_EXIST';
				let source1 = new VolumeRAID10('source1');
				source1.capacity = 2;
				source1.isReadOnly = true;
				return source1.createOrReject()
					.then(() => snapshot.save())
					.then(result => errorUtils.assertIsCausedBy(result.error, systemMessages.SNAPSHOT_DATA_VOLUME_CAPACITY_LOWER_THAN_SOURCE_VOLUME_CAPACITY))
					.then(() => makeSureNotCreated());
			});
		});
	});

	describe('#Delete Snapshot', function() {
		let sourceVolume = new VolumeRAID10('source1');
		sourceVolume.isReadOnly = true;
		let snapshot = new Snapshot('snapshot1', 'source1');
		let targets;

		before(() => {
			return setup.newSetup()
				.then(() => targets = generateTargets(5, ZONE_1))
				.then(() => Promise.all(targets.map(t => t.save())))
				.then(() => sourceVolume.createOrReject())
				.then(() => snapshot.createOrReject())
				.then(() => volumeCollection.findOne({ _id: snapshot.name }))
				.then(dbVolume => {
					assert(dbVolume, 'Snapshot Data Volume not found in volume collection');
					assert.strictEqual(dbVolume.status, consts.volumeStatuses.UNAVAILABLE);
					assert.strictEqual(dbVolume.action, consts.volumeActions.INITIALIZING);
				})
				.then(() => volumeCollection.findOne({ _id: snapshot.name + consts.MetadataVolumeEnding }))
				.then(dbVolume => {
					assert(dbVolume, 'Metadata Volume not found in volume collection');
					assert.strictEqual(dbVolume.status, consts.volumeStatuses.UNAVAILABLE);
					assert.strictEqual(dbVolume.action, consts.volumeActions.INITIALIZING);
				})
				.then(() => log.debug('finished setup'));
		});

		it('Prevent Deletion of MDV directly from REST API', () => {
			let deleteReq = [
				{ _id: snapshot.metadataVolumeID, uuid: snapshot.metadataVolumeUUID }
			];

			return new Promise(resolve => {
				deleteVolumes(deleteReq, messages => {
					let message = messages[0];
					let res = message.createApiResponse();
					// make sure request denied
					assert(!res.success);
					errorUtils.assertIsCausedBy(res.error, systemMessages.SNAPSHOT_CANNOT_DELETE_METADATA_VOLUME);
					resolve(messages);
				});
			})
				.then(() => volumeCollection.findOne({ _id: snapshot.metadataVolumeID }))
				.then(dbVolume => {
					assert(dbVolume);
				});
		});

		it('Report snapshot pRaids online', (done) => {
			volumeCollection.findOne({ _id: snapshot._id }, (err, vol) => {
				assert(!err);

				vol.chunks.forEach(c => c.pRaids.forEach(p => p.diskSegments.forEach(d => {
					d.status = consts.diskSegmentStatuses.NORMAL;
					d.vitality = consts.segmentVitality.UP;
				})));
				let msgBuilder = UpdatePRaidReportBuilder.fromVolume(vol, targets[0]);

				handlePRaidStatusMessage(msgBuilder.build(), () => {
					done();
				});
			});
		});

		it('Report metadata pRaids online', (done) => {
			volumeCollection.findOne({ _id: snapshot._id + consts.MetadataVolumeEnding }, (err, vol) => {
				assert(!err);

				vol.chunks.forEach(c => c.pRaids.forEach(p => p.diskSegments.forEach(d => {
					d.status = consts.diskSegmentStatuses.NORMAL;
					d.vitality = consts.segmentVitality.UP;
				})));
				let msgBuilder = UpdatePRaidReportBuilder.fromVolume(vol, targets[0]);

				handlePRaidStatusMessage(msgBuilder.build(), () => {
					done();
				});
			});
		});

		it('Snapshot and MDV should be removed', () => {
			return snapshot.remove()
				.then(() => volumeCollection.findOne({ _id: snapshot.name }))
				.then(dbVolume => {
					if (dbVolume)
						assert.strictEqual(dbVolume.action, consts.volumeActions.MARKED_FOR_DELETION,
							'Snapshot Data Volume not removed from volume collection');
				})
				.then(() => volumeCollection.findOne({ _id: snapshot.name + consts.MetadataVolumeEnding }))
				.then(dbVolume => {
					if (dbVolume)
						assert.strictEqual(dbVolume.action, consts.volumeActions.MARKED_FOR_DELETION,
							'Snapshot Data Volume not removed from volume collection');
				});
		});

		it('source volume uses counter should be 0', () => {
			return volumeCollection.findOne({ _id: snapshot.sourceID })
				.then(dbVolume => {
					assert.strictEqual(dbVolume.usedAsSourceCount, 0);
				});
		});
	});

	describe('#ReadOnly Volumes', function() {
		describe('Allow to delete when usedAsSourceCount == 0', () => {
			let sourceVolume = new VolumeRAID10('source1');
			sourceVolume.isReadOnly = true;
			let snapshot = new Snapshot('snapshot1', 'source1');
			let targets;

			before(() => {
				return setup.newSetup()
					.then(() => targets = generateTargets(5, ZONE_1))
					.then(() => Promise.all(targets.map(t => t.save())))
					.then(() => sourceVolume.createOrReject())
					.then(() => snapshot.createOrReject())
					.then(() => volumeCollection.findOne({ _id: snapshot.name }))
					.then(dbVolume => {
						assert(dbVolume, 'Snapshot Data Volume not found in volume collection');
						assert.strictEqual(dbVolume.status, consts.volumeStatuses.UNAVAILABLE);
						assert.strictEqual(dbVolume.action, consts.volumeActions.INITIALIZING);
					})
					.then(() => volumeCollection.findOne({ _id: snapshot.name + consts.MetadataVolumeEnding }))
					.then(dbVolume => {
						assert(dbVolume, 'Metadata Volume not found in volume collection');
						assert.strictEqual(dbVolume.status, consts.volumeStatuses.UNAVAILABLE);
						assert.strictEqual(dbVolume.action, consts.volumeActions.INITIALIZING);
					});
			});

			it('Report snapshot pRaids online', (done) => {
				volumeCollection.findOne({ _id: snapshot._id }, (err, vol) => {
					assert(!err);

					vol.chunks.forEach(c => c.pRaids.forEach(p => p.diskSegments.forEach(d => {
						d.status = consts.diskSegmentStatuses.NORMAL;
						d.vitality = consts.segmentVitality.UP;
					})));
					let msgBuilder = UpdatePRaidReportBuilder.fromVolume(vol, targets[0]);

					handlePRaidStatusMessage(msgBuilder.build(), () => {
						done();
					});
				});
			});

			it('Report metadata pRaids online', (done) => {
				volumeCollection.findOne({ _id: snapshot._id + consts.MetadataVolumeEnding }, (err, vol) => {
					assert(!err);

					vol.chunks.forEach(c => c.pRaids.forEach(p => p.diskSegments.forEach(d => {
						d.status = consts.diskSegmentStatuses.NORMAL;
						d.vitality = consts.segmentVitality.UP;
					})));
					let msgBuilder = UpdatePRaidReportBuilder.fromVolume(vol, targets[0]);

					handlePRaidStatusMessage(msgBuilder.build(), () => {
						done();
					});
				});
			});

			it('Snapshot should be deleted', () => {
				return snapshot.remove()
					.then(() => volumeCollection.findOne({ _id: snapshot.sourceID }))
					.then(sourceDbVolume => {
						// make sure ref count is 0
						assert.strictEqual(sourceDbVolume.usedAsSourceCount, 0);
					});
			});

			it('Report source pRaids online', (done) => {
				volumeCollection.findOne({ _id: snapshot.sourceID }, (err, vol) => {
					assert(!err);

					vol.chunks.forEach(c => c.pRaids.forEach(p => p.diskSegments.forEach(d => {
						d.status = consts.diskSegmentStatuses.NORMAL;
						d.vitality = consts.segmentVitality.UP;
					})));
					let msgBuilder = UpdatePRaidReportBuilder.fromVolume(vol, targets[0]);

					handlePRaidStatusMessage(msgBuilder.build(), () => {
						done();
					});
				});
			});

			it('Should be deleted - ref count is 0', () => {
				return sourceVolume.markForDeletion()
					.then(result => {
						assert(result.success, 'Expected deletion to fail');
					});
			});
		});

		describe('Fail to delete when usedAsSourceCount > 0', () => {
			let sourceVolume = new VolumeRAID10('source1');
			sourceVolume.isReadOnly = true;
			let snapshot = new Snapshot('snapshot1', 'source1');
			let targets;

			before(() => {
				return setup.newSetup()
					.then(() => targets = generateTargets(5, ZONE_1))
					.then(() => Promise.all(targets.map(t => t.save())))
					.then(() => sourceVolume.createOrReject())
					.then(() => snapshot.createOrReject())
					.then(() => volumeCollection.findOne({ _id: snapshot.name }))
					.then(dbVolume => assert(dbVolume, 'Snapshot Data Volume not found in volume collection'))
					.then(() => volumeCollection.findOne({ _id: snapshot.sourceID }))
					.then(sourceDbVolume => {
					// make sure ref count is 1
						assert.strictEqual(sourceDbVolume.usedAsSourceCount, 1);
					})
					.then(() => log.debug('finished setup'));
			});

			it('Report source pRaids online', (done) => {
				volumeCollection.findOne({ _id: snapshot.sourceID }, (err, vol) => {
					assert(!err);

					vol.chunks.forEach(c => c.pRaids.forEach(p => p.diskSegments.forEach(d => {
						d.status = consts.diskSegmentStatuses.NORMAL;
						d.vitality = consts.segmentVitality.UP;
					})));
					let msgBuilder = UpdatePRaidReportBuilder.fromVolume(vol, targets[0]);

					handlePRaidStatusMessage(msgBuilder.build(), () => {
						done();
					});
				});
			});

			it('Should fail to delete - ref count > 0', () => {
				return sourceVolume.markForDeletion()
					.then(result => {
						assert(!result.success, 'Expected deletion to fail');
						assert(result.error.innerMessage.indexOf('The volume is used as a Source Volume') > -1);
					});
			});
		});

		describe('Fail to to set as ReadOnly when reserved as RW', () => {
			let sourceVolume = new VolumeRAID10('source1');

			function setVolumeAsReserved(volumeID, reservationMode) {
				return volumeCollection.findOneAndUpdate(
					{ _id: volumeID },
					{ $set: {
						reservation: {
							mode: reservationMode,
							version: 1,
							preempt: false
						}
					} });
			}

			before(() => {
				return setup.newSetup()
					.then(() => generateAndSaveTargets(5, ZONE_1))
					.then(() => sourceVolume.createOrReject());
			});
			it('Should fail to set ReadOnly when reserved as EXCLUSIVE_RW', () => {
				sourceVolume.isReadOnly = true;
				return setVolumeAsReserved(sourceVolume._id, consts.reservationModes.EXCLUSIVE_READ_WRITE)
					.then(() => sourceVolume.update())
					.then(message => assert(message.systemMessage.id !== systemMessages.VOLUME_UPDATED.id));
			});

			it('Should fail to set ReadOnly when reserved as SHARED_RW', () => {
				sourceVolume.isReadOnly = true;
				return setVolumeAsReserved(sourceVolume._id, consts.reservationModes.SHARED_READ_WRITE)
					.then(() => sourceVolume.update())
					.then(message => assert(message.systemMessage.id !== systemMessages.VOLUME_UPDATED.id));

			});

			it('Should allow to set ReadOnly when reserved as SHARED_READ_ONLY', () => {
				sourceVolume.isReadOnly = true;
				return setVolumeAsReserved(sourceVolume._id, consts.reservationModes.SHARED_READ_ONLY)
					.then(() => sourceVolume.update())
					.then(message => assert(message.systemMessage.id === systemMessages.VOLUME_UPDATED.id))
					.then(() => volumeCollection.findOne({ _id: sourceVolume._id }))
					.then(dbVolume => assert(dbVolume.isReadOnly));
			});
		});

		describe('Fail to set ReadOnly = false when used by Snapshot', () => {
			let sourceVolume = new VolumeRAID10('source1');
			sourceVolume.isReadOnly = true;
			let snapshot = new Snapshot('snapshot1', 'source1');
			before(() => {
				return setup.newSetup()
					.then(() => generateAndSaveTargets(5, ZONE_1))
					.then(() => sourceVolume.createOrReject())
					.then(() => snapshot.createOrReject())
					.then(() => volumeCollection.findOne({ _id: snapshot.name }))
					.then(dbVolume => assert(dbVolume, 'Snapshot Data Volume not found in volume collection'))
					.then(() => volumeCollection.findOne({ _id: snapshot.sourceID }))
					.then(sourceDbVolume => {
					// make sure ref count is 1
						assert.strictEqual(sourceDbVolume.usedAsSourceCount, 1);
					})
					.then(() => log.debug('finished setup'));
			});

			it('Should fail to set ReadOnly = false', () => {
				sourceVolume.isReadOnly = false;
				return sourceVolume.update()
					.then(message => assert(message.systemMessage.id !== systemMessages.VOLUME_UPDATED.id));
			});
		});

		// TODO: Fix when client attach / detach works
		describe.skip('Fail to reserve as RW when isReadOnly is set', () => {
			let readOnlyVolume = new VolumeRAID10('source1');
			readOnlyVolume.isReadOnly = true;
			let client = new Client(SERVER_0);
			before(() => {
				return setup.newSetup()
					.then(() => generateAndSaveTargets(5, ZONE_1))
					.then(() => readOnlyVolume.createOrReject())
					.then(() => client.save())
					.then(() => log.debug('finished setup'));
			});

			it('Should fail to set ReadOnly = false', () => {
				let volumeToAttach = {
					name: readOnlyVolume.name,
					uuid: readOnlyVolume.uuid,
					reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE }
				};

				return new Promise((resolve) => {
					attachVolumes(SERVER_0, client.uuid, [volumeToAttach], results => {
						return resolve(results);
					});
				})
					.then(results => {
						assert.strictEqual(results[0].success, false, 'Expected RW reservation fail since the volume is readOnly');
						errorUtils.assertIsCausedBy(results[0].error.systemMessage, systemMessages.VALIDATE_RESERVATION_READ_ONLY_ERROR);

					})
					.then(() => clientCollection.findOne({ _id: SERVER_0 }))
					.then(dbClient => {
						assert(!dbClient.attachments);
					});

			});
		});
	});

	// TODO: Fix Tests on kafka
	describe('Snapshot Attach / Detach', function() {
		describe('Error Handling', function() {
			let sourceVolume = new VolumeRAID10('source1');
			sourceVolume.isReadOnly = true;
			let snapshot1 = new Snapshot('snapshot1', 'source1');
			snapshot1.VPG = 'DEFAULT_RAID_1_VPG';
			let snapshot2 = new Snapshot('snapshot2', 'source1');

			let client = new Client(SERVER_0);

			before(() => {
				return setup.newSetup()
					.then(() => generateAndSaveTargets(5, ZONE_1))
					.then(() => sourceVolume.createOrReject())
					.then(() => snapshot1.createOrReject())
					.then(() => snapshot2.createOrReject())
					.then(() => client = new Client(SERVER_0))
					.then(() => client.save())
					.then(() => log.debug('finished setup'));
			});

			it('Should return error - source not attached', (done) => {
				volumeCollection.findOne({ _id: snapshot1._id })
					.then(dbSnapshot => {
						attachSnapshot(dbSnapshot, SERVER_0, client.uuid, message => {
							const response = message.createApiResponse();
							errorUtils.assertIsCausedBy(response.error, systemMessages.SNAPSHOT_SOURCE_VOLUME_NOT_ATTACHED);
							done();
						});
					});
			});

			it('Only single snapshot attach per client allowed', async() => {
				client.waitForClientMessageType(consts.kafkaMessageTypes.ManagementToClient.attachVolumes)
					.then(async(clientConfMsg) => {
						await reportAttachOnConfigurationResponse(clientConfMsg, client);
						// Listen for new configuration to attach snapshot and metadata
						clientConfMsg = await client.waitForClientMessageType(consts.kafkaMessageTypes.ManagementToClient.attachVolumes);
						await reportAttachOnConfigurationResponse(clientConfMsg, client);
					});

				// Attach Source Volume
				let sourceAttachRequest = {
					name: sourceVolume.name,
					uuid: sourceVolume.uuid,
					reservation: { mode: consts.reservationModeNames.SHARED_READ_ONLY }
				};

				await promiseAttachVolume(SERVER_0, client.uuid, sourceAttachRequest);

				let dbSnapshot1 = await volumeCollection.findOne({ _id: snapshot1._id });
				await promiseAttachSnapshot(dbSnapshot1, SERVER_0, client.uuid);

				let dbSnapshot2 = await volumeCollection.findOne({ _id: snapshot2._id });
				var err = await promiseAttachSnapshot(dbSnapshot2, SERVER_0, client.uuid)
					.catch(err => {
						assert(err.message.includes(systemMessages.CLIENT_ALREADY_HAS_SNAPSHOT_ATTACHED.message));
						return err;
					});
				assert(err, 'Snapshot attached but expected to fail');
			});
		});

		describe('Basic Attach Detach Snapshot', function() {
			let sourceVolume = new VolumeRAID10('source1');
			sourceVolume.isReadOnly = true;
			let snapshot = new Snapshot('snapshot1', 'source1');
			snapshot.VPG = 'DEFAULT_RAID_1_VPG';
			let client = new Client(SERVER_0);

			before(async() => {
				await setup.newSetup();
				await generateAndSaveTargets(5, ZONE_1);
				await sourceVolume.createOrReject();
				await snapshot.createOrReject();
				await client.save();
				await log.debug('finished setup');
			});

			it('attachSnapshot should succeed', async() => {
				// Call the attachSnapshot function
				let sourceAttachRequest = {
					name: sourceVolume.name,
					uuid: sourceVolume.uuid,
					reservation: { mode: consts.reservationModeNames.SHARED_READ_ONLY }
				};

				// Set up client handler for messages from management
				client.waitForClientMessageType(consts.kafkaMessageTypes.ManagementToClient.attachVolumes)
					.then(async(clientConfMsg) => {
						await reportAttachOnConfigurationResponse(clientConfMsg, client);
						// Listen for new configuration to attach snapshot and metadata
						clientConfMsg = await client.waitForClientMessageType(consts.kafkaMessageTypes.ManagementToClient.attachVolumes);
						await reportAttachOnConfigurationResponse(clientConfMsg, client);
					});

				// Attach Source Volume
				await promiseAttachVolume(SERVER_0, client.uuid, sourceAttachRequest);


				// Attach Snapshot
				// set up handler for spdkCommand message
				let dbSnapshot = await volumeCollection.findOne({ _id: snapshot._id });
				await promiseAttachSnapshot(dbSnapshot, SERVER_0);

				// Verify Attached
				let dbClient = await clientCollection.findOne({ _id: SERVER_0 });
				assert.strictEqual(Object.keys(dbClient.attachments).length, 3);

				return;
			});

			it('detachSnapshot should succeed', async() => {
				let dbSnapshot = await volumeCollection.findOne({ _id: snapshot._id });

				await new Promise((resolve, reject) => {
					detachSnapshot(dbSnapshot, SERVER_0, client.uuid, async(apiResponse) => {
						if (apiResponse.error)
							return reject(new Error(JSON.stringify(apiResponse.error)));

						let continueHandlingMsgs = true;
						//handle detach volumes messages

						let msg;
						let detachMsgsCount = 0;
						while (continueHandlingMsgs) {
							msg = await client.readMessageFromClientTopic(5000);

							if (!continueHandlingMsgs)
								return;

							switch (msg.type) {
								case consts.kafkaMessageTypes.ManagementToClient.detachVolumes:
									await reportDetachedOnDetachVolume(msg, client);
									detachMsgsCount++;
									if (detachMsgsCount == 2)
										continueHandlingMsgs = false;

									break;
								case consts.kafkaMessageTypes.ManagementToClient.sendClientReport:
									client.attachmentsVersion = msg.attachmentsVersion;
									await client.sendReport();
									break;
								case consts.kafkaMessageTypes.ManagementToClient.attachVolumes:
									//console.log(`sendConfigurationResponse: ${JSON.stringify(msg, null, 2)}`);
									console.log(`ignoring msg ${msg.type}`);
									break;
								default:
									console.log(`ignoring msg ${msg.type}`);
							}
						}

						resolve();
					});
				});


				let dbClient = await clientCollection.findOne({ _id: SERVER_0 });

				// source volume should stay
				assert(dbClient.block_devices.length, 'client has no block devices - expected source1 to still be attached');
				assert.strictEqual(Object.keys(dbClient.attachments).length, 1,
					'There were attachments left on the client db object: \n' + JSON.stringify(dbClient.attachments, '', 4));
			});
		});

		describe.skip('creatAndAttach', function() {
			const sourceVolume = new VolumeRAID10('source1');
			sourceVolume.isReadOnly = true;
			const snapshot = new Snapshot('snapshot1', 'source1');
			snapshot.VPG = 'DEFAULT_RAID_1_VPG';
			let client;
			const user = { email: 'admin@nvidia.com' };

			beforeEach(async() => {
				await setup.newSetup();
				await generateAndSaveTargets(5, ZONE_1);
				await sourceVolume.createOrReject();
				client = new Client(SERVER_0);
				await client.save();
				app.get('globalSettings').snapshotAttachTimeout = 500;
				await log.debug('finished setup');
			});

			function promiseCreateSnapshot(snapshot, user) {
				return new Promise(resolve => {
					snapshot.sourceUUID = sourceVolume.uuid;
					createSnapshot(snapshot, user, (message, snapshot) => {
						resolve(snapshot);
					});
				});
			}

			function promiseAttachSnapshot(snapshot, clientID) {
				return new Promise(resolve => {
					attachSnapshot(snapshot, clientID, message => {
						resolve(message.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID));
					});
				});
			}

			it('source not attached - should fail and rollback creation', async() => {
				const snapshotObject = await promiseCreateSnapshot(snapshot, user);
				let res = await promiseAttachSnapshot(snapshotObject, client.id);

				assert(res);
				assert(res.error);
				errorUtils.assertIsCausedBy(res.error, systemMessages.SNAPSHOT_SOURCE_VOLUME_NOT_ATTACHED);
				assert(!res.error.rollbackError, 'Rollback failed ' + errorUtils.errorToString(res.error?.rollbackError));
			});
		});
	});
});

