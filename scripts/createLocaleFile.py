#!/usr/bin/python2

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import os, re, collections, json

MAIN_DIR = '../'
ERROR_CODE_COUNTER = 1000
PATTERN = re.compile(r'^([\s]+return[\s]*|[\s]+)([\w]+\.(sys|)(ERROR|WARNING|INFO)\([^;]+;)', re.MULTILINE)

FILES_TO_SCAN = [
	'app.js',
	'bootstrapper.js',
	'dbBackup.js',
	'events.js',
	'mgmtStatistics.js',
	'objectNotifier.js',
	'utils.js',
	'initServices/initDbConnection.js',
	'validator.js',
	'modules/client.js',
	'modules/config.js',
	'modules/diskClass.js',
	'modules/disk.js',
	'modules/generalSettings.js',
	'modules/index.js',
	'modules/key.js',
	'modules/lock.js',
	'modules/login.js',
	'modules/log.js',
	'modules/managementCluster.js',
	'modules/mongoDB.js',
	'modules/node.js',
	'modules/nvmeshMetadata.js',
	'modules/profileScheme.js',
	'modules/sanityAndRecover.js',
	'modules/serverClass.js',
	'modules/statistics.js',
	'modules/statisticsLayouts.js',
	'modules/statisticsRollUp.js',
	'modules/statisticsWorker.js',
	'modules/statsWebsocket.js',
	'modules/target.js',
	'modules/user.js',
	'modules/validation.js',
	'modules/volume.js',
	'modules/volumeSecurityGroup.js',
	'modules/websocketCommon.js',
	'modules/websocket.js',
	'modules/zone.js',
	'routes/backups.js',
	'routes/clients.js',
	'routes/cluster.js',
	'routes/configurationProfiles.js',
	'routes/diskClasses.js',
	'routes/disks.js',
	'routes/generalSettings.js',
	'routes/index.js',
	'routes/keys.js',
	'routes/login.js',
	'routes/logs.js',
	'routes/managementCluster.js',
	'routes/mongoDB.js',
	'routes/nvmeshMetadata.js',
	'routes/serverClasses.js',
	'routes/servers.js',
	'routes/statistics.js',
	'routes/users.js',
	'routes/volumeProvisioningGroups.js',
	'routes/volumeSecurityGroups.js',
	'routes/volumes.js',
]

'''
RESULT_EXAMPLE = {
	GENERAL_MONGO_ERROR: {
		'id': 1000,
		'originalLine': 'logger.sysERROR("bla bla");',
		'lineNumber': 300,
		'filename': app.js,
		'message': '',
		'comments': '',
		'additionalInfo': [VOLUME.NAME, CLIENT.UUID]
	}
}
'''

systemMessages = collections.OrderedDict()

def matchWithLine(pattern, string):
	matches = list(re.finditer(pattern, string))

	if not matches:
		print ('Nothing to see here!')
		yield None
		return

	end = matches[-1].start()
	newlineTable = { -1: 0 }
	newlinePattern = re.compile(r'\n')

	for i, m in enumerate(re.finditer(newlinePattern, string), 1):
		offset = m.start()

		if offset > end:
			break

		newlineTable[offset] = i

	for m in matches:
		newlineOffset = string.rfind('\n', 0, m.start())
		lineNumber = newlineTable[newlineOffset]
		yield (m.groups()[1], lineNumber + 1)


for f in FILES_TO_SCAN:
	with open(os.path.join(MAIN_DIR, f)) as fd:
		content = fd.read()

	print ('Working on  file: %s' % f)
	for r in matchWithLine(PATTERN, content):
		if r:
			systemMessages[ERROR_CODE_COUNTER] = {
				'id': ERROR_CODE_COUNTER,
				'originalLine': r[0],
				'lineNumber': r[1],
				'fileName': f,
				'message': '',
				'comments': '',
				'additionalInfo': []
			}

			ERROR_CODE_COUNTER += 1

with open('./results.json', 'w') as f:
	f.write(json.dumps(systemMessages, indent=4))
