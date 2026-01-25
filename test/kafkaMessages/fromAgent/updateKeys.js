/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { kafkaMessageTypes } = require('../../../consts');
const { MessageFromAgent } = require('../../../models/kafkaMessages/MessageFromAgent');
const { AgentMessageBuilder } = require('./agentMessageBuilder');
const versionForAPI = 1;

exports.UpdateKeys = class UpdateKeys extends MessageFromAgent {
	constructor(rawMsg) {
		super(kafkaMessageTypes.AgentToManagement.updateKeys, versionForAPI, rawMsg);
	}
};

exports.UpdateKeysBuilder = class UpdateKeysBuilder extends AgentMessageBuilder {
	constructor(clientID) {
		let rawMsg = {
			clientID: clientID,
			payload: { 
				keys: [ 
					// Example of key data
					// 	{ 
					// 	    'name': 'key_suit', 
					// 		'uuid': 'd0d716f0-538b-11ed-93ad-13f64cec0259', 
					// 		'dbUUID': 'b2e80b50-5079-11ed-b422-6b5b5312f6a2' 
					// 	}
				] 
			}
		};
		
		let msg = new exports.UpdateKeys(rawMsg);
		super(msg);
	}

	addKey(keyData) {
		this.msg.payload.keys.push(keyData.getClientKey());
		return this;
	}

	static fromClient(client) {
		const builder = new UpdateKeysBuilder(client.id);
		builder.updateDataFromClient(client);
		let keys = client.keys || [];
		keys.forEach(keyData => {
			builder.addKey(keyData);
		});
		
		client.agentMessageSequence++;
		builder.messageSequence = client.agentMessageSequence;
		return builder;
	}
};

exports.KeyData = class KeyData {
	constructor(name, uuid, dbUUID) {
		this.name = name;
		this.uuid = uuid;
		this.dbUUID = dbUUID;
	}
};

// exports.createUpdateKeysMessage = function(clientID) {
// 	payload = { 
// 		'keys': [ 
// 			{ 
// 				'name': 'key_suit', 
// 				'uuid': 'd0d716f0-538b-11ed-93ad-13f64cec0259', 
// 				'dbUUID': 'b2e80b50-5079-11ed-b422-6b5b5312f6a2' 
// 			}, 
// 			{ 
// 				'name': 'key_specific', 
// 				'uuid': 'a0d715a3-538b-11ec-93ad-13f64fec234', 
// 				'dbUUID': 'b2e80b50-5079-11ed-b422-6b5b5312f6a2' 
// 			} 
// 		] 
// 	}; 
// 	msg = exports.createAgentMessage(clientID, 'updateKeys', payload);
// 	return msg;
// };
