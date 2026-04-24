/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { MessageFromAgent } = require('./MessageFromAgent');
const { kafkaMessageTypes } = require('../../consts');

// Client-agent -> management, published at ~5 s cadence while a TPV
// is attached with isCompaction=true (TPV_Trimming.md Step 4).
// Terminal values of 'state' are 'done', 'failed', 'aborted'.  The
// payload mirrors /proc/nvmeibc/tpv/<n>/compaction on the client
// kernel side.
exports.TPVCompactionStats = class TPVCompactionStats extends MessageFromAgent {
	constructor(rawMsg) {
		super(kafkaMessageTypes.AgentToManagement.tpvCompactionStats, 1, rawMsg);
	}

	// payload shape: { tpvUUID, clientId, state, relocated,
	//                  plannedRelocations, reclaimed }
	get tpvUUID() { return this.payload.tpvUUID; }
	get clientId() { return this.payload.clientId; }
	get state() { return this.payload.state; }
	get relocated() { return this.payload.relocated; }
	get plannedRelocations() { return this.payload.plannedRelocations; }
	get reclaimed() { return this.payload.reclaimed; }
};
