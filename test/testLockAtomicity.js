/* global app,log,describe,before,after,it */

const dbManager = require('./testUtils/dbManager.js');
const { setup } = require('./testUtils/setup.js');
const assert = require('assert');
const async = require('async');

const lockModule = require('../modules/lock.js');

var lockAtomicityCollection;

function increaseCounter(increase, multiplier, cb) {
	function run(callback) {
		let jobs = [];

		for (let i = 0; i < increase; i++) {
			jobs.push(
				(callback) => {
					lockModule.acquireLockByZone('1', () => {
						lockAtomicityCollection.findOne({}, (err, lock) => {
							lock.counter += 1;

							lockAtomicityCollection.updateOne({ _id: '1' }, { $set: { counter: lock.counter } }, (err) => {
								if (err)
									log.debug(err);

								lockModule.releaseLockByZone('1', () => {
									callback(err);
								});
							});
						});
					});
				}
			);
		}
		
		async.each(jobs, (func, callback) => {
			func(callback);
		}, callback);
	}

	let jobs = [];

	for (let i = 0; i < multiplier; i++) {
		jobs.push((callback) => { run(callback); });
	}

	async.each(jobs, (func, callback) => {
		func(callback);
	}, cb);
}

describe('TestLock', function() {
	this.timeout(10000);
	before(() => {
		return dbManager.connect().then(() => {
			lockAtomicityCollection = app.get('db').collection('lockAtomicity');

			return lockAtomicityCollection.deleteMany({});
		});
	});

	after(() => {
		dbManager.closeConnection();
	});

	describe('#LockAtomicity', function() {
		before(() => {
			return setup.newSetup();
		});

		before(() => {
			return lockAtomicityCollection.insertOne({
				_id: '1',
				counter: 0
			});
		});

		it('Take lock in parallel', (done) => {
			let count = 200;
			let multiplier = 5;
			increaseCounter(count, multiplier, () => {
				lockAtomicityCollection.findOne({}, (err, lock) => {
					if (err)
						log.debug(err);

					assert.strictEqual(lock.counter, count * multiplier);

					done();
				});
			});
		});
	});
});