/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { KafkaMessage } = require('./KafkaMessage');
const { kafkaMessageTypes } = require('../../consts');

// Sent management → TOMA when a client is being evicted from a CDV.
// TOMA handler (under per-CDV handler_lock) raises admission_floor to newFloor
// first, then terminates the named client's reg_ctx on every CDV segment.
// The order (floor-first) closes the window where a REGISTER retry could
// re-establish the stale registrant. See TPV_PerClientCDVPreemption.md §2.10.4.
//
// Idempotent: a replay with the same or lower newFloor is a no-op on the floor
// (max_t on TOMA) and a no-op on termination (lookup misses an already-terminated
// client). Management retries this message with exponential backoff on ACK
// timeout.
exports.PreemptClientFromCDV = class PreemptClientFromCDV extends KafkaMessage {
	constructor(clientID, clientUUID, cdvID, cdvUUID, newFloor) {
		super(kafkaMessageTypes.ManagementToTOMA.preemptClientFromCDV, 1);
		this.clientID = clientID;
		this.clientUUID = clientUUID;
		this.cdvID = cdvID;
		this.cdvUUID = cdvUUID;
		this.newFloor = newFloor;
	}

	toJSON() {
		const json = super.toJSON();
		json['payload'] = {
			clientID: this.clientID,
			clientUUID: this.clientUUID,
			cdvID: this.cdvID,
			cdvUUID: this.cdvUUID,
			newFloor: this.newFloor,
		};
		return json;
	}
};
