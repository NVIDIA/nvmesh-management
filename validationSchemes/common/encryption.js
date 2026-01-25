/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const encryptionPropertiesConditions = 		{
	// ensure that if isEncrypted is true, a default encryption is provided
	if: { properties: { isEncrypted: { const: true } }, required: ['isEncrypted'] },
	then: { properties: { encryption: { default: { headerSize: 16 } } } }
};

module.exports = { encryptionPropertiesConditions };