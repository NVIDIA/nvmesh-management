/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

const assert = require('assert');
const lockModule = require('../../modules/lock.js');
const { delay } = require('./common.js');

exports.getLockStatus = function(lockID) {
	let lockCollection = app.get('db').collection('lock');
	return new Promise((resolve, reject) => {
		lockCollection.findOne({ _id: lockID }).then(d => {
			if (!d)
				return reject('Lock document not found lockID: ' + lockID);

			resolve(d.status);
		});
	});
};

exports.makeSureLockIsReleased = function(zone, retries) {
	if (retries == null)
		retries = 3;

	return exports.getLockStatus(zone).then(status => {
		if (status != 'unlocked' && retries > 0)
			return delay(50)
				.then(() => exports.makeSureLockIsReleased(zone, retries - 1));

		assert.strictEqual(status, 'unlocked');
	});
};

exports.makeSureLockIsLocked = function(zone) {
	return exports.getLockStatus(zone).then(status => {
		assert.strictEqual(status, 'locked');
	});
};

exports.getAllLockStatuses = function() {
	let lockCollection = app.get('db').collection('lock');
	return new Promise((resolve, reject) => {
		lockCollection.find({}).toArray((err, results) => {
			if (err)
				return reject(err);

			resolve(results);
		});
	});
};

exports.makeSureAllZonesAreReleased = function() {
	return exports.getAllLockStatuses().then(results => {
		let allReleased = results.every((lock) => { return lock.status === 'unlocked'; });
		assert(allReleased);
	});
};

exports.makeSureAllZonesAreLocked = function() {
	return exports.getAllLockStatuses().then(results => {
		let allReleased = results.every((lock) => { return lock.status === 'locked'; });
		assert(allReleased);
	});
};

exports.getAllLocks = function() {
	let lockCollection = app.get('db').collection('lock');
	return new Promise((resolve, reject) => {
		lockCollection.find({}).toArray((err, results) => {
			if (err)
				return reject(err);

			resolve(results);
		});
	});
};

exports.getLockDocument = function(zone) {
	let lockCollection = app.get('db').collection('lock');
	return new Promise((resolve, reject) => {
		lockCollection.findOne({ _id: zone }, (err, doc) => {
			if (err)
				return reject(err);

			resolve(doc);
		});
	});
};

exports.releaseLockByZoneAndVerifyReleased = function(zone) {
	return new Promise((resolve, reject) => {
		lockModule.releaseLockByZone(zone, () => {
			exports.makeSureLockIsReleased(zone).then(resolve).catch(reject);
		});
	});
};