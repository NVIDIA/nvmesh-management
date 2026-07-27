const { originTypes } = require('../../consts');
var { KafkaMessage } = require('./KafkaMessage');

exports.MessageFromClient = class MessageFromClient extends KafkaMessage {
	constructor(type, version, rawMsg) {
		super(type, version, rawMsg, originTypes.CLIENT);
	}

	deserialize(rawMsg) {
		this.clientID = rawMsg.clientID;
		this.clientToken = rawMsg.clientToken;
		this.messageSequence = rawMsg.messageSequence;
		this.keepaliveInterval = rawMsg.keepaliveInterval;
		this.isUmClient = rawMsg.isUmClient;

		return rawMsg.payload;
	}

	toJSON() {
		let json = super.toJSON();

		json['clientID'] = this.clientID;
		json['clientToken'] = this.clientToken;
		json['messageSequence'] = this.messageSequence;
		json['keepaliveInterval'] = this.keepaliveInterval;
		json['isUmClient'] = this.isUmClient;
		json['payload'] = this.payload;

		return json;
	}

	getNodeID() {
		return this.clientID;
	}

	getToken() {
		return this.clientToken;
	}
};