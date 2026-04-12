/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { MessageFromTOMA } = require('./MessageFromTOMA');
const { kafkaMessageTypes } = require('../../consts');

// Received TOMA → management when CDV.allocator finds fewer than 10% of extents free.
// Management responds by triggering the CDV extend flow.
exports.CDVCapacityWarning = class CDVCapacityWarning extends MessageFromTOMA {
	constructor(rawMsg) {
		super(kafkaMessageTypes.TOMAToManagement_TP.cdvCapacityWarning, 1, rawMsg);
	}

	// payload shape: { cdvUUID: string, usedExtents: number, totalExtents: number }
	get cdvUUID()      { return this.payload.cdvUUID; }
	get usedExtents()  { return this.payload.usedExtents; }
	get totalExtents() { return this.payload.totalExtents; }
};
