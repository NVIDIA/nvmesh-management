const kafkaRouter = require('../../modules/kafkaRouter.js');

exports.sendMessageToManagement = function(message) {

	return new Promise(resolve => {
		let called = false;
		let msgJSON = message.toJSON();
		kafkaRouter.routeMessage(msgJSON, 'topicPlaceholder', 0, '0', err => {
			if (called)
				throw new Error(`BUG: Routing of message ${message.messageType} called the callback multiple times!`);

			called = true;
			resolve(err);
		});
	});
};