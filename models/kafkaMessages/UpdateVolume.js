/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { kafkaMessageTypes } = require('../../consts');
const { VolumeMessage } = require('./VolumeMessage');


exports.UpdateVolume = class UpdateVolume extends VolumeMessage {
	constructor(confObj, type = kafkaMessageTypes.ManagementToTOMA.updateVolume, version = 1) {
		super(type, version, confObj);
	}
};
