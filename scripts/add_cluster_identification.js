/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { exec } = require('child_process');

const MGMT_DB_UTIL_PATH = '/opt/nvmesh/management/upgradeScripts/utils/upgradeUtils.sh';

function runCommand(cmd) {
	return new Promise((resolve, reject) => {
		exec(cmd, (error, stdout, stderr) => {
			if (error) {
				console.log(`error running ${cmd}:\n ${error.message}`);
				return reject(error);
			}

			resolve(stdout, stderr);
		});
	});
}

function removeTrailingNewLines(text) {
	return text.replace(/\n+$/, '');
}

function getMetadataCMDLineArguments() {
	let cmd = `${MGMT_DB_UTIL_PATH} getMongoNVMeshMetadataCommandLineArguments | tail -n 1`;
	return runCommand(cmd)
		.then(cmdLineParams => removeTrailingNewLines(cmdLineParams))
		// "$external" is the name of the authentication DB when using TLS with X509 - should not be evaluated when running the command
		.then(cmdLineParams => cmdLineParams.replace('$external', '\\$external'));
}

function addDataToDb(mongoCmdLineArgs, data) {
	let cmd = `mongosh ${mongoCmdLineArgs} --eval 'db.identification.update({_id: "${data._id}"},${JSON.stringify(data)},{upsert:true})'`;
	return runCommand(cmd);
}

function main() {
	let scriptArgs = process.argv.slice(2);
	let jsonData = scriptArgs[0];

	if (!jsonData) {
		console.log('usage: add_cluster_identification.js \'{"key1":"value1"}\'');
		process.exit(1);
	}

	let data = JSON.parse(jsonData);
	if (!data._id)
		data._id = 'identification';

	getMetadataCMDLineArguments()
		.then((mongoCmdLineArgs) => addDataToDb(mongoCmdLineArgs, data))
		.catch(err => console.log('Error: ' + err));
}

main();

