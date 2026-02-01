/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const config = require('../modules/config.js');
const consts = require('../consts.js');
const emailAddr = config.get('serviceStopNotificationEmail');

if (emailAddr) {
	const logger = require('../logger.js'); // It is imported here to avoid circular dependency
	const currentDate = (new Date()).toString();
	logger.logToConsole('NVMesh management was stopped on: ' + currentDate + ', sending notification email to: ' + emailAddr);

	logger.sendMail([emailAddr], 'NVMesh management stopped', 'NVMesh management service was stopped on: ' + currentDate, function(err) {
		if (err)
			logger.logToConsole('Error while trying to send service stop notification email. ' + err), consts.logsLevel.ERROR;
	});
}
