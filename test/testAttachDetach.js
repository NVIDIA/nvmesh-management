
/* global app,log,describe,before,it,beforeEach,after */

const dbManager = require('./testUtils/dbManager.js');
const { setup } = require('./testUtils/setup.js');

const assert = require('assert');
const async = require('async');
const uuid = require('uuid');

const consts = require('../consts.js');
const { VolumeRAID1 } = require('./models/volume.js');
const { generateTargets } = require('./testUtils/entityGenerators.js');
const clientModule = require('../modules/client.js');
const { Client, BlockDevice } = require('./models/client.js');
const { markVolumesForDeletion } = require('../modules/volume.js');
const systemMessages = require('../systemMessages.js');
const { assertIsCausedBy } = require('./testUtils/errorUtils.js');
const { ClientUpdateAttachmentStatusBuilder } = require('./kafkaMessages/fromClient/clientMessageBuilders.js');
const { Entities } = require('../modules/error.js');
const { promiseAttachVolume, promiseDetachVolume, promiseHandleUpdateAttachment } = require('./testUtils/clientUtils.js');

const ZONE_1 = 'zone_1';
const VOL_1 = { name: 'vol-1' };
const VOL_2 = { name: 'vol-2' };
const VOL_3 = { name: 'vol-3' };
const CLIENTS = [1, 2, 3, 4, 5].map(i => `client-${i}`);
const CLIENT_1 = CLIENTS[0];
let clientCollection;
let volumeCollection;

function generateAndSaveTargets(count, numOfDisks, zone) {
	let targets = generateTargets(count, zone, numOfDisks);
	return Promise.all(targets.map(t => t.save()));
}

function getVolumeUUIDByID(volumeID) {
	return app.get('db').collection('volume').findOne({ _id: volumeID }, { uuid: 1 });
}

describe('AttachDetachAndReservation', () => {
	before(() => {
		return dbManager.connect().then(() => {
			clientCollection = app.get('db').collection('client');
			volumeCollection = app.get('db').collection('volume');
		});
	});

	after(() => {
		return dbManager.closeConnection();
	});

	describe('#Attach&Detach from management', () => {
		let volumes = [new VolumeRAID1(VOL_1.name), new VolumeRAID1(VOL_2.name), new VolumeRAID1(VOL_3.name)];
		let clientObj;
		let clients = [];

		beforeEach(() => {
			return setup.newSetup()
				.then(() => generateAndSaveTargets(3, 2, ZONE_1))
				.then(() => Promise.all(volumes.map(v => v.save())))
				.then(() => log.debug('finished setup'))
				.then(() => {
					return Promise.all(CLIENTS.map(client => {
						clientObj = new Client(client);
						clients.push(clientObj);
						return clientObj.save();
					}));
				})
				.then(() => getVolumeUUIDByID(VOL_1.name))
				.then(dbVolume => { VOL_1.uuid = dbVolume.uuid; delete VOL_1.referenceID; })
				.then(() => getVolumeUUIDByID(VOL_2.name))
				.then(dbVolume => { VOL_2.uuid = dbVolume.uuid; delete VOL_2.referenceID; })
				.then(() => getVolumeUUIDByID(VOL_3.name))
				.then(dbVolume => { VOL_3.uuid = dbVolume.uuid; delete VOL_3.referenceID; });
		});
		it('Remove already detached volumes', async() => {
			// Step 1: Attach volumes
			let volumesToAttach = [
				{
					name: VOL_1.name,
					uuid: VOL_1.uuid,
					reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE }
				},
				{
					name: VOL_2.name,
					uuid: VOL_2.uuid,
					reservation: { mode: consts.reservationModeNames.SHARED_READ_ONLY }
				},
				{
					name: VOL_3.name,
					uuid: VOL_3.uuid,
					reservation: { mode: consts.reservationModeNames.EXCLUSIVE_READ_WRITE }
				}
			];

			await new Promise(resolve => {
				clientModule.attachVolumes(CLIENT_1, clientObj.uuid, volumesToAttach, () => {
					resolve();
				});
			});

			// Step 2: Update client collection
			await clientCollection.updateOne(
				{ _id: CLIENT_1 },
				{
					$set: {
						block_devices: [
							{
								uuid: VOL_1.uuid,
								vol_status: consts.volumeAttachmentStatus.DETACHED
							},
							{
								uuid: VOL_2.uuid,
								vol_status: consts.volumeAttachmentStatus.ATTACHED
							}
						],
						attachments: {
							[VOL_1.uuid]: {
								uuid: VOL_1.uuid,
								action: consts.volumeAttachmentActions.DETACHING,
								attachmentsVersion: 1
							},
							[VOL_2.uuid]: {
								uuid: VOL_2.uuid,
								action: consts.volumeAttachmentActions.DETACHING,
								attachmentsVersion: 1
							},
							[VOL_3.uuid]: {
								uuid: VOL_3.uuid,
								action: consts.volumeAttachmentActions.DETACHING,
								attachmentsVersion: 1
							}
						}
					}
				}
			);

			// Step 3: Remove already detached attachments
			await new Promise(resolve => {
				clientModule.removeAlreadyDetachedAttachments(CLIENT_1, resolve);
			});

			// Step 4: Verify result
			const client = await clientCollection.findOne({ _id: CLIENT_1 });
			assert.strictEqual(1, Object.keys(client.attachments).length);
			assert(!client.attachments[VOL_1.uuid]);
			assert(!client.attachments[VOL_3.uuid]);
			assert(client.attachments[VOL_2.uuid]);

			const volumes = await volumeCollection.find({ _id: { $in: [VOL_1.name, VOL_2.name, VOL_3.name] } }).toArray();
			volumes.forEach(vol => {
				switch (vol._id) {
					case VOL_1.name:
					case VOL_3.name:
						assert.strictEqual(vol.reservation.attachedClients.length, 0);
						assert.strictEqual(vol.reservation.version, 3);
						break;
					case VOL_2.name:
						assert.strictEqual(vol.reservation.attachedClients.length, 1);
						assert.strictEqual(vol.reservation.version, 2);
						break;

					default:
						break;
				}

			});
		});


		it('Attach / Detach SharedRW the volume', () => {
			return new Promise(resolve => {
				clientModule.attachVolumes(CLIENT_1, clientObj.uuid, [{
					name: VOL_1.name,
					uuid: VOL_1.uuid,
					reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE }
				}], logs => {
					assert(logs.length);
					assert(logs[0].systemMessage.id === systemMessages.VOLUME_STATE_ATTACHING.id);
					resolve();
				});
			})
				.then(() => clientCollection.findOne({ _id: CLIENT_1 }))
				.then(client => {
					assert.strictEqual(Object.keys(client.attachments).length, 1);
					assert.strictEqual(client.attachments[VOL_1.uuid].reservation.version, 2);
					assert.strictEqual(client.attachments[VOL_1.uuid].reservation.mode, consts.reservationModes.SHARED_READ_WRITE);
					assert.strictEqual(client.attachments[VOL_1.uuid].version, 1);
					assert.ok(!client.attachments[VOL_1.uuid].pending);
				})
				.then(() => volumeCollection.findOne({ _id: VOL_1.name }))
				.then(volume => {
					assert.strictEqual(volume.reservation.version, 2);
					assert.ok(volume.reservation.attachedClients.includes(CLIENT_1));
				})
			// Handle Attach
				.then(() => {
					// Send Attach update from client
					let attached = new BlockDevice(VOL_1)
						.setUUID(VOL_1.uuid)
						.setAction(consts.volumeAttachmentActions.ATTACHING)
						.setStatus(consts.volumeAttachmentStatus.ATTACHED);
					let client = new Client(CLIENT_1);
					client.clientToken = 1;
					let updateAttachmentMsg = ClientUpdateAttachmentStatusBuilder.fromClient(client)
						.setReportID(2)
						.addAttachment(attached)
						.setAttachmentsVersion(2)
						.build();
					return new Promise(resolve => {
						clientModule.handleUpdateAttachment(updateAttachmentMsg,
							(err) => {
								assert(!err);
								clientCollection.findOne({ _id: CLIENT_1 }, (err, client) => {
									assert.strictEqual(1, Object.keys(client.attachments).length,
										`Found unexpected client attachments: ${JSON.stringify(client.attachments, '', 4)}`);
									resolve();
									volumeCollection.findOne({ _id: VOL_1.name })
										.then(volume => {
											assert.strictEqual(volume.reservation.version, 2);
											assert.strictEqual(Object.values(volume.lastReservationVersionSentToTomaByTargetVersion)[0], 3);
											assert.ok(volume.reservation.attachedClients.includes(CLIENT_1));
											assert.strictEqual(volume.reservation.mode, consts.reservationModes.SHARED_READ_WRITE);
											resolve();
										});
								});
							});
					});

				})
			// Detach
				.then(() => {
					return new Promise(resolve => {
						clientModule.detachVolumes(CLIENT_1, clientObj.uuid, [VOL_1], logs => {
							assert(logs[0].systemMessage.id === systemMessages.VOLUME_STATE_DETACHING.id);
							resolve();
						});
					});
				})
				.then(() => clientCollection.findOne({ _id: CLIENT_1 }))
				.then(dbClient => {
					assert.strictEqual(Object.keys(dbClient.attachments).length, 1);
					assert.strictEqual(2, dbClient.attachmentsVersion);
					assert.ok(!dbClient.attachments[VOL_1.uuid].pending);
					assert.strictEqual(dbClient.attachments[VOL_1.uuid].version, 2);

					// Send Detach update from client
					let detached = new BlockDevice(VOL_1)
						.setUUID(VOL_1.uuid)
						.setAction(consts.volumeAttachmentActions.DETACHING)
						.setStatus(consts.volumeAttachmentStatus.DETACHED);

					let client = new Client(CLIENT_1);
					client.clientToken = 1;
					let updateAttachmentMsg = ClientUpdateAttachmentStatusBuilder.fromClient(client)
						.setReportID(3)
						.addAttachment(detached)
						.setAttachmentsVersion(2)
						.build();

					return new Promise(resolve => {
						clientModule.handleUpdateAttachment(updateAttachmentMsg,
							(err) => {
								assert(!err);
								clientCollection.findOne({ _id: CLIENT_1 }, (err, client) => {
									assert.strictEqual(0, Object.keys(client.attachments).length,
										`Found unexpected client attachments: ${JSON.stringify(client.attachments, '', 4)}`);
									resolve();
									volumeCollection.findOne({ _id: VOL_1.name })
										.then(volume => {
											assert.strictEqual(volume.reservation.version, 3);
											assert.strictEqual(Object.values(volume.lastReservationVersionSentToTomaByTargetVersion)[0], 3);
											assert.ok(!volume.reservation.attachedClients.includes(CLIENT_1));
											assert.strictEqual(volume.reservation.mode, consts.reservationModes.NONE);
											resolve();
										});
								});
							});
					});
				});
		});

		it('Handle DETACH_FAILED_UNKNOWN_VOLUME from client', async() => {
			// Attach
			let attachCmd = {
				name: VOL_1.name,
				uuid: VOL_1.uuid,
				reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE }
			};

			let client = clients[0];
			await promiseAttachVolume(client.id, client.uuid, attachCmd);

			// client reports ATTACHED
			let attached = new BlockDevice(VOL_1)
				.setUUID(VOL_1.uuid)
				.setAction(consts.volumeAttachmentActions.ATTACHING)
				.setStatus(consts.volumeAttachmentStatus.ATTACHED);

			let updateAttachmentMsg = ClientUpdateAttachmentStatusBuilder.fromClient(client)
				.setReportID(2)
				.addAttachment(attached)
				.setAttachmentsVersion(2)
				.build();

			await promiseHandleUpdateAttachment(updateAttachmentMsg);

			// Detach
			await promiseDetachVolume(client.id, client.uuid, VOL_1);

			// Send DETACH_FAILED_UNKNOWN_VOLUME update from client
			let detached = new BlockDevice(VOL_1)
				.setUUID(VOL_1.uuid)
				.setAction(consts.volumeAttachmentActions.DETACHING)
				.setStatus(consts.volumeAttachmentStatus.DETACH_FAILED_UNKNOWN_VOLUME);

			updateAttachmentMsg = ClientUpdateAttachmentStatusBuilder.fromClient(client)
				.setReportID(3)
				.addAttachment(detached)
				.setAttachmentsVersion(2)
				.build();

			await promiseHandleUpdateAttachment(updateAttachmentMsg);

			// check attachment deleted from desiredState
			let dbClient = await clientCollection.findOne({ _id: CLIENT_1 });
			let numOfClientAttachments = Object.keys(dbClient.attachments).length;
			assert.strictEqual(0, numOfClientAttachments,
				`Found unexpected client attachments: ${JSON.stringify(dbClient.attachments, '', 4)}`);
		});

		it('updateAttachmentStatus DETACHED with old reportID', async() => {
			// User Requests Attach
			let attachCmd = {
				name: VOL_1.name,
				uuid: VOL_1.uuid,
				reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE }
			};

			let client = clients[0];
			await promiseAttachVolume(client.id, client.uuid, attachCmd);

			// client reports ATTACHED
			let attached = new BlockDevice(VOL_1)
				.setUUID(VOL_1.uuid)
				.setAction(consts.volumeAttachmentActions.ATTACHING)
				.setStatus(consts.volumeAttachmentStatus.ATTACHED);

			let updateAttachmentMsg = ClientUpdateAttachmentStatusBuilder.fromClient(client)
				.setReportID(2)
				.addAttachment(attached)
				.setAttachmentsVersion(2)
				.build();

			await promiseHandleUpdateAttachment(updateAttachmentMsg);

			// User Requests Detach
			await promiseDetachVolume(client.id, client.uuid, VOL_1);

			// Send DETACH with old reportID
			let detached = new BlockDevice(VOL_1)
				.setUUID(VOL_1.uuid)
				.setAction(consts.volumeAttachmentActions.DETACHING)
				.setStatus(consts.volumeAttachmentStatus.DETACHED);

			updateAttachmentMsg = ClientUpdateAttachmentStatusBuilder.fromClient(client)
				.setReportID(2)
				.addAttachment(detached)
				.setAttachmentsVersion(2)
				.build();

			await promiseHandleUpdateAttachment(updateAttachmentMsg);
			// check attachment not deleted
			let dbClient = await clientCollection.findOne({ _id: CLIENT_1 });
			assert(dbClient.attachments[VOL_1.uuid]);
			assert(dbClient.attachments[VOL_1.uuid]);

			// verify pending was removed
			assert(!dbClient.attachments[VOL_1.uuid].pending);

			// verify block_device ATTACHED was removed
			assert(dbClient.block_devices[0].vol_status, consts.volumeAttachmentStatus.ATTACHED);
		});

		it('Attach / Detach STATIC emulation volume', () => {
			return new Promise(resolve => {
				clientModule.attachVolumes(CLIENT_1, clientObj.uuid, [{
					name: VOL_1.name,
					uuid: VOL_1.uuid,
					reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE },
					emulation: { mode: consts.emulationModeNames.STATIC }
				}], messages => {
					const response = messages[0].createApiResponse();

					assert(response.success);
					resolve(response);
				});
			})
				.then(() => clientCollection.findOne({ _id: CLIENT_1 }))
				.then(client => {
					assert.strictEqual(Object.keys(client.attachments).length, 1);
					assert.strictEqual(client.attachments[VOL_1.uuid].reservation.version, 2);
					assert.strictEqual(client.attachments[VOL_1.uuid].reservation.mode, consts.reservationModes.SHARED_READ_WRITE);
					assert.strictEqual(client.attachments[VOL_1.uuid].emulation.mode, consts.emulationModes.STATIC);
					assert.strictEqual(client.attachments[VOL_1.uuid].version, 1);
					assert.ok(!client.attachments[VOL_1.uuid].pending);
				})
				.then(() => volumeCollection.findOne({ _id: VOL_1.name }))
				.then(volume => {
					assert.strictEqual(volume.reservation.version, 2);
					assert.ok(volume.reservation.attachedClients.includes(CLIENT_1));
				})
			// Handle Attach
				.then(() => {
					// Send Attach update from client
					let attached = new BlockDevice(VOL_1)
						.setUUID(VOL_1.uuid)
						.setAction(consts.volumeAttachmentActions.ATTACHING)
						.setStatus(consts.volumeAttachmentStatus.ATTACHED);
					let client = new Client(CLIENT_1);
					client.clientToken = 1;
					let updateAttachmentMsg = ClientUpdateAttachmentStatusBuilder.fromClient(client)
						.setReportID(2)
						.addAttachment(attached)
						.setAttachmentsVersion(2)
						.build();
					return new Promise(resolve => {
						clientModule.handleUpdateAttachment(updateAttachmentMsg,
							(err) => {
								assert(!err);
								clientCollection.findOne({ _id: CLIENT_1 }, (err, client) => {
									assert.strictEqual(1, Object.keys(client.attachments).length,
										`Found unexpected client attachments: ${JSON.stringify(client.attachments, '', 4)}`);
									resolve();
									volumeCollection.findOne({ _id: VOL_1.name })
										.then(volume => {
											assert.strictEqual(volume.reservation.version, 2);
											assert.strictEqual(Object.values(volume.lastReservationVersionSentToTomaByTargetVersion)[0], 3);
											assert.ok(volume.reservation.attachedClients.includes(CLIENT_1));
											assert.strictEqual(volume.reservation.mode, consts.reservationModes.SHARED_READ_WRITE);
											resolve();
										});
								});
							});
					});

				})
			// Detach
				.then(() => {
					return new Promise(resolve => {
						clientModule.detachVolumes(CLIENT_1, clientObj.uuid, [VOL_1], messages => {
							const response = messages[0].createApiResponse();
							assert(response.success, `Detach client failed: ${JSON.stringify(response.error)}`);
							resolve();
						});
					});
				})
				.then(() => clientCollection.findOne({ _id: CLIENT_1 }))
				.then(dbClient => {
					assert.strictEqual(Object.keys(dbClient.attachments).length, 1);
					assert.strictEqual(2, dbClient.attachmentsVersion);
					assert.strictEqual(dbClient.attachments[VOL_1.uuid].version, 2);
					assert.ok(!dbClient.attachments[VOL_1.uuid].pending);

					// Send Detach update from client
					let detached = new BlockDevice(VOL_1)
						.setUUID(VOL_1.uuid)
						.setAction(consts.volumeAttachmentActions.DETACHING)
						.setStatus(consts.volumeAttachmentStatus.DETACHED);

					let client = new Client(CLIENT_1);
					let updateAttachmentMsg = ClientUpdateAttachmentStatusBuilder.fromClient(client)
						.setReportID(3)
						.addAttachment(detached)
						.setAttachmentsVersion(2)
						.build();

					return new Promise(resolve => {
						clientModule.handleUpdateAttachment(updateAttachmentMsg,
							(err) => {
								assert(!err);
								clientCollection.findOne({ _id: CLIENT_1 }, (err, client) => {
									assert.strictEqual(0, Object.keys(client.attachments).length,
										`Found unexpected client attachments: ${JSON.stringify(client.attachments, '', 4)}`);
									resolve();
								});
							});
					});
				});
		});

		it('Attach / Detach volume with refID', async() => {
			const refID = 'namespace-a';

			const attachReq = {
				name: VOL_1.name,
				uuid: VOL_1.uuid,
				reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE },
				referenceID: refID
			};

			await promiseAttachVolume(CLIENT_1, clientObj.uuid, attachReq);

			let dbClient = await clientCollection.findOne({ _id: CLIENT_1 });
			assert.strictEqual(Object.keys(dbClient.attachments).length, 1);
			assert.strictEqual(dbClient.attachments[VOL_1.uuid].reservation.version, 2);
			assert.strictEqual(dbClient.attachments[VOL_1.uuid].reservation.mode, consts.reservationModes.SHARED_READ_WRITE);
			assert.ok(dbClient.attachments[VOL_1.uuid].referenceIDs.includes(refID));

			let dbVolume = await volumeCollection.findOne({ _id: VOL_1.name });
			assert.strictEqual(dbVolume.reservation.version, 2);
			assert.ok(dbVolume.reservation.attachedClients.includes(CLIENT_1));

			// Send ATTACHED update from client
			let attached = new BlockDevice(VOL_1)
				.setUUID(VOL_1.uuid)
				.setAction(consts.volumeAttachmentActions.ATTACHING)
				.setStatus(consts.volumeAttachmentStatus.ATTACHED);

			let client = new Client(CLIENT_1);
			let updateAttachmentMsg1 = ClientUpdateAttachmentStatusBuilder.fromClient(client)
				.setReportID(2)
				.addAttachment(attached)
				.setAttachmentsVersion(2)
				.build();

			await promiseHandleUpdateAttachment(updateAttachmentMsg1);

			// Detach
			const detachReq = {
				name: VOL_1.name,
				uuid: VOL_1.uuid,
				referenceID: refID
			};
			await promiseDetachVolume(CLIENT_1, clientObj.uuid, detachReq);

			dbClient = await clientCollection.findOne({ _id: CLIENT_1 });
			assert.strictEqual(Object.keys(dbClient.attachments).length, 1);
			assert.strictEqual(2, dbClient.attachmentsVersion);
			assert.ok(!dbClient.attachments[VOL_1.uuid].pending);
			assert.ok(!dbClient.attachments[VOL_1.uuid].referenceIDs.includes(refID));

			// Send Detach update from client
			let detached = new BlockDevice(VOL_1)
				.setUUID(VOL_1.uuid)
				.setAction(consts.volumeAttachmentActions.DETACHING)
				.setStatus(consts.volumeAttachmentStatus.DETACHED);

			let updateAttachmentMsg2 = ClientUpdateAttachmentStatusBuilder.fromClient(client)
				.setReportID(3)
				.addAttachment(detached)
				.setAttachmentsVersion(2)
				.build();

			await promiseHandleUpdateAttachment(updateAttachmentMsg2);

			dbClient = await clientCollection.findOne({ _id: CLIENT_1 });

			assert.strictEqual(0, Object.keys(dbClient.attachments).length,
				`Found unexpected client attachments: ${JSON.stringify(dbClient.attachments, '', 4)}`);
		});

		it('Attach / Detach volume with multiple refIDs', () => {
			const refID1 = 'namespace-a';
			const refID2 = 'namespace-b';

			return new Promise(resolve => {
				clientModule.attachVolumes(CLIENT_1, clientObj.uuid, [{
					name: VOL_1.name,
					uuid: VOL_1.uuid,
					reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE },
					referenceID: refID1
				}], messages => {
					const response = messages[0].createApiResponse();

					assert(response.success);
					resolve(response);
				});
			})
				.then(() => clientCollection.findOne({ _id: CLIENT_1 }))
				.then(client => {
					assert.strictEqual(Object.keys(client.attachments).length, 1);
					assert.strictEqual(client.attachments[VOL_1.uuid].reservation.version, 2);
					assert.strictEqual(client.attachments[VOL_1.uuid].reservation.mode, consts.reservationModes.SHARED_READ_WRITE);
					assert.ok(client.attachments[VOL_1.uuid].referenceIDs.includes(refID1));
				})
				.then(() => volumeCollection.findOne({ _id: VOL_1.name }))
				.then(volume => {
					assert.strictEqual(volume.reservation.version, 2);
					assert.ok(volume.reservation.attachedClients.includes(CLIENT_1));
				})
				// report Attached
				.then(async() => {
					// Send ATTACHED update from client
					let attached = new BlockDevice(VOL_1)
						.setUUID(VOL_1.uuid)
						.setAction(consts.volumeAttachmentActions.ATTACHING)
						.setStatus(consts.volumeAttachmentStatus.ATTACHED);

					let client = new Client(CLIENT_1);
					let updateAttachmentMsg1 = ClientUpdateAttachmentStatusBuilder.fromClient(client)
						.setReportID(2)
						.addAttachment(attached)
						.setAttachmentsVersion(2)
						.build();

					await promiseHandleUpdateAttachment(updateAttachmentMsg1);
				})
				// Attach 2nd refID
				.then(() => {
					return new Promise(resolve => {
						clientModule.attachVolumes(CLIENT_1, clientObj.uuid, [
							{
								name: VOL_1.name,
								uuid: VOL_1.uuid,
								reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE },
								referenceID: refID2
							},
							{
								name: VOL_2.name,
								uuid: VOL_2.uuid,
								reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE },
								referenceID: refID2
							}
						], messages => {
							assert(messages[0].systemMessage.id === systemMessages.VOLUME_STATE_ATTACHING.id);
							assert(messages[1].systemMessage.id === systemMessages.ADDED_REF_ID.id);
							const responses = messages.map(m => m.createApiResponse());

							assert(responses.every(res => res.success));

							resolve();
						});
					});
				})
				.then(() => clientCollection.findOne({ _id: CLIENT_1 }))
				.then(client => {
					assert.strictEqual(Object.keys(client.attachments).length, 2);
					assert.strictEqual(client.attachments[VOL_1.uuid].reservation.version, 2);
					assert.strictEqual(client.attachments[VOL_1.uuid].reservation.mode, consts.reservationModes.SHARED_READ_WRITE);
					assert.ok(client.attachments[VOL_1.uuid].referenceIDs.includes(refID1));
					assert.ok(client.attachments[VOL_1.uuid].referenceIDs.includes(refID2));
				})
			// Detach first refID
				.then(() => {
					return new Promise(resolve => {
						clientModule.detachVolumes(CLIENT_1, clientObj.uuid, [{
							name: VOL_1.name,
							uuid: VOL_1.uuid,
							referenceID: refID1
						},
						{
							name: VOL_2.name,
							uuid: VOL_2.uuid,
							referenceID: refID2
						}
						], messages => {
							assert(messages[0].systemMessage.id === systemMessages.VOLUME_REMOVED_REF_ID.id);
							assert(messages[1].systemMessage.id === systemMessages.VOLUME_STATE_DETACHING.id);
							const responses = messages.map(m => m.createApiResponse());

							assert(responses.every(res => res.success));
							let detached = new BlockDevice(VOL_2)
								.setUUID(VOL_2.uuid)
								.setAction(consts.volumeAttachmentActions.DETACHING)
								.setStatus(consts.volumeAttachmentStatus.DETACHED);

							let client = new Client(CLIENT_1);
							let updateAttachmentMsg = ClientUpdateAttachmentStatusBuilder.fromClient(client)
								.setReportID(3)
								.addAttachment(detached)
								.setAttachmentsVersion(4)
								.build();

							clientModule.handleUpdateAttachment(updateAttachmentMsg,
								(err) => {
									assert(!err);
									clientCollection.findOne({ _id: CLIENT_1 }, (err, client) => {
										assert.strictEqual(1, Object.keys(client.attachments).length,
											`Found unexpected client attachments: ${JSON.stringify(client.attachments, '', 4)}`);
										resolve();
									});
								});
						});
					});
				})
				.then(() => clientCollection.findOne({ _id: CLIENT_1 }))
				.then(dbClient => {
					assert.strictEqual(Object.keys(dbClient.attachments).length, 1);
					assert.strictEqual(dbClient.attachmentsVersion, 5);
					assert.ok(!dbClient.attachments[VOL_1.uuid].pending);
					assert.ok(!dbClient.attachments[VOL_1.uuid].referenceIDs.includes(refID1));
					assert.strictEqual(dbClient.attachments[VOL_1.uuid].action, consts.volumeAttachmentActions.ATTACHING);
				})
				.then(() => {
					return new Promise(resolve => {
						clientModule.detachVolumes(CLIENT_1, clientObj.uuid, [{
							name: VOL_1.name,
							uuid: VOL_1.uuid,
							referenceID: refID2
						}], messages => {
							const response = messages[0].createApiResponse();
							assert(messages[0].systemMessage.id === systemMessages.VOLUME_STATE_DETACHING.id);
							assert(response.success, `Detach client failed: ${JSON.stringify(response.error)}`);
							resolve();
						});
					});
				})
				.then(() => clientCollection.findOne({ _id: CLIENT_1 }))
				.then(dbClient => {
					assert.strictEqual(Object.keys(dbClient.attachments).length, 1);
					assert.strictEqual(dbClient.attachmentsVersion, 6);
					assert.ok(!dbClient.attachments[VOL_1.uuid].pending);
					assert.ok(!dbClient.attachments[VOL_1.uuid].referenceIDs.includes(refID2));
					assert.strictEqual(dbClient.attachments[VOL_1.uuid].action, consts.volumeAttachmentActions.DETACHING);
					// Send Detach update from client
					let detached = new BlockDevice(VOL_1)
						.setUUID(VOL_1.uuid)
						.setAction(consts.volumeAttachmentActions.DETACHING)
						.setStatus(consts.volumeAttachmentStatus.DETACHED);

					let client = new Client(CLIENT_1);
					let updateAttachmentMsg = ClientUpdateAttachmentStatusBuilder.fromClient(client)
						.setReportID(4)
						.addAttachment(detached)
						.setAttachmentsVersion(6)
						.build();

					return new Promise(resolve => {
						clientModule.handleUpdateAttachment(updateAttachmentMsg,
							(err) => {
								assert(!err);
								clientCollection.findOne({ _id: CLIENT_1 }, (err, client) => {
									assert.strictEqual(0, Object.keys(client.attachments).length,
										`Found unexpected client attachments: ${JSON.stringify(client.attachments, '', 4)}`);
									resolve();
								});
							});
					});
				});
		});
		// it('Race between 2 detach and 1 attach => Attachment should not be pending and the action should be consistent with the volume', () => {
		// 	let client;

		// 	return new Promise(resolve => {
		// 		clientModule.attachVolumes(CLIENT_1, clientObj.uuid, [{
		// 			name: VOL_1.name,
		// 			uuid: VOL_1.uuid,
		// 			reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE }
		// 		}], logs => {
		// 			assert(logs.length);
		// 			assert(logs[0].systemMessage.id === systemMessages.VOLUME_STATE_ATTACHING.id);
		// 			resolve();
		// 		});
		// 	})
		// 		.then(() => {
		// 			return new Promise(resolve => {
		// 				async.parallel([
		// 					function(cb) {
		// 						clientModule.detachVolumes(CLIENT_1, clientObj.uuid, [VOL_1], messages => {
		// 							if (messages[0].systemMessage.id === systemMessages.VOLUME_STATE_DETACHING.id)
		// 								cb();
		// 							else
		// 								cb(false);
		// 						});
		// 					},
		// 					function(cb) {
		// 						clientModule.attachVolumes(CLIENT_1, clientObj.uuid, [VOL_1], messages => {
		// 							if (messages[0].systemMessage.id === systemMessages.VOLUME_STATE_ATTACHING.id)
		// 								cb();
		// 							else
		// 								cb(false);
		// 						});
		// 					},
		// 					function(cb) {
		// 						clientModule.detachVolumes(CLIENT_1, clientObj.uuid, [VOL_1], messages => {
		// 							if (messages[0].systemMessage.id === systemMessages.VOLUME_STATE_DETACHING.id)
		// 								cb();
		// 							else
		// 								cb(false);
		// 						});
		// 					}
		// 				],
		// 				function(err) {
		// 					assert(!err);
		// 					resolve();
		// 				});
		// 			}).then(() => clientCollection.findOne({ _id: CLIENT_1 }))
		// 				.then(dbClient => {
		// 					client = dbClient;
		// 					assert.ok(!dbClient.attachments[VOL_1.uuid].pending);
		// 					assert.strictEqual(dbClient.attachmentsVersion, 4);
		// 				})
		// 				.then(() => volumeCollection.findOne({ _id: VOL_1.name }))
		// 				.then(dbVolume => {
		// 					if (client.attachments[VOL_1.uuid].action === consts.volumeAttachmentActions.ATTACHING)
		// 						assert(dbVolume.reservation.attachedClients.includes(CLIENT_1));
		// 				});
		// 		});
		// });

		it('Check pending attach', () => {
			return new Promise(resolve => {
				clientCollection.updateOne({ _id: CLIENT_1 },
					{
						$set: {
							[`attachments.${VOL_1.uuid}.pending`]: { action: consts.volumeAttachmentActions.DETACHING },
							[`attachments.${VOL_1.uuid}.uuid`]: VOL_1.uuid,
							[`attachments.${VOL_1.uuid}.name`]: VOL_1.name,
							[`attachments.${VOL_2.uuid}.pending`]: { action: consts.volumeAttachmentActions.DETACHING },
							[`attachments.${VOL_2.uuid}.uuid`]: VOL_2.uuid,
							[`attachments.${VOL_2.uuid}.name`]: VOL_2.name
						}
					}
				)
					.then(() => {
						async.parallel([
							function attach(cb) {
								clientModule.attachVolumes(CLIENT_1, clientObj.uuid, [
									{
										name: VOL_1.name,
										uuid: VOL_1.uuid,
										reservation: { mode: consts.reservationModeNames.SHARED_READ_ONLY }
									},
									{
										name: VOL_2.name,
										uuid: VOL_2.uuid,
										reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE }
									},
									{
										name: VOL_3.name,
										uuid: VOL_3.uuid,
										reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE }
									}
								], results => {
									results = results.reduce((acc, curr) => {
										return { ...acc, [curr.getAdditionalInfoByKey(Entities.Volume.ID)]: curr };
									}, {});
									assert(results[VOL_1.name].systemMessage.id === systemMessages.VOLUME_STATE_ATTACHING.id);
									assert.strictEqual(results[VOL_2.name].systemMessage.id, systemMessages.FAILED_WAIT_FOR_PENDING_ATTACHMENT.id);
									assert(results[VOL_3.name].systemMessage.id === systemMessages.VOLUME_STATE_ATTACHING.id);
									cb();
								});
							},
							function removePendingFromVOL1(cb) {
								setTimeout(() => {
									clientCollection.updateOne({ _id: CLIENT_1 }, { $unset: { [`attachments.${VOL_1.uuid}.pending`]: 1 } }, cb);
								}, 2000);
							}
						], function() {
							resolve();
						});
					});
			})
				.then(() => volumeCollection.findOne({ _id: VOL_1.name }))
				.then(dbVolume => {
					assert.strictEqual(dbVolume.reservation.mode, consts.reservationModes.SHARED_READ_ONLY);
				});
		});

		it('Attach Exclusive RW the volume', (done) => {
			clientModule.attachVolumes(CLIENT_1, clientObj.uuid, [{
				name: VOL_1.name,
				uuid: VOL_1.uuid,
				reservation: { mode: consts.reservationModeNames.EXCLUSIVE_READ_WRITE }
			}], logs => {
				assert.strictEqual(logs[0].systemMessage.id, systemMessages.VOLUME_STATE_ATTACHING.id, logs[0].toString());

				clientCollection.findOne({ _id: CLIENT_1 }, (err, client) => {
					assert.strictEqual(Object.keys(client.attachments).length, 1);
					assert.strictEqual(client.attachments[VOL_1.uuid].reservation.version, 2);
					assert.strictEqual(client.attachments[VOL_1.uuid].reservation.mode, consts.reservationModes.EXCLUSIVE_READ_WRITE);

					done();
				});
			});
		});
		// it('Detach all the clients from a volume -> reservation.mode = NONE ', () => {
		// 	return new Promise((resolve) => {
		// 		async.parallel(CLIENTS.map(client => {
		// 			return function(cb) {
		// 				clientModule.attachVolumes(
		// 					client,
		// 					[{
		// 						name: VOL_1.name,
		// 						uuid: VOL_1.uuid,
		// 						reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE	}
		// 					}],
		// 					logs => {
		// 						if (logs[0].systemMessage.id !== systemMessages.VOLUME_STATE_ATTACHING.id)
		// 							return cb(logs[0]);

		// 						cb();
		// 					});
		// 			};
		// 		}), err => {
		// 			assert.ok(!err);

		// 			const volumeToDetach = {
		// 				name: VOL_1.name,
		// 				uuid: VOL_1.uuid
		// 			};
		// 			async.parallel(CLIENTS.map(client => {
		// 				return function(cb) {
		// 					clientModule.detachVolumes(client, [volumeToDetach], logs => {
		// 						if (logs[0].systemMessage.id !== systemMessages.VOLUME_STATE_DETACHING.id)
		// 							return cb(logs[0]);

		// 						cb();
		// 					});
		// 				};
		// 			}),
		// 			err => {
		// 				assert.ok(!err);
		// 				resolve();
		// 			});
		// 		});
		// 	})
		// 		.then(() => volumeCollection.findOne({ _id: VOL_1.name }))
		// 		.then((volume) => {
		// 			assert.strictEqual(volume.reservation.version, 3);
		// 			assert.strictEqual(volume.reservation.mode, consts.reservationModes.NONE);
		// 			assert.strictEqual(volume.reservation.attachedClients.length, 0);
		// 			assert.strictEqual(volume.lastReservationVersionSentToTOMA, volume.reservation.version);
		// 		});
		// });

		it('Attach / Detach many volumes', () => {
			let volumesToAttach = [{
				name: VOL_1.name,
				uuid: VOL_1.uuid,
				reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE	}
			}, {
				name: VOL_2.name,
				uuid: VOL_2.uuid,
				reservation: { mode: consts.reservationModeNames.SHARED_READ_ONLY }
			}, {
				name: VOL_3.name,
				uuid: VOL_3.uuid,
				reservation: { mode: consts.reservationModeNames.EXCLUSIVE_READ_WRITE }
			}];

			return new Promise((resolve) => {
				clientModule.attachVolumes(CLIENT_1, clientObj.uuid, volumesToAttach, res => {
					resolve(res);
				});
			})
				.then(() => clientCollection.findOne({ _id: CLIENT_1 }))
				.then(client => {
					assert.strictEqual(Object.keys(client.attachments).length, 3);

					volumesToAttach.forEach((v) => {
						assert.strictEqual(client.attachments[v.uuid].reservation.version, 2);
						assert.strictEqual(client.attachments[v.uuid].action, consts.volumeAttachmentActions.ATTACHING);
						assert.strictEqual(client.attachments[v.uuid].reservation.mode, v.reservation.mode);
					});
				})
				.then(() => {
					// handle update attachments
					return new Promise(resolve => {
						let reportID = 2;
						let attachmentVersion = 2;
						async.eachSeries(volumesToAttach, (vol, nextVol) => {
							let attached = new BlockDevice(VOL_1)
								.setUUID(vol.uuid)
								.setAction(consts.volumeAttachmentActions.ATTACHING)
								.setStatus(consts.volumeAttachmentStatus.ATTACHED);
							let clnt = new Client(CLIENT_1);
							clnt.clientToken = 1;
							let updateAttachmentMsg = ClientUpdateAttachmentStatusBuilder.fromClient(clnt)
								.setReportID(reportID)
								.addAttachment(attached)
								.setAttachmentsVersion(attachmentVersion)
								.build();

							clientModule.handleUpdateAttachment(updateAttachmentMsg, (err) => {
								reportID++;
								attachmentVersion++;
								nextVol(err);
							});
						}, err => {
							assert(!err);
							resolve();
						});
					});
				})
			// Detach Volumes
				.then(() => {
					return new Promise((resolve) => {
						clientModule.detachVolumes(CLIENT_1, clientObj.uuid, volumesToAttach, () => {
							resolve();
						});
					});
				})
				.then(() => clientCollection.findOne({ _id: CLIENT_1 }))
				.then((client) => {
					assert.strictEqual(Object.keys(client.attachments).length, 3);

					volumesToAttach.forEach((v) => {
						assert.strictEqual(client.attachments[v.uuid].reservation.version, 2);
						assert.strictEqual(client.attachments[v.uuid].action, consts.volumeAttachmentActions.DETACHING);
						assert.strictEqual(client.attachments[v.uuid].reservation.mode, v.reservation.mode);
					});
				});
		});


		it('Reservation illegal transition SHARED_RW > EXCL_RW ', (done) => {
			clientModule.attachVolumes(CLIENT_1, clientObj.uuid, [{
				name: VOL_1.name,
				uuid: VOL_1.uuid,
				reservation: {
					mode: consts.reservationModeNames.SHARED_READ_WRITE,
					preempt: consts.reservationModePreempts.NO_PREEMPT
				}
			}], () => {
				clientCollection.findOne({ _id: CLIENT_1 }, (err, client) => {
					clientModule.attachVolumes(CLIENT_1, clientObj.uuid, [{
						name: VOL_1.name,
						uuid: VOL_1.uuid,
						reservation: {
							mode: consts.reservationModeNames.EXCLUSIVE_READ_WRITE,
							preempt: consts.reservationModePreempts.NO_PREEMPT,
							version: client.attachments[VOL_1.uuid].reservation.version
						}
					}], (logs) => {
						const response = logs[0].createApiResponse();
						assertIsCausedBy(response.error, systemMessages.VALIDATE_RESERVATION_PREEMPT_ERROR);
						clientCollection.findOne({ _id: CLIENT_1 }, (err, client) => {
							assert.strictEqual(client.attachments[VOL_1.uuid].reservation.mode, consts.reservationModes.SHARED_READ_WRITE);

							done();
						});
					});
				});
			});
		});

		it('Reservation illegal transition SHARED_RO > EXCL_RW ', (done) => {
			clientModule.attachVolumes(CLIENT_1, clientObj.uuid, [{
				name: VOL_1.name,
				uuid: VOL_1.uuid,
				reservation: {
					mode: consts.reservationModeNames.SHARED_READ_ONLY,
					preempt: consts.reservationModePreempts.NO_PREEMPT
				}
			}], () => {
				clientCollection.findOne({ _id: CLIENT_1 }, (err, client) => {
					clientModule.attachVolumes(CLIENT_1, clientObj.uuid, [{
						name: VOL_1.name,
						uuid: VOL_1.uuid,
						reservation: {
							mode: consts.reservationModeNames.EXCLUSIVE_READ_WRITE,
							preempt: consts.reservationModePreempts.NO_PREEMPT,
							version: client.attachments[VOL_1.uuid].reservation.version
						}
					}], (logs) => {
						const response = logs[0].createApiResponse();
						assertIsCausedBy(response.error, systemMessages.VALIDATE_RESERVATION_PREEMPT_ERROR);
						clientCollection.findOne({ _id: CLIENT_1 }, (err, client) => {
							assert.strictEqual(client.attachments[VOL_1.uuid].reservation.mode, consts.reservationModes.SHARED_READ_ONLY);

							done();
						});
					});
				});
			});
		});

		it('Reservation illegal transition SHARED_RO > SHARED_RW ', (done) => {
			clientModule.attachVolumes(CLIENT_1, clientObj.uuid, [{
				name: VOL_1.name,
				uuid: VOL_1.uuid,
				reservation: {
					mode: consts.reservationModeNames.SHARED_READ_ONLY,
					preempt: consts.reservationModePreempts.NO_PREEMPT
				}
			}], () => {
				clientCollection.findOne({ _id: CLIENT_1 }, (err, client) => {
					clientModule.attachVolumes(CLIENT_1, clientObj.uuid, [{
						name: VOL_1.name,
						uuid: VOL_1.uuid,
						reservation: {
							mode: consts.reservationModeNames.SHARED_READ_WRITE,
							preempt: consts.reservationModePreempts.NO_PREEMPT,
							version: client.attachments[VOL_1.uuid].reservation.version
						}
					}], (logs) => {
						const response = logs[0].createApiResponse();
						assertIsCausedBy(response.error, systemMessages.VALIDATE_RESERVATION_PREEMPT_ERROR);
						clientCollection.findOne({ _id: CLIENT_1 }, (err, client) => {
							assert.strictEqual(client.attachments[VOL_1.uuid].reservation.mode, consts.reservationModes.SHARED_READ_ONLY);

							done();
						});
					});
				});
			});
		});


		it('Reservation transition with preempt', (done) => {
			const CLIENT_2 = CLIENTS[1];
			clientModule.attachVolumes(CLIENT_1, clientObj.uuid, [{
				name: VOL_1.name,
				uuid: VOL_1.uuid,
				reservation: {
					mode: consts.reservationModeNames.SHARED_READ_WRITE,
					preempt: consts.reservationModePreempts.NO_PREEMPT
				}
			},
			{
				name: VOL_2.name,
				uuid: VOL_2.uuid,
				reservation: {
					mode: consts.reservationModeNames.SHARED_READ_WRITE,
					preempt: consts.reservationModePreempts.NO_PREEMPT
				}
			}], () => {
				clientCollection.findOne({ _id: CLIENT_1 }, (err, client) => {
					clientCollection.findOne({ _id: CLIENT_2 }, (err, client2) => {
						clientModule.attachVolumes(CLIENT_2, client2.uuid, [{
							name: VOL_1.name,
							uuid: VOL_1.uuid,
							reservation: {
								mode: consts.reservationModeNames.EXCLUSIVE_READ_WRITE,
								preempt: consts.reservationModePreempts.PREEMPT,
								isDetachOthers: true,
								version: client.attachments[VOL_1.uuid].reservation.version
							}
						}], () => {
							clientCollection.find({ _id: { $in: [CLIENT_1, CLIENT_2] } }).toArray((err, clients) => {
								const client1 = clients.filter(c => c._id === CLIENT_1)[0];
								const client2 = clients.filter(c => c._id === CLIENT_2)[0];

								assert.strictEqual(client1.attachments[VOL_1.uuid].action, consts.volumeAttachmentActions.DETACHING);
								assert.strictEqual(client1.attachments[VOL_2.uuid].action, consts.volumeAttachmentActions.ATTACHING);
								assert.strictEqual(client2.attachments[VOL_1.uuid].reservation.mode, consts.reservationModes.EXCLUSIVE_READ_WRITE);

								volumeCollection.findOne({ _id: VOL_1.name }, (_, volume) => {
									assert.strictEqual(volume.reservation.mode, consts.reservationModes.EXCLUSIVE_READ_WRITE);
									assert.strictEqual(volume.reservation.attachedClients.length, 1);
									assert.strictEqual(volume.reservation.attachedClients[0], CLIENT_2);

									done();
								});
							});
						});
					});
				});
			});
		});

		it('Failed attachment, volume doesn\'t exist', (done) => {
			clientModule.attachVolumes(CLIENT_1, clientObj.uuid, [{
				name: 'vol-5',
				uuid: '6104bf50-b2b1-11ed-bec6-89fcb08b0ba3',
				reservation: {
					mode: consts.reservationModeNames.SHARED_READ_WRITE,
					preempt: consts.reservationModePreempts.NO_PREEMPT
				}
			}], logs => {
				assert(logs[0].systemMessage.id !== systemMessages.VOLUME_STATE_ATTACHING.id);

				done();
			});
		});

		it('Fail to detach volume that is not attached', (done) => {
			clientModule.detachVolumes(CLIENT_1, clientObj.uuid, [{
				name: 'vol-5',
				uuid: 'fdfd',
				reservation: {
					mode: consts.reservationModeNames.SHARED_READ_WRITE,
					preempt: consts.reservationModePreempts.NO_PREEMPT
				}
			}], logs => {
				assert(logs[0].systemMessage.id !== systemMessages.VOLUME_STATE_DETACHING.id);

				done();
			});
		});

		it('Fail to detach missing refID', (done) => {
			clientModule.attachVolumes(CLIENT_1, clientObj.uuid, [{
				name: VOL_1.name,
				uuid: VOL_1.uuid,
				reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE },
			}], messages => {
				const response = messages[0].createApiResponse();

				assert(response.success);
				clientModule.detachVolumes(CLIENT_1, clientObj.uuid, [{
					name: 'vol-5',
					uuid: 'fdfd',
					referenceID: 'bla'
				}], logs => {
					assert(logs[0].systemMessage.id === systemMessages.DETACH_CLIENT_NOT_FOUND_OR_VOLUME_NOT_ATTACHED.id);

					clientModule.detachVolumes(CLIENT_1, clientObj.uuid, [{
						name: VOL_1.name,
						uuid: VOL_1.uuid,
						referenceID: 'bla'
					}], logs => {
						assert(logs[0].systemMessage.id === systemMessages.MISSING_REF_ID.id);
						done();
					});
				});
			});

		});

		it('Fail to detach 1 of 2 volumes - one is not attached', () => {
			let singleVolume = [{
				name: VOL_1.name,
				uuid: VOL_1.uuid,
				reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE	}
			}];

			let volumesToDetach = [
				{ name: VOL_1.name, uuid: VOL_1.uuid },
				{ name: VOL_2.name, uuid: VOL_2.uuid }
			];

			return new Promise((resolve) => {
				clientModule.attachVolumes(CLIENT_1, clientObj.uuid, singleVolume, () => {
					// Send Attach update from client
					let attached = new BlockDevice(VOL_1)
						.setUUID(VOL_1.uuid)
						.setAction(consts.volumeAttachmentActions.ATTACHING)
						.setStatus(consts.volumeAttachmentStatus.ATTACHED);
					let client = new Client(CLIENT_1);
					client.clientToken = 1;
					let updateAttachmentMsg = ClientUpdateAttachmentStatusBuilder.fromClient(client)
						.setReportID(2)
						.addAttachment(attached)
						.setAttachmentsVersion(2)
						.build();
					clientModule.handleUpdateAttachment(updateAttachmentMsg, (err) => {
						assert(!err);
						clientCollection.findOne({ _id: CLIENT_1 }, (err, client) => {
							assert.strictEqual(1, Object.keys(client.attachments).length,
								`Found unexpected client attachments: ${JSON.stringify(client.attachments, '', 4)}`);
							resolve();
							volumeCollection.findOne({ _id: VOL_1.name })
								.then(volume => {
									assert.strictEqual(volume.reservation.version, 2);
									assert.strictEqual(Object.values(volume.lastReservationVersionSentToTomaByTargetVersion)[0], 3);
									assert.ok(volume.reservation.attachedClients.includes(CLIENT_1));
									assert.strictEqual(volume.reservation.mode, consts.reservationModes.SHARED_READ_WRITE);
									resolve();
								});
						});
					});
				});
			})
			// Detach 2 Volumes
				.then(() => {
					return new Promise((resolve) => {
						clientModule.detachVolumes(CLIENT_1, clientObj.uuid, volumesToDetach, (logs) => {
							resolve(logs);
						});
					});
				}).then(logs => {
					logs.forEach(l => {
						if (l.getAdditionalInfoByKey(Entities.Volume.ID) == VOL_1.name)
							// volume that was attached but failed because of another volume error
							assert(l.systemMessage.id === systemMessages.VOLUME_STATE_DETACHING.id);
						else
							// volume that was not found
							assertIsCausedBy(l, systemMessages.VOLUME_NOT_ATTACHED);
					});
				});
		});

		it('Fail to attach volumes - Client not found', () => {
			let volumesToAttach = [{
				name: VOL_1.name,
				uuid: VOL_1.uuid,
				reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE	}
			}, {
				name: VOL_2.name,
				uuid: VOL_2.uuid,
				reservation: { mode: consts.reservationModeNames.SHARED_READ_ONLY }
			}, {
				name: VOL_3.name,
				uuid: VOL_3.uuid,
				reservation: { mode: consts.reservationModeNames.EXCLUSIVE_READ_WRITE }
			}];
			return new Promise((resolve) => {
				clientModule.attachVolumes('Client-not-found', clientObj.uuid, volumesToAttach, (logs) => {
					resolve(logs);
				});
			}).then(messages => {
				messages.forEach(message => {
					assertIsCausedBy(message, systemMessages.ATTACH_CLIENT_UPDATE_FAILED);
				});
			});
		});

		it('Fail to detach volumes - Client not found', () => {
			let volumesToAttach = [{
				name: VOL_1.name,
				uuid: VOL_1.uuid,
				reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE	}
			}, {
				name: VOL_2.name,
				uuid: VOL_2.uuid,
				reservation: { mode: consts.reservationModeNames.SHARED_READ_ONLY }
			}, {
				name: VOL_3.name,
				uuid: VOL_3.uuid,
				reservation: { mode: consts.reservationModeNames.EXCLUSIVE_READ_WRITE }
			}];
			return new Promise((resolve) => {
				clientModule.detachVolumes('Client-not-found', clientObj.uuid, volumesToAttach, (logs) => {
					resolve(logs);
				});
			}).then(logs => {
				logs.forEach(l => {
					assertIsCausedBy(l, systemMessages.CLIENT_NOT_FOUND);
				});
			});
		});

		it('Mark for Deletion should fail if volume attached', (done) => {
			let volumesToAttach = [
				{
					name: VOL_1.name,
					uuid: VOL_1.uuid,
					reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE	},
				}
			];

			clientModule.attachVolumes(CLIENT_1, clientObj.uuid, volumesToAttach, (logs) => {
				assert.strictEqual(logs[0].systemMessage.id, systemMessages.VOLUME_STATE_ATTACHING.id);

				app.get('db').collection('volume').findOne({ _id: VOL_1.name }, (err, volume) => {
					assert(!err);
					markVolumesForDeletion([volume], (logs) => {
						let result = logs[0].createApiResponse();
						let resultString = JSON.stringify(result);
						assert(result, `Expected result object but got ${resultString}`);
						assert(!result.success, `Expected deletion to fail but got ${resultString}`);
						done();
					});
				});
			});
		});

		it.skip('Mark for Deletion should succeed if volume detached', (done) => {
			let volumesToAttach = [
				{
					name: VOL_1.name,
					uuid: VOL_1.uuid,
					reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE	},
				}
			];

			clientModule.attachVolumes(CLIENT_1, clientObj.uuid, volumesToAttach, (logs) => {
				assert.strictEqual(logs[0].systemMessage.id, systemMessages.VOLUME_STATE_ATTACHING.id);

				clientModule.detachVolumes(CLIENT_1, clientObj.uuid, volumesToAttach, (logs) => {
					assert(logs[0].systemMessage.id === systemMessages.VOLUME_STATE_DETACHING.id);

					app.get('db').collection('volume').findOne({ _id: VOL_1.name }, (err, volume) => {
						assert(!err);
						markVolumesForDeletion([volume], (log) => {
							let result = log.createApiResponse();
							let resultString = JSON.stringify(result);
							assert(result[0], `Expected result object but got ${resultString}`);
							assert(result[0].success, `Expected deletion to succeed but got ${resultString}`);
							done();
						});
					});
				});
			});
		});
	});

	describe('#Hidden Attach Req from client', () => {
		let volumes = [new VolumeRAID1(VOL_1.name), new VolumeRAID1(VOL_2.name), new VolumeRAID1(VOL_3.name)];
		let clientObjs = [];

		beforeEach(async() => {
			await setup.newSetup();
			await generateAndSaveTargets(3, 2, ZONE_1);
			await Promise.all(volumes.map(v => v.save()));
			clientObjs = CLIENTS.map(c => new Client(c));
			await Promise.all(clientObjs.map(c => c.save()));

			for (const vol of volumes) {
				const dbVolume = await getVolumeUUIDByID(vol.name);
				vol.uuid = dbVolume.uuid;
			}

			log.debug('finished setup');
		});


		it('Client reports attachmentStatus for recovery attachments', async() => {
			// Send Detach update from client
			let recoveryUUID = uuid.v1();
			// recovery name format is vol1[01.0]796e3992
			let recoveryName = VOL_1.name + '[01.0]' + recoveryUUID.substring(0, 8);
			let recovery = new BlockDevice(recoveryName)
				.setHiddenAttach()
				.setUUID(recoveryUUID)
				.setAction(consts.volumeAttachmentActions.ATTACHING)
				.setStatus(consts.volumeAttachmentStatus.ATTACHED);

			let updateAttachmentMsg = ClientUpdateAttachmentStatusBuilder.fromClient(clientObjs[0])
				.setReportID(2)
				.addAttachment(recovery)
				.setAttachmentsVersion(2)
				.build();

			await new Promise(resolve => {
				clientModule.handleUpdateAttachment(updateAttachmentMsg,
					(err) => {
						assert(!err);
						resolve();
					});
			});

			let dbClient = await clientCollection.findOne({ _id: CLIENT_1 });
			assert.strictEqual(0, Object.keys(dbClient.attachments).length);
			assert.strictEqual(1, dbClient.block_devices.length);
			let dbBlockDevice = Object.values(dbClient.block_devices)[0];
			assert.strictEqual(dbBlockDevice.uuid, recoveryUUID);
			assert.strictEqual(dbBlockDevice.name, recoveryName);
			assert.strictEqual(dbBlockDevice.vol_status, consts.volumeAttachmentStatus.ATTACHED);
		});
	});
});


