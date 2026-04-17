/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { MessageFromTOMA } = require('./MessageFromTOMA');
const { kafkaMessageTypes } = require('../../consts');

// Sent TOMA → management when a TOMA has been elected as the CDV allocator
// (via RAFT) and requests EXCLUSIVE_READ_WRITE attachment to the CDV's
// satellite (`<CDV>-mgmt`) volume so it can read/write the allocator metadata.
//
// Management replies with AttachSatelliteResponse on the requesting TOMA's
// TOMA_COMMANDS topic.  See nvmesh-kernel/design/SatelliteVolumeForCDVAlloc.md
// Phase 2 for the full protocol.
//
// Payload shape:
//   {
//     cdvUUID:               string,  // parent CDV UUID
//     allocatorTomaHostname: string,  // sender, echoed for validation
//     allocatorGeneration:   number,  // monotonic, from RAFT
//     raftTerm:              number,  // RAFT term at request time
//     requestId:             string,  // client-assigned, idempotent retry key
//   }
exports.AttachSatelliteRequest = class AttachSatelliteRequest extends MessageFromTOMA {
	constructor(rawMsg) {
		super(kafkaMessageTypes.TOMAToManagement_TP.attachSatelliteRequest, 1, rawMsg);
	}

	get cdvUUID() { return this.payload.cdvUUID; }
	get allocatorTomaHostname() { return this.payload.allocatorTomaHostname; }
	get allocatorGeneration() { return this.payload.allocatorGeneration; }
	get raftTerm() { return this.payload.raftTerm; }
	get requestId() { return this.payload.requestId; }
};
