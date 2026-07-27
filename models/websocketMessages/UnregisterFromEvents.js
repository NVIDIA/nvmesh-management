const { websocketMessageTypes } = require('../../consts');
const { WebsocketMessage } = require('./websocketMessage');

exports.UnregisterFromEvents = class UnregisterFromEvents extends WebsocketMessage {
	constructor(events, registrant, acessToken, messageType = websocketMessageTypes.unregisterFromEvents, messageTypeVersion = 1) {
		super(messageType, messageTypeVersion, registrant, acessToken);

		this.payload = {
			events: events
		};
	}

	/**
	 * Casts a WebsocketMessage to a LoginMessage
	 * @param {WebsocketMessage} m - The WebsocketMessage.
	 * @returns {UnregisterFromEvents} A UnregisterFromEvents.
	 */
	static fromObject(m) {
		return Object.assign(new UnregisterFromEvents(), m);
	}
};