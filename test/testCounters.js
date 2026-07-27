/* global app,log,describe,before,it,after */

const assert = require('assert');

const dbManager = require('./testUtils/dbManager.js');
const { setup, SetupOptions } = require('./testUtils/setup.js');
const { generateTarget } = require('./testUtils/entityGenerators.js');
const { listenToEvent, listenToEventUpToOnce } = require('./testUtils/eventUtils.js');
const { events } = require('../objectNotifier.js');
const consts = require('../consts.js');
const { handleTimedOutComponent } = require('../modules/lastMessageLog.js');
const { deleteTargets, deleteNICByIDAndUUID } = require('../modules/target.js');


class Counter {
	constructor() {
		this.total = 0;
		this.alarm = 0;
		this.critical = 0;
	}

	updateFromChangeEvent(countersChangeEvent) {
		let changes = countersChangeEvent.payload;
		this.total += changes.total;
		this.alarm += changes.alarm;
		this.critical += changes.critical;
	}

	except(total, alarm, critical) {
		assert.strictEqual(this.total, total, 'wrong number of total nic');
		assert.strictEqual(this.alarm, alarm, 'wrong number of alarm nic');
		assert.strictEqual(this.critical, critical, 'wrong number of critical nic');
	}
}

async function setupEnvironment() {
	let opts = new SetupOptions().setEnableZones(true);
	await setup.newSetup(opts);
	log.debug('enableZones: ' + app.get('globalSettings').enableZones);
	log.debug('setupEnvironment finished');
}

describe('Counters', function() {

	before(() => {
		return dbManager.connect();
	});

	after(()=>{
		return dbManager.closeConnection();
	});

	describe('#Test Counters Using Events', function() {
		let targetCounter = new Counter();

		before(async() => {
			await setupEnvironment();
		});

		it('Should show 1 healthy target', async() => {
			let done = listenToEvent(events.serversCountChangeEvent.name)
				.then(e => targetCounter.updateFromChangeEvent(e))
				.then(() => {
					assert.strictEqual(targetCounter.total, 1, 'wrong number of total targets');
					assert.strictEqual(targetCounter.critical, 0, 'wrong number of critical targets');
					assert.strictEqual(targetCounter.alarm, 0, 'wrong number of alarm targets');
				});
            
			let emitter = app.get('eventEmitter');
			let payload = { 
				nodeID: 's1',
				health: consts.targetHealth.HEALTHY,
				health_old: null,
			};
			emitter.emit(events.targetWentOnlineEvent.name, { payload: payload });
			await done;
		});

		it('Should show 2 targets, 1 alarm', async() => {
			let done = listenToEvent(events.serversCountChangeEvent.name)
				.then(e => targetCounter.updateFromChangeEvent(e))
				.then(() => {
					assert.strictEqual(targetCounter.total, 2, 'wrong number of total targets');
					assert.strictEqual(targetCounter.critical, 0, 'wrong number of critical targets');
					assert.strictEqual(targetCounter.alarm, 1, 'wrong number of alarm targets');
				});
            
			let emitter = app.get('eventEmitter');
			let payload = { 
				nodeID: 's1',
				health: consts.targetHealth.ALARM,
				health_old: null,
			};
			emitter.emit(events.targetFailureEvent.name, { payload: payload });
			await done;
		});

		it('Should show 3 targets, 1 alarm, 1 critical', async() => {
			let done = listenToEvent(events.serversCountChangeEvent.name)
				.then(e => targetCounter.updateFromChangeEvent(e))
				.then(() => {
					assert.strictEqual(targetCounter.total, 3, 'wrong number of total targets');
					assert.strictEqual(targetCounter.critical, 1, 'wrong number of critical targets');
					assert.strictEqual(targetCounter.alarm, 1, 'wrong number of alarm targets');
				});
            
			let emitter = app.get('eventEmitter');
			let payload = { 
				nodeID: 's1',
				health: consts.targetHealth.CRITICAL,
				health_old: null,
			};
			emitter.emit(events.targetFailureEvent.name, { payload: payload });

			await done;
		});
	});

	describe('#Test with object flows', function() {
		let targetCounter = new Counter();
		let emitter;
		let t1 = generateTarget('target-1', '1', 2, 2);


		before(async() => {
			await setupEnvironment();
			emitter = app.get('eventEmitter');
			emitter.on(events.serversCountChangeEvent.name, (e) => {
				targetCounter.updateFromChangeEvent(e);
			});
		});

		it('New Target - Should show 1 healthy target', async() => {
			await t1.save();

			assert.strictEqual(targetCounter.total, 1, 'wrong number of total targets');
			assert.strictEqual(targetCounter.critical, 0, 'wrong number of critical targets');
			assert.strictEqual(targetCounter.alarm, 0, 'wrong number of alarm targets');
		});

		it('Target timed-out - Should show 1 critical target', async() => {
			let tomaComponent = {
				_id: { type: consts.originTypes.TOMA, id: t1._id },
				token: t1.tomaToken
			};

			let p = new Promise((resolve, reject)=> {
				handleTimedOutComponent(tomaComponent, err => {
					if (err) return reject(err);
					resolve();
				});
			});

			await p;
            
			assert.strictEqual(targetCounter.total, 1, 'wrong number of total targets');
			assert.strictEqual(targetCounter.critical, 1, 'wrong number of critical targets');
			assert.strictEqual(targetCounter.alarm, 0, 'wrong number of alarm targets');
		});

		it('Target removed - Should show 0 targets, 0 critical', async() => {

			let p = new Promise(resolve=> {
				deleteTargets([{ _id: t1._id, uuid: t1.uuid }], false, (results) => {
					resolve(results);
				});
			});
            
			let results = await p;
			assert(results[0].createApiResponse().success);
            
			assert.strictEqual(targetCounter.total, 0, 'wrong number of total targets');
			assert.strictEqual(targetCounter.critical, 0, 'wrong number of critical targets');
			assert.strictEqual(targetCounter.alarm, 0, 'wrong number of alarm targets');
		});
	});

	describe('Test NIC Counter', () => {
		const nicCounter = new Counter();
		const nodeID = 'rpff';
		const target = generateTarget(nodeID, '1');
		const nicA = target.nics[0];
		const sendReport = async() => {
			target.messageSequence++;
			target.reportID++;
			await target.sendReport();
		};

		before(async() => {
			await setupEnvironment();
		});
		
		it('create new target without nic', async() => {
			target.nics = [];
			await target.save();
		});

		it('add 1 nic and send report', async() => {
			const done = listenToEventUpToOnce(events.nicsCountChangeEvent.name)
				.then(e => nicCounter.updateFromChangeEvent(e))
				.then(() => nicCounter.except(1, 0, 0));

			target.nics.push(nicA);
			await sendReport();
			await done;
		});

		it('remove 1 nic and send report', async() => {
			const done = listenToEventUpToOnce(events.nicsCountChangeEvent.name)
				.then(e => nicCounter.updateFromChangeEvent(e))
				.then(() => nicCounter.except(1, 0, 1));

			target.nics = [];
			await sendReport();
			await done;
		});

		it('delete 1 nic', async() => {
			const done = listenToEventUpToOnce(events.nicRemovedEvent.name)
				// nicRemovedEvent count changed is currently handled on the serverController (UI)
				.then(() => nicCounter.updateFromChangeEvent({ payload: { total: -1, critical: -1, alarm: 0 } })) 
				.then(() => nicCounter.except(0, 0, 0));

			await new Promise(resolve => deleteNICByIDAndUUID(target._id, target.uuid, nicA.nicID, resolve));
			await done;
		});

		it('reappear 1 nic and send report', async() => {
			const done = listenToEventUpToOnce(events.nicsCountChangeEvent.name)
				.then(e => nicCounter.updateFromChangeEvent(e))
				.then(() => nicCounter.except(1, 0, 0));

			target.nics.push(nicA);
			await sendReport();
			await done;
		});		
	});
});

