/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { SystemMessage } = require('../modules/error');
const systemMessages = require('../systemMessages');

/* global app */

const isServiceAvailable = (req, res, next) => {
	const settings = app.get('globalSettings');
	const isAcceptHTML = req.headers.accept?.toLowerCase().includes('html');

	if (app.get('isShuttingDown')) {
		const sysMessage = new SystemMessage(systemMessages.SERVICE_SHUTTING_DOWN);

		if (isAcceptHTML) {
			const renderData = renderServiceUnavailable(req, sysMessage);
			return res.render('unavailable', renderData);
		}

		return res.status(503).json(sysMessage.createApiResponse());
	}

	if (app.get('nonLatestVersion') && settings.disableOldManagements) {
		const sysMessage = new SystemMessage(systemMessages.SERVICE_UPGRADE_MODE);

		if (isAcceptHTML) {
			const renderData = renderServiceUnavailable(req, sysMessage);
			return res.render('unavailable', renderData);
		}

		return res.status(503).json(sysMessage.createApiResponse());
	}

	next();
};

function renderServiceUnavailable(req, sysMessage) {
	const renderData = {};
	renderData.layout = false;

	renderData.additionalData = sysMessage.systemMessage.message;

	return renderData;
}

module.exports = isServiceAvailable;
