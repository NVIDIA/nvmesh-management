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
};
