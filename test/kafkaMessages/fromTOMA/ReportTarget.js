const { kafkaMessageTypes } = require('../../../consts');
const { MessageFromTOMA } = require('../../../models/kafkaMessages/MessageFromTOMA');
const versionForAPI = 1;

exports.ReportTarget = class ReportTarget extends MessageFromTOMA {
	constructor(rawMsg) {
		super(kafkaMessageTypes.TOMAToManagament.reportTarget, versionForAPI, rawMsg);
	}
};