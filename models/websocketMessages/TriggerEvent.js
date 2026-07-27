const { websocketMessageTypes } = require('../../consts');
const { WebsocketMessage } = require('./websocketMessage');

exports.TriggerEvent = class TriggerEvent extends WebsocketMessage {
	constructor(ids, eventName, eventPayload, registrant, acessToken, messageType = websocketMessageTypes.triggerEvent, messageTypeVersion = 1) {
		super(messageType, messageTypeVersion, registrant, acessToken);

		this.payload = {
			eventIDs: ids,
			eventName: eventName,
			eventPayload: eventPayload
		};
	}

	/**
	 * Casts a WebsocketMessage to a LoginMessage
	 * @param {WebsocketMessage} m - The WebsocketMessage.
	 * @returns {TriggerEvent} A TriggerEvent.
	 */
	static fromObject(m) {
		return Object.assign(new TriggerEvent(), m);
	}
};