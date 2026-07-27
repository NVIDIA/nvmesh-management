const consts = require('../consts.js');
const { SystemMessage } = require('../modules/error');
const systemMessages = require('../systemMessages');

/* global app */

const isServiceAvailable = (req, res, next) => {
	const settings = app.get('globalSettings');
	const isAcceptHTML = req.headers.accept?.toLowerCase().includes('html');

	if (app.get('isShuttingDown')) {
		const sysMessage = new SystemMessage(systemMessages.SERVICE_SHUTTING_DOWN);

		if (isAcceptHTML) {
			return renderServiceUnavailable(res, sysMessage);
		}

		return res.status(503).json(sysMessage.createApiResponse());
	}

	if (app.get('nonLatestVersion') && settings.disableOldManagements) {
		const sysMessage = new SystemMessage(systemMessages.SERVICE_UPGRADE_MODE);

		if (isAcceptHTML) {
			return renderServiceUnavailable(res, sysMessage);
		}


		return res.status(503).json(sysMessage.createApiResponse());
	}

	next();
};

function renderServiceUnavailable(res, sysMessage) {
	const renderData = {};
	renderData.isReact = true;
	renderData.componentName = consts.componentsPages.serviceUnavailable;
	renderData.additionalData = sysMessage.systemMessage.message;

	return res.render('react', renderData);
}

module.exports = isServiceAvailable;
