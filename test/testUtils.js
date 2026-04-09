/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app,describe,it,before,after,afterEach */

const assert = require('assert');
const { waitForEventOrTimeout } = require('../events.js');
const { setup } = require('./testUtils/setup.js');

const dbManager = require('./testUtils/dbManager.js');
const { callFunctionWithDebouncer, clearFunctionDebouncer } = require('../utils.js');

describe('Test Utils', function() {
	before(() => {
		return dbManager.connect();
	});

	after(() => {
		dbManager.closeConnection();
	});

	describe('Test Events', function() {
		before(() =>{
			return dbManager.connect()
				.then(() => setup.newSetup());
		});

		after(() => {
			return dbManager.closeConnection();
		});

		it('Should call the callback once', (done) => {
			function callback(err, payload) {
				assert(!err);
				assert(payload);
				assert.strictEqual(payload.hello, 'test');
				done(err);
			}

			waitForEventOrTimeout('my-event', 20, callback);

			let emitter = app.get('eventEmitter');
			emitter.emit('my-event', { hello: 'test' });
		});

		it('Should send an error timeout', (done) => {
			function callback(err, payload) {
				assert(err);
				assert(!payload);
				done();
			}

			waitForEventOrTimeout('my-event', 20, callback);
		});
	});


	describe('Test Function Debouncer', () => {
		let id = 'nvme500_token';
		let failTimeout = null;

		afterEach(() => {
			clearFunctionDebouncer(id);
		});

		it('Function should be called immediately', (done) => {
			// if not finished in time fail
			failTimeout = setTimeout(() => { assert(false); }, 0);

			let sendMsgFunc = () => {
				clearTimeout(failTimeout);
				done();
			};

			let minWait = 5000;
			callFunctionWithDebouncer(sendMsgFunc, id, minWait);
		});

		it('Function should be called when timed-out', (done) => {
			let minWait = 30;
			let finished = 0;

			// if not finished in time fail
			failTimeout = setTimeout(() => { done(new Error('Function never called again')); }, 40);

			let sendMsgFunc = () => {
				finished++;

				if (finished == 2) {
					clearTimeout(failTimeout);
					done();
				}
			};

			callFunctionWithDebouncer(sendMsgFunc, id, minWait);
			callFunctionWithDebouncer(sendMsgFunc, id, minWait);
		});

		it('Function should only be called once', (done) => {
			let minWait = 5000;
			let finished = 0;

			// verify only one finished !
			failTimeout = setTimeout(() => {
				if (finished > 1)
					done(new Error('Too many calls: ' + finished));
				else
					done();
			}, 30);

			let sendMsgFunc = () => { finished++; };

			for (var i = 0; i < 100; i++) {
				callFunctionWithDebouncer(sendMsgFunc, id, minWait);
			}
		});
	});
});
