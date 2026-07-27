const assert = require('assert');

exports.failedToAllocateError = 'Failed to allocate';

exports.isCausedBy = function(errObject, systemMessage) {
	if (!errObject)
		return false;

	if (errObject.id == systemMessage.id)
		return true;

	let subObjects = [];

	// in case of SystemAdminMessage we should look into additionalInfo
	if (errObject.additionalInfo?.error)
		subObjects.push(errObject.additionalInfo.error);

	if (errObject.innerMessage)
		subObjects.push(errObject.innerMessage);

	if (errObject.systemMessage)
		subObjects.push(errObject.systemMessage);

	for (var i = 0; i < subObjects.length; i++) {
		if (exports.isCausedBy(subObjects[i], systemMessage))
			return true;
	}

	return false;
};

exports.assertIsCausedBy = function(errObject, systemMessage) {
	let msgIfFailed = 'expected "' + systemMessage.internalName + '" but received "' + exports.getErrorChainString(errObject) + '"';
	assert(exports.isCausedBy(errObject, systemMessage), msgIfFailed);
};

exports.getErrorChainString = function(err) {
	let errChain = [];
	let currentErr = err;
	while (currentErr) {
		if (currentErr.systemMessage)
			errChain.push(currentErr.systemMessage.internalName);
		else if (currentErr.header)
			errChain.push(currentErr.header);
		else if (currentErr.message)
			errChain.push(exports.errorToString(currentErr));
		else
			errChain.push(currentErr);

		currentErr = currentErr.innerMessage;
	}

	let asString = '';
	let indent = '';
	for (let i = 0; i < errChain.length; i++) {
		if (i == 0)
			asString += errChain[i];
		else
			asString += '\n' + indent + 'Caused by: ' + errChain[i];

		indent += '\t';
	}

	return asString;
};

exports.errorToString = function(err) {
	if (!err)
		return '';
	return `(${err.id}): ${err.message}`;
};