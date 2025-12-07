const fs = require('fs');
const path = require('path');

const consts = require('../consts.js');
const systemMessages = require('../systemMessages.js');
const { SystemMessage, Entities } = require('./error.js');

var scope = {};
module.exports = scope;

scope.prepareCertSubDir = function(subDirName) {
	const activeCertSubDir = path.join(consts.ACTIVE_CERT_DIR, subDirName);

	try {
		fs.mkdirSync(activeCertSubDir, { recursive: true });
	} catch (err) {
		new SystemMessage(systemMessages.CERT_CREATE_DIRECTORY_FAILED)
			.addInfo(Entities.Exception, err.message)
			.addInfo(Entities.Stack, err.stack)
			.addInfo(Entities.Path, activeCertSubDir)
			.log();
		process.exit(1);
	}

	return activeCertSubDir;
};

function copyCertFile(activeCertSubDir, sourceCertPath, certType) {
	const targetFilename = consts.CERT_TYPE_FILENAMES[certType];

	const targetCertPath = path.join(activeCertSubDir, targetFilename);
	try {
		fs.copyFileSync(sourceCertPath, targetCertPath);
	} catch (err) {
		new SystemMessage(systemMessages.CERT_COPY_FAILED)
			.addInfo(Entities.Exception, err.message)
			.addInfo(Entities.Stack, err.stack)
			.addInfo(Entities.Path, sourceCertPath)
			.addInfo(Entities.Path, targetCertPath)
			.log();
		process.exit(1);
	}

	return targetCertPath;
}

scope.getCertFilePath = function(activeCertSubDir, sourceCertPath, certType) {
	return copyCertFile(activeCertSubDir, sourceCertPath, certType);
};

scope.getCertFile = function(activeCertSubDir, sourceCertPath, certType, encoding) {
	const targetCertPath = copyCertFile(activeCertSubDir, sourceCertPath, certType);

	try {
		const certContent = encoding ? fs.readFileSync(targetCertPath, encoding) : fs.readFileSync(targetCertPath);
		return certContent;
	} catch (err) {
		new SystemMessage(systemMessages.CERT_READ_FAILED)
			.addInfo(Entities.Exception, err.message)
			.addInfo(Entities.Stack, err.stack)
			.addInfo(Entities.Path, targetCertPath)
			.addInfo(Entities.Path, sourceCertPath)
			.log();
		process.exit(1);
	}
};

scope.getActiveCertPath = function(subDirName, certType) {
	const targetFilename = consts.CERT_TYPE_FILENAMES[certType];
	return path.join(consts.ACTIVE_CERT_DIR, subDirName, targetFilename);
};
