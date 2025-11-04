/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* global INTERVALS, SOCKET,io,jQuery,consts, ReactDOM, React */

/* eslint-disable-next-line no-global-assign */
INTERVALS = [];
/* eslint-disable-next-line no-global-assign */
function SocketHandler() {
	this.socket = new io();
	this.registeredEvents = {};
}

SocketHandler.prototype.addHandler = function(eventName, handler) {
	if (eventName in this.registeredEvents) {
		this.removeHandler(eventName, true);
	} else {
		this.socket.emit('registerToEvent', { name: eventName });
	}

	this.registeredEvents[eventName] = 1;
	this.socket.on(eventName, handler);
};

SocketHandler.prototype.removeHandler = function(eventName, fromGUIOnly) {

	this.socket.removeAllListeners(eventName);
	if (this.registeredEvents[eventName]) {
		if (!fromGUIOnly)
			this.socket.emit('unregisterFromEvents', [eventName]);
		delete this.registeredEvents[eventName];
	}

};

SocketHandler.prototype.removeAllHandlers = function() {
	for (var event in this.registeredEvents)
		this.socket.removeAllListeners(event);

	this.socket.emit('unregisterFromEvents', Object.keys(this.registeredEvents));

	this.registeredEvents = {};
};

/* eslint-disable-next-line */
SOCKET = new SocketHandler();


(function($) {
	$(function() {
		var $body = $('body');

		$body.on('click', 'a[disabled="disabled"]', function() {
			return false;
		});

		// Disables shift and control text selection, so it will not override shift checking
		// in multi select tables
		$body.mousedown(function(e) {
			if (e.ctrlKey || e.shiftKey) {
				// For non-IE browsers
				e.preventDefault();
			}
		});

		window.onbeforeunload = function() {
			SOCKET.removeAllHandlers();
		};

		//pjax configuration
		$(document).pjax('a[data-pjax!="false"]', '.content', { timeout: 5000 });

		//A hack to take 'back' control from pjax
		$(window).off('popstate.pjax');
		$(window).on('popstate.pjax', function(event) {
			if (!event.state)
				return;

			var options = {
				url: event.state.url,
				container: event.state.container,
				timeout: event.state.timeout,
				id:	event.state.id,
				fragment: event.state.fragment,
				scrollTo: false,
				push: false,

			};

			$.pjax(options);
		});

		$(document).on('pjax:start', function() {
			INTERVALS.forEach(function(i) {
				clearInterval(i);
			});

			SOCKET.removeAllHandlers();

			$('.content').animate({ left: '2000px' }, function(){ });
		});

		$(document).on('pjax:end', function() {
			$('.content').finish().animate({ left: 0 }, 200);

			const pagesFolder = './components_js/pages';

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

			const reactAppElement = document.getElementById('reactApp');
			const root = ReactDOM.createRoot(reactAppElement);
			const componentName = reactAppElement.getAttribute('component');
			const additionalData = reactAppElement.getAttribute('data');

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

	});


})(jQuery);
