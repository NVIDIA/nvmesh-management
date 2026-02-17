/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app,log,describe,before,after,it */
const uuid = require('uuid');
const dbManager = require('./testUtils/dbManager.js');
const consts = require('../consts.js');
const { setup } = require('./testUtils/setup.js');
const assert = require('assert');
const { Client, BlockDevice } = require('./models/client.js');
const { LastMessageLog } = require('./models/lastMessageLog.js');
const moment = require('moment');
const { handleTimedOutComponent } = require('../modules/lastMessageLog.js');
const { sendMessageToManagement } = require('./kafkaMessages/sendMessage.js');
const { ClientKeepAliveBuilder, ClientUpdateAttachmentStatusBuilder,
	ClientGetTargetNICsBuilder } = require('./kafkaMessages/fromClient/clientMessageBuilders.js');
const { originTypes } = require('../consts.js');
const { VolumeConcatenated } = require('./models/volume.js');
const { generateTarget, generateTargetNIC } = require('./testUtils/entityGenerators.js');
const { promiseAttachVolume, sendClientKeepaliveAndValidateTokenReceived, sendAgentKeepaliveAndValidateTokenReceived,
	getSingleAttachmentStatusMsg, promiseHandleUpdateAttachment } = require('./testUtils/clientUtils.js');
const { reportAllSegmentsOnline } = require('./testUtils/volumeUtils.js');
const clientModule = require('../modules/client.js');
const targetModule = require('../modules/target.js');
const { AgentKeepAliveBuilder } = require('./kafkaMessages/fromAgent/agentKeepAlive.js');
const { delay } = require('./testUtils/common.js');
const { resetDebouncerCache } = require('../utils.js');
const { Entities } = require('../modules/error.js');

var clientCollection;
var targetCollection;
var volumeCollection;

describe('Client', function() {
	before(() => {
		return dbManager.connect().then(() => {
			clientCollection = app.get('db').collection('client');
			targetCollection = app.get('db').collection('server');
			volumeCollection = app.get('db').collection('volume');
		});
	});

	after(async() => {
		await delay(2000); // this is mandatory as we have async flows still running and we dont want to close the connection until they are done
		await dbManager.closeConnection();
	});

	describe('Keep Alive', function() {
		let client = new Client('Client1');

		async function waitForClientToBeHealthy() {
			let shouldContinue = true;
			let retries = 20;
			let dbClient;

			while (shouldContinue && retries--) {
				await new Promise(r => setTimeout(r, 100));
				dbClient = await clientCollection.findOne({ _id: client.id });
				shouldContinue = dbClient.health !== consts.targetHealth.HEALTHY;
			}

			assert(retries);
			assert(dbClient);
			assert.strictEqual(client.clientToken, dbClient.clientToken);
			assert.strictEqual(consts.targetHealth.HEALTHY, dbClient.health);
			assert.strictEqual(client.messageSequence, dbClient.kafkaMessageSequence.keepalive);
		}

		before(() => setup.newSetup().then(() => log.debug('finished setup')));

		it('should create client when agent keep-alive with token -1 when client doesn\'t exists', () => {
			return sendAgentKeepaliveAndValidateTokenReceived(client, clientCollection);
		});

		it('should update agent status', () => {
			const keepAliveMsg = AgentKeepAliveBuilder.fromClient(client).build();

			return sendMessageToManagement(keepAliveMsg)
				.then(() => clientCollection.findOne({ _id: client.id }))
				.then(dbClient => {
					assert(dbClient);
					assert.strictEqual(client.mgmtAgentToken, dbClient.managementAgentToken);
					assert.strictEqual(consts.managementAgentStatuses.UP, dbClient.managementAgentStatus);
					assert.strictEqual(client.agentMessageSequence, dbClient.agentKafkaMessageSequence.keepalive);
				});
		});

		it('client keep-alive with token -1 when client exists should trigger updateClientToken', () => {
			return sendClientKeepaliveAndValidateTokenReceived(client, clientCollection);
		});

		it('client keep-alive should make client healthy', () => {
			const keepAliveMsg = ClientKeepAliveBuilder.fromClient(client).build();

			return sendMessageToManagement(keepAliveMsg)
				.then(waitForClientToBeHealthy);
		});

		it('client should have a lastMessageLog', () => {
			const docID = { id: client.id, type: consts.originTypes.CLIENT };

			return app.get('db').collection('lastMessageLog').findOne({ _id: docID })
				.then((dbLastMsg) => assert.strictEqual(dbLastMsg.status, consts.lastMessageLogStatuses.LIVE));
		});

		it('client timed-out should make client status down and increase token', () => {
			return new Promise(resolve => {
				// simulate a timed out component
				const tenMinsAgo = moment().subtract(10, 'minutes');
				const lastMessageLogDoc = new LastMessageLog(client.id, originTypes.CLIENT, consts.kafkaMessageTypes.ClientToManagement.keepalive,
					client.messageSequence, client.clientToken, tenMinsAgo);

				handleTimedOutComponent(lastMessageLogDoc, () => {
					resolve();
				});
			})
				// Make sure client is unavailable and token increased
				.then(() => clientCollection.findOne({ _id: client.id }))
				.then(dbClient => {
					assert(dbClient);
					assert.strictEqual(consts.clientStatus.DOWN, dbClient.client_status);
					assert.strictEqual(client.clientToken + 1, dbClient.clientToken);
					assert.strictEqual(0, dbClient.kafkaMessageSequence.keepalive);
					assert.strictEqual(0, dbClient.kafkaMessageSequence.reportClient);
				});
		});

		it('keep-alive after timeout', () => {
			return sendClientKeepaliveAndValidateTokenReceived(client, clientCollection, 2);
		});

		it('keep-alive with token -1 after timeout', () => {
			client.setClientToken(-1);
			return sendClientKeepaliveAndValidateTokenReceived(client, clientCollection, 2);
		});

		it('keep-alive with correct token after timeout', () => {
			const keepAliveMsg = ClientKeepAliveBuilder.fromClient(client).build();

			return sendMessageToManagement(keepAliveMsg)
				.then(waitForClientToBeHealthy);
		});

		it('client timed-out again', () => {
			return new Promise(resolve => {
				// simulate a timed out component
				const tenMinsAgo = moment().subtract(10, 'minutes');
				const lastMessageLogDoc = new LastMessageLog(client.id, originTypes.CLIENT, consts.kafkaMessageTypes.ClientToManagement.keepalive,
					client.messageSequence, client.clientToken, tenMinsAgo);

				handleTimedOutComponent(lastMessageLogDoc, () => {
					resolve();
				});
			})
				// Make sure client is unavailable and token increased
				.then(() => clientCollection.findOne({ _id: client.id }))
				.then(dbClient => {
					assert(dbClient);
					assert.strictEqual(consts.clientStatus.DOWN, dbClient.client_status);
					assert.strictEqual(client.clientToken + 1, dbClient.clientToken);
					assert.strictEqual(0, dbClient.kafkaMessageSequence.keepalive);
					assert.strictEqual(0, dbClient.kafkaMessageSequence.reportClient);
					client.uuid = dbClient.uuid;
				});
		});

		it('should delete client', done => {
			client.timedOutClient()
				.then(() => {
					clientModule.deleteClients([{ _id: client.id, uuid: client.uuid }], messages => {
						const results = messages.map(l => l.createApiResponse(Entities.Client.ID));
						assert(results);
						assert(results.length);
						assert(results[0].success, JSON.stringify(results[0].error));

						clientCollection.findOne({ _id: client.id }, (err, res) => {
							assert(!err);
							assert(!res);

							done();
						});
					});
				});
		});


		it('client keep-alive after deletion should not create client (before any agent keepalive)', () => {
			const keepAliveMsg = ClientKeepAliveBuilder.fromClient(client).build();

			return client.timedOutClient()
				.then(() => sendMessageToManagement(keepAliveMsg))
				.then(() => clientCollection.findOne({ _id: client.id }))
				.then(dbClient => assert(!dbClient));
		});

		it('should create client when agent keep-alive with token > -1 when client doesn\'t exists', () => {
			return sendAgentKeepaliveAndValidateTokenReceived(client, clientCollection)
				.then(() => {
					const keepAliveMsg = AgentKeepAliveBuilder.fromClient(client).build();

					return sendMessageToManagement(keepAliveMsg);
				})
				.then(() => clientCollection.findOne({ _id: client.id }))
				.then(dbClient => {
					assert(dbClient);
					assert.strictEqual(client.mgmtAgentToken, dbClient.managementAgentToken);
					assert.strictEqual(consts.managementAgentStatuses.UP, dbClient.managementAgentStatus);
					assert.strictEqual(client.agentMessageSequence, dbClient.agentKafkaMessageSequence.keepalive);
				});
		});

		it('should make reapearing client healthy with correct token after sending client keepalive', () => {
			return sendClientKeepaliveAndValidateTokenReceived(client, clientCollection, client.clientToken + 1)
				.then(() => {
					const keepAliveMsg = ClientKeepAliveBuilder.fromClient(client).build();

					return sendMessageToManagement(keepAliveMsg);
				})
				.then(waitForClientToBeHealthy);
		});

		it('attachmnetsVersion missmatch', async() => {
			let dbAV = 10;
			let reportedAV = 8;

			await clientCollection.updateOne({ _id: client.id }, { $set: { attachmentsVersion: dbAV } });

			//first missmatch should set attachmentsVersionMissmatchTime
			let keepAliveMsg = ClientKeepAliveBuilder.fromClient(client)
				.setAttachmentsVersion(reportedAV)
				.setHasWIPOperations(false)
				.setAttachmentsUUIDHash('cause-missmatch')
				.build();

			await sendMessageToManagement(keepAliveMsg);

			let dbClient = await clientCollection.findOne({ _id: client.id });
			// make sure attachmentsVersionMissmatchTime is set
			assert(dbClient.attachmentsVersionMissmatchTime);
			let initialAVMissmatchTime = dbClient.attachmentsVersionMissmatchTime;

			// should not trigger if not enough time passed
			keepAliveMsg = ClientKeepAliveBuilder.fromClient(client)
				.setAttachmentsVersion(reportedAV)
				.setHasWIPOperations(false)
				.setAttachmentsUUIDHash('cause-missmatch')
				.build();

			await sendMessageToManagement(keepAliveMsg);
			dbClient = await clientCollection.findOne({ _id: client.id });
			assert(!dbClient.attachmentsVersionMissmatchTrigger);

			// should trigger if enough time passed
			await clientCollection.updateOne({ _id: client.id }, { $set: { attachmentsVersionMissmatchTime: moment().subtract(2, 'minutes').toDate() } });

			keepAliveMsg = ClientKeepAliveBuilder.fromClient(client)
				.setAttachmentsVersion(reportedAV)
				.setHasWIPOperations(false)
				.setAttachmentsUUIDHash('cause-missmatch')
				.build();

			await sendMessageToManagement(keepAliveMsg);
			await delay(1);
			dbClient = await clientCollection.findOne({ _id: client.id });
			assert(dbClient.attachmentsVersionMissmatchTrigger);
			assert(dbClient.attachmentsVersionMissmatchTime > initialAVMissmatchTime);

			// should trigger again if enough time passed & AV != last TriggeredAV
			await clientCollection.updateOne({ _id: client.id }, { $set: { attachmentsVersionMissmatchTime: moment().subtract(2, 'minutes').toDate() } });

			keepAliveMsg = ClientKeepAliveBuilder.fromClient(client)
				.setAttachmentsVersion(reportedAV + 1)
				.setHasWIPOperations(false)
				.setAttachmentsUUIDHash('cause-missmatch')
				.build();

			await sendMessageToManagement(keepAliveMsg);
			await delay(1);
			dbClient = await clientCollection.findOne({ _id: client.id });
			assert(dbClient.attachmentsVersionMissmatchTrigger);

			// AV synced should remove attachmentsVersionMissmatchTime
			keepAliveMsg = ClientKeepAliveBuilder.fromClient(client)
				.setAttachmentsVersion(dbAV)
				.setHasWIPOperations(false)
				.setAttachmentsUUIDHash('cause-missmatch')
				.build();

			await sendMessageToManagement(keepAliveMsg);
			await delay(1);
			dbClient = await clientCollection.findOne({ _id: client.id });
			assert(!dbClient.attachmentsVersionMissmatchTime);
		});
	});

	describe('Upgrade', function() {
		let client = new Client('Client1');
		let v1 = new VolumeConcatenated('v1');
		let target = generateTarget('server1.acme.com');

		before(async() => {
			await setup.newSetup();
			await target.save();
			await client.save();
			await v1.createOrReject();
			log.debug('finished setup');
		});

		it('Attach Volume', async() => {
			let attachRequest = {
				name: v1._id,
				uuid: v1.uuid,
				reservation: { mode: consts.reservationModeNames.EXCLUSIVE_READ_WRITE }
			};

			await promiseAttachVolume(client.id, client.uuid, attachRequest);

			let dbClient = await clientCollection.findOne({ _id: client.id });
			assert.strictEqual(Object.keys(dbClient.attachments).length, 1);
			assert.strictEqual(dbClient.attachments[v1.uuid].reservation.version, 2);

			let msg = await client.readMessageFromClientTopic();
			assert(msg && msg.type == consts.kafkaMessageTypes.ManagementToClient.attachVolumes, 'expected client confiugration');
			assert.strictEqual(msg.payload.attachmentsVersion, 1);
		});

		it('Upgrade - keepalive with new version', async() => {
			resetDebouncerCache();
			let oldVersion = client.version;
			let newVersion = '3.2.0-1';

			// simulate upgrade script
			await clientCollection.updateMany({}, {
				$set: {
					attachmentsVersion: 0,
					block_devices: []
				}
			});

			// simulate Client upgraded from older version
			client.clientToken = -1;
			client.mgmtAgentToken = -1;
			client.attachmentsVersion = 0;
			client.version = newVersion;
			client.commit = 'upgraded-commit';
			client.branch = 'upgraded-branch';
			client.block_devices = [];

			let expectedToken = 1;
			await sendAgentKeepaliveAndValidateTokenReceived(client, clientCollection);
			await client.sendAgentKeepAlive();
			await sendClientKeepaliveAndValidateTokenReceived(client, clientCollection, expectedToken);

			const keepAliveMsg = ClientKeepAliveBuilder.fromClient(client).build();
			await sendMessageToManagement(keepAliveMsg)
				.then(() => clientCollection.findOne({ _id: client.id }))
				.then(assert);

			// Verify version updated in DB
			let dbClient = await clientCollection.findOne({ _id: client.id });

			assert.strictEqual(dbClient.version, newVersion, `Client version not updated from ${oldVersion}, expected: ${newVersion}`);
			assert.strictEqual(dbClient.branch, client.branch, 'Client branch not updated');
			assert.strictEqual(dbClient.commit, client.commit, 'Client commit not updated');

			// Client should get AttachVolumes message
			let msg = await client.readMessageFromClientTopic();
			assert(msg && msg.type == consts.kafkaMessageTypes.ManagementToClient.attachVolumes, 'expected client confiugration');
			assert.strictEqual(msg.payload.attachmentsVersion, 1);
		});
	});

	describe('Create new client', function() {
		let client = new Client('Client1');

		before(() => {
			return setup.newSetup()
				.then(() => log.debug('finished setup'));
		});

		it('should create client', () => {
			return client.save()
				.then(res => {
					console.log(`finished res=${res}`);
				});
		});
	});

	describe('Send Attach Volumes', function() {
		let client = new Client('Client1');
		let v1 = new VolumeConcatenated('v1');
		let target = generateTarget('server1.acme.com');

		before(async() => {
			await setup.newSetup();
			await target.save();
			await client.save();
			await v1.createOrReject();
			log.debug('finished setup');
		});

		it('Attach Volume', async() => {
			let attachRequest = {
				name: v1._id,
				uuid: v1.uuid,
				reservation: { mode: consts.reservationModeNames.EXCLUSIVE_READ_WRITE }
			};

			await promiseAttachVolume(client.id, client.uuid, attachRequest);

			let dbClient = await clientCollection.findOne({ _id: client.id });
			assert.strictEqual(Object.keys(dbClient.attachments).length, 1);
			assert.strictEqual(dbClient.attachments[v1.uuid].reservation.version, 2);

			let msg = await client.readMessageFromClientTopic();
			assert(msg && msg.type == consts.kafkaMessageTypes.ManagementToClient.attachVolumes, 'expected client confiugration');
			assert.strictEqual(msg.payload.attachmentsVersion, 1);
		});

		it('Update Volume', async() => {
			// Get volume to Online state - pre-requisiste for extend
			let dbVolume = await volumeCollection.findOne({ _id: v1._id });
			await reportAllSegmentsOnline(dbVolume, target);

			v1.capacity = v1.capacity * 2;
			let extendRes = await v1.extend();
			assert(extendRes.success);

			let msg = await client.readMessageFromClientTopic();
			assert(msg && msg.type == consts.kafkaMessageTypes.ManagementToClient.updateVolumes, 'expected UpdateVolumes message but got: ' + msg.type);
		});

		it('Re-Attach Volume', async() => {
			let attachRequest = {
				name: v1._id,
				uuid: v1.uuid,
				reservation: {
					mode: consts.reservationModeNames.SHARED_READ_ONLY,
					version: 2,
					preempt: consts.reservationModePreempts.PREEMPT
				}
			};

			await promiseAttachVolume(client.id, client.uuid, attachRequest);

			let dbClient = await clientCollection.findOne({ _id: client.id });
			assert.strictEqual(Object.keys(dbClient.attachments).length, 1);
			assert.strictEqual(dbClient.attachments[v1.uuid].reservation.version, 3);

			let msg = await client.readMessageFromClientTopic();
			assert(msg && msg.type == consts.kafkaMessageTypes.ManagementToClient.attachVolumes, 'expected client confiugration');
			assert.strictEqual(msg.payload.attachmentsVersion, 2);

			// client reports VOLUME_RESERVATION_DENIED
			let updateAttachmentMsg = getSingleAttachmentStatusMsg(client, v1, consts.volumeAttachmentStatus.VOLUME_RESERVATION_DENIED);
			await promiseHandleUpdateAttachment(updateAttachmentMsg);

			// Wait for detach message
			msg = await client.readMessageFromClientTopic();
			assert(msg && msg.type == consts.kafkaMessageTypes.ManagementToClient.detachVolumes, 'expected DetachVolumes message but got: ' + msg.type);

			// report detached
			updateAttachmentMsg = getSingleAttachmentStatusMsg(client, v1, consts.volumeAttachmentStatus.DETACHED);
			await promiseHandleUpdateAttachment(updateAttachmentMsg);


			// wait for attach message
			msg = await client.readMessageFromClientTopic();
			assert(msg && msg.type == consts.kafkaMessageTypes.ManagementToClient.attachVolumes, 'expected AttchVolumes message but got: ' + msg.type);

			// report attached
			updateAttachmentMsg = getSingleAttachmentStatusMsg(client, v1, consts.volumeAttachmentStatus.ATTACHED);
			await promiseHandleUpdateAttachment(updateAttachmentMsg);

		});
	});

	describe('New Protocol', function() {
		/**
		 * Testing new client protocol (2024)
		 * 1. test out of sync attachment hash (attachmentsUUIDHash) from keepalive
		 * 2. test out of sync sumOfVolumeVersions
		 */

		let client = new Client('Client1');
		let client2 = new Client('Client2');
		let v1 = new VolumeConcatenated('v1');
		let v2 = new VolumeConcatenated('v2');
		let v3 = new VolumeConcatenated('v3');
		let target1 = generateTarget('server1.acme.com');
		let target2 = generateTarget('server2.acme.com');

		before(async() => {
			await setup.newSetup();
			await target1.save();
			await client.save();
			await client2.save();
			await v1.createOrReject();
			await v2.createOrReject();
			await v3.createOrReject();

			let volumes = [v1, v2];
			await attachVolumes(volumes);
			log.debug('finished setup');
		});

		after(async() => {
			await (await client.getClientQueue())
				.readMessageOrWait(20)
				.catch(() => {
					// ignore
					// we may have an async flow that will try to connect to mongo
					// just after we close the connection which will throw an error
					// so we wait a short while to see if there's a message  for the client, if not we ignore the timeout error
				});
		});

		async function attachVolumes(volumes) {
			let attachRequests1 = volumes.map(vol => {
				return {
					name: vol._id,
					uuid: vol.uuid,
					reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE }
				};
			});

			let attachRequests2 = volumes.map(vol => {
				return {
					name: vol._id,
					uuid: vol.uuid,
					reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE }
				};
			});

			await promiseAttachVolume(client.id, client.uuid, attachRequests1);

			let msg = await client.readMessageFromClientTopic();
			assert(msg && msg.type == consts.kafkaMessageTypes.ManagementToClient.attachVolumes, 'expected client confiugration');
			assert.strictEqual(msg.payload.attachmentsVersion, 1);

			// add volumes as block devices to client instance
			msg.payload.volumes.forEach(v => {
				client.addBlockDevice(v.configuration, msg.payload.attachmentsVersion);
			});

			//attach to client2
			await promiseAttachVolume(client2.id, client2.uuid, attachRequests2);

			let msg2 = await client2.readMessageFromClientTopic();
			assert(msg2 && msg2.type == consts.kafkaMessageTypes.ManagementToClient.attachVolumes, 'expected client confiugration');
			assert.strictEqual(msg2.payload.attachmentsVersion, 1);

		}

		it('attachmentsUUIDHash mismatch', async() => {
			resetDebouncerCache();
			let av = client.attachments[v2.uuid].attachmentsVersion;

			// report v2 is attached
			let v2status = new BlockDevice(v2._id)
				.setUUID(v2.uuid)
				.setAttachmentsVersion(av)
				.setAction(consts.volumeAttachmentActions.ATTACHING)
				.setStatus(consts.volumeAttachmentStatus.ATTACHED);

			//report one block device that is not expected to be attached
			let v3status = new BlockDevice(v3._id)
				.setUUID(v3.uuid)
				.setAttachmentsVersion(av)
				.setAction(consts.volumeAttachmentActions.ATTACHING)
				.setStatus(consts.volumeAttachmentStatus.ATTACHED);

			let updateAttachmentMsg = ClientUpdateAttachmentStatusBuilder.fromClient(client)
				.addAttachment(v2status)
				.addAttachment(v3status)
				.build();

			await promiseHandleUpdateAttachment(updateAttachmentMsg);

			// Check db to see reportID set correctly
			let dbClient = await clientCollection.findOne({ _id: client.id });
			assert.strictEqual(dbClient.maxReportID, client.reportID);

			// send keepalive with out-of-sync attachmentsVersion
			let v2attachment = {
				uuid: v2.uuid,
				action: consts.volumeAttachmentActions.ATTACHING,
				attachmentsVersion: av
			};

			client.setAttachmentsVersion(av);
			let keepAliveMsg = ClientKeepAliveBuilder.fromClient(client)
				.setAttachmentsUUIDHash(clientModule.calcAttachmentsUUIDHash({ attachments: [v2attachment] }, false)) //report hash of only v1
				.build();
			await sendMessageToManagement(keepAliveMsg);


			// handle AttachVolumes
			let msg = await client.readMessageFromClientTopic();
			assert(msg && msg.type == consts.kafkaMessageTypes.ManagementToClient.attachVolumes, 'expected AttachVolumes message but got: ' + msg.type);

			// make sure we got AttachVolume only for v1 (because v2 is reported as attached, therefore for v2 wishful state == current state)
			assert(msg.payload.attachmentsVersion);

			assert.strictEqual(msg.payload.volumes.length, 1);
			assert.strictEqual(msg.payload.volumes[0].uuid, v1.uuid);
			assert.strictEqual(msg.payload.volumes[0]._id, v1._id);


			// handle DetachVolumes
			msg = await client.readMessageFromClientTopic();
			assert(msg && msg.type == consts.kafkaMessageTypes.ManagementToClient.detachVolumes, 'expected DetachVolumes message but got: ' + msg.type);

			// make sure we got DetachVolume for v3 (because v3 is reported as attached but shouldn't be according to wishful state)
			assert(msg.attachmentsVersion);

			assert.strictEqual(msg.volumes.length, 1);
			assert.strictEqual(msg.volumes[0].name, v3.name);

			//report v3 no longer attached
			v3status = new BlockDevice(v3._id)
				.setUUID(v3.uuid)
				.setAttachmentsVersion(msg.attachmentsVersion)
				.setAction(consts.volumeAttachmentActions.DETACHING)
				.setStatus(consts.volumeAttachmentStatus.DETACHED);

			client.reportID++;
			updateAttachmentMsg = ClientUpdateAttachmentStatusBuilder.fromClient(client)
				.addAttachment(v3status)
				.build();

			await promiseHandleUpdateAttachment(updateAttachmentMsg);

			// mak sure client topic empty
			let q = await client.getClientQueue();
			assert.strictEqual(q.q.length, 0);
		});

		it('volumeVersionsSum mismatch', async() => {
			// send keepalive with out-of-sync attachmentsVersion
			let dbClient = await clientCollection.findOne({ _id: client.id });
			client.attachmentsVersion = dbClient.attachmentsVersion;

			let keepAliveMsg = ClientKeepAliveBuilder.fromClient(client)
				// just a random number that does not equal hex(md5(v1.uuid:v1.version,v2.uuid:v2.version)
				.setVolumeVersionsSum('not-correct-versionSum')
				.build();
			await sendMessageToManagement(keepAliveMsg);

			let msg = await client.readMessageFromClientTopic();
			assert(msg && msg.type == consts.kafkaMessageTypes.ManagementToClient.updateVolumes, 'expected UpdatehVolumes message but got: ' + msg.type);

			// make sure we got UpdateVolumes for all (2) volumes
			assert(msg.payload.attachmentsVersion);
			assert.strictEqual(msg.payload.volumes.length, 2);
		});

		it('VolumeUpdate due to volumeVersionChanged caused by extend', async() => {
			// empty client2 msg queue
			await (await client2.getClientQueue()).clear();

			let volume = v1;
			let dbVolume = await volumeCollection.findOne({ _id: volume.name });

			// report volume online
			await reportAllSegmentsOnline(dbVolume, 'test-server-0');

			// extend volume x2 the size
			volume.capacity *= 2;
			let res = await volume.extend();
			assert(res.success, res.error?.message);

			let msg = await client.readMessageFromClientTopic();
			let msg2 = await client2.readMessageFromClientTopic();


			assert(msg && msg.type == consts.kafkaMessageTypes.ManagementToClient.updateVolumes,
				'expected UpdateVolumes message for v1 but got: ' + msg.type);
			assert(msg2 && msg2.type == consts.kafkaMessageTypes.ManagementToClient.updateVolumes,
				'expected UpdateVolumes message for v2 but got: ' + msg2.type);

			async function checkCorrectMessage(client, msg) {
				let dbClient = await clientCollection.findOne({ _id: client.id });
				assert.strictEqual(dbClient.attachmentsVersion, msg.payload.attachmentsVersion);
				assert.strictEqual(msg.payload.volumes.length, 1);
				assert.strictEqual(msg.payload.volumes[0].uuid, v1.uuid);
				assert.strictEqual(msg.payload.volumes[0].name, v1.name);
			}

			// make sure we got DetachVolumes for v3 since it was not in the desiredState
			await checkCorrectMessage(client, msg);
			await checkCorrectMessage(client2, msg2);
		});

		it('GetTargetNICs with nicsVersion -1 or lower than db', async() => {
			// send keepalive with out-of-sync attachmentsVersion
			let getNicsMsg = ClientGetTargetNICsBuilder.fromClient(client)
				.addTarget(target1._id, -1)
				.addTarget(target2._id, 1)
				.build();
			await sendMessageToManagement(getNicsMsg);

			// we should expect to get updateTargetNICs for both targets
			let msg = await client.readMessageFromClientTopic();
			assert(msg && msg.type == consts.kafkaMessageTypes.ManagementToClient.updateTargetNICs, 'expected updateTargetNICs message but got: ' + msg.type);

			// make sure we got NICs for one target
			assert.strictEqual(Object.keys(msg.payload.targets).length, 1);
		});

		it('GetTargetNICs with waitingForNICs and get update on newNIC', async() => {
			// send keepalive with out-of-sync attachmentsVersion
			let getNicsMsg = ClientGetTargetNICsBuilder.fromClient(client)
				.addTarget(target1._id, 1)
				.build();

			await sendMessageToManagement(getNicsMsg);
			let q = await client.getClientQueue();
			assert.strictEqual(q.q.length, 0);

			let nic = generateTargetNIC(target1.node_id, target1.uuid, 3);
			target1.addNIC(nic);
			target1.reportID++;
			target1.messageSequence++;
			await target1.sendReport();

			// we should expect to get updateTargetNICs with 2 nics
			let msg = await client.readMessageFromClientTopic();
			assert(msg && msg.type == consts.kafkaMessageTypes.ManagementToClient.updateTargetNICs, 'expected updateTargetNICs message but got: ' + msg.type);

			// make sure we got NICs for one target
			assert.strictEqual(Object.keys(msg.payload.targets).length, 1);
			let targetNicsUpdate = msg.payload.targets[0];

			// nicsVersion should increase to 2
			assert.strictEqual(targetNicsUpdate.nicsVersion, 2);

			let nics = targetNicsUpdate.nics;
			// make sure we have the new nic reported
			assert.strictEqual(nics.length, 2);
			let reportedNic = nics.find(n => n.nicID == nic.nicID);
			assert(reportedNic);

			// mak sure only one message sent
			assert.strictEqual(q.q.length, 0);
		});

		it('GetTargetNICs with waitingForNICs and get update on nic MISSING', async() => {
			// send keepalive with out-of-sync attachmentsVersion
			let getNicsMsg = ClientGetTargetNICsBuilder.fromClient(client)
				.addTarget(target1._id, 2)
				.build();

			await sendMessageToManagement(getNicsMsg);
			let q = await client.getClientQueue();
			assert.strictEqual(q.q.length, 0);

			target1.nics = [target1.nics[0]];
			target1.reportID++;
			target1.messageSequence++;
			await target1.sendReport();

			// we should expect to get updateTargetNICs with single nic
			let msg = await client.readMessageFromClientTopic();
			assert(msg && msg.type == consts.kafkaMessageTypes.ManagementToClient.updateTargetNICs, 'expected updateTargetNICs message but got: ' + msg.type);

			// make sure we got NICs for one target
			assert.strictEqual(Object.keys(msg.payload.targets).length, 1);

			let targetNicsUpdate = msg.payload.targets[0];

			// nicsVersion should increase to 3
			assert.strictEqual(targetNicsUpdate.nicsVersion, 3);

			let nics = targetNicsUpdate.nics;

			// still 2 nics are reported
			assert.strictEqual(nics.length, 2);

			let reportedNic = nics.find(n => n.nicID == target1.nics[0].nicID);
			assert(reportedNic);

			// mak sure only one message sent
			assert.strictEqual(q.q.length, 0);
		});

		it('GetTargetNICs with waitingForNICs and get update on nicRemoved', async() => {
			// send keepalive with out-of-sync attachmentsVersion
			let getNicsMsg = ClientGetTargetNICsBuilder.fromClient(client)
				.addTarget(target1._id, 3)
				.build();

			await sendMessageToManagement(getNicsMsg);
			let q = await client.getClientQueue();
			assert.strictEqual(q.q.length, 0);

			// Delete the missing nic
			let dbTarget = await targetCollection.findOne({ _id: target1._id }, { nics: 1 });
			let missingNic = dbTarget.nics.find(n => n.status == consts.nicStatus.MISSING);
			assert(missingNic);

			await new Promise(resolve => {
				targetModule.deleteNICByIDAndUUID(target1._id, missingNic.nodeUUID, missingNic.nicID, message => {
					const res = message.createApiResponse();
					assert(res.success, res.error);
					resolve();
				});
			});

			// we should expect to get updateTargetNICs with single nic
			let msg = await client.readMessageFromClientTopic();
			assert(msg && msg.type == consts.kafkaMessageTypes.ManagementToClient.updateTargetNICs, 'expected updateTargetNICs message but got: ' + msg.type);

			// make sure we got NICs for one target
			assert.strictEqual(Object.keys(msg.payload.targets).length, 1);

			let targetNicsUpdate = msg.payload.targets[0];

			// nicsVersion should increase to 3
			assert.strictEqual(targetNicsUpdate.nicsVersion, 4);

			let nics = targetNicsUpdate.nics;
			// make sure we have the new nic reported
			assert.strictEqual(nics.length, 1);
			let reportedNic = nics.find(n => n.nicID == target1.nics[0].nicID);
			assert(reportedNic);

			// mak sure only one message sent
			assert.strictEqual(q.q.length, 0);
		});

		it('Client reports attachmentStatus for recovery attachments', async() => {
			// Send Detach update from client
			let recoveryUUID = uuid.v1();
			// recovery name format is vol1[01.0]796e3992
			let recoveryName = v1.name + '[01.0]' + recoveryUUID.substring(0, 8);
			let recovery = new BlockDevice(recoveryName)
				.setHiddenAttach()
				.setUUID(recoveryUUID)
				.setAction(consts.volumeAttachmentActions.ATTACHING)
				.setStatus(consts.volumeAttachmentStatus.ATTACHED);

			client.reportID++;
			let updateAttachmentMsg = ClientUpdateAttachmentStatusBuilder.fromClient(client)
				.addAttachment(recovery)
				.setAttachmentsVersion(2)
				.build();

			await promiseHandleUpdateAttachment(updateAttachmentMsg);

			let dbClient = await clientCollection.findOne({ _id: client.id });
			assert.strictEqual(2, Object.keys(dbClient.attachments).length);
			assert.strictEqual(3, dbClient.block_devices.length);
			assert.strictEqual(2, dbClient.block_devices.filter(bd => bd.vol_status === consts.volumeAttachmentStatus.ATTACHED).length);
			let dbBlockDevice = Object.values(dbClient.block_devices).find(bd => bd.uuid == recoveryUUID);
			assert.strictEqual(dbBlockDevice.name, recoveryName);
			assert.strictEqual(dbBlockDevice.vol_status, consts.volumeAttachmentStatus.ATTACHED);
		});

		it('updateAttachmentStatus volume not in desired state and recovery attachment', async() => {
			resetDebouncerCache();

			// report v3 is attached
			let v3status = new BlockDevice(v3._id)
				.setUUID(v3.uuid)
				.setAttachmentsVersion(1)
				.setAction(consts.volumeAttachmentActions.ATTACHING)
				.setStatus(consts.volumeAttachmentStatus.ATTACHED);

			let updateAttachmentMsg = ClientUpdateAttachmentStatusBuilder.fromClient(client)
				.addAttachment(v3status)
				.build();

			await promiseHandleUpdateAttachment(updateAttachmentMsg);

			let dbClient = await clientCollection.findOne({ _id: client.id });

			// Check db to see reportID set correctly
			assert.strictEqual(dbClient.maxReportID, client.reportID);

			// make sure desired state has v1 and v2
			assert.strictEqual(Object.keys(dbClient.attachments).length, 2);
			assert.strictEqual(Object.keys(dbClient.attachments).sort().join(','), [v1.uuid, v2.uuid].sort().join(','));

			// make sure client reported attached to 3 volumes -> v2, v3 and recovery attachment
			assert.strictEqual(dbClient.block_devices.length, 3);

			// We expect to get AttachVolumes for v1 and DetachVolumes for v3, nothing for v2 and recovery attachment
			// send keepalive with out-of-sync attachmentsVersion
			let keepAliveMsg = ClientKeepAliveBuilder.fromClient(client)
				.setAttachmentsUUIDHash(clientModule.calcAttachmentsUUIDHash({ attachments: [v1, v2, v3] }, false)) //report hash of all 3 volumes
				.build();
			await sendMessageToManagement(keepAliveMsg);

			function handleMessage(msg) {
				assert(msg);
				switch (msg.type) {
					case consts.kafkaMessageTypes.ManagementToClient.attachVolumes:
						// we should expect to get attach message only for v1
						// (becuase none of them is attached as a block device in the management)
						assert.strictEqual(msg.payload.volumes.length, 1, JSON.stringify(msg.payload.volumes.map(v => v._id)));
						assert.strictEqual(msg.payload.volumes[0].uuid, v1.uuid);
						assert.strictEqual(msg.payload.volumes[0]._id, v1.name);
						break;
					case consts.kafkaMessageTypes.ManagementToClient.detachVolumes:
						// make sure we got DetachVolumes for v3 since it was not in the desiredState
						// we also shouldn't get DetachVolumes for a recovery attachment (hidden attach)
						assert.strictEqual(msg.volumes.length, 1, JSON.stringify(msg.volumes.map(v => v.name)));
						assert.strictEqual(msg.volumes[0].uuid, v3.uuid);
						assert.strictEqual(msg.volumes[0].name, v3.name);
						break;
					default:
						assert(false, `unexpected message type ${msg.type}`);
				}
			}

			// expect 2 messages AttachVolumes & UpdateVolumes
			let msg = await client.readMessageFromClientTopic();
			handleMessage(msg);

			msg = await client.readMessageFromClientTopic();
			handleMessage(msg);
		});

		it('updateAttachmentStatus out-of-order for same attachment', async() => {
			resetDebouncerCache();

			function buildUpdateAttachmentMessage(ioEnabled, reportID) {
				// report v3 is attached
				let v1ioDisabled = new BlockDevice(v1._id)
					.setUUID(v1.uuid)
					.setAttachmentsVersion(1)
					.setAction(consts.volumeAttachmentActions.ATTACHING)
					.setStatus(consts.volumeAttachmentStatus.ATTACHED)
					.setIOEnabled(ioEnabled);

				let msg = ClientUpdateAttachmentStatusBuilder.fromClient(client)
					.addAttachment(v1ioDisabled)
					// we set the lower reportID here
					.setReportID(reportID)
					.build();

				return msg;
			}

			// =================================================================
			// Stage 1 - Send first message with ioEnabled=true and reportID=120
			let msgReportID120 = buildUpdateAttachmentMessage(1, 120);
			assert.strictEqual(msgReportID120.payload.reportID, 120);

			await promiseHandleUpdateAttachment(msgReportID120);

			let dbClient = await clientCollection.findOne({ _id: client.id });

			// Check db to see reportID set correctly
			let bdev = dbClient.block_devices.find(bd => bd.uuid == v1.uuid);
			assert.strictEqual(bdev.reportID, 120);

			// ===================================================================
			// Stage 2 - Send second message with ioEnabled=false and reportID=100
			let msgReportID100 = buildUpdateAttachmentMessage(0, 100);
			assert.strictEqual(msgReportID100.payload.reportID, 100);

			await promiseHandleUpdateAttachment(msgReportID100);

			dbClient = await clientCollection.findOne({ _id: client.id });

			// Check db to see reportID set correctly
			bdev = dbClient.block_devices.find(bd => bd.uuid == v1.uuid);
			assert.strictEqual(bdev.ioEnabled, 1);
			assert.strictEqual(bdev.reportID, 120);
		});
	});
});
