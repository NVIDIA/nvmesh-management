const { websocketMessageTypes } = require('../../consts');
const { WebsocketMessage } = require('./websocketMessage');

exports.LoginResponse = class LoginResponse extends WebsocketMessage {
	constructor(success, error, accessToken, registrant, type = websocketMessageTypes.loginResponse, version = 1) {
		super(type, version, registrant);

		this.payload = {
			success: success,
			accessToken: accessToken
		};

		if (error)
			this.payload.error = error;
	}


	/**
	 * Casts a WebsocketMessage to a LoginMessage
	 * @param {WebsocketMessage} m - The WebsocketMessage.
	 * @returns {LoginResponse} A LoginMessage.
	 */
	static fromObject(m) {
		return Object.assign(new LoginResponse(), m);
	}
};