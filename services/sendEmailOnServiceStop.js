/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/


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