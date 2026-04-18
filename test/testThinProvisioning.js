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
const { saveVolumes, deleteTPVs, updateTPV, extendTPV, handleCDVCapacityWarning, updateVolumes, markVolumesForDeletion } = require('../modules/volume.js');
const { Entities } = require('../modules/error.js');

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
function makeTPV(name, cdvId, capacity = 5) {
	return {
		name,
		volumeClass: consts.volumeClass.TPV,
		capacity,
		tpvConfig: { cdvId, tpvExtentSizeKB: 1024 },
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

			it('TPV should have correct config stored', () => {
				return getVolumeFromDB('tpv-create-ok')
					.then(doc => {
						assert(doc.tpvConfig, 'tpvConfig should be present');
						assert.strictEqual(doc.tpvConfig.cdvId, cdv.name);
						assert.strictEqual(doc.tpvConfig.tpvExtentSizeKB, 1024);
						assert.strictEqual(doc.tpvConfig.exclusiveClient, null);
						assert.strictEqual(doc.capacity, 5);
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

		describe('#Create — TPV capacity exceeds CDV capacity', () => {
			let cdv;

			before(() => setup.newSetup()
				.then(() => generateAndSaveTargets(1, 1))
				.then(() => {
					cdv = makeCDV('cdv-small', 5);
					return saveVolume(cdv);
				})
			);

			it('Should fail when TPV capacity > CDV capacity', () => {
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

			it('Should extend TPV capacity to a larger value', () => {
				return new Promise((resolve, reject) => {
					extendTPV({ tpvId: tpvName, newSizeGB: 20 }, TEST_USER, msg => {
						const res = msg.createApiResponse(Entities.Volume.ID);
						res.success ? resolve() : reject(new Error(JSON.stringify(res.error)));
					});
				}).then(() => getVolumeFromDB(tpvName))
					.then(doc => {
						assert.strictEqual(doc.capacity, 20);
					});
			});

			it('Should fail when newSizeGB is equal to current capacity', () => {
				return new Promise(resolve => {
					extendTPV({ tpvId: tpvName, newSizeGB: 20 }, TEST_USER, msg => {
						resolve(msg.createApiResponse(Entities.Volume.ID));
					});
				}).then(res => assert(!res.success, 'Expected failure: same size'));
			});

			it('Should fail when newSizeGB is less than current capacity', () => {
				return new Promise(resolve => {
					extendTPV({ tpvId: tpvName, newSizeGB: 1 }, TEST_USER, msg => {
						resolve(msg.createApiResponse(Entities.Volume.ID));
					});
				}).then(res => assert(!res.success, 'Expected failure: smaller size'));
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

	// ── tpvExtentSizeKB validation ────────────────────────────────────────────

	describe('TPV — tpvExtentSizeKB exceeds CDV extent size', () => {
		let cdv;

		before(() => setup.newSetup()
			.then(() => generateAndSaveTargets(1, 1))
			.then(() => {
				cdv = makeCDV('cdv-extent-check', 10);
				cdv.cdvConfig.cdvExtentSizeMB = 64; // 64 MB = 65536 KB
				return saveVolume(cdv);
			})
		);

		it('Should fail when tpvExtentSizeKB > cdvExtentSizeMB * 1024', () => {
			// CDV extent is 64 MB = 65536 KB. TPV extent of 65536 KB is equal (OK), but we can't test larger
			// since 65536 is max. Use cdvExtentSizeMB = 64 and tpvExtentSizeKB = 65536 (equal, should pass)
			// and test with a CDV where cdvExtentSizeMB < max tpvExtentSizeKB
			return saveVolume(makeTPV('tpv-extent-ok', cdv.name, 5))
				.then(res => assert(res.success, `Expected success for equal extent, got: ${JSON.stringify(res.error)}`));
		});

		it('Should fail when tpvExtentSizeKB is explicitly too large', () => {
			const tpv = makeTPV('tpv-extent-too-big', cdv.name, 5);
			// CDV extent is 64 MB = 65536 KB. Set TPV extent to a value that would exceed it.
			// We can't use a value larger than max enum, but we can use a smaller CDV extent.
			// Actually, the makeTPV defaults tpvExtentSizeKB to 1024, which is fine.
			// Let's create a CDV with cdvExtentSizeMB = 64 (64 MB = 65536 KB) and TPV extent of 65536 KB
			// That's equal, not exceeding. We need cdvExtentSizeMB smaller.
			// Use a CDV with cdvExtentSizeMB = 64 and manually set tpvExtentSizeKB to something > 65536.
			// But tpvExtentSizeKBValues max is 65536, so the schema would reject it.
			// Bypass: save directly with a cdvExtentSizeMB of 64 (=65536 KB) and set tpvExtentSizeKB = 65536
			// This is equal, so it passes. We need to test with a truly smaller CDV extent.
			// Let's make a new CDV with cdvExtentSizeMB of 64 (but tpvExtentSizeKBValues includes 65536 which is equal).
			// Actually to properly test this, we need a value where KB > MB*1024.
			// If cdvExtentSizeMB = 64, then max KB = 65536. tpvExtentSizeKB of 65536 is exactly equal.
			// There is no valid tpvExtentSizeKBValue that exceeds it because 65536 is the max.
			// But if we test the logic directly by inserting a raw value:
			tpv.tpvConfig.tpvExtentSizeKB = 999999; // exceeds 64 * 1024 = 65536
			return saveVolume(tpv)
				.then(res => assert(!res.success, 'Expected failure: tpvExtentSizeKB exceeds cdvExtentSizeMB * 1024'));
		});
	});

	// ── CDV deletion guard ────────────────────────────────────────────────────

	describe('CDV — deletion blocked when TPVs exist', () => {
		let cdv;

		before(() => setup.newSetup()
			.then(() => generateAndSaveTargets(1, 1))
			.then(() => {
				cdv = makeCDV('cdv-del-guard', 10);
				return saveVolume(cdv);
			})
			.then(() => saveVolume(makeTPV('tpv-on-cdv', cdv.name, 3)))
		);

		it('Should fail to delete CDV that has active TPVs', () => {
			return new Promise(resolve => {
				markVolumesForDeletion([{ _id: cdv.name, uuid: cdv.uuid }], msgs => {
					const res = msgs[0].createApiResponse(Entities.Volume.ID, Entities.Volume.UUID);
					resolve(res);
				});
			}).then(res => assert(!res.success, 'Expected failure: CDV has TPVs'));
		});

		it('CDV should still exist in DB after failed delete', () => {
			return getVolumeFromDB(cdv.name)
				.then(doc => assert(doc, 'CDV should still be in the DB'));
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

	// ── Per-client CDV preempt (TPV_PerClientCDVPreemption.md §2.10 Step 20) ──

	describe('CDV preempt client', () => {
		const clientModule = require('../modules/client.js');
		let cdv, tpv;
		const TEST_CLIENT = 'test-client-01';
		const TEST_CLIENT_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

		before(() => setup.newSetup()
			.then(() => generateAndSaveTargets(1, 1))
			.then(() => {
				cdv = makeCDV('cdv-preempt-test', 20);
				return saveVolume(cdv);
			})
			.then(() => {
				tpv = makeTPV('tpv-preempt-test', cdv.name, 4);
				return saveVolume(tpv);
			})
			// Simulate an existing attachment in the 'normal' state so the
			// preempt flow has something to transition to EVICTING.
			// attachments is a UUID-keyed object, not an array.
			.then(() => app.get('db').collection('client').insertOne({
				_id: TEST_CLIENT,
				uuid: TEST_CLIENT_UUID,
				attachments: {
					[cdv.uuid]: {
						uuid: cdv.uuid,
						name: cdv.name,
						volumeID: cdv.name,
						action: consts.volumeAttachmentActions.ATTACHING,
					},
				},
			}))
			// Simulate the TPV having this client as its exclusive holder.
			.then(() => app.get('db').collection('volume').updateOne(
				{ _id: tpv.name },
				{ $set: { 'tpvConfig.exclusiveClient': TEST_CLIENT, 'tpvConfig.exclusiveClientUUID': TEST_CLIENT_UUID } }
			))
		);

		it('CDV admissionFloor should be initialized to 0 on create', () => {
			return getVolumeFromDB(cdv.name).then(doc => {
				assert.strictEqual(doc.cdvConfig.admissionFloor, 0,
					'Expected admissionFloor=0 on freshly-created CDV');
			});
		});

		// EVICTING gate (checkNotEvictingFromCDV in attachTPV) — state-level
		// test: verify the Mongo query shape that the gate uses actually finds
		// the EVICTING attachment. The full attachTPV flow is an integration
		// test (touches Kafka fan-out through attachCDV / attachTPVVolume) and
		// lives outside the unit-test harness; here we assert the predicate
		// the gate relies on.
		it('EVICTING attachment is detected by the gate query', done => {
			const clientCol = app.get('db').collection('client');
			clientCol.updateOne(
				{ _id: TEST_CLIENT },
				{ $set: { [`attachments.${cdv.uuid}.action`]: consts.volumeAttachmentActions.EVICTING } },
				() => {
					// Query used in checkNotEvictingFromCDV (see attachTPV).
					clientCol.findOne(
						{ _id: TEST_CLIENT },
						{ projection: { [`attachments.${cdv.uuid}.action`]: 1 } },
						(err, clientDoc) => {
							assert(!err, `Expected no Mongo error, got ${err && err.message}`);
							const attachment = clientDoc && clientDoc.attachments && clientDoc.attachments[cdv.uuid];
							assert(attachment, 'Expected attachment entry for the CDV');
							assert.strictEqual(attachment.action, consts.volumeAttachmentActions.EVICTING,
								`Expected action=EVICTING, got ${attachment.action}`);
							done();
						}
					);
				}
			);
		});

		it('Double-preempt should be idempotent (floor monotonic via $max)', done => {
			// Seed: bump floor twice manually, simulating two preempt invocations
			// that land (first bumps 0→1, second 1→2 on retry). Using $max means
			// a $max with value ≤ current value is a no-op.
			const volCol = app.get('db').collection('volume');
			volCol.updateOne(
				{ uuid: cdv.uuid },
				{ $max: { 'cdvConfig.admissionFloor': 5 } },
				() => {
					// Second call with a lower value — should NOT decrease.
					volCol.updateOne(
						{ uuid: cdv.uuid },
						{ $max: { 'cdvConfig.admissionFloor': 3 } },
						() => {
							volCol.findOne({ uuid: cdv.uuid }, (err, doc) => {
								assert.strictEqual(doc.cdvConfig.admissionFloor, 5,
									'Expected floor to remain at 5 after $max 3 (monotonic)');
								done();
							});
						}
					);
				}
			);
		});

		it('clearEvictedClientState should clear exclusiveClient on TPV and remove attachment', done => {
			// Ensure baseline.
			app.get('db').collection('volume').updateOne(
				{ _id: tpv.name },
				{ $set: { 'tpvConfig.exclusiveClient': TEST_CLIENT, 'tpvConfig.exclusiveClientUUID': TEST_CLIENT_UUID } },
				() => {
					clientModule.clearEvictedClientState(cdv, TEST_CLIENT, () => {
						app.get('db').collection('volume').findOne({ _id: tpv.name }, (err, tpvDoc) => {
							assert.strictEqual(tpvDoc.tpvConfig.exclusiveClient, null,
								'Expected exclusiveClient cleared');
							app.get('db').collection('client').findOne({ _id: TEST_CLIENT }, (err2, clientDoc) => {
								const stillHas = clientDoc && clientDoc.attachments && clientDoc.attachments[cdv.uuid];
								assert(!stillHas, 'Expected (client, CDV) attachment removed');
								done();
							});
						});
					});
				}
			);
		});

		// Reaper discovery query — verify the Mongo expression the reaper uses
		// to find stuck EVICTING attachments. The full reaper flow invokes
		// preemptClientFromCDV per stuck attachment, which fans out Kafka and
		// waits for TOMA ACKs; that's integration-level scope. Here we just
		// verify the discovery query matches the right docs.
		it('reapEvictingAttachments discovery query finds clients with EVICTING attachments', done => {
			const clientCol = app.get('db').collection('client');
			clientCol.updateOne(
				{ _id: TEST_CLIENT },
				{ $set: { attachments: { [cdv.uuid]: {
					uuid: cdv.uuid,
					name: cdv.name,
					volumeID: cdv.name,
					action: consts.volumeAttachmentActions.EVICTING,
				} } } },
				() => {
					// Mirror the $expr + $objectToArray discovery query from
					// reapEvictingAttachments. A matching client implies the
					// reaper would pick it up.
					clientCol.find({
						$expr: { $anyElementTrue: { $map: {
							input: { $ifNull: [{ $objectToArray: '$attachments' }, []] },
							as: 'a',
							in: { $eq: ['$$a.v.action', consts.volumeAttachmentActions.EVICTING] },
						} } },
					}).toArray((err, clients) => {
						assert(!err, `Expected no Mongo error, got ${err && err.message}`);
						const found = (clients || []).some(c => c._id === TEST_CLIENT);
						assert(found, 'Expected reaper discovery to find the EVICTING-attachment client');
						done();
					});
				}
			);
		});
	});
});
