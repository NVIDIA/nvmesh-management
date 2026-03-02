/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global it, describe */

const assert = require('assert');
const { parseVersionString } = require('../modules/versionUtils.js');

const EMPTY_RESULT = {
	packageName: '',
	baseVersion: '',
	releaseNumber: '',
	distTag: '',
	buildNumber: '',
	arch: '',
	extension: ''
};

describe('parseVersionString', () => {
	describe('full RPM artifact names', () => {
		it('should parse RPM with build number', async() => {
			assert.deepStrictEqual(parseVersionString('nvmesh-base-3.3.1-23.el8_10.1.985.x86_64.rpm'), {
				packageName: 'nvmesh-base',
				baseVersion: '3.3.1',
				releaseNumber: '23',
				distTag: 'el8_10',
				buildNumber: '1.985',
				arch: 'x86_64',
				extension: 'rpm'
			});
		});

		it('should parse RPM without build number', async() => {
			assert.deepStrictEqual(parseVersionString('nvmesh-target-3.1.0-1357.el8_6.x86_64.rpm'), {
				packageName: 'nvmesh-target',
				baseVersion: '3.1.0',
				releaseNumber: '1357',
				distTag: 'el8_6',
				buildNumber: '',
				arch: 'x86_64',
				extension: 'rpm'
			});
		});

		it('should parse RPM with multiple "-" in package name', async() => {
			assert.deepStrictEqual(parseVersionString('nvmesh-upgrade-agent-3.3.0-1234.el8_6.x86_64.rpm'), {
				packageName: 'nvmesh-upgrade-agent',
				baseVersion: '3.3.0',
				releaseNumber: '1234',
				distTag: 'el8_6',
				buildNumber: '',
				arch: 'x86_64',
				extension: 'rpm'
			});
		});

		it('should parse RPM with dev build number placeholder', async() => {
			assert.deepStrictEqual(parseVersionString('nvmesh-management-3.3.1-23.el8_10.buildnumber.x86_64.rpm'), {
				packageName: 'nvmesh-management',
				baseVersion: '3.3.1',
				releaseNumber: '23',
				distTag: 'el8_10',
				buildNumber: 'buildnumber',
				arch: 'x86_64',
				extension: 'rpm'
			});
		});
	});

	describe('full DEB artifact names', () => {
		it('should parse DEB with underscore separators', async() => {
			assert.deepStrictEqual(parseVersionString('nvmesh-base_999.999.999-99999.ubuntu2404.0.0_amd64.deb'), {
				packageName: 'nvmesh-base',
				baseVersion: '999.999.999',
				releaseNumber: '99999',
				distTag: 'ubuntu2404',
				buildNumber: '0.0',
				arch: 'amd64',
				extension: 'deb'
			});
		});

		it('should parse DEB with 4-segment base version', async() => {
			assert.deepStrictEqual(parseVersionString('nvmesh-client_3.3.0.1-3000.ubuntu2404.0.0_amd64.deb'), {
				packageName: 'nvmesh-client',
				baseVersion: '3.3.0.1',
				releaseNumber: '3000',
				distTag: 'ubuntu2404',
				buildNumber: '0.0',
				arch: 'amd64',
				extension: 'deb'
			});
		});

		it('should parse DEB without build number', async() => {
			assert.deepStrictEqual(parseVersionString('nvmesh-utils_3.3.0-3000.ubuntu2204_amd64.deb'), {
				packageName: 'nvmesh-utils',
				baseVersion: '3.3.0',
				releaseNumber: '3000',
				distTag: 'ubuntu2204',
				buildNumber: '',
				arch: 'amd64',
				extension: 'deb'
			});
		});
	});

	// versions string such as reported by upgradeAgents.nvmeshVersions
	describe('version strings', () => {
		it('should parse version with distTag and build number', async() => {
			assert.deepStrictEqual(parseVersionString('999.999.999-3282.el8_6.0.0.x86_64'), {
				packageName: '',
				baseVersion: '999.999.999',
				releaseNumber: '3282',
				distTag: 'el8_6',
				buildNumber: '0.0',
				arch: 'x86_64',
				extension: ''
			});
		});

		it('should parse version with distTag, no build number', async() => {
			assert.deepStrictEqual(parseVersionString('3.1.0-1357.el8_6.x86_64'), {
				packageName: '',
				baseVersion: '3.1.0',
				releaseNumber: '1357',
				distTag: 'el8_6',
				buildNumber: '',
				arch: 'x86_64',
				extension: ''
			});
		});

		it('should parse simple version-release string', async() => {
			assert.deepStrictEqual(parseVersionString('3.3.0-1234'), {
				packageName: '',
				baseVersion: '3.3.0',
				releaseNumber: '1234',
				distTag: '',
				buildNumber: '',
				arch: '',
				extension: ''
			});
		});

		it('should parse bare base version', async() => {
			assert.deepStrictEqual(parseVersionString('3.3.0'), {
				packageName: '',
				baseVersion: '3.3.0',
				releaseNumber: '',
				distTag: '',
				buildNumber: '',
				arch: '',
				extension: ''
			});
		});

		it('should parse base version with 4 segments', async() => {
			assert.deepStrictEqual(parseVersionString('3.3.2.1-23.el8_10.x86_64'), {
				packageName: '',
				baseVersion: '3.3.2.1',
				releaseNumber: '23',
				distTag: 'el8_10',
				buildNumber: '',
				arch: 'x86_64',
				extension: ''
			});
		});
	});

	describe('wildcard glob patterns', () => {
		it('should parse RPM with wildcard in distTag', async() => {
			assert.deepStrictEqual(parseVersionString('nvmesh-target-3.5.0-3000.el8*.0.0.x86_64.rpm'), {
				packageName: 'nvmesh-target',
				baseVersion: '3.5.0',
				releaseNumber: '3000',
				distTag: 'el8*',
				buildNumber: '0.0',
				arch: 'x86_64',
				extension: 'rpm'
			});
		});

		it('should parse RPM with wildcard in distTag suffix and build number', async() => {
			assert.deepStrictEqual(parseVersionString('nvmesh-upgrade-agent-3.4.0-3000.el8_*.*.x86_64.rpm'), {
				packageName: 'nvmesh-upgrade-agent',
				baseVersion: '3.4.0',
				releaseNumber: '3000',
				distTag: 'el8_*',
				buildNumber: '*',
				arch: 'x86_64',
				extension: 'rpm'
			});
		});

		it('should parse DEB with wildcard in build number', async() => {
			assert.deepStrictEqual(parseVersionString('nvmesh-client_3.4.0-3000.ubuntu24041.1.*_amd64.deb'), {
				packageName: 'nvmesh-client',
				baseVersion: '3.4.0',
				releaseNumber: '3000',
				distTag: 'ubuntu24041',
				buildNumber: '1.*',
				arch: 'amd64',
				extension: 'deb'
			});
		});
	});

	describe('edge cases', () => {
		it('should return empty result for null', async() => {
			assert.deepStrictEqual(parseVersionString(null), EMPTY_RESULT);
		});

		it('should return empty result for undefined', async() => {
			assert.deepStrictEqual(parseVersionString(undefined), EMPTY_RESULT);
		});

		it('should return empty result for empty string', async() => {
			assert.deepStrictEqual(parseVersionString(''), EMPTY_RESULT);
		});

		it('should return empty result for non-string input', async() => {
			assert.deepStrictEqual(parseVersionString(12345), EMPTY_RESULT);
		});

		it('should return empty result for unexpected string', async() => {
			assert.deepStrictEqual(parseVersionString('not-a-version'), EMPTY_RESULT);
		});
	});
});
