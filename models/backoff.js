/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { EventEmitter } = require('eventemitter3');


exports.BackoffError = class BackoffError extends Error {};
exports.MaxRetriesExceeded = class MaxRetriesExceeded extends exports.BackoffError {};
exports.MaxTimeoutExceeded = class MaxTimeoutExceeded extends exports.BackoffError {};
exports.Backoff = class Backoff extends EventEmitter {
	/**
	 * Backoff Options
	 * @param {Object} [backoffOptions]
	 * @param {int} [backoffOptions.initialBackoff] The initial backoff
	 * @param {int} [backoffOptions.multiplier] The amount to multiply the backoff in each iteration
	 * @param {int} [backoffOptions.maxBackoff] The maximum backoff
	 * @param {int} [backoffOptions.maxRetries] Max retries backoff(callback) will return an error
	 * @param {int} [backoffOptions.maxTimeout] The Maximum timeout in miliseconds

	 */
	constructor(backoffOptions) {
		super();
		backoffOptions = backoffOptions || {};
		this.initialBackoff = backoffOptions.initialBackoff || 100;
		this.multiplier = backoffOptions.multiplier || 2;
		this.maxBackoff = backoffOptions.maxBackoff || 3000;
		this.maxRetries = backoffOptions.maxRetries || null;
		this.maxTimeout = backoffOptions.maxTimeout || null;
		this.currentBackoff = this.initialBackoff;
		this.startTime = null;
		this.retries = 0;
		this.backoffActive = false;
	}

	getNextBackoff() {
		return Math.min(this.currentBackoff * this.multiplier, this.maxBackoff);
	}

	/**
	 * backoff
	 * @param callback
	 */
	backoff(callback) {
		if (this.startTime == null)
			this.startTime = new Date();

		this.retries += 1;
		this.emit('event', { event: 'backoff', message: `backing off for ${this.currentBackoff}ms, retries: ${this.retries}` });
		if (this.maxRetries && this.retries > this.maxRetries)
			return callback(new exports.MaxRetriesExceeded(`Backoff max retries of ${this.maxRetries} exceeded`));

		if (this.maxTimeout && this.getTotalTimeout() > this.maxTimeout)
			return callback(new exports.MaxTimeoutExceeded(`Backoff max timeout of ${this.maxTimeout} exceeded`));

		this.backoffActive = true;
		setTimeout(() => {
			this.emit('event', {
				event: 'backoffFinished',
				message: `backing off finished for ${this.currentBackoff}ms, total: ${this.getTotalTimeout()}ms, retries: ${this.retries}, calling callback`
			});
			this.backoffActive = false;
			callback();
		}, this.currentBackoff);
		this.totalTimeout += this.currentBackoff;
		this.currentBackoff = this.getNextBackoff();
	}

	getTotalTimeout() {
		return new Date() - this.startTime;
	}

	/**
	 * reset
	 * Resets the backoff to intial values
	 */
	reset() {
		this.currentBackoff = this.initialBackoff;
		this.retries = 0;
		this.startTime = null;
		this.emit('event', { event: 'reset', message: 'reset to initial values' });
	}
};
