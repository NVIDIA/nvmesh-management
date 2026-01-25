/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { kafkaMessageTypes } = require('../../consts');
const { KafkaMessage } = require('./KafkaMessage');

exports.ReservationModeChange = class ReservationModeChange extends KafkaMessage {
	constructor(volumeID, volumeUUID, reservationMode, reservationVersion, type = kafkaMessageTypes.ManagementToTOMA.reservationModeChange, version = 1) {
		super(type, version);

		this.payload = {
			volumeID: volumeID,
			volumeUUID: volumeUUID,
			reservationMode: reservationMode,
			reservationVersion: reservationVersion
		};
	}
};
