/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Sent TOMA → management after the per-CDV handler completes (floor raise +
// reg_ctx termination + drain). Management aggregates ACKs across all TOMAs
// serving the CDV before clearing EVICTING and running cleanupDB.
//
// Parse-only: this module exposes a static parse() that normalizes the payload
// shape for the router; management does not construct outgoing instances.
exports.PreemptClientFromCDVResponse = class PreemptClientFromCDVResponse {
	static parse(payload) {
		return {
			tomaID: payload.tomaID || null,
			cdvUUID: payload.cdvUUID,
			clientID: payload.clientID,
			newFloor: payload.newFloor,
			success: !!payload.success,
			error: payload.error || null,
			terminatedRegistrants: payload.terminatedRegistrants || 0,
		};
	}
};
