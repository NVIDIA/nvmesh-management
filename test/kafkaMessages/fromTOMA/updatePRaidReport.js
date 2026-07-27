const { kafkaMessageTypes } = require('../../../consts');
const { MessageFromTOMA } = require('../../../models/kafkaMessages/MessageFromTOMA');
const versionForAPI = 1;

class updatePRaidReport extends MessageFromTOMA {
	constructor(rawMsg) {
		super(kafkaMessageTypes.TOMAToManagament.updatePRaidReport, versionForAPI, rawMsg);
	}
}

exports.updatePRaidReport = updatePRaidReport;