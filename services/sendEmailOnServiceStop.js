/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* eslint no-console: "off" */
var config = require('../modules/config.js');
var logger = require('../logger.js');
const { logToConsole } = require('../logger.js');
const consts = require('../consts.js');


var emailAddr = config.get('serviceStopNotificationEmail');

if (emailAddr) {
	var currentDate = (new Date()).toString();
	logger.logToConsole('NVMesh management was stopped on: ' + currentDate + ', sending notification email to: ' + emailAddr);

	logger.sendMail([emailAddr], 'NVMesh management stopped', 'NVMesh management service was stopped on: ' + currentDate, function(err) {
		if (err)
			logToConsole('Error while trying to send service stop notification email. ' + err), consts.logsLevel.ERROR;
	});
}