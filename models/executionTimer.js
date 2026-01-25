/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

var logger = require('../logger.js');
var config = require('../modules/config.js');

var isExecutionTimersEnabled = config.get('enableExecutionTimers');

exports.clearExecutionTimers = () => {
	var timedIntervals = app.get('timedIntervals');
	var executionTimers = app.get('executionTimers');

	if (timedIntervals && Object.keys(timedIntervals).length) {
		timedIntervals.isTiming = false;
		app.set('timedIntervals', timedIntervals);
	}

	if (executionTimers && executionTimers.length)
		app.set('executionTimers', []);
};

exports.ExecutionTimer = class ExecutionTimer {
	constructor(id) {
		this.isExecutionTimersEnabled = isExecutionTimersEnabled;
		if (!isExecutionTimersEnabled)
			return;

		var timedIntervals = app.get('timedIntervals');
		var executionTimers = app.get('executionTimers');

		if (!timedIntervals.intervals) {
			this.isTiming = false;
			return;
		}

		this.isTiming = timedIntervals.isTiming;
		this.uuid = id;
		this.id = id.replace(/::.*::/, '');
		this.setFunctionNameAndCaller();

		var callerTiming = this.caller ? this.findCallerInTimedIntervals(timedIntervals) : false;
		var setTimedIntervals = false;

		if (callerTiming && !callerTiming.intervals[this.functionName]) {
			this.initTimedInterval(callerTiming);
			setTimedIntervals = true;
		} else if (!(timedIntervals.intervals[this.functionName] || this.caller)) {
			this.initTimedInterval(timedIntervals);
			setTimedIntervals = true;
		}

		if (setTimedIntervals)
			app.set('timedIntervals', timedIntervals);

		// do not push exection timers, if not currently timing
		if (this.isTiming) {
			if (!executionTimers)
				executionTimers = [];

			executionTimers.push(this);
			app.set('executionTimers', executionTimers);

			this.startTimer(this);
		}
	}

	setFunctionNameAndCaller() {
		var splittedId = this.id.split('.');
		if (splittedId.length === 1) {
			this.caller = null;
			this.functionName = splittedId[0];
		} else {
			var callerAndFunctionName = splittedId.splice(-2);
			this.caller = callerAndFunctionName[0];
			this.functionName = callerAndFunctionName[1];
		}
	}

	findCallerInTimedIntervals(timedIntervals) {
		var intervals = timedIntervals.intervals;
		var keys = Object.keys(intervals);

		if (keys.indexOf(this.caller) !== -1)
			return intervals[this.caller];
		else
			for (let key of keys) {
				var result = this.findCallerInTimedIntervals(intervals[key]);
				if (result)
					break;
			}

		return result || false;
	}

	startTimer() {
		this.start = process.hrtime();
	}

	stop(success = true) {
		function convertToMs(seconds, nanoSecondes) {
			return (seconds * 1000) + (nanoSecondes / 1000000);
		}

		if (!this.isExecutionTimersEnabled || !this.isTiming)
			return;

		var endTime = process.hrtime(this.start);
		var time = convertToMs(...endTime);

		this.updateTimedIntervals(time, success);
	}

	updateTimedIntervals(time, success) {
		var timedIntervals = app.get('timedIntervals');
		logger.sysDEBUG('it took me: ' + time + ' ms to handle ' + (!success ? 'failed ' : '') + this.uuid);

		if (this.caller)
			var callerInterval = this.findCallerInTimedIntervals(timedIntervals);

		this.timedInterval = this.caller ? callerInterval.intervals[this.functionName] : timedIntervals.intervals[this.functionName];

		if (success)
			this.timedInterval.successCount++;
		else
			this.timedInterval.failCount++;

		this.timedInterval.totalTimeSpent += time;

		this.updateTimeLimit('max', time);
		this.updateTimeLimit('min', time);

		app.set('timedIntervals', timedIntervals);
	}

	initTimedInterval(timedIntervals) {
		timedIntervals.intervals[this.functionName] = {
			id: this.id,
			intervals: {},
			successCount: 0,
			failCount: 0,
			totalTimeSpent: 0,
			maxTime: -1,
			minTime: Number.MAX_SAFE_INTEGER
		};
	}

	updateTimeLimit(limit, time) {
		var key = limit + 'Time';
		var update = (limit === 'max' && this.timedInterval[key] < time) || (limit == 'min' && this.timedInterval[key] > time);

		if (update)
			this.timedInterval[key] = time;
	}
};
