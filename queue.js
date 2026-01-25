/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var scope = {};

scope.Queue = function(name) {
	this.oldestIndex = 0;
	this.newestIndex = 0;
	this.data = {};
	this.maximumSize = 0;
	this.name = name;
	this.logger = require('./logger.js');
};

scope.Queue.prototype.size = function() {
	return this.newestIndex - this.oldestIndex;
};

scope.Queue.prototype.enqueue = function(value, caller) {
	this.data[this.newestIndex++] = { 'value': value, 'caller': caller };
	if (this.newestIndex - this.oldestIndex > this.maximumSize) {
		this.maximumSize = this.newestIndex - this.oldestIndex;
		this.logger.sysDEBUG('queue: ' + this.name + ' new maximum queue size is ' + this.maximumSize);
		if ((this.maximumSize & (this.maximumSize - 1)) == 0) {
			for (let i = this.oldestIndex; i < this.newestIndex; i++)
				this.logger.sysDEBUG('queue: ' + this.name + ' index: ' + i + ' caller: ' + this.data[i].caller);
		}
	}
};

scope.Queue.prototype.dequeue = function() {
	var retval = null;

	if (this.oldestIndex !== this.newestIndex) {
		retval = this.data[this.oldestIndex];
		delete this.data[this.oldestIndex++];
	} else {
		this.oldestIndex = 0;
		this.newestIndex = 0;
	}

	return retval;
};

scope.Queue.prototype.debug = function() {
	return this;
};

module.exports = scope;
