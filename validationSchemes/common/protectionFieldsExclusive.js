/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

//protectionLevel and legacy ignoreNodeSeparation must not both be present
const protectionFieldsExclusive = {
	anyOf: [
		{ not: { required: ['ignoreNodeSeparation'] } },
		{ not: { required: ['protectionLevel'] } }
	]
};

module.exports = { protectionFieldsExclusive };
