const { websocketMessageTypes } = require('../../consts');
const { WebsocketMessage } = require('./websocketMessage');

exports.EventResponse = class EventResponse extends WebsocketMessage {
	constructor(eventName, eventPayload, registrant, type = websocketMessageTypes.eventResponse, version = 1) {
		super(type, version, registrant);

		this.payload = {
			eventName: eventName,
			payload: eventPayload
		};
	}

	/**
	 * Casts a WebsocketMessage to a LoginMessage
	 * @param {WebsocketMessage} m - The WebsocketMessage.
	 * @returns {EventResponse} A EventResponse.
	 */
	static fromObject(m) {
		return Object.assign(new EventResponse(), m);
	}
};