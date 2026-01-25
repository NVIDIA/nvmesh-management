/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app,log,describe,before,it,after */

const { VolumeConcatenated } = require('./models/volume');
const { Client } = require('./models/client.js');

const dbManager = require('./testUtils/dbManager.js');
const { setup } = require('./testUtils/setup.js');
const errorUtils = require('./testUtils/errorUtils.js');

const assert = require('assert');

const { generateAndSaveTargets } = require('./testUtils/entityGenerators.js');
const { checkPermission } = require('../modules/volume');
const { VolumeSecurityGroup } = require('./models/volumeSecuirtyGroup');
const { Key } = require('./models/key');
const { attachVolumes, updateClientKeys } = require('../modules/client');
const consts = require('../consts');
const systemMessages = require('../systemMessages');

const ZONE_1 = '1';

let clientCollection;
let keyCollection;
let vsgCollection;

describe('VolumeSecurityGroup', () => {
	before(() => {
		return dbManager.connect().then(() => {
			clientCollection = app.get('db').collection('client');
			keyCollection = app.get('db').collection('key');
			vsgCollection = app.get('db').collection('volumeSecurityGroup');
		});
	});

	after(()=>{
		return dbManager.closeConnection();
	});

	describe('Keys', () => {
		let client1 = new Client('test-server-1');
		let key1 = new Key('key1');
		let key2 = new Key('key2', 'this is key2');

		before(() => {
			return setup.newSetup()
				.then(() => client1.save())
				.then(() => {
					log.debug('finished setup');
				});
		});

		it('keys should be created', () => {
			return Promise.all([key1.save(), key2.save()])
				.then(() => {
					return keyCollection.find({ _id: { $in: [key1._id, key2._id] } }).toArray();
				})
				.then((dbKeys) => {
					assert.strictEqual(dbKeys.length, 2);
					assert.strictEqual(dbKeys[0]._id, key1._id);
					assert.strictEqual(dbKeys[1]._id, key2._id);
					assert.strictEqual(dbKeys[1].description, key2.description);
				});
		});

		it('check keys saved on client', () => {
			let clientKeys = [key1.getClientKey(), key2.getClientKey()];

			return new Promise((resolve, reject) => {
				updateClientKeys(clientKeys, client1.id, err => {
					if (err)
						return reject(err);

					resolve();
				});
			})
				.then(() => clientCollection.findOne({ _id: client1.id }))
				.then(dbClient => {
					assert(dbClient.keys);
					assert.strictEqual(dbClient.keys.length, 2);
					let expectedKeys = clientKeys.map(k=>k.uuid).sort();
					let keysInDB = dbClient.keys.map(k=>k.uuid).sort();
					assert.deepEqual(expectedKeys, keysInDB);
				});
		});
	});

	describe('VSGs', () => {
		let key1 = new Key('key1');
		let key2 = new Key('key2');

		let vsg1 = new VolumeSecurityGroup('vsg1');
		vsg1.addKey(key1._id);

		before(() => {
			return setup.newSetup()
				.then(() => log.debug('finished setup'));
		});
		it('VSG should be created', () => {
			return key1.save()
				.then(() => vsg1.save())
				.then(res => assert(res.success))
				.then(() => vsgCollection.findOne({ _id: vsg1._id }))
				.then(dbVSG => {
					assert(dbVSG);
					assert.strictEqual(dbVSG.keys[0], key1._id);
				});
		});

		it('key should be added to VSG', () => {
			return key2.save()
				.then(() => vsg1.addKey(key2._id))
				.then(() => vsg1.update())
				.then(() => vsgCollection.findOne({ _id: vsg1._id }))
				.then(dbVSG => {
					assert.strictEqual(dbVSG.keys[0], key1._id);
					assert.strictEqual(dbVSG.keys[1], key2._id);
				});
		});
	});

	//TODO: remove skip when targets tests working
	describe.skip('checkPermissions', () => {
		let keyOnlyOnClient = new Key('key-only-on-client');

		let keyClientDoesntHave = new Key('keyClientDoesntHave');
		let vsgNotAllowed = new VolumeSecurityGroup('vsgNotAllowed');
		vsgNotAllowed.addKey(keyClientDoesntHave._id);
		let volumeNotAllowed = new VolumeConcatenated('volumeNotAllowed');
		volumeNotAllowed.VSGs = [vsgNotAllowed._id];

		let keyClientHave = new Key('keyClientHave');
		let keyOnlyOnVSG2 = new Key('key-only-on-vsg2');
		let vsgAllowed = new VolumeSecurityGroup('vsgAllowed');
		vsgAllowed.addKey(keyClientHave._id);
		vsgAllowed.addKey(keyOnlyOnVSG2._id);
		let volumeAllowed = new VolumeConcatenated('volumeAllowed');
		volumeAllowed.VSGs = [vsgAllowed._id];

		let volumeNoVSGs = new VolumeConcatenated('volNoVSG');

		let client1 = new Client('test-server-1');
		let client2 = new Client('test-server-2');

		before(() => {
			return setup.newSetup()
				.then(() => generateAndSaveTargets(1, 2, ZONE_1))

				//keys
				.then(() => keyClientDoesntHave.save())
				.then(() => keyClientHave.save())
				.then(() => keyOnlyOnClient.save())
				.then(() => keyOnlyOnVSG2.save())

				// VSGs
				.then(() => vsgNotAllowed.save())
				.then(() => vsgAllowed.save())

				// Clients
				.then(() => client1.save())
				.then(() => client2.save())

				// save volumes
				.then(() => volumeNoVSGs.save())
				.then(() => volumeNotAllowed.save())
				.then(() => volumeAllowed.save())

				.then(() => new Promise(resolve => updateClientKeys([keyClientHave.getClientKey(), keyOnlyOnClient.getClientKey()], client1.id, resolve)))
				.then(err => assert(!err))
				.then(() => clientCollection.findOne({ _id: client1.id }))
				.then(dbClient => {
					assert(dbClient.keys);
					assert.strictEqual(dbClient?.keys[0]?._id, keyClientHave._id);
				})
				.then(() => log.debug('finished setup'));
		});

		it('volume with no VSG - should permit ', () => {
			return new Promise(resolve => {
				checkPermission(volumeNoVSGs, client1.id, (permitted, vsgs, authKeys) => {
					assert(permitted, 'should permit');
					assert(!vsgs || !vsgs.length, 'unexpected VSGs: ' + vsgs);
					assert(!authKeys || !authKeys.length, 'unexpected keys: ' + authKeys);
					resolve();
				});
			});
		});

		it('client has the wrong key - should not permit ', () => {
			return new Promise(resolve => {
				checkPermission(volumeNotAllowed, client1.id, (permitted, vsgs, authKeys, clientKeys) => {
					assert(!permitted, 'should not permit');
					assert(!vsgs || !vsgs.length, 'unexpected VSGs: ' + vsgs);
					assert(!authKeys || !authKeys.length, 'unexpected authKeys: ' + authKeys);
					assert.strictEqual(clientKeys[0]._id, keyClientHave._id);
					resolve();
				});
			});
		});

		it('client has the right key - should permit ', () => {
			return new Promise(resolve => {
				checkPermission(volumeAllowed, client1.id, (permitted, vsgs, auhtKeys, clientKeys) => {
					assert(permitted, 'should permit');
					assert.strictEqual(vsgs[0], vsgAllowed._id);
					assert.strictEqual(auhtKeys[0]._id, keyClientHave._id);
					assert.strictEqual(auhtKeys.length, 1);
					assert.strictEqual(clientKeys.length, 2);
					resolve();
				});
			});
		});

		it('client has no keys - should not permit ', () => {
			return Promise.resolve()
				.then(() => clientCollection.findOne({ _id: client2.id }))
				.then(dbClient => {
					assert(!dbClient.keys || dbClient.keys.length == 0);
				})
				.then(() => new Promise(resolve => {
					checkPermission(volumeAllowed, client2.id, permitted => {
						assert(!permitted, 'should not permit');
						resolve();
					});
				}));
		});

		it('try attaching multiple volumes', () => {
			let volumesToAttach = [{
				name: volumeNoVSGs._id,
				uuid: volumeNoVSGs.uuid,
				reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE	}
			}, {
				name: volumeNotAllowed._id,
				uuid: volumeNotAllowed.uuid,
				reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE }
			}, {
				name: volumeAllowed._id,
				uuid: volumeAllowed.uuid,
				reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE }
			}];

			return new Promise((resolve) => {
				attachVolumes(client1.id, client1.uuid, volumesToAttach, results => {
					assert.strictEqual(results.length, 3);

					results.forEach(res => {
						if (res._id == volumeNoVSGs._id)
							assert(res.success, res.error);
						else if (res._id == volumeAllowed._id)
							assert(res.success, res.error);
						else if (res._id == volumeNotAllowed._id) {
							assert(!res.success);
							errorUtils.assertIsCausedBy(res.error.systemMessage, systemMessages.UNAUTHORIZED_ATTACH_REQUEST);
						}
					});
					resolve();
				});
			});
		});

		it('attaching action left over and key removed', () => {
			// This test simulates a scenario where the client had a volume attached with a key
			// Then the client was shut down, the key was deleted, and now the client is turned back on
			// In this case the client document in the db will have an attachment with "ATTACHING" action on it
			// The expected behavior is that the attachment will have status UNAUTHORIZED
			// From this state the user should be able to DETACH or ATTACH which will re-attempt to attach the volume
			let volumesToAttach = [{
				name: volumeNotAllowed._id,
				reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE }
			}];

			return Promise.resolve()
				.then(() => {

				})
				.then(() => {
					return new Promise((resolve) => {
						attachVolumes(client2.id, client2.uuid, volumesToAttach, resolve);
					});
				})
				.then(results => {
					assert.strictEqual(results.length, 1);

					results.forEach(res => {
						if (res._id == volumeNoVSGs._id)
							assert(res.success, res.error);
						else if (res._id == volumeAllowed._id)
							assert(res.success, res.error);
						else if (res._id == volumeNotAllowed._id)
							assert(!res.success);
					});
				});
		});
	});
});

