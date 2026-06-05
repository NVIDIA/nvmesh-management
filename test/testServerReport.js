/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app,log,describe,before,it,after */

const assert = require('assert');

const dbManager = require('./testUtils/dbManager.js');
const { setup, SetupOptions } = require('./testUtils/setup.js');
const { Target } = require('./models/target.js');
const { generateTarget } = require('./testUtils/entityGenerators.js');
const { ReportTargetBuilder } = require('./kafkaMessages/fromTOMA/tomaMessageBuilders.js');
const { TargetNIC } = require('./models/targetNic.js');
const lockUtils = require('./testUtils/lockUtils.js');
const { targetHealth } = require('../consts.js');
const targetModule = require('../modules/target.js');

var serverCollection;

const NODE_ID = 'node-1';
const ZONE_1 = '1';

function setupEnvironment() {
	return setup.newSetup()
		.then(() => new Target(NODE_ID)) // TODO(KAFKA): remove this ?
		.then(() => log.debug('setupEnvironment finished'));
}

describe('Target Report', function() {

	before(() => {
		return dbManager.connect().then(() => {
			serverCollection = app.get('db').collection('server');
		});
	});

	after(() => {
		return dbManager.closeConnection().catch(() => {});
	});

	describe('#New Target - Zones Enabled', function() {
		let target = generateTarget(NODE_ID);

		before(() => {
			let opts = new SetupOptions().setEnableZones(true);
			return setupEnvironment(opts);
		});

		it('operation should not return an error', () => {
			return target.save();
		});

		it('full document should appear in the db', () => {
			return serverCollection.findOne({ node_id: NODE_ID }).then(dbDoc => {
				assert(dbDoc);
				assert.strictEqual(dbDoc.nics.length, target.nics.length);
				assert.strictEqual(dbDoc.disks.length, target.disks.length);
			});
		});

		it('lock 1 should have 1 targetsInZone ', (done) => {
			lockUtils.getLockDocument(ZONE_1).then((lockDocument) => {
				assert.strictEqual(lockDocument.targetsInZone.length, 1);
				done();
			});
		});
	});

	describe('#New Target - Zones Disabled', function() {
		let target = generateTarget(NODE_ID);

		before(() => {
			let opts = new SetupOptions().setEnableZones(false);
			return setupEnvironment(opts);
		});

		it('operation should not return an error', () => {
			return target.save();
		});

		it('full document should appear in the db', () => {
			return serverCollection.findOne({ node_id: NODE_ID }).then(dbDoc => {
				assert(dbDoc);
				assert.strictEqual(dbDoc.nics.length, target.nics.length);
				assert.strictEqual(dbDoc.disks.length, target.disks.length);
			});
		});

		it('lock 1 should have 1 targetsInZone ', () => {
			return lockUtils.getLockDocument(ZONE_1).then((lockDocument) => {
				assert(lockDocument);
				assert.strictEqual(lockDocument.targetsInZone.length, 1);
			});
		});

		it('report disk endurance < 50%', async() => {
			target.disks[0].Available_Spare = '40_%';
			target.disks[0].reappearingCounter++;
			target.messageSequence++;
			target.reportID++;
			await target.sendReport();
			let dbTarget = await serverCollection.findOne({ node_id: NODE_ID });
			assert(dbTarget);
			assert.strictEqual(dbTarget.disks[0].health, targetHealth.ALARM);
		});

		it('report disk endurance < 1%', async() => {
			target.disks[0].Available_Spare = '0_%';
			target.messageSequence++;
			target.reportID++;
			await target.sendReport();
			let dbTarget = await serverCollection.findOne({ node_id: NODE_ID });
			assert(dbTarget);
			assert.strictEqual(dbTarget.disks[0].health, targetHealth.CRITICAL);
		});
	});

	describe('target reports race with same tomaToken', function() {
		before(async() => {
			await setup.newSetup(new SetupOptions().setEnableZones(false));
			new Target(NODE_ID);
		});

		const NUM_OF_REPORTS = 5;

		function fireReport(message) {
			return new Promise(resolve => {
				targetModule.report(message, err => resolve(err || null));
			});
		}

		function errSummary(err) {
			if (!err) return 'ok';
			return err.systemMessage?.id || err.message || String(err);
		}

		// Fire `NUM_OF_REPORTS` `reportTarget`s concurrently with the same `tomaToken` and
		// consecutive `messageSequence` values; saveTargetReport's seq guard must prevent duplicate
		it(`${NUM_OF_REPORTS} concurrent reportTarget messages: no duplicate NICs`, async() => {
			const target = generateTarget(NODE_ID, 0, 0);
			await target.save();

			const initial = await serverCollection.findOne({ _id: NODE_ID });
			assert.strictEqual(initial.nics.length, 0, 'target should start with no NICs');

			const nicID = 'race-nic';
			const nic = new TargetNIC(nicID, NODE_ID, target.uuid);
			const startSeq = (initial.kafkaMessageSequence?.reportTarget || 0) + 1;

			target.nics = [nic];
			const messages = [];
			for (let r = 0; r < NUM_OF_REPORTS; r++) {
				target.messageSequence = startSeq + r;
				messages.push(ReportTargetBuilder.fromTarget(target).build());
			}

			const errors = await Promise.all(messages.map(m => fireReport(m)));

			const finalDoc = await serverCollection.findOne({ _id: NODE_ID });
			const finalRows = finalDoc.nics.filter(n => n.nicID === nicID);

			assert.strictEqual(finalRows.length, 1,
				`expected exactly 1 row for nicID=${nicID}, got ${finalRows.length} `
				+ `(uuids=${JSON.stringify(finalRows.map(r => r.uuid))}, errs=${JSON.stringify(errors.map(errSummary))})`);

			assert(errors.some(e => !e),
				'every racer\'s callback returned an error -- expected at least one to commit '
				+ `(errs=${JSON.stringify(errors.map(errSummary))})`);

			// verify NIC attributes were not double parsed
			const persisted = finalRows[0];
			assert.strictEqual(persisted.pkey, 0xFFFF,
				`pkey must be 65535 (single parse), got ${persisted.pkey}`);
			assert.strictEqual(persisted.mtu, nic.mtu, 'mtu must be unchanged');
			assert.strictEqual(persisted.status, nic.status, 'status must be unchanged');
			assert.strictEqual(persisted.protocol, nic.protocol, 'protocol must be unchanged');
		});
	});
});

