/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { kafkaMessageTypes } = require('../../../consts');
const { MessageFromAgent } = require('../../../models/kafkaMessages/MessageFromAgent');
const { AgentMessageBuilder } = require('./agentMessageBuilder');
const versionForAPI = 1;

// This message is response for updateConfigProfile message from the management
exports.ConfigProfileUpdated = class ConfigProfileUpdated extends MessageFromAgent {
	constructor(rawMsg) {
		super(kafkaMessageTypes.AgentToManagement.configProfileUpdated, versionForAPI, rawMsg);
		this.payload = {
			configProfileInfo: {
				id: '',
				name: '',
				version: 0
			}
		};
	}
};

exports.ConfigProfileUpdatedBuilder = class ConfigProfileUpdatedBuilder extends AgentMessageBuilder {
	constructor(clientID) {
		let rawMsg = {
			clientID: clientID,
			payload: {
				configProfileInfo: {
					id: 'cluster_default',
					name: 'Cluster Default',
					version: 5
				}
			}
		};

		let msg = new exports.ConfigProfileUpdated(rawMsg);
		super(msg);
	}

	setProfileInfo(profileInfo) {
		this.msg.payload.configProfileInfo = profileInfo;
		return this;
	}

	static fromClient(client) {
		const builder = new ConfigProfileUpdatedBuilder(client.id);
		builder.updateDataFromClient(client);
		builder.setProfileInfo(client.configProfile);
		client.agentMessageSequence++;
		builder.messageSequence = client.agentMessageSequence;
		return builder;
	}
};