/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

const getFullEventName = (eventName, id) => id ? id + '@' + eventName : eventName;

exports.listenToEvent = function(eventName, id) {
	return new Promise((resolve) => {
		let eventEmitter = app.get('eventEmitter');
		let fullEventName = getFullEventName(eventName, id);
		eventEmitter.on(fullEventName, (e) => {
			resolve(e);
		});
	});
};

exports.listenToEventOnce = function(eventName, id) {
	// return a promise that will be resolved only once on the first time eventName is emitted
	let eventEmitter = app.get('eventEmitter');
	let fullEventName = getFullEventName(eventName, id);

	return new Promise(resolve => {
		function onFirstEvent(data) {
			removeListener();
			resolve(data);
		}

		function removeListener() {
			eventEmitter.removeListener(eventName, onFirstEvent);
		}

		eventEmitter.on(fullEventName, onFirstEvent);
	});
};

exports.listenToEventUpToOnce = function(eventName, id, timeout = 2000) {
	// Resolves if the event is triggered exactly once after the timeout.
	// Throws an error if:
	// 	- The event is triggered more than once.
	//  - The timeout expires before the event is triggered.

	const eventEmitter = app.get('eventEmitter');
	const fullEventName = getFullEventName(eventName, id);

	let eventData;
	let timeoutHandle;
	let triggeredCount = 0;

	return new Promise((resolve, reject) => {
		function onEvent(data) {
			triggeredCount += 1;

			if (triggeredCount > 1) {
				cleanup();
				return reject(new Error(`Event "${fullEventName}" triggered more than once`));
			}

			eventData = data;
		}

		function cleanup() {
			eventEmitter.removeListener(fullEventName, onEvent);
			clearTimeout(timeoutHandle);
		}

		timeoutHandle = setTimeout(() => {
			cleanup();
			
			if (!eventData)
				return reject(new Error(`Timeout: Event "${fullEventName}" was not triggered within ${timeout}ms`));

			resolve(eventData);
		}, timeout);

		eventEmitter.on(fullEventName, onEvent);
	});
};
