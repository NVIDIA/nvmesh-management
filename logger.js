/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */
var Syslog = require('modern-syslog');
var nodemailer = require('nodemailer');
var smtpTransport = require('nodemailer-smtp-transport');
var path = require('path');
var config = require('./modules/config.js');
var nvmeshMetadata = require('./modules/nvmeshMetadata.js');
var objectNotifier = null; //Can't use require here as it depends on logger
var consts = require('./consts.js');
var events = require('./events.js');
var systemMessages = require('./systemMessages.js');
var scope = {};
var { Entities, SystemMessage, MongoError } = require('./modules/error.js');
const openTelemetry = require('./modules/openTelemetry.js');
const { DiagLogLevel, diag } = require('@opentelemetry/api');

let currentSysLogLevel;
scope.logSysMessage;

scope.isEmpty = function(obj) {
	for (var prop in obj) {
		if (Object.prototype.hasOwnProperty.call(obj, prop))
			return false;
	}

	return true;
};

function sysAppendObject(msg, obj) {
	if (obj && !scope.isEmpty(obj))
		msg += ' Data: ' + JSON.stringify(obj);
	else if (obj instanceof Error)
		msg += obj.toString();

	return msg;
}

function getLoggingLevel() {
	var GLOBAL_SETTINGS = app.get('globalSettings');
	var loggingLevel;
	var level = GLOBAL_SETTINGS && GLOBAL_SETTINGS.loggingLevel;

	if (level) {
		switch (level) {
			case consts.loggingLevel.INFO:
				loggingLevel = Syslog.LOG_INFO;
				break;
			case consts.loggingLevel.WARNING:
				loggingLevel = Syslog.LOG_WARNING;
				break;
			case consts.loggingLevel.ERROR:
				loggingLevel = Syslog.LOG_ERR;
				break;
			case consts.loggingLevel.DEBUG:
			case consts.loggingLevel.VERBOSE:
			default:
				loggingLevel = Syslog.LOG_DEBUG;
		}
	} else {
		loggingLevel = Syslog.LOG_INFO;
	}

	return loggingLevel;
}

// Temporarily commented to pass lint - until we finish new logging logic
// function createLogMetaObj(req) {
// 	return {
// 		url: req.baseUrl,
// 		method: req.method,
// 		host: req.headers.host,
// 		referer: req.headers.referer,
// 		userAgent: req.headers['user-agent'],
// 		query: req.query,
// 		params: req.params,
// 		body: req.body,
// 		user: req.user
// 	};
// }

function getTimeForLogging() {
	let date = new Date();

	// format example: Sun, 13 Dec 2020 15:28:34 GMT
	return date.toGMTString() + ' ';
}

scope.logToConsoleWrapper = function(level, msg) {
	scope.logToConsole(msg, level);
};

scope.logToConsole = function(msg, level) {
	let os = require('os');
	let hostname = os.hostname();
	let loggerID = (typeof app === 'undefined') ? consts.SYSLOG_ID : app.get('syslogID');
	let timestamp = getTimeForLogging();
	level = level || 'INFO';

	// format example: Sun, 13 Dec 2020 15:28:34 GMT  Eliotts-MacBook-Pro.local  nvmeshmgr-stats[85675]: INFO Listening on port 4073
	var formattedMsg = timestamp + ' ' + hostname + '  ' + loggerID + '[' + process.pid + ']: ' + level + ' ' + msg;

	switch (level) {
		case 'DEBUG':
			console.debug(formattedMsg);
			break;
		case 'INFO':
			console.info(formattedMsg);
			break;
		case 'WARNING':
			console.warn(formattedMsg);
			break;
		case 'ERROR':
			console.error(formattedMsg);
			break;
	}
};

scope.logSyslog = function(level, msg) {
	const loggingLevel = getLoggingLevel();

	if (!currentSysLogLevel)
		Syslog.open(app.get('syslogID'), Syslog.LOG_PID, Syslog.LOG_LOCAL0);

	if (currentSysLogLevel !== loggingLevel) {
		Syslog.upto(loggingLevel);
		currentSysLogLevel = loggingLevel;
	}

	msg = level + ': ' + msg;

	switch (level) {
		case 'DEBUG':
			Syslog.debug(msg);
			break;
		case 'INFO':
			Syslog.info(msg);
			break;
		case 'WARNING':
			Syslog.warning(msg);
			break;
		case 'ERROR':
			Syslog.error(msg);
			break;
	}
};

scope.logOpenTelemetry = function(level, msg) {
	const winstonLevelToOTEL = {
		'VERBOSE': 'verbose',
		'DEBUG': 'debug',
		'INFO': 'info',
		'WARNING': 'warn',
		'ERROR': 'error'
	};

	const winstonLevel = winstonLevelToOTEL[level] || 'debug';
	openTelemetry.otelLogger.log(winstonLevel, msg);
};

if (config.get('logToConsole')) {
	scope.logSysMessage = scope.logToConsoleWrapper;
} else {
	scope.logSysMessage = scope.logSyslog;
}

// if openTelemetry logger is enabled - log both to syslog and OTEL
if (config.get('openTelemetry.enabled')) {
	scope.logSysMessage = function logToBoth(level, msg) {
		scope.logSyslog(level, msg);
		if (openTelemetry.otelLogger)
			scope.logOpenTelemetry(level, msg);
	};
}

//#1001: logger.sysERROR(\'Unhandled exception: \' + err.stack);

scope.sysVERBOSE = function(component, msg, obj) {
	var GLOBAL_SETTINGS = app.get('globalSettings');
	if (!GLOBAL_SETTINGS || GLOBAL_SETTINGS.loggingLevel !== consts.loggingLevel.VERBOSE)
		return;

	var components = GLOBAL_SETTINGS.debugComponents;
	if (component in components && components[component])
		scope.logSysMessage('DEBUG', sysAppendObject('(' + component + ')' + ':' + msg, obj));
};

scope.sysDEBUG = function(msg, obj) {
	var GLOBAL_SETTINGS = app.get('globalSettings');
	if (!GLOBAL_SETTINGS || ![consts.loggingLevel.DEBUG, consts.loggingLevel.VERBOSE].includes(GLOBAL_SETTINGS.loggingLevel))
		return;

	scope.logSysMessage('DEBUG', sysAppendObject(msg, obj));
};

scope.sysINFO = function(managementError) {
	scope.logSysMessage('INFO', managementError);
};

scope.sysWARNING = function(managementError) {
	scope.logSysMessage('WARNING', managementError);
};

scope.sysERROR = function(managementError) {
	scope.logSysMessage('ERROR', managementError);
};

scope.WARNING = function(managementError) {
	var resolvedMsg = scope.logWithRequest('WARNING', managementError);

	if (resolvedMsg)
		scope.sendMails('WARNING', resolvedMsg);
};

scope.ERROR = function(sysAdminMessage) {
	var resolvedMsg = scope.logWithRequest('ERROR', sysAdminMessage);

	if (resolvedMsg)
		scope.sendMails('ERROR', resolvedMsg);
};

scope.logWithRequest = function(level, sysAdminMessage) {
	//Check if got request Obj
	// if (metaObj && metaObj.req && metaObj.req.headers)
	// 	metaObj.req = createLogMetaObj(metaObj.req);

	return scope.log(level, sysAdminMessage);
};

scope.DEBUG = function(msg, metaObj) {
	scope.log('DEBUG', msg, metaObj);
};

scope.INFO = function(systemMessage) {
	scope.log('INFO', systemMessage);
};

scope.log = function(level, systemMessage) {
	if (!objectNotifier)
		objectNotifier = require('./objectNotifier.js');

	var resolvedMsg;

	switch (level) {
		case 'DEBUG':
		case 'INFO':
		case 'WARNING':
		case 'ERROR':
			var logger = app.get('managementLogger');

			var metaObj = systemMessage.metaObj ? systemMessage.metaObj : {};
			metaObj.acknowledged = false;

			resolvedMsg = scope.resolveLink(systemMessage.toString(), metaObj);
			scope.logSysMessage(systemMessage.sysLogLevel, resolvedMsg);

			// Emit event for new log item created
			events.emitEvent(null, objectNotifier.events.newLogEvent);

			var logObj = scope.resolveMessage(systemMessage.toString(), metaObj);
			logger.log(level, logObj['message'], { meta: logObj['meta'] });

			break;
		default:
			scope.sysDEBUG('Received invalid log request from websocket.. level:' + level);
	}

	return resolvedMsg;
};

scope.resolveMessage = (message, meta) => {
	if (Object.keys(meta.links || {}).length) {
		meta.rawMessage = message;

		for (const [key, value] of Object.entries(meta.links))
			message = message.replace(`{${key}}`, value.entityText);
	}

	return { message, meta };
};

scope.resolveLink = (msg, metaObj, toSyslog = true) => {
	if (typeof msg !== 'string')
		return msg;

	let resolvedMsg = msg;

	for (const [key, value] of Object.entries(metaObj.links || {}))
		resolvedMsg = resolvedMsg.replace(`{${key}}`, toSyslog ? scope.formatLinkSyslog(value) : value.entityText);

	if (metaObj.user)
		resolvedMsg += ' USER: ' +	metaObj.user._id;

	return resolvedMsg;
};

scope.formatLinkSyslog = (metaLink) => {
	const link = consts.getEntityLink(metaLink);
	return metaLink.entityText + ' (' + link + ')';
};

let isSMTPCredentialsWarningLogged = false;

//Acquire connection to the SMTP server, login if necessary, send email and close the connection.
scope.sendMail = function(recipients, subject, msg, cb) {
	var transporter;
	var credentialsRequired = config.get('SMTP.useDefault') || config.get('SMTP.authRequired');
	var credentials = { user: config.get('SMTP.username'), pass: config.get('SMTP.password') };

	if (credentialsRequired && (!credentials.user || !credentials.pass)) {
		var errorMessage = 'SMTP username or SMTP password is not configured, abort email sending';

		if (cb) {
			cb(errorMessage, !isSMTPCredentialsWarningLogged);
			isSMTPCredentialsWarningLogged = true;
			return;
		}

		if (!isSMTPCredentialsWarningLogged) {
			scope.sysWARNING(errorMessage);
			isSMTPCredentialsWarningLogged = true;
		}

		return;
	}

	isSMTPCredentialsWarningLogged = false;

	if (config.get('SMTP.useDefault'))
		transporter = nodemailer.createTransport({
			service: 'Gmail',
			auth: credentials
		});
	else {
		var smtpTrans = smtpTransport({
			host: config.get('SMTP.host'),
			port: config.get('SMTP.port'),
			secure: config.get('SMTP.secure')
		});

		if (config.get('SMTP.authRequired'))
			smtpTrans = smtpTransport({
				host: config.get('SMTP.host'),
				port: config.get('SMTP.port'),
				secure: config.get('SMTP.secure'),
				auth: credentials
			});

		transporter = nodemailer.createTransport(smtpTrans);
	}

	var mailOptions = {
		from: 'Management System Mails <management@acme.com>',
		to: recipients.join(','),
		subject: subject,
		text: msg
	};

	if (!cb)
		cb = (err) => {
			if (err)
				new SystemMessage(systemMessages.APP_SEND_EMAIL_FAILED).addInfo(Entities.Error, err).log();
		};

	transporter.sendMail(mailOptions, cb);
};

//Send notification emails.
scope.sendMails = function(level, msg) {
	var db = app.get('db');
	var user = db.collection('user');

	//If the level is ERROR send the email to all the users that asked for WARNING too.
	var $match = level;
	if (level == 'ERROR')
		$match = { $in: ['ERROR', 'WARNING'] };

	user.find({ notificationLevel: $match }, { _id: 0, email: 1 }).toArray(function(err, results) {
		if (err)
			new MongoError(err).log();

		var phoneHomeUser;
		var allUsersExceptPhoneHome = [];

		if (results && results.length > 0){
			results.forEach(function(u) {
				if (u._id == 'phoneHome@acme.com')
					phoneHomeUser = u;
				else
					allUsersExceptPhoneHome.push(u);
			});

			nvmeshMetadata.getClusterID((clusterID) => {
				var clusterInfoMsg = clusterID ? 'Cluster ID: ' + clusterID.id + ', Cluster UUID: ' + clusterID.uuid + '. Message: ' : '';
				msg = clusterInfoMsg + msg;

				if (phoneHomeUser) {
					var messageForPhoneHome = JSON.stringify({ messageType: 'log', timestamp: new Date(), level: level, message: msg });
					scope.sendMail([phoneHomeUser.email], level + ' has been logged', messageForPhoneHome);
				}

				var recipients = allUsersExceptPhoneHome.map(function(e) { return e.email; });
				scope.sendMail(recipients, level + ' has been logged', msg);
			});
		} else
			scope.sysDEBUG('Failed to send emails notification: no eligible users with notification level ERROR or WARNING found in DB');

	});
};

scope.createTargetLink = function(nodeID) {
	return {
		entityType: consts.entityType.TARGET,
		entityText: nodeID
	};
};

scope.createClientLink = function(nodeID) {
	return {
		entityType: consts.entityType.CLIENT,
		entityText: nodeID
	};
};

scope.createVolumeLink = function(volumeName) {
	return {
		entityType: consts.entityType.VOLUME,
		entityText: volumeName
	};
};

scope.createDiskLink = function(diskID, targetID) {
	return {
		entityType: consts.entityType.DISK,
		entityText: diskID,
		target: targetID
	};
};

scope.createUserLink = function(userEmail) {
	return {
		entityType: consts.entityType.USER,
		entityText: userEmail
	};
};

scope.createConfigurationProfileLink = function(configurationProfileID) {
	return {
		entityType: consts.entityType.CONFIGURATION_PROFILE,
		entityText: configurationProfileID
	};
};

scope.createNICLink = function(nicID, nodeID) {
	return {
		entityType: consts.entityType.NIC,
		entityText: nicID,
		target: nodeID
	};
};

scope.createVPGLink = function(vpgName) {
	return {
		entityType: consts.entityType.VPG,
		entityText: vpgName
	};
};

scope.getCallingFunction = function(goBackN) {
	const stack = getStack();

	if (!stack.length)
		return 'unknown';

	const entry = stack[goBackN || 1];

	return getStringifiedFunctionByStackEntry(entry);
};

scope.getCallingFunctions = (goBackUntilN) => {
	let callingFunctions = '';
	const stack = getStack();

	if (!stack.length)
		return 'unknown';

	for (const [stackIndex, entry] of stack.entries()) {
		if (stackIndex !== 0 && stackIndex !== goBackUntilN)
			callingFunctions += ' <- ';

		callingFunctions += getStringifiedFunctionByStackEntry(entry);

		if (stackIndex === goBackUntilN)
			break;
	}

	return callingFunctions;
};

function getStringifiedFunctionByStackEntry(entry) {
	let functionName = entry.getFunctionName() || 'Anonymous function';
	let projectRoot = app.get('projectRoot');
	let fileName = entry.getFileName() ? path.relative(projectRoot, entry.getFileName()) : 'Unknown file';
	let line = entry.getLineNumber() || 'Unknown line';

	return `${functionName} in ${fileName} on line ${line}`;
}

function getStack() {
	let orig = Error.prepareStackTrace;
	Error.prepareStackTrace = function(_, stack) { return stack; };
	let err = new Error;
	Error.captureStackTrace(err, arguments.callee);
	let stack = err.stack;
	Error.prepareStackTrace = orig;

	return stack;
}


/** pipe Open-Telemetry internal logs to the app main logger
 * This will include error collecting and exporting metrics
*/

const otelSyslogLogger = {
	error: msg => scope.sysERROR(`open-telemetry: ${msg}`),
	warn: msg => scope.sysWARNING(`open-telemetry: ${msg}`),
	info: msg => scope.sysINFO(`open-telemetry: ${msg}`),
	debug: msg => scope.sysDEBUG(`open-telemetry: ${msg}`),
	verbose: () => {},
};

scope.initOtelLogger = () => {
	const diagLogLevel = config.get('openTelemetry.diagLogLevel');
	diag.setLogger(otelSyslogLogger, DiagLogLevel[diagLogLevel]);
};

setImmediate(scope.initOtelLogger);

module.exports = scope;
