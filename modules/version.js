const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const systemMessages = require('../systemMessages');

// assign appRoot for unittests where app.js is not run directly
global.appRoot = path.join(__dirname, '..');

const versions = {
	versionsFromFile: null,
	rpmVersion: null,
};

function getManagementVersionFromVersionFile() {
	let err;

	try {
		const versionFile = path.join(global.appRoot, 'version');
		if (fs.existsSync(versionFile)) {
			const versionFileContent = fs.readFileSync(versionFile, 'utf8');
			const versionsFromFile = versionFileContent.split('\n').reduce((acc, line) => {
				if (!line) return acc;
				const [key, value] = line.split('=');
				if (value)
					acc[key] = value.replace(/['"]/g, '');
				return acc;
			}, {});

			versions.versionsFromFile = versionsFromFile;

			if (versionsFromFile.version)
				return versionsFromFile.version;
			else
				err = new Error(`${systemMessages.APP_VERSION_FILE_CONTENT_DEFORMED.message}: ${versionFile}`);
		} else
			err = new Error(`${systemMessages.APP_VERSION_FILE_MISSING.message}: ${versionFile}`);
	} catch (exErr) {
		err = new Error(`${systemMessages.APP_VERSION_FILE_READ_EXCEPTION.message}. Error: ${exErr}`);
	}

	if (err)
		throw err;
}

function getManagementVersionFromGitDescribe() {
	try {
		var versionPattern = /v([^-]+-[^-]+)-/;
		var describe = execSync('git describe').toString();
		return versionPattern.exec(describe)[1];
	} catch (err) {
		throw new Error(`${systemMessages.APP_VERSION_UNKNOWN.message}: ${err}`);
	}
}

/**
 * Reads the application version from the version file or git describe
 * and sets the 'rpmVersion' and 'managementVersion' app properties
 */
function readAppVersion() {
	let rpmVersion = getManagementVersionFromVersionFile();
	versions.rpmVersion = rpmVersion;
	if (!rpmVersion) {
		//Failed to acquire the version from the version file, trying git describe
		rpmVersion = getManagementVersionFromGitDescribe();
		versions.rpmVersion = rpmVersion;
	}

	return versions.rpmVersion;
}

readAppVersion();

module.exports = {
	versions: versions,
};