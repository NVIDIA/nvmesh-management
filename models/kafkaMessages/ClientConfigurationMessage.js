/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { KafkaMessage } = require('./KafkaMessage');
const { toExternalSegmentStatus } = require('./VolumeMessage.js');

exports.ClientConfigurationMessage = class ClientConfigurationMessage extends KafkaMessage {
	preparePayload(confObj) {
		if (!confObj || !Array.isArray(confObj.volumes))
			return confObj;

		return {
			...confObj,
			volumes: confObj.volumes.map(volume => {
				if (!volume.chunks)
					return volume;

				return {
					...volume,
					chunks: volume.chunks.map(chunk => ({
						...chunk,
						pRaids: (chunk.pRaids || []).map(pRaid => ({
							...pRaid,
							diskSegments: (pRaid.diskSegments || []).map(segment => ({
								...segment,
								status: toExternalSegmentStatus(segment.status)
							}))
						}))
					}))
				};
			})
		};
	}
};
