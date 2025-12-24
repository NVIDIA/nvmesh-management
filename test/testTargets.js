/* global app,log,describe,before,beforeEach,it,after */

const assert = require('assert');

const dbManager = require('./testUtils/dbManager.js');
const targetModule = require('../modules/target.js');
const consts = require('../consts.js');
const diskModule = require('../modules/disk.js');
const lockUtils = require('./testUtils/lockUtils.js');
const { setup, SetupOptions } = require('./testUtils/setup.js');
const { generateTarget } = require('./testUtils/entityGenerators.js');
const { VolumeConcatenated } = require('./models/volume.js');
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
			targets = [
				generateTarget('server1.excelero.com', '1'),
				generateTarget('server2.excelero.com', '2'),
				generateTarget('server3.excelero.com', '3'),
				generateTarget('server4.excelero.com', '4'),
			];
			return Promise.all(targets.map(t => t.save()));
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
		targets = [generateTarget('server1.excelero.com', '1')];
		await Promise.all(targets.map(t => t.save()));
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
			let target = generateTarget(nodeID, '1');
			return target.save()
				.then(() => serverCollection.findOne({ _id: nodeID }))
				.then(dbTarget => {
					assert(dbTarget);
					assert.strictEqual(target.nics.length, dbTarget.nics.length);
					assert.strictEqual(target.disks.length, dbTarget.disks.length);
				});
		});
	});

	describe('#Delete Target', function() {

		describe('Single Target', function() {
			let targetToDelete;

			beforeEach(async() => {
				await setupSingleTargetEnvironment();
				// Add another target to zone 1
				await generateTarget('zone1serverB.excelero.com', '1').save();
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
			let serverNodeID = 'server1.excelero.com';
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
						serverCollection.findOne({ node_id: 'server1.excelero.com' })
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
			var nodeID = 'server1.excelero.com';

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
				let target = generateTarget(nodeID, '1');

				before(() => {
					return setupEnvironment()
						.then(() => target.save())
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
					return target._addToZone()
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

			let targetALeader = generateTarget('targetA', zoneID);
			// we don't set the desired zone so it won't get set by targetA.save()
			let targetB = generateTarget('targetB');
			let targetC = generateTarget('targetC');

			before(async() => {
				let opts = new SetupOptions().setEnableZones(true);
				await setup.newSetup(opts);
				log.debug('enableZones: ' + app.get('globalSettings').enableZones);
				await targetALeader.save();
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
});
