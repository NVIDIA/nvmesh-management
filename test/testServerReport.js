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
const lockUtils = require('./testUtils/lockUtils.js');
const { targetHealth } = require('../consts.js');

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
});

