/* global consts */

import { compareV } from '../utils.js';

export const NDUService = {

	getUpgradeAgentSourceVersions: (upgradeAgent) => {
		const nduComponents = [consts.components.CLIENT, consts.components.MANAGEMENT];
		return nduComponents
			.filter(component => upgradeAgent.upgradeAgentData.nvmeshVersions[component])
			.map(component => ({ name: component, version: upgradeAgent.upgradeAgentData.nvmeshVersions[component] }));
	},

	getUpgradeAgentsSourceVersions: (upgradeAgents) => {
		// collect all source versions from all upgrade agents, distinct by name and version
		const versions = {};
		upgradeAgents.forEach(upgradeAgent => {
			NDUService.getUpgradeAgentSourceVersions(upgradeAgent)
				.forEach(sourceVersion => versions[`${sourceVersion.name}-${sourceVersion.version}`] = sourceVersion);
		});
		return Object.values(versions);
	},

	extractSourceAndTargetBaseVersions: (versionsByBaseVersion) => {
		const baseVersions = Object.keys(versionsByBaseVersion);

		if (baseVersions.length === 1) return { sourceBaseVersion: baseVersions[0], targetBaseVersion: null };
		if (baseVersions.length > 2) return { sourceBaseVersion: null, targetBaseVersion: null };

		let source = baseVersions[0];
		let target = baseVersions[1];

		if (compareV(source, target) > 0) {
			[source, target] = [target, source];
		}
		return { sourceBaseVersion: source, targetBaseVersion: target };
	},

	parseArtifactName: (artifactName) => {
		// Supports:
		//   nvmesh-base_3.3.0-3000.ubuntu2404.0.0_amd64.deb
		//   nvmesh-client-3.3.0-3000.el8_10.0.0.x86_64.rpm
		const match = artifactName.match(/^([^-_]+(?:-[^-_]+)*?)[_-](\d+\.\d+\.\d+)-(\d+)\./);
		if (!match) return null;
		return {
			packageName: match[1],
			baseVersion: match[2],
			releaseNumber: match[3]
		};
	},

	isReleaseMatchMachineDestVersion: (release, machineDestVersions) => {
		return machineDestVersions.every(machineDestVersion => {
			const match = machineDestVersion.version.match(/^(\d+\.\d+\.\d+)-(\d+)/);
			if (!match) return false;
			const baseVersion = match[1];
			const releaseNumber = match[2];
			return release.artifacts.some(artifact => {
				// check the release version is not lower than the machine dest version
				const parsedArtifact = NDUService.parseArtifactName(artifact.name);

				return parsedArtifact
					&& parsedArtifact.packageName === machineDestVersion.name
					&& parsedArtifact.baseVersion === baseVersion
					&& parseInt(parsedArtifact.releaseNumber, 10) >= parseInt(releaseNumber, 10);
			});
		});
	},

};