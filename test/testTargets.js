/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app,log,describe,before,beforeEach,it,after */

const assert = require('assert');

const dbManager = require('./testUtils/dbManager.js');
const targetModule = require('../modules/target.js');
const consts = require('../consts.js');
const diskModule = require('../modules/disk.js');
const lockUtils = require('./testUtils/lockUtils.js');
const { setup, SetupOptions } = require('./testUtils/setup.js');
const { generateTarget } = require('./testUtils/entityGenerators.js');
const { reportAllSegmentsOnline } = require('./testUtils/volumeUtils.js');
const { VolumeConcatenated, VolumeRAID1, VolumeEC, VolumeRAID1With2Mirrors, VolumeRAID1With2MirrorsMinimal } = require('./models/volume.js');
const { TargetClass } = require('./models/targetClass.js');
const systemMessages = require('../systemMessages.js');
const { getOrCreateQueue } = require('./testUtils/mockKafkaModule.js');
const { getIncrementalTargetUpdatesTopic } = require('../modules/kafka.js');

const ZONE_1 = '1';

var serverCollection;
let targets;

function setupEnvironment() {
	let opts = new SetupOptions().setEnableZones(true);
	return setup.newSetup(opts)
		.then(() => {
			log.debug('enableZones: ' + app.get('globalSettings').enableZones);
		})
		.then(() => {
			return Promise.all([
				generateTarget('server1.acme.com').save().then(t => t.setZone('1')),
				generateTarget('server2.acme.com').save().then(t => t.setZone('2')),
				generateTarget('server3.acme.com').save().then(t => t.setZone('3')),
				generateTarget('server4.acme.com').save().then(t => t.setZone('4')),
			]);
		})
		.then(savedTargets => {
			targets = savedTargets;
		})
		.then(() => log.debug('setupEnvironment finished'))
		.catch(err => {
			throw new Error(`Error Setting Up Environment! Error: ${err}`);
		});
}

async function setupSingleTargetEnvironment() {
	try {
		let opts = new SetupOptions().setEnableZones(false);
		await setup.newSetup(opts);
		log.debug('enableZones: ' + app.get('globalSettings').enableZones);
		targets = [await generateTarget('server1.acme.com').save()];
		log.debug('setupSingleTargetEnvironment finished');
	} catch (err) {
		throw new Error(`Error Setting Up Environment! Error: ${err}`);
	}
}

describe('Targets', function() {

	before(() => {
		return dbManager.connect().then(() => {
			serverCollection = app.get('db').collection('server');
		});
	});

	after(()=>{
		return dbManager.closeConnection();
	});

	describe('#New Target', function() {
		before(async() => {
			await setupSingleTargetEnvironment();
		});

		it('Target should be saved', () =>{
			let nodeID = 'test.single.target';
			let target = generateTarget(nodeID);
			return target.save()
				.then(() => serverCollection.findOne({ _id: nodeID }))
				.then(dbTarget => {
					assert(dbTarget);
					assert.strictEqual(target.nics.length, dbTarget.nics.length);
					assert.strictEqual(target.disks.length, dbTarget.disks.length);
				});
		});
	});

	describe('#setZone', function() {
		describe('Zones enabled', function() {
			before(async() => {
				let opts = new SetupOptions().setEnableZones(true);
				await setup.newSetup(opts);
			});

			it('Target should be saved without zone', async() => {
				let target = await generateTarget('test-setzone').save();
				assert.strictEqual(target.zone, '-1');
			});

			it('setZone should assign zone to saved target', async() => {
				let target = await generateTarget('test-setzone-assign').save();
				assert.strictEqual(target.zone, '-1');
				await target.setZone('1');
				assert.strictEqual(target.zone, '1');

				let dbTarget = await serverCollection.findOne({ _id: 'test-setzone-assign' });
				assert(dbTarget);
				assert.strictEqual(dbTarget.zone, '1');
			});
		});
	});

	describe('#Delete Target', function() {

		describe('Single Target', function() {
			let targetToDelete;

			beforeEach(async() => {
				await setupSingleTargetEnvironment();
				// Add another target to zone 1
				await generateTarget('zone1serverB.acme.com').save();
				targetToDelete = targets[0];
			});

			it('should return success', async() => {
				await targetToDelete.timedOut();

				const logs = await targetToDelete.delete();
				const results = logs.map(l => l.createApiResponse());
				assert(results[0].success);
				await lockUtils.makeSureLockIsReleased(ZONE_1);

				const numOfTargets = await serverCollection.countDocuments({ node_id: targetToDelete._id });
				assert.strictEqual(numOfTargets, 0);

				const lockDocument = await lockUtils.getLockDocument(ZONE_1);
				assert.strictEqual(lockDocument.targetsInZone.length, 1);
			});

			it('should fail drive has segments', async() => {
				const v1 = new VolumeConcatenated('v1');

				v1.limitByDisks = ['SERVER1.1'];
				await v1.createOrReject();

				await targetToDelete.timedOut();

				const logs = await targetToDelete.delete();
				const results = logs.map(l => l.createApiResponse());
				assert(!results[0].success);

				const numOfTargets = await serverCollection.countDocuments({ node_id: targetToDelete._id });
				assert.strictEqual(numOfTargets, 1);

				const lockDocument = await lockUtils.getLockDocument(ZONE_1);
				assert.strictEqual(lockDocument.targetsInZone.length, 2);
			});
		});

		describe('Evict Target', function() {
			let targetToDelete;

			this.beforeEach(() => {
				return setupEnvironment()
					.then(() => targetToDelete = targets[0]);
			});

			it('should return success', async() => {
				await targetToDelete.timedOut();

				const logs = await targetToDelete.evict();
				const results = logs.map(l => l.createApiResponse());
				assert(results[0].success);

				const numOfTargets = await serverCollection.countDocuments({ node_id: targetToDelete._id });
				assert.strictEqual(numOfTargets, 0);
			});

			it('should return failed to evict drives', async() => {
				const v1 = new VolumeConcatenated('v1');
				v1.limitByDisks = ['SERVER1.1'];
				await v1.createOrReject();

				await targetToDelete.timedOut();

				const logs = await targetToDelete.evict();
				const results = logs.map(l => l.createApiResponse());
				assert(!results[0].success);

				const target = await serverCollection.findOne({ node_id: targetToDelete._id });
				assert(target);
				assert(target.disks[0].diskID == 'SERVER1.1');

				const lockDocument = await lockUtils.getLockDocument(ZONE_1);
				assert.strictEqual(lockDocument.targetsInZone.length, 1);
			});
		});

		describe('Multiple Targets', function() {
			var locksInitialState;

			before(() => {
				return setupEnvironment().then(() => {
					lockUtils.getAllLocks().then((allLocks) => {
						locksInitialState = allLocks;
					});
				});
			});

			it('operation should return success', async() => {
				const targetsToDelete = targets.slice(0, -1);

				await Promise.all(targetsToDelete.map(target => target.timedOut()));

				const logs = await new Promise(resolve => targetModule.deleteTargets(targetsToDelete.map(({ _id, uuid }) => ({ _id, uuid })), false, resolve));
				const results = logs.map(l => l.createApiResponse());
				assert(results.every(r => r.success));
			});


			it('All Locks should be released', () => {
				return lockUtils.makeSureAllZonesAreReleased().catch(err => assert(!err));
			});

			it('only one target should be left in the db', (done) => {
				serverCollection.countDocuments({}, (err, result) => {
					assert(!err);
					assert.strictEqual(result, 1);
					done();
				});
			});

			it('3 locks counters should change', () => {
				return lockUtils.getAllLocks().then((allLocks) => {
					var countersDiff = {};

					locksInitialState.forEach(c => countersDiff[c._id] = c.lockCounter);
					allLocks.forEach(c => countersDiff[c._id] -= c.lockCounter);

					var changedZones = Object.keys(countersDiff).filter(zone => countersDiff[zone] != 0);
					assert.strictEqual(changedZones.length, 3);
				});
			});

			it('3 locks should have 0 targetsInZone', (done) => {
				lockUtils.getAllLocks().then((allLocks) => {
					allLocks.forEach(lockDoc => {
						let affectedZones = new Set(['1', '2', '3']);
						if (affectedZones.has(lockDoc._id)) {
							assert.strictEqual(lockDoc.targetsInZone.length, 0);
						}
					});

					done();
				});
			});
		});
	});

	describe('#DeleteNICByIDAndUUID', function() {

		describe('Fail if NIC not found', function() {
			let target;

			before(() => {
				return setupEnvironment()
					.then(() => target = targets[0]);
			});

			it('operation should fail', (done) => {
				serverCollection.findOne({ node_id: targets[1]._id }, (err, t) => {
					assert(!err);
					// take NIC from the wrong node
					const nicID = t.nics[0].nicID;
					targetModule.deleteNICByIDAndUUID(target._id, target.uuid, nicID, (log) => {
						const result = log.createApiResponse();
						assert(!result.success);
						done();
					});
				});
			});

			it('Lock should be released', () => {
				return lockUtils.makeSureLockIsReleased(ZONE_1);
			});

			it('should not be removed from the target document in the db', (done) => {
				serverCollection.findOne({ node_id: target._id }, (err, target) => {
					assert(!err);
					assert.strictEqual(target.nics.length, 1);
					done();
				});
			});
		});

		describe('Fail if status is not Missing', function() {
			let target;
			let nicID;

			before(() => {
				return setupEnvironment()
					.then(() => target = targets[0]);
			});

			it('operation should fail', (done) => {
				serverCollection.findOne({ node_id: target._id }, (err, t) => {
					assert(!err);
					nicID = t.nics[0].nicID;
					targetModule.deleteNICByIDAndUUID(target._id, target.uuid, nicID, (log) => {
						const result = log.createApiResponse();
						assert(!result.success);
						done();
					});
				});
			});

			it('Lock should be released', () => {
				return lockUtils.makeSureLockIsReleased(ZONE_1);
			});

			it('should not be removed from the target document in the db', (done) => {
				serverCollection.findOne({ node_id: target._id }, (err, target) => {
					assert(!err);
					let nic = target.nics.filter(nic => nic.nicID == nicID);
					assert.strictEqual(nic.length, 1);
					done();
				});
			});
		});

		describe('success if status is Missing', function() {
			let target;
			let nicID;

			before(() => {
				return setupEnvironment()
					.then(() => target = targets[0])
					.then(() => {
						return new Promise((resolve, reject) => {
							serverCollection.updateOne(
								{ node_id: target._id },
								{ $set: { 'nics.0.status': 'Missing' } },
								(err) => {
									if (err)
										return reject(err);

									resolve();
								}
							);
						});
					});
			});

			it('operation should return success', (done) => {
				serverCollection.findOne({ node_id: target._id }, (err, t) => {
					assert(!err);
					nicID = t.nics[0].nicID;
					targetModule.deleteNICByIDAndUUID(target._id, target.uuid, nicID, (log) => {
						const result = log.createApiResponse();
						assert(result.success);
						done();
					});
				});
			});

			it('should be removed from the target document in the db', (done) => {
				serverCollection.findOne({ node_id: target._id }, (err, target) => {
					assert(!err);
					target.nics.forEach(nic => {
						assert(nic.nicID != nicID);
					});

					done();
				});
			});

			it('Lock should be released', () => {
				return lockUtils.makeSureLockIsReleased(ZONE_1);
			});
		});
	});

	describe('#Evict Drive', function() {
		this.beforeEach(() => {
			return setupEnvironment();
		});

		it('Fail if Drive not found', function(done) {
			var diskID = 'something';
			var diskUUID = '14add590-b36c-11ed-8eb5-0b54ad2aa109';
			diskModule.evictDiskByDiskIDsAndUUIDs([{ diskID: diskID, uuid: diskUUID }], consts.SYSTEM_USER, false, null, null, null, (logs) => {
				const results = logs.map(l => l.createApiResponse());
				assert(!results[0].success);
				lockUtils.makeSureLockIsReleased(ZONE_1).then(()=>done());
			});
		});

		it('Fail if there is no redundancy', function(done) {
			let diskID = 'SERVER1.1';
			let serverNodeID = 'server1.acme.com';
			// create non-redundant volume
			Promise.resolve()
				.then(() => {
					var v1 = new VolumeConcatenated('v1');
					v1.limitByDisks = [diskID];
					return v1.save();
				})
				.then(() => serverCollection.findOne({ node_id: serverNodeID }, { 'disks.uuid': 1 }))
				.then((server) => {
					let diskUUID = server.disks.find(d => d.diskID === diskID).uuid;
					let disk = { diskID: diskID, uuid: diskUUID };
					diskModule.evictDiskByDiskIDsAndUUIDs([disk], consts.SYSTEM_USER, false, null, null, null, (logs) => {
						const results = logs.map(l => l.createApiResponse());
						assert(!results[0].success);
						serverCollection.findOne({ node_id: 'server1.acme.com' })
							.then(target => {
								// make sure target not deleted
								assert(target);
								// make sure disk not evicted
								assert(target.disks[0].diskID == diskID);
								done();
							});
					});
				})
				.catch(err => done(err));
		});

		it('should succeed', function(done) {
			var diskID;
			var diskUUID;
			var nodeID = 'server1.acme.com';

			serverCollection.findOne({ node_id: nodeID }, (err, target) => {
				assert(!err);
				diskID = target.disks[0].diskID;
				diskUUID = target.disks[0].uuid;
				let disk = { diskID: diskID, uuid: diskUUID };
				diskModule.evictDiskByDiskIDsAndUUIDs([disk], consts.SYSTEM_USER, false, null, null, null, (logs) => {
					const results = logs.map(l => l.createApiResponse());
					assert(results[0].success);

					serverCollection.findOne({ node_id: nodeID }, (err, target) => {
						assert(!err);
						assert(target.disks[0].isOutOfService);
						lockUtils.makeSureLockIsReleased(ZONE_1)
							.then(() => done());
					});
				});
			});
		});
	});

	describe('#Evict Drive - RAID1 with 2 mirrors', function() {
		let volume;
		let volumeCollection;
		let evictTargets;

		beforeEach(() => {
			return setup.newSetup()
				.then(() => Promise.all([
					generateTarget('server1.acme.com').save(),
					generateTarget('server2.acme.com').save(),
					generateTarget('server3.acme.com').save(),
				]))
				.then(savedTargets => { evictTargets = savedTargets; })
				.then(() => {
					volumeCollection = app.get('db').collection('volume');
					volume = new VolumeRAID1With2Mirrors('r1_2m_evict');
					return volume.save();
				})
				.then(result => assert(result.success, 'Failed to create volume'))
				.then(() => volumeCollection.findOne({ _id: volume.name }))
				.then(dbVol => reportAllSegmentsOnline(dbVol, evictTargets[0]));
		});

		function setSegmentsDead(deadSegmentIndices) {
			const $set = {};
			deadSegmentIndices.forEach(i => {
				$set[`chunks.0.pRaids.0.diskSegments.${i}.status`] = consts.diskSegmentStatuses.DEAD;
				$set[`chunks.0.pRaids.0.diskSegments.${i}.isDead`] = true;
			});
			return volumeCollection.updateOne({ _id: volume.name }, { $set });
		}

		function evictFirstSegmentAndAssert(expectSuccess, message, done) {
			volumeCollection.findOne({ _id: volume.name }, (err, dbVol) => {
				assert(!err);
				const segment = dbVol.chunks[0].pRaids[0].diskSegments[0];
				const disk = { diskID: segment.diskID, uuid: segment.diskUUID };

				diskModule.evictDiskByDiskIDsAndUUIDs([disk], consts.SYSTEM_USER, false, null, null, null, (logs) => {
					const results = logs.map(l => l.createApiResponse());
					assert.strictEqual(!!results[0].success, expectSuccess, message);
					lockUtils.makeSureLockIsReleased(ZONE_1).then(() => done());
				});
			});
		}

		it('Should allow evict when all other segments are healthy', (done) => {
			evictFirstSegmentAndAssert(true, 'Expected evict to succeed', done);
		});

		it('Should allow evict when 1 other segment is dead but 1 is still healthy', (done) => {
			setSegmentsDead([1]).then(() =>
				evictFirstSegmentAndAssert(true, 'Expected evict to succeed with 1 healthy copy remaining', done));
		});

		it('Should block evict when all other segments are dead', (done) => {
			setSegmentsDead([1, 2]).then(() =>
				evictFirstSegmentAndAssert(false, 'Expected evict to be blocked', done));
		});

		it('Should block evict when all segments including the evicted one are dead', (done) => {
			setSegmentsDead([0, 1, 2]).then(() =>
				evictFirstSegmentAndAssert(false, 'Expected evict to be blocked when all segments are dead', done));
		});
	});

	describe('#Race Conditions', () => {
		describe('#Race between delete target and TOMA keepalive with tomaToken > 1', () => {
			/*
			Race example:
			* TOMA > MGMT keepalive with token 2
			* MGMT delete target
			* TOMA > MGMT keepalive with token 2 (before getting the deleteTarget message)
			* target not found in DB -> insert new partial target with token 1
			* MGMT > TOMA updateKAToken with token 1
			* TOMA refuse to adapt the token since it had a bigger token 2 (and 1 < 2)

			Solution: Adapt Toma token from keepalive message if Target does not exist in DB and token was not -1
			*/

			describe('#Zones do not exists', () => {
				let nodeID = 'test.multi.zones';
				let target = generateTarget(nodeID);

				before(() => {
					return setupEnvironment()
						.then(() => target.save().then(t => t.setZone('1')))
						.then(() => serverCollection.findOne({ _id: nodeID }))
						.then(dbTarget => {
							assert(dbTarget);
							assert.strictEqual(target.nics.length, dbTarget.nics.length);
							assert.strictEqual(target.disks.length, dbTarget.disks.length);
						});
				});

				it('should simulate TOMA restart and increase token to be > 1', () => {
					target.tomaToken = -1;

					return target.sendKeepAlive()
						.then(() => serverCollection.findOne({ _id: nodeID }))
						.then(dbTarget => {
							assert(dbTarget.tomaToken > 1);
							target.tomaToken = dbTarget.tomaToken;
						});
				});

				it('should delete target', () => {
					return new Promise((resolve) => {
						targetModule.deleteTargets([{ _id: target._id, uuid: target.uuid }], false, (logs) => {
							const results = logs.map(l => l.createApiResponse());
							assert(results[0].success);
							serverCollection.findOne({ _id: nodeID }, (err, res) => {
								assert(!res);
								resolve();
							});
						});
					});
				});

				it('should get updateKeepalive token with token 2 and answer to KA', () => {
					return target.sendKeepAlive()
						.then(() => target.readMessageFromCommandsTopic()) // resend report
						.then(() => target.readMessageFromCommandsTopic()) // updateTOMAKAToken old
						.then(() => target.readMessageFromCommandsTopic())
						.catch(err => assert(err.toString().includes('timed-out waiting for Kafka Message topic: test.multi.zones.TOMA.commands')));
				});

				it.skip('should send updateTOMAKAToken with correct token and targetUpdatesSequence after setZone', () => {
					return target._addToZone('1')
						.then(() => target.readMessageFromCommandsTopic()) // updateTOMAKAToken with token 2 (original queue was deleted after target deletion)
						.then(msg => {
							assert.strictEqual(msg.type, consts.kafkaMessageTypes.ManagementToTOMA.updateTomaKeepaliveToken);
							assert.strictEqual(msg.token, 2);
						});
				});
			});
		});
		describe('#Race Adding two targets', () => {
			const zoneID = '1';

			let targetALeader = generateTarget('targetA');
			let targetB = generateTarget('targetB');
			let targetC = generateTarget('targetC');

			before(async() => {
				let opts = new SetupOptions().setEnableZones(true);
				await setup.newSetup(opts);
				log.debug('enableZones: ' + app.get('globalSettings').enableZones);
				await targetALeader.save().then(t => t.setZone(zoneID));
				await targetB.save();
				await targetC.save();

			});

			async function setTargetsZone(targets, zone) {
				return new Promise((resolve, reject) => {
					targetModule.setZone(targets.map(target => ({ _id: target.node_id, uuid: target.uuid })), zone, (results) => {

						let errors = [];
						results.forEach(r => {
							if (r.systemMessage.id !== systemMessages.SET_ZONE_SUCCESS.id)
								errors.push(r);
						});

						if (errors.length)
							return reject(new Error('SetZone failed', errors));

						resolve(results);
					});
				});
			}

			it('should send 2 AddTarget messages to the leader', async() => {

				let promise = setTargetsZone([targetB, targetC], zoneID);
				await promise;

				const targetUpdatesTopic = await new Promise(resolve => getIncrementalTargetUpdatesTopic(zoneID, resolve));
				let q = await getOrCreateQueue(targetUpdatesTopic);
				let messagesToLeader = q.q;

				assert(messagesToLeader.length, 2);

				let lastMsgPerTarget = {};
				messagesToLeader.forEach(msg => {
					// we should only get addTarget msgs
					assert(msg.type, consts.kafkaMessageTypes.ManagementToTOMA.addTarget);

					if (!lastMsgPerTarget[msg.nodeID])
						lastMsgPerTarget[msg.nodeID] = msg;
					else if (lastMsgPerTarget[msg.nodeID].targetUpdatesSequence < msg.taretUpdatesSequence)
						lastMsgPerTarget[msg.nodeID] = msg;
				});


				// each target get an updated msg with a different targetUpdatesSequence and targetsInZone
				assert.notEqual(lastMsgPerTarget[targetB.node_id].targetUpdatesSequence, lastMsgPerTarget[targetC.node_id].targetUpdatesSequence);
				assert.notEqual(lastMsgPerTarget[targetB.node_id].targetsInZone, lastMsgPerTarget[targetC.node_id].targetsInZone);
				console.log('finished');
			});
		});
	});

	describe('Drive Relocation Violation Alerts', function() {
		let logCollection;

		const violationHeader = systemMessages.TARGET_DRIVE_RELOCATION_CAUSED_SEPARATION_VIOLATION.header;
		const resolutionHeader = systemMessages.TARGET_DRIVE_RELOCATION_RESOLVED_SEPARATION_VIOLATION.header;
		const NO_LOG_EXPECTED_WAIT_MS = 2000;
		const MAX_LOG_POLL_RETRIES = 20;
		const LOG_POLL_INTERVAL_MS = 100;

		async function setupRelocationEnvironment(numTargets) {
			await setup.newSetup(new SetupOptions().setEnableMongoLog(true));
			targets = [];
			for (let i = 0; i < numTargets; i++)
				targets.push(await generateTarget(`reloc-server${i + 1}.acme.com`, 1).save());
			serverCollection = app.get('db').collection('server');
			logCollection = app.get('db').collection('log');
		}

		async function setupWithVolume(numTargets, volume) {
			await setupRelocationEnvironment(numTargets);
			const result = await volume.save();
			assert(result.success, 'Volume creation failed: ' + JSON.stringify(result.err));
		}

		async function setupDomainEnvironment(numTargets, domainScope, volume) {
			await setupRelocationEnvironment(numTargets);
			for (let i = 0; i < targets.length; i++) {
				const targetClass = new TargetClass(`${domainScope.toLowerCase()}-${i}`, [targets[i].node_id]);
				targetClass.domains = [{ scope: domainScope, identifier: `${domainScope}-${i}` }];
				await targetClass.save();
			}
			const vol = volume();
			vol.domain = domainScope;
			const result = await vol.save();
			assert(result.success, 'Volume creation failed: ' + JSON.stringify(result.err));
		}

		async function findDiskWithSegments(nodeID) {
			const server = await serverCollection.findOne({ _id: nodeID });
			return server.disks.find(d => d.diskSegments && d.diskSegments.length > 0);
		}

		async function relocateDisk(sourceTarget, destTarget, diskID, { expectLog = true } = {}) {
			const countBefore = await logCollection.countDocuments({ 'meta.header': { $in: [violationHeader, resolutionHeader] } });
			const disk = await sourceTarget.removeDiskAndReport(diskID);
			await destTarget.addDiskAndReport(disk);

			if (expectLog)
				await waitForNewLogEntry(countBefore);
			else
				await new Promise(resolve => setTimeout(resolve, NO_LOG_EXPECTED_WAIT_MS));
		}

		async function waitForNewLogEntry(countBefore) {
			for (let i = 0; i < MAX_LOG_POLL_RETRIES; i++) {
				const count = await logCollection.countDocuments({
					'meta.header': { $in: [violationHeader, resolutionHeader] }
				});
				if (count > countBefore) return;
				await new Promise(resolve => setTimeout(resolve, LOG_POLL_INTERVAL_MS));
			}
			const totalWaitMs = MAX_LOG_POLL_RETRIES * LOG_POLL_INTERVAL_MS;
			throw new Error(`waitForNewLogEntry: no new log entry after ${MAX_LOG_POLL_RETRIES} retries (${totalWaitMs}ms)`);
		}

		async function findViolationLogs(header, separationLevel) {
			const query = { 'meta.header': header };
			if (separationLevel)
				query.message = { $regex: `volumeSeparationLevel: ${separationLevel}` };
			return logCollection.find(query).toArray();
		}

		async function relocateAndExpectViolation(sourceIdx, destIdx, separationLevel) {
			const diskWithSegments = await findDiskWithSegments(targets[sourceIdx].node_id);
			assert(diskWithSegments, `Expected disk with segments on target ${sourceIdx}`);

			const diskID = diskWithSegments.diskID;
			await relocateDisk(targets[sourceIdx], targets[destIdx], diskID);

			const logs = await findViolationLogs(violationHeader, separationLevel);
			assert(logs.length > 0, `Expected ${separationLevel} separation violation`);
			return diskID;
		}

		async function relocateAndExpectResolution(sourceIdx, destIdx, diskID) {
			await relocateDisk(targets[sourceIdx], targets[destIdx], diskID);

			const logs = await findViolationLogs(resolutionHeader);
			assert(logs.length > 0, 'Expected violation resolution');
		}

		async function relocateAndExpectNoViolation(sourceIdx, destIdx, separationLevel) {
			const diskWithSegments = await findDiskWithSegments(targets[sourceIdx].node_id);
			assert(diskWithSegments, `Expected disk with segments on target ${sourceIdx}`);

			await relocateDisk(targets[sourceIdx], targets[destIdx], diskWithSegments.diskID, { expectLog: false });

			const logs = await findViolationLogs(violationHeader, separationLevel);
			assert.strictEqual(logs.length, 0, 'No violation expected');
		}

		describe('Node separation -- Mirrored RAID-1', function() {
			let relocatedDiskID;
			before(() => setupWithVolume(2, new VolumeRAID1('r1-node-test')));

			it('should detect violation when mirror relocated to same node', async function() {
				relocatedDiskID = await relocateAndExpectViolation(0, 1, consts.volumeSeparationLevels.NODE);
			});

			it('should resolve violation when disk relocated back', async function() {
				await relocateAndExpectResolution(1, 0, relocatedDiskID);
			});
		});

		describe('Node separation -- Mirrored RAID-1 with ignoreNodeSeparation', function() {
			before(() => {
				const vol = new VolumeRAID1('r1-ignore-sep-test');
				vol.ignoreNodeSeparation = true;
				return setupWithVolume(2, vol);
			});

			it('should not alert when ignoreNodeSeparation is true', async function() {
				await relocateAndExpectNoViolation(0, 1);
			});
		});

		describe('Node separation -- Mirrored RAID-1 with protectionLevel Full', function() {
			let relocatedDiskID;
			before(() => setupWithVolume(3, new VolumeRAID1With2Mirrors('r1-pl-full-test')));

			it('should detect violation when mirror relocated to same node', async function() {
				relocatedDiskID = await relocateAndExpectViolation(0, 1, consts.volumeSeparationLevels.NODE);
			});

			it('should resolve violation when disk relocated back', async function() {
				await relocateAndExpectResolution(1, 0, relocatedDiskID);
			});
		});

		describe('Node separation -- Mirrored RAID-1 with protectionLevel Ignore', function() {
			before(() => {
				const vol = new VolumeRAID1With2Mirrors('r1-pl-ignore-test');
				vol.protectionLevel = consts.separationTypes.IGNORE;
				return setupWithVolume(3, vol);
			});

			it('should not alert when protectionLevel is Ignore', async function() {
				await relocateAndExpectNoViolation(0, 1);
			});
		});

		describe('Node separation -- Mirrored RAID-1 with protectionLevel Minimal (numberOfMirrors=2)', function() {
			let secondRelocatedDiskID;
			before(() => setupWithVolume(3, new VolumeRAID1With2MirrorsMinimal('r1-pl-minimal-test')));

			it('should not alert when segments on same node <= numberOfMirrors', async function() {
				await relocateAndExpectNoViolation(1, 0, consts.volumeSeparationLevels.NODE);
			});

			it('should alert when segments on same node > numberOfMirrors', async function() {
				secondRelocatedDiskID = await relocateAndExpectViolation(2, 0, consts.volumeSeparationLevels.NODE);
			});

			it('should resolve when disk relocated back', async function() {
				await relocateAndExpectResolution(0, 2, secondRelocatedDiskID);
			});
		});

		describe('Node separation -- EC Full', function() {
			let relocatedDiskID;
			before(() => setupWithVolume(10, new VolumeEC('ec-full-node-test')));

			it('should detect violation when EC segment relocated to same node', async function() {
				relocatedDiskID = await relocateAndExpectViolation(0, 1, consts.volumeSeparationLevels.NODE);
			});

			it('should resolve violation when disk relocated back', async function() {
				await relocateAndExpectResolution(1, 0, relocatedDiskID);
			});
		});

		describe('Node separation -- EC Ignore', function() {
			before(() => {
				const vol = new VolumeEC('ec-ignore-test');
				vol.protectionLevel = consts.separationTypes.IGNORE;
				return setupWithVolume(10, vol);
			});

			it('should not alert when protectionLevel is Ignore', async function() {
				await relocateAndExpectNoViolation(0, 1);
			});
		});

		describe('Node separation -- EC Minimal', function() {
			let secondRelocatedDiskID;
			before(() => {
				const vol = new VolumeEC('ec-minimal-test');
				vol.protectionLevel = consts.separationTypes.MINIMAL;
				vol.parityBlocks = 2;
				vol.dataBlocks = 4;
				return setupWithVolume(6, vol);
			});

			it('should not alert when segments on same node <= parityBlocks', async function() {
				await relocateAndExpectNoViolation(1, 0, consts.volumeSeparationLevels.NODE);
			});

			it('should alert when segments on same node > parityBlocks', async function() {
				secondRelocatedDiskID = await relocateAndExpectViolation(2, 0, consts.volumeSeparationLevels.NODE);
			});

			it('should resolve when disk relocated back', async function() {
				await relocateAndExpectResolution(0, 2, secondRelocatedDiskID);
			});
		});

		describe('Domain separation -- Mirrored RAID-1', function() {
			before(() => setupDomainEnvironment(2, 'Rack', () => new VolumeRAID1('r1-domain-test')));

			let relocatedDiskID;

			it('should detect domain violation when mirror relocated to same domain', async function() {
				relocatedDiskID = await relocateAndExpectViolation(0, 1, consts.volumeSeparationLevels.DOMAIN);
			});

			it('should resolve domain violation when disk relocated back', async function() {
				await relocateAndExpectResolution(1, 0, relocatedDiskID);
			});
		});

		describe('Domain separation -- Mirrored RAID-1 to different domain', function() {
			before(() => setupDomainEnvironment(3, 'Rack', () => new VolumeRAID1('r1-dom-diff-test')));

			it('should not alert when mirror relocated to a different (unused) domain', async function() {
				let sourceIdx = -1;
				let destIdx = -1;
				for (let i = 0; i < targets.length; i++) {
					const disk = await findDiskWithSegments(targets[i].node_id);
					if (disk && sourceIdx < 0)
						sourceIdx = i;
					else if (!disk && destIdx < 0)
						destIdx = i;
				}
				assert(sourceIdx >= 0 && destIdx >= 0, 'Expected one used and one unused target');

				await relocateAndExpectNoViolation(sourceIdx, destIdx);
			});
		});

		describe('Domain separation -- EC Full', function() {
			before(() => setupDomainEnvironment(10, 'Rack', () => {
				const vol = new VolumeEC('ec-full-domain-test');
				vol.protectionLevel = consts.separationTypes.FULL;
				return vol;
			}));

			let relocatedDiskID;


			it('should detect domain violation when EC segment relocated to same domain', async function() {
				relocatedDiskID = await relocateAndExpectViolation(0, 1, consts.volumeSeparationLevels.DOMAIN);
			});

			it('should resolve domain violation when disk relocated back', async function() {
				await relocateAndExpectResolution(1, 0, relocatedDiskID);
			});
		});

		describe('Domain separation -- EC Ignore', function() {
			before(() => setupDomainEnvironment(10, 'Rack', () => {
				const vol = new VolumeEC('ec-ignore-domain-test');
				vol.protectionLevel = consts.separationTypes.IGNORE;
				return vol;
			}));

			it('should not alert when protectionLevel is Ignore', async function() {
				await relocateAndExpectNoViolation(0, 1);
			});
		});
	});
});
