/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { MessageFromAgent } = require('./MessageFromAgent');
const { kafkaMessageTypes } = require('../../consts');

// Received management agent → management once per keepalive cycle.
// Carries per-TPV allocator statistics read from /proc/nvmeibc/tpv/*/status.
exports.TPVStats = class TPVStats extends MessageFromAgent {
	constructor(rawMsg) {
		super(kafkaMessageTypes.AgentToManagement.tpvStats, 1, rawMsg);
	}

	// payload shape: { tpvs: [{ tpvUUID, cdvExtents, tpvExtentsInUse, tpvExtentsTotal }] }
	get tpvs() { return this.payload.tpvs || []; }
};
