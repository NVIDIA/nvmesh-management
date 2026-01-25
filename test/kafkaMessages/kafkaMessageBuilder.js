/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


exports.KafkaMessageBuilder = class KafkaMessageBuilder {
	constructor(msg) {
		this.msg = msg;
	}

	build() {
		return this.msg;
	}
};
