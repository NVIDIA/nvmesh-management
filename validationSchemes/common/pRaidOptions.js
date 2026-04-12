/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts.js');

const protectionLevelEnum = { enum: Object.values(consts.separationTypes) };

const pRaidOptionsProperties = {
	stripeSize: { type: 'integer', minimum: 32, default: 32 },
	stripeWidth: { type: 'integer', minimum: 2, default: 2 },
	dataBlocks: { type: 'integer', minimum: 1, maximum: 10, default: 8 },
	parityBlocks: { type: 'integer', minimum: 1, maximum: 2, default: 2 },
	protectionLevel: { ...protectionLevelEnum, default: consts.separationTypes.FULL },
	protectionLevelNoDefault: protectionLevelEnum,
	enableCrcCheck: { type: 'boolean', default: false },
	numberOfMirrors: { type: 'integer', minimum: Math.min(...consts.validNumberOfMirrors), maximum: Math.max(...consts.validNumberOfMirrors), default: 1 },
	ignoreNodeSeparation: { type: 'boolean' },
};

const pRaidOptionsPropertiesByRAIDLevel = {
	[consts.RAIDLevel.ERASURE_CODING]: {
		stripeSize: pRaidOptionsProperties.stripeSize,
		stripeWidth: { ...pRaidOptionsProperties.stripeWidth, minimum: 1, maximum: 1, default: 1 },
		dataBlocks: pRaidOptionsProperties.dataBlocks,
		parityBlocks: pRaidOptionsProperties.parityBlocks,
		protectionLevel: pRaidOptionsProperties.protectionLevel,
		enableCrcCheck: { ...pRaidOptionsProperties.enableCrcCheck, default: true },
	},
	[consts.RAIDLevel.STRIPED_ERASURE_CODING]: {
		stripeSize: pRaidOptionsProperties.stripeSize,
		stripeWidth: pRaidOptionsProperties.stripeWidth,
		dataBlocks: pRaidOptionsProperties.dataBlocks,
		parityBlocks: pRaidOptionsProperties.parityBlocks,
		protectionLevel: pRaidOptionsProperties.protectionLevel,
		enableCrcCheck: { ...pRaidOptionsProperties.enableCrcCheck, default: true },
	},
	[consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10]: {
		stripeSize: pRaidOptionsProperties.stripeSize,
		stripeWidth: pRaidOptionsProperties.stripeWidth,
		numberOfMirrors: pRaidOptionsProperties.numberOfMirrors,
		protectionLevel: pRaidOptionsProperties.protectionLevelNoDefault,
		ignoreNodeSeparation: pRaidOptionsProperties.ignoreNodeSeparation,
		enableCrcCheck: pRaidOptionsProperties.enableCrcCheck,
	},
	[consts.RAIDLevel.STRIPED_RAID_0]: {
		stripeSize: pRaidOptionsProperties.stripeSize,
		stripeWidth: pRaidOptionsProperties.stripeWidth,
	},
	[consts.RAIDLevel.MIRRORED_RAID_1]: {
		numberOfMirrors: pRaidOptionsProperties.numberOfMirrors,
		protectionLevel: pRaidOptionsProperties.protectionLevelNoDefault,
		ignoreNodeSeparation: pRaidOptionsProperties.ignoreNodeSeparation,
		enableCrcCheck: pRaidOptionsProperties.enableCrcCheck,
	},
	[consts.RAIDLevel.CONCATENATED]: {},
};

const pRaidOptionsPropertiesConditions = {
	if: { properties: { RAIDLevel: { const: consts.RAIDLevel.ERASURE_CODING } } },
	then: { properties: pRaidOptionsPropertiesByRAIDLevel[consts.RAIDLevel.ERASURE_CODING] },
	else: {
		if: { properties: { RAIDLevel: { const: consts.RAIDLevel.STRIPED_ERASURE_CODING } } },
		then: { properties: pRaidOptionsPropertiesByRAIDLevel[consts.RAIDLevel.STRIPED_ERASURE_CODING] },
		else: {
			if: { properties: { RAIDLevel: { const: consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10 } } },
			then: { properties: pRaidOptionsPropertiesByRAIDLevel[consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10] },
			else: {
				if: { properties: { RAIDLevel: { const: consts.RAIDLevel.STRIPED_RAID_0 } } },
				then: { properties: pRaidOptionsPropertiesByRAIDLevel[consts.RAIDLevel.STRIPED_RAID_0] },
				else: {
					if: { properties: { RAIDLevel: { const: consts.RAIDLevel.MIRRORED_RAID_1 } } },
					then: { properties: pRaidOptionsPropertiesByRAIDLevel[consts.RAIDLevel.MIRRORED_RAID_1] },
				}
			}
		}
	}
};

module.exports = { pRaidOptionsPropertiesConditions };