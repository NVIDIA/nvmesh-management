/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');

var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/generalSettings.js',
	type: 'object',
	properties: {
		domain: { type: 'string' },
		MAX_JSON_SIZE: { type: 'integer', minimum: 1 },
		RESERVED_BLOCKS: { type: 'number', exclusiveMinimum: 0 },
		autoLogOutThreshold: { type: 'integer', minimum: 60 },
		keepaliveIntervals: {
			type: 'object',
			properties: {
				MANAGEMENT_AGENT: { type: 'integer', minimum: 1 },
				CLIENT: { type: 'integer', minimum: 1 },
				TOMA: { type: 'integer', minimum: 1 },
				TOMA_LEADER: { type: 'integer', minimum: 1 },
				UPGRADE_AGENT: { type: 'integer', minimum: 1 },
			}
		},
		compatibilityMode: { type: 'boolean' },
		enableLegacyFormatting: { type: 'boolean' },
		enableDistributedRAID: { type: 'boolean' },
		enableZones: { type: 'boolean' },
		forceUpgradeUpToDateComponents: { type: 'boolean' },
		loggingLevel: { enum: [
			consts.loggingLevel.INFO,
			consts.loggingLevel.WARNING,
			consts.loggingLevel.ERROR,
			consts.loggingLevel.DEBUG,
			consts.loggingLevel.VERBOSE,
			consts.loggingLevel.NONE
		] },
		debugComponents: {
			type: 'object',
			properties: {
				lock: { type: 'boolean' },
				events: { type: 'boolean' },
				counters: { type: 'boolean' },
				client: { type: 'boolean' },
				statistics: { type: 'boolean' },
				diskSegments: { type: 'boolean' },
				HA: { type: 'boolean' },
				updatePRaidStatus: { type: 'boolean' },
				kafka: { type: 'boolean' }
			}
		},
		enableNVMf: { type: 'boolean' },
		defaultUnitType: {
			enum: [
				consts.unitType.BINARY,
				consts.unitType.DECIMAL
			]
		},
		cacheUpdateInterval: { type: 'integer', minimum: 1 },
		snapshotAttachTimeout: { type: 'integer', minimum: 1000 },
		snapshotExportTimeout: { type: 'integer', minimum: 1000 },
		zoneRanking: {
			type: 'object',
			properties: {
				fuzziness: { type: 'integer', minimum: 1 },
				criterias: {
					type: 'object',
					properties: {
						segmentsInZone: { type: 'integer', minimum: 1 },
						targetsInZone: { type: 'integer', minimum: 1 },
						avgTimeSpentWaitingForLock: { type: 'integer', minimum: 1 }
					}
				}
			}
		},
		kafka: {
			type: 'object',
			properties: {
				partitionsFactorForManagementTopics: { type: 'integer', minimum: 1 }
			}
		},
		disableOldManagements: { type: 'boolean', const: true },
		thinProvisioning: {
			type: 'object',
			properties: {
				cdvAlmostFullThresholdPercent: { type: 'integer', minimum: 0, maximum: 100 },
				cdvCriticalThresholdPercent: { type: 'integer', minimum: 0, maximum: 100 }
			}
		}
	}
};

module.exports = scheme;