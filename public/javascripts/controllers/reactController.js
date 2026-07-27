/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* global angular, ReactDOM, React, consts */

const managementApp = angular.module('managementApp');

const pagesFolder = '../components_js/pages';

// Registry mapping page keys to their module paths
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

managementApp.controller('reactController', function($scope) {
	$scope.options = {};

	const reactAppElement = document.getElementById('reactApp');
	const root = ReactDOM.createRoot(reactAppElement);
	const componentName = reactAppElement.getAttribute('component');
	const additionalData = reactAppElement.getAttribute('data');
	// Dynamically import App and the requested component in parallel
	Promise.all([
		import(`${pagesFolder}/App.js`),
		import(componentsRegistry[componentName])
	])
		.then(([AppModule, ComponentModule]) => {
			const App = AppModule.default;
			const Component = ComponentModule.default;
			if (componentName === consts.componentsPages.serviceUnavailable) {
				root.render(React.createElement(Component, { data: additionalData }));
			} else {
				root.render(React.createElement(App, null, React.createElement(Component)));
			}
		})
		.catch(err => {
			console.error('Error loading components:', err);
		});
});