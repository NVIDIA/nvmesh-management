/* global app,describe,before,it,after */

const assert = require('assert');

const dbManager = require('./testUtils/dbManager.js');
const { setup } = require('./testUtils/setup.js');
const {
	generateAndSaveTargetsPerZone,
	generateAndSaveClients,
	generateTargetsPerZones
} = require('./testUtils/entityGenerators');
const { VolumeConcatenated, VolumeRAID1 } = require('./models/volume');
const volumeEncryptionModule = require('../modules/volumeEncryption');
const consts = require('../consts');
const { sendMessageToManagement } = require('./kafkaMessages/sendMessage');
const { EncryptionResponse } = require('./kafkaMessages/fromTOMA/EncryptionResponse');
const {
	PRaidReport,
	UpdatePRaidReportBuilder
} = require('./kafkaMessages/fromTOMA/tomaMessageBuilders');
const volumeModule = require('../modules/volume');
const systemMessages = require('../systemMessages.js');
const { assertIsCausedBy } = require('./testUtils/errorUtils.js');

const allSegmentOnline = [
	consts.diskSegmentStatuses.NORMAL,
	consts.diskSegmentStatuses.NORMAL,
	consts.diskSegmentStatuses.NORMAL
];

let volumeCollection;

let index = 1;

function generateAndSaveVolumes(count, isEncrypted) {
	const volumes = new Array(count).fill(0).map(i => {
		const volume = new VolumeConcatenated(`vol-${i + index++}`);
		if (isEncrypted) {
			volume.isEncrypted = isEncrypted;
			volume.encryption = {
				headerSize: 16
			};
		}
		return volume;
	});
	return Promise.all(volumes.map(v => v.save()));
}

describe('Volume Encryption', () => {
	// eslint-disable-next-line no-unused-vars
	const handleEncryptionRequestsPromise = (encryptionObjs, command) => new Promise((resolve, reject) => {
		volumeEncryptionModule.handleEncryptionRequests(encryptionObjs, command, (logs) => resolve(logs.map(l => l.createApiResponse())));
	});

	before(async() => {
		await dbManager.connect();
		volumeCollection = app.get('db').collection('volume');
	});

	after(() => {
		return dbManager.closeConnection();
	});

	describe('Encryption Commands', () => {
		const volumes = [];
		let nonEncryptedVol;
		let encryptedVol;

		before(async() => {
			await setup.newSetup();
			await generateAndSaveTargetsPerZone(10, 1, 4, 2);
			await generateAndSaveClients(3);
			volumes.push(...await generateAndSaveVolumes(1, false));
			volumes.push(...await generateAndSaveVolumes(1, true));
			nonEncryptedVol = volumes[0];
			encryptedVol = volumes[1];

		});

		it('Should not init encryption a non encrypted volume', async() => {
			const command = {
				keySize: consts.XTS_KEY_SIZES.XTS_AES_256,
				passphrase: 'blablabla',
				slot: 1,
				uuid: nonEncryptedVol.uuid,
				_id: nonEncryptedVol._id
			};
			const responses = await handleEncryptionRequestsPromise([command], consts.volumeEncryptionCommands.INIT_ENCRYPTION);
			assert(responses.length === 1);
			assert(!responses[0].success);
			assertIsCausedBy(responses[0].error, systemMessages.VOLUME_MISSING_IS_ENCRYPTED);
		});

		it('Should init encryption an encrypted volume', async() => {
			await volumeCollection.updateOne({ _id: encryptedVol._id }, { $set: { action: consts.volumeActions.INIT_ENCRYPTION_REQUIRED } });

			const command = {
				keySize: consts.XTS_KEY_SIZES.XTS_AES_256,
				passphrase: 'blablabla',
				slot: 1,
				uuid: encryptedVol.uuid,
				_id: encryptedVol._id
			};
			const responses = await handleEncryptionRequestsPromise([command], consts.volumeEncryptionCommands.INIT_ENCRYPTION);
			assert(responses.length === 1);
			assert(responses[0].success, `expected to succeed but got ${JSON.stringify(responses[0].error)}`);
		});

		it('Should not init encryption a volume that is already initialized', async() => {
			const command = {
				keySize: consts.XTS_KEY_SIZES.XTS_AES_256,
				passphrase: 'blablabla',
				slot: 1,
				uuid: encryptedVol.uuid,
				_id: encryptedVol._id
			};
			const responses = await handleEncryptionRequestsPromise([command], consts.volumeEncryptionCommands.INIT_ENCRYPTION);
			assert(responses.length === 1);
			assert(!responses[0].success);
		});

		it('handle encryptionCommandResponse error with volumeName Not_found', async() => {
			const vol = encryptedVol;

			const command = {
				keySize: consts.XTS_KEY_SIZES.XTS_AES_256,
				passphrase: 'blablabla',
				slot: 1,
				uuid: vol.uuid,
				_id: vol._id
			};

			const responses = await handleEncryptionRequestsPromise([command], consts.volumeEncryptionCommands.INIT_ENCRYPTION);
			assert(responses.length === 1);
			assert(!responses[0].success);

			const msg = {
				originType: 'TOMA',
				messageType: 'encryptionCommandResponse',
				messageTypeVersion: 1,
				messageSequence: 7048,
				hostname: 'toma-1',
				payload: {
					 //TODO: this Not_found is something TOMA sends -
					 // but they should response with the volumeID we sent in the command
					'volumeName': 'Not_found',
					'volumeUUID': vol.uuid,
					'encryptionCommandIndex': 1,
					'result': 3,
					'retryable': 'false',
					'error': 'Volume doesn\'t exist'
				}
			};

			const err = await new Promise(resolve => volumeEncryptionModule.handleCommandResponse(msg, resolve));
			assert(!err);

			const dbVolume = await volumeCollection.findOne({ _id: vol._id });
			assert(!!dbVolume.encryption.command.response, 'should contain command response');
			assert(!!dbVolume.encryption.command.response.error, 'should contain command response error');
		});

		it('Should return error when ADD_PASSPHRASE requested for non encrypted volume', async() => {
			const vol = nonEncryptedVol;

			const command = {
				keySize: consts.XTS_KEY_SIZES.XTS_AES_256,
				passphrase: 'blablabla',
				slot: 1,
				uuid: vol.uuid,
				_id: vol._id
			};
			const responses = await handleEncryptionRequestsPromise([command], consts.volumeEncryptionCommands.ADD_PASSPHRASE);
			assert(responses.length === 1);
			assert(!responses[0].success);
			assertIsCausedBy(responses[0].error, systemMessages.VOLUME_MISSING_IS_ENCRYPTED);
		});

		it('Should return error when ADD_PASSPHRASE requested before encryption is initialized', async() => {
			const vol = encryptedVol;

			const command = {
				keySize: consts.XTS_KEY_SIZES.XTS_AES_256,
				passphrase: 'blablabla',
				slot: 1,
				uuid: vol.uuid,
				_id: vol._id
			};
			const responses = await handleEncryptionRequestsPromise([command], consts.volumeEncryptionCommands.ADD_PASSPHRASE);
			assert(responses.length === 1);
			assert(!responses[0].success);
			assertIsCausedBy(responses[0].error, systemMessages.VOLUME_ENCRYPTION_NOT_INITIALIZED);
		});

		it('Should return error when DELETE_PASSPHRASE requested for non encrypted volume', async() => {
			const vol = nonEncryptedVol;

			const command = {
				keySize: consts.XTS_KEY_SIZES.XTS_AES_256,
				passphrase: 'blablabla',
				slot: 1,
				uuid: vol.uuid,
				_id: vol._id
			};
			const responses = await handleEncryptionRequestsPromise([command], consts.volumeEncryptionCommands.DELETE_PASSPHRASE);
			assert(responses.length === 1);
			assert(!responses[0].success);
			assertIsCausedBy(responses[0].error, systemMessages.VOLUME_MISSING_IS_ENCRYPTED);
		});

		it('Should return error when DELETE_PASSPHRASE requested before encryption is initialized', async() => {
			const vol = encryptedVol;

			const command = {
				keySize: consts.XTS_KEY_SIZES.XTS_AES_256,
				passphrase: 'blablabla',
				slot: 1,
				uuid: vol.uuid,
				_id: vol._id
			};
			const responses = await handleEncryptionRequestsPromise([command], consts.volumeEncryptionCommands.DELETE_PASSPHRASE);
			assert(responses.length === 1);
			assert(!responses[0].success);
			assertIsCausedBy(responses[0].error, systemMessages.VOLUME_ENCRYPTION_NOT_INITIALIZED);
		});


		it('Should return error when ROTATE_PASSPHRASE requested for non encrypted volume', async() => {
			const vol = nonEncryptedVol;

			const command = {
				keySize: consts.XTS_KEY_SIZES.XTS_AES_256,
				passphrase: 'blablabla',
				slot: 1,
				uuid: vol.uuid,
				_id: vol._id
			};
			const responses = await handleEncryptionRequestsPromise([command], consts.volumeEncryptionCommands.ROTATE_PASSPHRASE);
			assert(responses.length === 1);
			assert(!responses[0].success);
			assertIsCausedBy(responses[0].error, systemMessages.VOLUME_MISSING_IS_ENCRYPTED);
		});

		it('Should return error when ROTATE_PASSPHRASE requested before encryption is initialized', async() => {
			const vol = encryptedVol;

			const command = {
				keySize: consts.XTS_KEY_SIZES.XTS_AES_256,
				passphrase: 'blablabla',
				slot: 1,
				uuid: vol.uuid,
				_id: vol._id
			};
			const responses = await handleEncryptionRequestsPromise([command], consts.volumeEncryptionCommands.ROTATE_PASSPHRASE);
			assert(responses.length === 1);
			assert(!responses[0].success);
			assertIsCausedBy(responses[0].error, systemMessages.VOLUME_ENCRYPTION_NOT_INITIALIZED);
		});
	});

	describe('ChooseTOMAForEncryption Load Balancing', () => {
		const volumes = [];
		const allocatationNodes = Array.from({ length: 4 }, (_, i) => `test-server-${i}-zone-1`);
		async function generateAndSaveRAIDEncryptedVolumes(count, limitByNodes) {
			const volumes = new Array(count).fill(0).map(i => {
				const volume = new VolumeRAID1(`vol-${i + index++}`);
				volume.limitByNodes = limitByNodes;
				volume.isEncrypted = true;
				volume.encryption = {
					headerSize: 16
				};
				return volume;
			});
			await Promise.all(volumes.map(v => v.save()));
			volumes.forEach(v => v.chunks = [{ zone: '1' }]);
			return volumes;
		}

		function promiseChooseTOMAForEncryption(vol) {
			return new Promise((resolve) => {
				volumeEncryptionModule.chooseTOMAForEncryption(vol, (err, target) => {
					resolve({ err, target });
				});
			});
		}

		before(async() => {
			await setup.newSetup();
			await generateAndSaveTargetsPerZone(4, 1, 4, 2);
			await generateAndSaveClients(3);
			volumes.push(...await generateAndSaveRAIDEncryptedVolumes(5, allocatationNodes));
		});

		it('Should choose first TOMA for encryption', async() => {
			const { err, target } = await promiseChooseTOMAForEncryption(volumes[0]);
			assert(!err);

			const db = app.get('db');
			const lockCollection = db.collection('lock');
			const lock = await lockCollection.findOne({ _id: '1' });
			assert(target._id === lock.targetsInZone[1]);
		});

		it('Should choose second TOMA for encryption', async() => {
			const { err, target } = await promiseChooseTOMAForEncryption(volumes[0]);
			assert(!err);

			const db = app.get('db');
			const lockCollection = db.collection('lock');
			const lock = await lockCollection.findOne({ _id: '1' });
			assert(target._id === lock.targetsInZone[2]);
		});

		it('Should not choose TOMA that is down', async() => {
			const vol = volumes[0];

			// set all but last TOMA to DOWN
			const serverCollection = app.get('db').collection('server');
			await serverCollection.updateMany({ _id: { $in: allocatationNodes.slice(0, -1) } }, { $set: { tomaStatus: consts.tomaStatuses.DOWN } });

			const { err, target } = await promiseChooseTOMAForEncryption(vol);
			assert(!err);
			assert(allocatationNodes.includes(target._id));
			assert(target._id === allocatationNodes[allocatationNodes.length - 1]);
		});

		it('Should return error if all TOMAs are down', async() => {
			const vol = volumes[0];

			// set all TOMAs to DOWN
			const serverCollection = app.get('db').collection('server');
			await serverCollection.updateMany({}, { $set: { tomaStatus: consts.tomaStatuses.DOWN } });

			const { err, target } = await promiseChooseTOMAForEncryption(vol);
			assert(!target);
			assertIsCausedBy(err, systemMessages.GET_EXECUTING_TOMA_FOR_ENCRYPTION_FAILURE_UNAVAILABLE_TARGET);
		});
	});

	describe('Encryption Flow', () => {
		const volumes = [];
		let vol, targets;

		before(async() => {
			await setup.newSetup();
			targets = generateTargetsPerZones(10, 1, 4, 2);
			await Promise.all(targets.map(t => t.save()));

			await generateAndSaveClients(3);
			volumes.push(...await generateAndSaveVolumes(2, true));
			vol = volumes[0];
		});

		it('init encryption should fail - volume initializing', async() => {
			const command = {
				keySize: consts.XTS_KEY_SIZES.XTS_AES_256,
				passphrase: 'blablabla',
				slot: 1,
				uuid: vol.uuid,
				_id: vol._id
			};
			const responses = await handleEncryptionRequestsPromise([command], consts.volumeEncryptionCommands.INIT_ENCRYPTION);
			assert(responses.length === 1);
			assert(!responses[0].success);
		});

		it('volume should become online', async() => {
			let dbVolume = await volumeCollection.findOne({ _id: vol._id });

			let secondPRaid = dbVolume.chunks[0].pRaids[0];
			let secondPRaidReport = PRaidReport.fromPRaid(secondPRaid)
				.setSegmentStatuses(allSegmentOnline);

			let msgBuilder = UpdatePRaidReportBuilder.fromTarget(targets[0]);
			msgBuilder.addPRaidReport(secondPRaidReport);
			let msg = msgBuilder.build();

			await new Promise(resolve => {
				volumeModule.handlePRaidStatusMessage(msg, resolve);
			});

			dbVolume = await volumeCollection.findOne({ _id: vol._id });
			assert.strictEqual(dbVolume.action, consts.volumeActions.INIT_ENCRYPTION_REQUIRED, 'volume action should be INIT_ENCRYPTION_REQUIRED');
			assert.strictEqual(dbVolume.status, consts.volumeStatuses.ONLINE, 'volume status should be ONLINE');

		});

		it('should init encryption', async() => {
			const command = {
				keySize: consts.XTS_KEY_SIZES.XTS_AES_256,
				passphrase: 'blablabla',
				slot: 1,
				uuid: vol.uuid,
				_id: vol._id
			};
			const responses = await handleEncryptionRequestsPromise([command], consts.volumeEncryptionCommands.INIT_ENCRYPTION);
			assert(responses.length === 1);
			assert(responses[0].success);
		});

		it('volume action should be initializing encryption', async() => {
			const dbVolume = await volumeCollection.findOne({ _id: vol._id });
			assert.strictEqual(dbVolume.action, consts.volumeActions.INITIALIZING_ENCRYPTION, 'volume action should be INITIALIZING_ENCRYPTION');
		});

		it('on TOMA error - should handle error', async() => {
			const msg = new EncryptionResponse({
				payload: {
					volumeName: vol._id,
					volumeUUID: vol.uuid,
					encryptionCommandIndex: 1,
					result: consts.encryptionCommandResults.TOMA_ERROR,
					error: 'some error'
				}
			});

			await sendMessageToManagement(msg);

			const dbVolume = await volumeCollection.findOne({ _id: vol._id });
			assert(!dbVolume.encryption.isInitialized, 'volume encryption should not be initialized');
			assert(!dbVolume.isReady, 'volume should not be ready');
			assert.strictEqual(dbVolume.action, consts.volumeActions.INIT_ENCRYPTION_REQUIRED, 'volume action should not be INIT_ENCRYPTION_REQUIRED');
			assert.strictEqual(dbVolume.encryption.command.commandIndex, 1, 'command index should be 1');
			assert(!!dbVolume.encryption.command.response, 'should contain command response');
			assert(!!dbVolume.encryption.command.response.error, 'should contain command response error');
		});

		it('should init encryption again', async() => {
			const command = {
				keySize: consts.XTS_KEY_SIZES.XTS_AES_256,
				passphrase: 'blablabla',
				slot: 1,
				uuid: vol.uuid,
				_id: vol._id
			};
			const responses = await handleEncryptionRequestsPromise([command], consts.volumeEncryptionCommands.INIT_ENCRYPTION);
			assert(responses.length === 1);
			assert(responses[0].success);
		});

		it('on TOMA old command index - should handle fail', async() => {
			const msg = new EncryptionResponse({
				payload: {
					volumeName: vol._id,
					volumeUUID: vol.uuid,
					encryptionCommandIndex: 1,
					result: consts.encryptionCommandResults.SUCCESS
				}
			});

			await sendMessageToManagement(msg);

			const dbVolume = await volumeCollection.findOne({ _id: vol._id });
			assert(!dbVolume.encryption.isInitialized, 'volume encryption should not be initialized');
			assert(!dbVolume.isReady, 'volume should not be ready');
			assert.strictEqual(dbVolume.encryption.command.commandIndex, 2, 'command index should be 2');
		});

		it('on TOMA success - should handle success', async() => {
			const msg = new EncryptionResponse({
				payload: {
					volumeName: vol._id,
					volumeUUID: vol.uuid,
					encryptionCommandIndex: 2,
					result: consts.encryptionCommandResults.SUCCESS
				}
			});

			await sendMessageToManagement(msg);

			const dbVolume = await volumeCollection.findOne({ _id: vol._id });
			assert(dbVolume.encryption.isInitialized, 'volume encryption should be initialized');
			assert(dbVolume.isReady, 'volume should be ready');
			assert.strictEqual(dbVolume.encryption.command.commandIndex, 2, 'command index should be 2');
			assert.strictEqual(dbVolume.action, consts.volumeActions.NONE, 'volume action should be NONE');
		});

		it('should add Passphrase', async() => {
			const command = {
				keySize: consts.XTS_KEY_SIZES.XTS_AES_256,
				passphrase: 'blablabla',
				slot: 1,
				uuid: vol.uuid,
				_id: vol._id
			};
			const responses = await handleEncryptionRequestsPromise([command], consts.volumeEncryptionCommands.ADD_PASSPHRASE);
			assert(responses.length === 1);
			assert(responses[0].success);
		});

		it('volume action should be ADDING_PASSPHRASE', async() => {
			const dbVolume = await volumeCollection.findOne({ _id: vol._id });
			assert.strictEqual(dbVolume.action, consts.volumeActions.ADDING_PASSPHRASE, 'volume action should be INITIALIZING_ENCRYPTION');
		});

		it('on TOMA error - should handle add passphrase error', async() => {
			const msg = new EncryptionResponse({
				payload: {
					volumeName: vol._id,
					volumeUUID: vol.uuid,
					encryptionCommandIndex: 3,
					result: consts.encryptionCommandResults.TOMA_ERROR,
					error: 'some error'
				}
			});

			await sendMessageToManagement(msg);

			const dbVolume = await volumeCollection.findOne({ _id: vol._id });
			assert(dbVolume.encryption.command.commandIndex === 3, 'command index should be 3');
			assert(!!dbVolume.encryption.command.response, 'should contain command response');
			assert(!!dbVolume.encryption.command.response.error, 'should contain command response error');
		});

		it('on TOMA success - should handle passphrase success', async() => {
			const msg = new EncryptionResponse({
				payload: {
					volumeName: vol._id,
					volumeUUID: vol.uuid,
					encryptionCommandIndex: 3,
					result: consts.encryptionCommandResults.SUCCESS
				}
			});

			await sendMessageToManagement(msg);

			const dbVolume = await volumeCollection.findOne({ _id: vol._id });
			assert.strictEqual(dbVolume.encryption.command.commandIndex, 3, 'command index should be 3');
			assert.strictEqual(dbVolume.action, consts.volumeActions.NONE, 'volume action should be NONE');
		});

	});

});
