/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

var fs = require('fs');
var path = require('path');
var async = require('async');
var Ajv = require('ajv/dist/2020');
var ajvFormats = require('ajv-formats');
var ajvKeywords = require('ajv-keywords');

var utils = require('../utils.js');
var consts = require('../consts.js');

var { SystemMessage, Entities } = require('./error.js');
var systemMessages = require('../systemMessages.js');

var scope = {};
var basePath = 'validationSchemes/';
var absolutePath = path.join(consts.installDir, basePath);
var ajv = null;

function getSchemes(basedir, schemes, isAbsolutePath, cb) {
	fs.readdir(basedir, (err, fds) => {
		if (err)
			return cb(new SystemMessage(systemMessages.VALIDATION_SCHEME_FILES_READ_FAILED).addInfo(Entities.Error, err).log());

		async.eachSeries(fds, (fd, callback) => {
			// skip common directory as it is not including schemas
			if (fd === 'common')
				return callback();

			var fullPath = path.join(basedir, fd);
			if (fs.lstatSync(fullPath).isDirectory()) {
				getSchemes(fullPath, schemes, isAbsolutePath, function(err) {
					callback(err);
				});
			} else {
				var scheme = require(isAbsolutePath ? fullPath : path.join('../', fullPath));
				schemes.push(scheme);
				callback();
			}
		}, (err) => {
			cb(err);
		});
	});
}

const maxBytesKeyword = {
	keyword: 'maxBytes',
	type: 'object',
	schemaType: 'number',
	validate: function maxBytesValidate(maxBytes, data) {
		const byteSize = Buffer.byteLength(JSON.stringify(data), 'utf8');

		if (byteSize <= maxBytes)
			return true;

		maxBytesValidate.errors = [
			{
				keyword: 'maxBytes',
				message: `should be <= ${maxBytes} bytes, but is ${byteSize} bytes`,
				params: {
					maxBytes: maxBytes,
					size: byteSize
				}
			}
		];
		return false;
	}
};

scope.init = function(cb) {
	var schemes = [];

	var isRelativeDirExist = fs.existsSync(basePath);
	if (!isRelativeDirExist)
		basePath = absolutePath;

	getSchemes(basePath, schemes, !isRelativeDirExist, function(err) {
		if (!err) {
			ajv = new Ajv({ strict: false, schemas: schemes, useDefaults: true });
			ajv.addFormat('json', (data) => utils.tryParseJSON(data));
			ajvFormats(ajv, ['uuid', 'email']);
			ajvKeywords(ajv, ['uniqueItemProperties']);
			ajv.addKeyword(maxBytesKeyword);
		}

		cb(err);
	});
};

scope.getValidationFunctionByScheme = scheme => ajv.getSchema(scheme.toLowerCase());

scope.getValidationErrors = errors => {
	const groupedErrors = errors.reduce((acc, error) => {
		if (error.keyword === 'unevaluatedProperties')
			acc.unevaluatedProperties.push(error);
		else
			acc.general.push(error);
		return acc;
	}, { general: [], unevaluatedProperties: [] });

	let text = '';

	if (groupedErrors.general.length) {
		text += ajv.errorsText(groupedErrors.general);

		if (groupedErrors.unevaluatedProperties.length)
			text += ', ';
	}

	if (groupedErrors.unevaluatedProperties.length)
		text += groupedErrors.unevaluatedProperties
			.map(error => `Error: Invalid property: "${error.params.unevaluatedProperty}"`)
			.join(', ');

	return text;
};

module.exports = scope;
