/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Promise based delay in Miliseconds
exports.delay = (duration, value) => {
	return new Promise(resolve => {
		setTimeout(resolve.bind(null, value), duration);
	});
};

exports.stubMethod = function(modulePath, methodName, stubFn) {
	const mod = require(modulePath);
	const original = mod[methodName];
	mod[methodName] = stubFn;
	return () => { mod[methodName] = original; };
};

exports.pollUntil = function(conditionFn, intervalMs = 100, timeoutMs = 5000) {
	const start = Date.now();
	return new Promise((resolve, reject) => {
		function check() {
			conditionFn().then(result => {
				if (result)
					return resolve(result);

				if (Date.now() - start > timeoutMs)
					return reject(new Error(`pollUntil timed out after ${timeoutMs}ms`));

				setTimeout(check, intervalMs);
			}).catch(reject);
		}
		check();
	});
};
