/* global app,log,describe,before,it,afterEach,after */

const dbManager = require('./testUtils/dbManager.js');
const assert = require('assert');

const lockModule = require('../modules/lock.js');
const lockUtils = require('./testUtils/lockUtils.js');
const { generateTarget } = require('./testUtils/entityGenerators.js');
const { setup, SetupOptions } = require('./testUtils/setup.js');
const { setEnableZones: setEnabledZones } = require('./testUtils/settingsUtils.js');

const ZONE_1 = '1';
const ZONE_2 = '2';

var lockCollection;
var serverCollection;

function removeLock(lockID) {
	return new Promise((resolve, reject) => {
		lockCollection.deleteOne({ _id: lockID }, (err) => {
			if (err)
				return reject(err);
			resolve();
		});
	});
}

function setupMultiZoneEnvironment() {
	let opts = new SetupOptions().setEnableZones(true);
	return setup.newSetup(opts)
		// Zone 1
		.then(() => generateTarget('nvme81.excelero.com', ZONE_1).save())
		.then(() => generateTarget('nvme82.excelero.com', ZONE_1).save())
		.then(() => generateTarget('nvme83.excelero.com', ZONE_1).save())
		.then(() => generateTarget('nvme84.excelero.com', ZONE_1).save())
		// Zone 2
		.then(() => generateTarget('nvme91.excelero.com', ZONE_2).save())
		.then(() => generateTarget('nvme92.excelero.com', ZONE_2).save())
		.then(() => generateTarget('nvme93.excelero.com', ZONE_2).save())
		.then(() => generateTarget('nvme94.excelero.com', ZONE_2).save())

		.then(() => log.debug('setupZoneLockingEnvironment finished'));
}

//TODO: remove skip when ZoneLocking tests working
describe('ZoneLocking', function() {
	before(() => {
		return dbManager.connect().then(() => {
			lockCollection = app.get('db').collection('lock');
			serverCollection = app.get('db').collection('server');
		});
	});

	after(()=>{
		return dbManager.closeConnection();
	});

	describe('#TakeZone1Lock-EmptyDB', function() {

		before(() => {
			return setupMultiZoneEnvironment().then(() => {
				log.debug('finished setup db');
			}).catch(err => {
				log.debug(err);
			});
		});

		it('Lock should be created with lockCounter 2 and id \'1\'', (done) => {
			lockModule.acquireLockByZone(ZONE_2, () => {
				lockCollection.findOne({ _id: ZONE_2 }, (err, d) => {
					assert.strictEqual(d.lockCounter, 6);
					assert.strictEqual(d._id, ZONE_2);

					done();
				});
			});
		});

		it('Lock should be released', () => {
			return lockUtils.releaseLockByZoneAndVerifyReleased(ZONE_1);
		});
	});

	describe('#RemoveStaleLock', function() {

		before(() => {
			app.set('managementId', 'test');
			app.set('bootVersion', 1);
			return setupMultiZoneEnvironment().then(() => {
				log.debug('finished setup db');
			}).catch(err => {
				log.debug(err);
			});
		});

		it('Lock should be released - acquired by same mgmt in prev boot', (done) => {
			lockModule.acquireLockByZone(ZONE_2, () => {

				lockCollection.findOne({ _id: ZONE_2 }, (err, d) => {
					assert.strictEqual(d.lockCounter, 6);
					assert.strictEqual(d._id, ZONE_2);
					assert.strictEqual(d.handledBy.bootVersion, 1);

					app.set('bootVersion', 2);
					lockModule._zoneLocksCache[ZONE_2] = null;
					lockModule.acquireLockByZone(ZONE_2, () => {
						lockCollection.findOne({ _id: ZONE_2 }, (err, d) => {
							assert.strictEqual(d.lockCounter, 7);
							assert.strictEqual(d.status, 'locked');
							assert.strictEqual(d._id, ZONE_2);
							assert.strictEqual(d.handledBy.bootVersion, 2);
							lockModule.releaseLockByZone(ZONE_2, done);
						});
					});
				});
			});
		});

		it('Lock should be released - acquired by a dead mgmt', (done) => {
			const managementClusterCollection = app.get('db').collection('managementCluster');
			const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);

			managementClusterCollection.findOneAndUpdate(
				{ _id: app.get('managementId') },
				{
					$setOnInsert: {
						_id: app.get('managementId'),
						dateModified: sixMinutesAgo
					}
				},
				{ upsert: true },
				(err) => {
					err;
					lockModule.acquireLockByZone(ZONE_2, () => {

						lockCollection.findOne({ _id: ZONE_2 }, (err, d) => {
							assert.strictEqual(d.lockCounter, 8);
							assert.strictEqual(d._id, ZONE_2);
							assert.strictEqual(d.handledBy.bootVersion, 2);

							app.set('managementId', 'otherMgmt');
							lockModule._zoneLocksCache[ZONE_2] = null;

							lockModule.acquireLockByZone(ZONE_2, () => {
								lockCollection.findOne({ _id: ZONE_2 }, (err, d) => {
									assert.strictEqual(d.lockCounter, 9);
									assert.strictEqual(d.status, 'locked');
									assert.strictEqual(d._id, ZONE_2);
									assert.strictEqual(d.handledBy.bootVersion, 2);
									done();
								});
							});
						});
					});
				});
		});
	});

	describe('#TakeZone2Lock-EmptyDB', function() {
		before(() => {
			return setupMultiZoneEnvironment().then(() => removeLock(ZONE_2));
		});

		it('Lock should be created with lockCounter 2 and id \'2\'', (done) => {
			lockModule.acquireLockByZone(ZONE_2, () => {
				lockCollection.findOne({ _id: ZONE_2 }, (err, d) => {
					assert.strictEqual(d.lockCounter, 2);
					assert.strictEqual(d._id, ZONE_2);

					done();
				});
			});
		});

		it('Lock should be released', () => {
			return lockUtils.releaseLockByZoneAndVerifyReleased(ZONE_2);
		});
	});

	describe('#TakeZoneLockByTargetID', () => {
		const TARGET_ON_ZONE_1 = 'nvme82.excelero.com';
		before(() => {
			let opts = new SetupOptions().setEnableZones(true);
			return setup.newSetup(opts)
				// Set Targets with no zone and we will set the zone later in the test
				.then(() => generateTarget('nvme81.excelero.com', '2').save())
				.then(() => generateTarget('nvme82.excelero.com', '1').save())
				.then(() => generateTarget('nvme83.excelero.com', '2').save())
				.then(() => generateTarget('nvme84.excelero.com', '2').save())
				.then(() => {
					log.debug('setupZoneLockingEnvironment finished');
				});
		});

		it('All targets have zones', (done) => {
			serverCollection.find({}).project({ node_id: 1, zone: 1 }).toArray((err, targets) => {
				var allGood = true;

				targets.forEach((target) => {
					if (target.node_id === TARGET_ON_ZONE_1 && target.zone !== '1' || target.node_id !== TARGET_ON_ZONE_1 && target.zone !== '2')
						allGood = false;
				});

				assert.strictEqual(allGood, true);
				done();
			});
		});

		it('Zone 1 lock should be taken', (done) => {
			lockModule.acquireLockByTarget('nvme82.excelero.com', (err, zone) => {
				assert(!err);
				assert(zone == ZONE_1);
				lockUtils.makeSureLockIsLocked(ZONE_1).then(done);
			});
		});

		it('Zone 1 lock should be released', () => {
			return lockUtils.releaseLockByZoneAndVerifyReleased(ZONE_1);
		});
	});

	describe('#TakeZoneLock-NotEmptyDB', () => {
		it('Lock should be created with lockCounter 5 and id \'1\'', (done) => {
			lockModule.acquireLockByZone(ZONE_1, () => {
				lockCollection.findOne({ _id: ZONE_1 }, (err, d) => {
					assert.strictEqual(d.lockCounter, 5);
					done();
				});
			});
		});

		it('Lock should be released', () => {
			return lockUtils.releaseLockByZoneAndVerifyReleased(ZONE_1);
		});
	});

	describe('#Acquire global lock', function() {
		it('All zones should be locked', (done) => {
			lockModule.acquireGlobalLock(() => {
				lockUtils.makeSureAllZonesAreLocked().catch((err) => assert(!err, err)).finally(done);
			});
		});

		it('All zones should be released', (done) => {
			lockModule.releaseGlobalLock(() => {
				lockUtils.makeSureAllZonesAreReleased().catch((err) => assert(!err, err)).finally(done);
			});
		});
	});

	describe('#Long wait for lock', function() {
		it('Lock zone \'1\'', (done) => {
			lockModule.acquireLockByZone(ZONE_1, () => {
				done();
				setTimeout(() => {
					lockModule.releaseLockByZone(ZONE_1);
				}, 500);
			});
		});

		it('Acquire zone \'1\' again', (done) => {
			lockModule.acquireLockByZone(ZONE_1, () => {
				lockCollection.findOne({ _id: ZONE_1 }, (err, lock) => {
					assert.strictEqual(lock.totalTimeSpentWaitingForLock > 500, true);
					done();
				});
			});
		});

		it('All zones should be released', (done) => {
			lockModule.releaseGlobalLock(() => {
				lockUtils.makeSureAllZonesAreReleased().then(done).catch((err) => assert(!err));
			});
		});
	});

	describe('#Acquire highest ranked zone', () => {
		it('Acquire the zone', (done) => {
			lockModule.acquireZoneLockForAllocation([], [], [], (err, zone) => {
				assert(!err);
				lockModule.getHighestScoredZone([], [], [], (highestRanked) => {
					assert.strictEqual(zone === highestRanked, true);
					return lockModule.releaseLockByZone(ZONE_1, done);
				});
			});
		});
	});

	describe('#Acquire highest ranked zone with limits', () => {
		before(() => {
			return setupMultiZoneEnvironment();
		});

		afterEach(done => {
			return lockModule.releaseLockByZone(ZONE_1, () => {
				lockModule.releaseLockByZone(ZONE_2, done);
			});
		});

		it('Acquire zone 1 by target limit', (done) => {
			lockModule.acquireZoneLockForAllocation(['nvme81.excelero.com'], [], [], (err, zone) => {
				assert.strictEqual(zone, ZONE_1);
				done();
			});
		});

		it('Acquire zone 2 by target limit', (done) => {
			lockModule.acquireZoneLockForAllocation(['nvme91.excelero.com'], [], [], (err, zone) => {
				assert.strictEqual(zone, ZONE_2);
				done();
			});
		});

		it('Acquire zone 1 using disk limit', (done) => {
			lockModule.acquireZoneLockForAllocation([], ['NVME81.1'], [], (err, zone) => {
				assert.strictEqual(zone, ZONE_1);
				done();
			});
		});

		it('Acquire zone 2 using disk limit', (done) => {
			lockModule.acquireZoneLockForAllocation([], ['NVME91.1'], [], (err, zone) => {
				assert.strictEqual(zone, ZONE_2);
				done();
			});
		});

		it('should return zone 2 with multiple disks from different zones', (done) => {
			lockModule.acquireZoneLockForAllocation([], ['NVME81.1', 'NVME91.1', 'NVME92.1'], [], (err, zone) => {
				// zone 2 should have higher score since it is limited for 2 targets and zone 1 is limited to only one.
				assert.strictEqual(zone, ZONE_2);
				done();
			});
		});

		it('No zone meets all conditions, any zone returned - volume creation will fail at the query stage', (done) => {
			lockModule.acquireZoneLockForAllocation(['nvme81.excelero.com'], ['NVME91.1'], [], (err, zone) => {
				assert(zone);
				done();
			});
		});

		it('should acquire lock of ZONE 1 with both target and disk limitations', (done) => {
			lockModule.acquireZoneLockForAllocation(['nvme81.excelero.com'], ['NVME81.1'], [], (err, zone) => {
				assert.strictEqual(zone, ZONE_1);
				done();
			});
		});
	});


	describe('#Acquire zone with limiters with zones disabled', () => {
		let NO_ZONE = null;
		before(() => {
			return setup.newSetup()
				.then(() => setEnabledZones(false))
				.then(() => generateTarget('nvme81.excelero.com', NO_ZONE).save())
				.then(() => generateTarget('nvme82.excelero.com', NO_ZONE).save())
				.then(() => generateTarget('nvme83.excelero.com', NO_ZONE).save())
				.then(() => generateTarget('nvme84.excelero.com', NO_ZONE).save())
				.then(() => log.debug('setupZoneLockingEnvironment finished'));
		});

		afterEach(done => {
			return lockModule.releaseLockByZone(ZONE_1, () => {
				lockModule.releaseLockByZone(ZONE_2, done);
			});
		});

		it('Should acquire zone 1 using disk limit', (done) => {
			lockModule.acquireZoneLockForAllocation([], ['NVME81.1'], [], (err, zone) => {
				assert.strictEqual(zone, ZONE_1);
				done();
			});
		});

		it('Should acquire zone 1 by target limit', (done) => {
			lockModule.acquireZoneLockForAllocation(['nvme81.excelero.com'], [], [], (err, zone) => {
				assert.strictEqual(zone, ZONE_1);
				done();
			});
		});

		it('should acquire zone 1 with both target and disk limitations', (done) => {
			lockModule.acquireZoneLockForAllocation(['nvme81.excelero.com'], ['NVME81.1'], [], (err, zone) => {
				assert.strictEqual(zone, ZONE_1);
				done();
			});
		});
	});
});