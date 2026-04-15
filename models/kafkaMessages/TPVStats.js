/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { MessageFromClient } = require('./MessageFromClient');
const { kafkaMessageTypes } = require('../../consts');

// Received client management agent → management once per keepalive cycle.
// Carries per-TPV allocator statistics read from /proc/nvmeibc/tpv/*/allocator.
exports.TPVStats = class TPVStats extends MessageFromClient {
	constructor(rawMsg) {
		super(kafkaMessageTypes.ClientToManagement.tpvStats, 1, rawMsg);
	}

	// payload shape: { tpvs: [{ tpvUUID, cdvExtents, tpvExtentsInUse, tpvExtentsTotal }] }
	get tpvs() { return this.payload.tpvs || []; }
};
