/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global describe,it */

const assert = require('assert');
var async = require('async');

const { Backoff, MaxRetriesExceeded, MaxTimeoutExceeded } = require('../models/backoff.js');

describe('TestBackoff', function() {
	it('Should backoff for at least initial 20', (done) => {
		let backoff = new Backoff({ initialBackoff: 20 });
		let start = new Date();
		backoff.backoff(err => {
			assert(!err);
			let duration = new Date() - start;
			assert(duration > 17 && duration < 23, `Expected 18 < duration > 22 but got duration=${duration}`);
			done();
		});
	});

	it('Should throw error when maxed retries', (done) => {
		let expectedRetries = 3;
		let backoff = new Backoff({ initialBackoff: 1, maxRetries: expectedRetries });
		let shouldContinue = true;
		let retries = 0;
		async.whilst(
			(callback) => callback(null, shouldContinue),
			(cb) => {
				backoff.backoff(err => {
					if (retries == expectedRetries) {
						assert(err, 'Expected an error');
						assert(err instanceof MaxRetriesExceeded);
						return done();
					} else {
						assert(!err, err);
					}
					retries++;
					cb();
				});
			});
	});

	it('Should throw error when max timeout exceeded', (done) => {
		let expectedRetries = 2;
		let backoff = new Backoff({ initialBackoff: 50, maxTimeout: 100 });
		let shouldContinue = true;
		let retries = 0;
		async.whilst(
			(callback) => callback(null, shouldContinue),
			(cb) => {
				backoff.backoff(err => {
					if (retries == expectedRetries) {
						assert(err);
						assert(err instanceof MaxTimeoutExceeded);
						return done();
					} else {
						assert(!err, err);
					}
					retries++;
					cb();
				});
			});
	});

	it('Should reset backoff to intialBackoff', (done) => {
		let initialBackoff = 20;
		let backoff = new Backoff({ initialBackoff: initialBackoff });
		backoff.backoff(err => {
			assert(!err);
			backoff.reset();
			assert.strictEqual(backoff.retries, 0);
			assert.strictEqual(backoff.currentBackoff, initialBackoff);
			done();
		});
	});
});

