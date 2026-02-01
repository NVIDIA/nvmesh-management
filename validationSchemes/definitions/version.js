/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const schema = {
	$id: 'http://management/definitions/version.js',
	type: 'string',
	pattern: '^[a-zA-Z0-9_.-]+$'
};

module.exports = schema;