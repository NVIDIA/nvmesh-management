/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app, describe, before, it, after */

const assert = require('assert');
const dbManager = require('./testUtils/dbManager.js');
const { setup } = require('./testUtils/setup.js');
const { generateTargets } = require('./testUtils/entityGenerators.js');
const lockUtils = require('./testUtils/lockUtils.js');
const consts = require('../consts.js');
const { saveVolumes, deleteTPVs, updateTPV, extendTPV, handleCDVCapacityWarning, updateVolumes } = require('../modules/volume.js');
const { Entities } = require('../modules/error.js');
const systemMessages = require('../systemMessages.js');

const ZONE_1 = '1';
const TEST_USER = { email: consts.ADMIN_USER };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateAndSaveTargets(count, numOfDisks) {
	return Promise.all(generateTargets(count, numOfDisks).map(t => t.save()));
}

/** Wraps saveVolumes in a Promise and returns the first API response. */
function saveVolume(volume) {
	return new Promise(resolve => {
		saveVolumes([volume], TEST_USER, logs => {
			const res = logs[0].createApiResponse(Entities.Volume.ID, Entities.Volume.UUID);
			volume.uuid = logs[0].getAdditionalInfoByKey(Entities.Volume.UUID) || volume.uuid;
			resolve(res);
		});
	});
}

/** Build a minimal CDV volume object. */
function makeCDV(name, capacityGB = 10) {
	return {
		_id: name,
		name,
		RAIDLevel: consts.RAIDLevel.CONCATENATED,
		capacity: capacityGB,
		volumeClass: consts.volumeClass.CDV,
		cdvConfig: { cdvExtentSizeMB: 1024 },
		limitByNodes: [],
		limitByDisks: [],
		serverClasses: [],
		diskClasses: [],
		relativeRebuildPriority: 10,
		enableNVMf: false,
		enableCrcCheck: false,
		selectedClientsForNvmf: [],
		createdBy: TEST_USER.email,
		modifiedBy: TEST_USER.email,
		dateCreated: new Date(),
		dateModified: new Date(),
		version: 1,
		isReserved: false,
		chunks: [],
	};
}

/** Build a minimal TPV volume object referencing an existing CDV. */
function makeTPV(name, cdvId, virtualSizeGB = 5, maxVirtualSizeGB = 100) {
	return {
		name,
		volumeClass: consts.volumeClass.TPV,
		tpvConfig: { cdvId, tpvExtentSizeKB: 1024, virtualSizeGB, maxVirtualSizeGB },
	};
}

function getVolumeFromDB(name) {
	return app.get('db').collection('volume').findOne({ _id: name });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Thin Provisioning', () => {
	before(() => dbManager.connect());
	after(() => dbManager.closeConnection());

	// ── CDV ──────────────────────────────────────────────────────────────────

	describe('CDV — Carrier Direct Volume', () => {

		describe('#Create', () => {
			let cdv;

			before(() => setup.newSetup()
				.then(() => generateAndSaveTargets(1, 1))
				.then(() => {
					cdv = makeCDV('cdv-create-test');
					return saveVolume(cdv);
				})
			);

			it('CDV should be created successfully', () => {
				return saveVolume(makeCDV('cdv-create-ok'))
					.then(res => assert(res.success, `Expected success, got: ${JSON.stringify(res.error)}`));
			});

			it('CDV should have volumeClass = CDV in the DB', () => {
				return getVolumeFromDB('cdv-create-test')
					.then(doc => {
						assert(doc, 'CDV document not found');
						assert.strictEqual(doc.volumeClass, consts.volumeClass.CDV);
					});
			});

			it('CDV should have tpvCount initialised to 0', () => {
				return getVolumeFromDB('cdv-create-test')
					.then(doc => {
						assert.strictEqual(doc.tpvCount, 0, 'tpvCount should start at 0');
					});
			});

			it('CDV should persist cdvConfig.cdvExtentSizeMB', () => {
				return getVolumeFromDB('cdv-create-test')
					.then(doc => {
						assert(doc.cdvConfig, 'cdvConfig should be present');
						assert.strictEqual(doc.cdvConfig.cdvExtentSizeMB, 1024);
					});
			});

			it('Lock should be released', () => lockUtils.makeSureLockIsReleased(ZONE_1));
		});

		describe('#Update', () => {
			let cdv;

			before(() => setup.newSetup()
				.then(() => generateAndSaveTargets(1, 1))
				.then(() => {
					cdv = makeCDV('cdv-update-test');
					return saveVolume(cdv);
				})
			);

			it('Should update description', () => {
				const update = { _id: cdv.name, uuid: cdv.uuid, volumeClass: consts.volumeClass.CDV, description: 'updated description' };
				return new Promise((resolve, reject) => {
					updateVolumes([update], TEST_USER, msgs => {
						const res = msgs[0].createApiResponse(Entities.Volume.ID, Entities.Volume.UUID);
						if (!res.success) return reject(new Error(JSON.stringify(res.error)));
						resolve();
					});
				}).then(() => getVolumeFromDB(cdv.name))
					.then(doc => assert.strictEqual(doc.description, 'updated description'));
			});

			it('Should update cdvConfig.maxTPVs', () => {
				const update = { _id: cdv.name, uuid: cdv.uuid, volumeClass: consts.volumeClass.CDV, cdvConfig: { maxTPVs: 64 } };
				return new Promise((resolve, reject) => {
					updateVolumes([update], TEST_USER, msgs => {
						const res = msgs[0].createApiResponse(Entities.Volume.ID, Entities.Volume.UUID);
						if (!res.success) return reject(new Error(JSON.stringify(res.error)));
						resolve();
					});
				}).then(() => getVolumeFromDB(cdv.name))
					.then(doc => assert.strictEqual(doc.cdvConfig.maxTPVs, 64));
			});

			it('Lock should be released', () => lockUtils.makeSureLockIsReleased(ZONE_1));
		});
	});

	// ── TPV ──────────────────────────────────────────────────────────────────

	describe('TPV — Thin-Provisioned Volume', () => {

		describe('#Create — success', () => {
			let cdv;

			before(() => setup.newSetup()
				.then(() => generateAndSaveTargets(1, 1))
				.then(() => {
					cdv = makeCDV('cdv-for-tpv', 10);
					return saveVolume(cdv);
				})
			);

			it('TPV should be created successfully', () => {
				return saveVolume(makeTPV('tpv-create-ok', cdv.name, 5))
					.then(res => assert(res.success, `Expected success, got: ${JSON.stringify(res.error)}`));
			});

			it('TPV should have volumeClass = TPV in the DB', () => {
				return getVolumeFromDB('tpv-create-ok')
					.then(doc => {
						assert(doc, 'TPV document not found');
						assert.strictEqual(doc.volumeClass, consts.volumeClass.TPV);
					});
			});

			it('TPV should have correct tpvConfig stored', () => {
				return getVolumeFromDB('tpv-create-ok')
					.then(doc => {
						assert(doc.tpvConfig, 'tpvConfig should be present');
						assert.strictEqual(doc.tpvConfig.cdvId, cdv.name);
						assert.strictEqual(doc.tpvConfig.virtualSizeGB, 5);
						assert.strictEqual(doc.tpvConfig.tpvExtentSizeKB, 1024);
						assert.strictEqual(doc.tpvConfig.exclusiveClient, null);
					});
			});

			it('CDV tpvCount should be incremented after TPV creation', () => {
				return getVolumeFromDB(cdv.name)
					.then(doc => assert.strictEqual(doc.tpvCount, 1));
			});
		});

		describe('#Create — CDV not found', () => {
			before(() => setup.newSetup()
				.then(() => generateAndSaveTargets(1, 1))
			);

			it('Should fail when CDV does not exist', () => {
				return saveVolume(makeTPV('tpv-no-cdv', 'nonexistent-cdv', 5))
					.then(res => assert(!res.success, 'Expected failure but got success'));
			});
		});

		describe('#Create — virtualSizeGB exceeds CDV capacity', () => {
			let cdv;

			before(() => setup.newSetup()
				.then(() => generateAndSaveTargets(1, 1))
				.then(() => {
					cdv = makeCDV('cdv-small', 5);
					return saveVolume(cdv);
				})
			);

			it('Should fail when virtualSizeGB > CDV capacity', () => {
				return saveVolume(makeTPV('tpv-too-big', cdv.name, 99, 200))
					.then(res => assert(!res.success, 'Expected failure but got success'));
			});
		});

		describe('#Create — CDV at maxTPVs', () => {
			let cdv;

			before(() => setup.newSetup()
				.then(() => generateAndSaveTargets(1, 1))
				.then(() => {
					cdv = makeCDV('cdv-max-tpvs', 10);
					// Set maxTPVs to 1 via cdvConfig before creation
					cdv.cdvConfig.maxTPVs = 1;
					return saveVolume(cdv);
				})
				.then(() => saveVolume(makeTPV('tpv-fills-cap', cdv.name, 1)))
			);

			it('Should fail when CDV is at maxTPVs capacity', () => {
				return saveVolume(makeTPV('tpv-overflow', cdv.name, 1))
					.then(res => assert(!res.success, 'Expected failure but got success'));
			});
		});

		describe('#Update', () => {
			let cdv;
			let tpvName = 'tpv-to-update';

			before(() => setup.newSetup()
				.then(() => generateAndSaveTargets(1, 1))
				.then(() => {
					cdv = makeCDV('cdv-for-tpv-update', 10);
					return saveVolume(cdv);
				})
				.then(() => saveVolume(makeTPV(tpvName, cdv.name, 5, 50)))
			);

			it('Should update TPV description', () => {
				return new Promise((resolve, reject) => {
					updateTPV({ _id: tpvName, description: 'updated tpv desc' }, TEST_USER, msg => {
						const res = msg.createApiResponse(Entities.Volume.ID);
						res.success ? resolve() : reject(new Error(JSON.stringify(res.error)));
					});
				}).then(() => getVolumeFromDB(tpvName))
					.then(doc => assert.strictEqual(doc.description, 'updated tpv desc'));
			});

			it('Should update tpvConfig.maxVirtualSizeGB', () => {
				return new Promise((resolve, reject) => {
					updateTPV({ _id: tpvName, tpvConfig: { maxVirtualSizeGB: 200 } }, TEST_USER, msg => {
						const res = msg.createApiResponse(Entities.Volume.ID);
						res.success ? resolve() : reject(new Error(JSON.stringify(res.error)));
					});
				}).then(() => getVolumeFromDB(tpvName))
					.then(doc => assert.strictEqual(doc.tpvConfig.maxVirtualSizeGB, 200));
			});

			it('Should not update cdvId (immutable field)', () => {
				return new Promise((resolve, reject) => {
					updateTPV({ _id: tpvName, tpvConfig: { cdvId: 'some-other-cdv' } }, TEST_USER, msg => {
						const res = msg.createApiResponse(Entities.Volume.ID);
						res.success ? resolve() : reject(new Error(JSON.stringify(res.error)));
					});
				}).then(() => getVolumeFromDB(tpvName))
					.then(doc => assert.strictEqual(doc.tpvConfig.cdvId, cdv.name, 'cdvId should not have changed'));
			});

			it('Should fail to update a non-TPV volume', () => {
				return new Promise(resolve => {
					updateTPV({ _id: cdv.name }, TEST_USER, msg => {
						const res = msg.createApiResponse(Entities.Volume.ID);
						resolve(res);
					});
				}).then(res => assert(!res.success, 'Expected failure for non-TPV update'));
			});
		});

		describe('#Delete', () => {
			let cdv;
			const tpvToDelete = 'tpv-to-delete';
			const tpvAttached = 'tpv-attached';

			before(() => setup.newSetup()
				.then(() => generateAndSaveTargets(1, 1))
				.then(() => {
					cdv = makeCDV('cdv-for-tpv-delete', 10);
					return saveVolume(cdv);
				})
				.then(() => Promise.all([
					saveVolume(makeTPV(tpvToDelete, cdv.name, 3)),
					saveVolume(makeTPV(tpvAttached, cdv.name, 3)),
				]))
				// Simulate an attached TPV by setting exclusiveClient in the DB
				.then(() => app.get('db').collection('volume')
					.updateOne({ _id: tpvAttached }, { $set: { 'tpvConfig.exclusiveClient': 'some-client' } })
				)
			);

			it('Should delete an unattached TPV successfully', () => {
				return new Promise((resolve, reject) => {
					deleteTPVs([{ _id: tpvToDelete }], TEST_USER, msgs => {
						const res = msgs[0].createApiResponse(Entities.Volume.ID);
						res.success ? resolve() : reject(new Error(JSON.stringify(res.error)));
					});
				});
			});

			it('Deleted TPV should no longer exist in the DB', () => {
				return getVolumeFromDB(tpvToDelete)
					.then(doc => assert(!doc, 'TPV should have been removed from DB'));
			});

			it('CDV tpvCount should be decremented after TPV deletion', () => {
				return getVolumeFromDB(cdv.name)
					.then(doc => assert.strictEqual(doc.tpvCount, 1, 'tpvCount should be 1 after deleting one of two TPVs'));
			});

			it('Should fail to delete a TPV that is currently attached', () => {
				return new Promise(resolve => {
					deleteTPVs([{ _id: tpvAttached }], TEST_USER, msgs => {
						resolve(msgs[0].createApiResponse(Entities.Volume.ID));
					});
				}).then(res => assert(!res.success, 'Expected failure when deleting an attached TPV'));
			});

			it('Attached TPV should still exist in the DB after failed delete', () => {
				return getVolumeFromDB(tpvAttached)
					.then(doc => assert(doc, 'Attached TPV should still be in the DB'));
			});
		});

		describe('#Extend', () => {
			let cdv;
			const tpvName = 'tpv-to-extend';

			before(() => setup.newSetup()
				.then(() => generateAndSaveTargets(1, 1))
				.then(() => {
					cdv = makeCDV('cdv-for-tpv-extend', 10);
					return saveVolume(cdv);
				})
				.then(() => saveVolume(makeTPV(tpvName, cdv.name, 5, 50)))
			);

			it('Should extend TPV virtualSizeGB to a larger value', () => {
				return new Promise((resolve, reject) => {
					extendTPV({ tpvId: tpvName, newSizeGB: 20 }, TEST_USER, msg => {
						const res = msg.createApiResponse(Entities.Volume.ID);
						res.success ? resolve() : reject(new Error(JSON.stringify(res.error)));
					});
				}).then(() => getVolumeFromDB(tpvName))
					.then(doc => {
						assert.strictEqual(doc.tpvConfig.virtualSizeGB, 20);
						assert.strictEqual(doc.capacity, 20);
					});
			});

			it('Should fail when newSizeGB is equal to current virtualSizeGB', () => {
				return new Promise(resolve => {
					extendTPV({ tpvId: tpvName, newSizeGB: 20 }, TEST_USER, msg => {
						resolve(msg.createApiResponse(Entities.Volume.ID));
					});
				}).then(res => assert(!res.success, 'Expected failure: same size'));
			});

			it('Should fail when newSizeGB is less than current virtualSizeGB', () => {
				return new Promise(resolve => {
					extendTPV({ tpvId: tpvName, newSizeGB: 1 }, TEST_USER, msg => {
						resolve(msg.createApiResponse(Entities.Volume.ID));
					});
				}).then(res => assert(!res.success, 'Expected failure: smaller size'));
			});

			it('Should fail when newSizeGB exceeds maxVirtualSizeGB', () => {
				return new Promise(resolve => {
					extendTPV({ tpvId: tpvName, newSizeGB: 999 }, TEST_USER, msg => {
						resolve(msg.createApiResponse(Entities.Volume.ID));
					});
				}).then(res => assert(!res.success, 'Expected failure: exceeds maxVirtualSizeGB'));
			});

			it('Should fail when TPV does not exist', () => {
				return new Promise(resolve => {
					extendTPV({ tpvId: 'nonexistent-tpv', newSizeGB: 10 }, TEST_USER, msg => {
						resolve(msg.createApiResponse(Entities.Volume.ID));
					});
				}).then(res => assert(!res.success, 'Expected failure: TPV not found'));
			});
		});
	});

	// ── CDV Capacity Warning ──────────────────────────────────────────────────

	describe('handleCDVCapacityWarning', () => {
		before(() => setup.newSetup());

		it('Should call callback immediately (auto-extend is disabled)', done => {
			const fakeMessage = {
				cdvUUID: 'fake-cdv-uuid',
				usedExtents: 92,
				totalExtents: 100,
			};
			handleCDVCapacityWarning(fakeMessage, done);
		});
	});
});
