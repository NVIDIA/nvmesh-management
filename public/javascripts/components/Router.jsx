/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, consts, $ */

import { SocketService } from './services/socket.service.js';
import { useAlerts } from './core/Alert.jsx';

const { useState, useEffect } = React;

const pagesFolder = './pages';

const componentsRegistry = {
	[consts.componentsPages.kafka]: `${pagesFolder}/Kafka.js`,
	[consts.componentsPages.logs]: `${pagesFolder}/Logs.js`,
	[consts.componentsPages.targetClasses]: `${pagesFolder}/target-class/TargetClasses.js`,
	[consts.componentsPages.driveClasses]: `${pagesFolder}/drive-class/DriveClasses.js`,
	[consts.componentsPages.targets]: `${pagesFolder}/Targets.js`,
	[consts.componentsPages.managementCluster]: `${pagesFolder}/ManagementCluster.js`,
	[consts.componentsPages.users]: `${pagesFolder}/users/Users.js`,
	[consts.componentsPages.generalSettings]: `${pagesFolder}/GeneralSettings.js`,
	[consts.componentsPages.keys]: `${pagesFolder}/keys/Keys.js`,
	[consts.componentsPages.volumeSecurityGroups]: `${pagesFolder}/vsg/VolumeSecurityGroups.js`,
	[consts.componentsPages.mongoDB]: `${pagesFolder}/MongoDB.js`,
	[consts.componentsPages.kernels]: `${pagesFolder}/kernels/Kernels.js`,
	[consts.componentsPages.ofeds]: `${pagesFolder}/ofeds/Ofeds.js`,
	[consts.componentsPages.operatingSystems]: `${pagesFolder}/operatingSystems/OperatingSystems.js`,
	[consts.componentsPages.platforms]: `${pagesFolder}/platforms/Platforms.js`,
	[consts.componentsPages.components]: `${pagesFolder}/components/Components.js`,
	[consts.componentsPages.dashboard]: `${pagesFolder}/dashboard/Dashboard.js`,
	[consts.componentsPages.vpg]: `${pagesFolder}/vpg/VolumeProvisioningGroups.js`,
	[consts.componentsPages.volumes]: `${pagesFolder}/volumes/Volumes.js`,
	[consts.componentsPages.backups]: `${pagesFolder}/Backups.js`,
	[consts.componentsPages.upgrades]: `${pagesFolder}/upgrades/Upgrades.js`,
	[consts.componentsPages.target]: `${pagesFolder}/target/Target.js`,
	[consts.componentsPages.upgrades]: `${pagesFolder}/upgrades/Upgrades.js`,
	[consts.componentsPages.upgradeScenarios]: `${pagesFolder}/upgradeScenarios/UpgradeScenarios.js`,
	[consts.componentsPages.upgradeStepsScenarios]: `${pagesFolder}/upgradeStepsScenarios/UpgradeStepsScenarios.js`,
	[consts.componentsPages.upgradeAgents]: `${pagesFolder}/upgradeAgents/UpgradeAgents.js`,
	[consts.componentsPages.clients]: `${pagesFolder}/clients/Clients.js`,
	[consts.componentsPages.techniciansScreen]: `${pagesFolder}/techniciansScreen/TechniciansScreen.js`,
	[consts.componentsPages.serviceUnavailable]: `${pagesFolder}/ServiceUnavailable.js`,
	[consts.componentsPages.upgrade]: `${pagesFolder}/upgrade/Upgrade.js`,
	[consts.componentsPages.drives]: `${pagesFolder}/drives/Drives.js`,
	[consts.componentsPages.cluster]: `${pagesFolder}/cluster/Cluster.js`,
	[consts.componentsPages.releases]: `${pagesFolder}/releases/Releases.js`,
	[consts.componentsPages.artifacts]: `${pagesFolder}/artifacts/Artifacts.js`,
	[consts.componentsPages.about]: `${pagesFolder}/About.js`,
	[consts.componentsPages.pageNotFound]: `${pagesFolder}/PageNotFound.js`,
	[consts.componentsPages.serviceUnavailable]: `${pagesFolder}/ServiceUnavailable.js`,
	[consts.componentsPages.configurationProfiles]: `${pagesFolder}/configProfiles/ConfigProfiles.js`
};


const Router = () => {
	const [DynamicComponent, setDynamicComponent] = useState(null);
	const { clearAlerts } = useAlerts();

	useEffect(() => {
		// Render the component according to pjax component name
		async function renderComponent() {
			const reactAppElement = document.getElementById('reactApp');
			if (!reactAppElement) {
				return;
			}
			const componentName = reactAppElement.getAttribute('component');

			try {
				const ComponentModule = await import(componentsRegistry[componentName]);
				setDynamicComponent(() => ComponentModule.default);
			} catch (err) {
				console.error('Error loading dynamic component:', err);
				setDynamicComponent(() => <div>Error loading page</div>);
			}
		}

		renderComponent();

		$(document).on('pjax:start', () => {
			setDynamicComponent(null);
			SocketService.removeAllHandlers();
			clearAlerts();
		});
		$(document).on('pjax:end', renderComponent);
	}, []);

	return (
		<>
			{DynamicComponent && (
				<DynamicComponent />
			)}
		</>
	);
};

export default Router;