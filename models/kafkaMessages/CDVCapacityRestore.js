/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { MessageFromTOMA } = require('./MessageFromTOMA');
const { kafkaMessageTypes } = require('../../consts');

// Received TOMA → management when CDV.allocator's used-extent ratio falls back
// below the hysteresis-clear threshold (NVMEIBT_CDV_WARN_CLEAR_PCT, 85%) after
// a prior CDVCapacityWarning.  Management uses this to clear any latched
// capacity-warning alert that was raised in response to the Warning - without
// it the warning banner remains on the UI until an unrelated reconcile.
exports.CDVCapacityRestore = class CDVCapacityRestore extends MessageFromTOMA {
	constructor(rawMsg) {
		super(kafkaMessageTypes.TOMAToManagement_TP.cdvCapacityRestore, 1, rawMsg);
	}

	// payload shape: { cdvUUID: string, nAllocated: number, totalExtents: number, usedPct: number }
	get cdvUUID() { return this.payload.cdvUUID; }
	get nAllocated() { return this.payload.nAllocated; }
	get totalExtents() { return this.payload.totalExtents; }
	get usedPct() { return this.payload.usedPct; }
};
