/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { kafkaMessageTypes } = require('../../../consts');
const { MessageFromTOMA } = require('../../../models/kafkaMessages/MessageFromTOMA');
const versionForAPI = 1;

class SegmentZeroingProgress extends MessageFromTOMA {
	constructor(rawMsg) {
		super(kafkaMessageTypes.TOMAToManagament.updatePRaidReport, versionForAPI, rawMsg);
	}
}

exports.SegmentZeroingProgress = SegmentZeroingProgress;