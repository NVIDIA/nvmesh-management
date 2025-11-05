/* global io */

class SocketHandler {
	constructor() {
		this.socket = new io();
		this.registeredEvents = {};
	}

	addHandler(eventName, handler) {
		if (eventName in this.registeredEvents) {
			this.removeHandler(eventName, true);
		} else {
			this.socket.emit('registerToEvent', { name: eventName });
		}
		this.registeredEvents[eventName] = 1;
		this.socket.on(eventName, handler);
	}

	removeHandler(eventName, fromGUIOnly) {
		this.socket.removeAllListeners(eventName);
		if (this.registeredEvents[eventName]) {
			if (!fromGUIOnly)
				this.socket.emit('unregisterFromEvents', [eventName]);
			delete this.registeredEvents[eventName];
		}
	}

	removeAllHandlers() {
		for (const event in this.registeredEvents) {
			this.socket.removeAllListeners(event);
		}
		this.socket.emit('unregisterFromEvents', Object.keys(this.registeredEvents));
		this.registeredEvents = {};
	}
}

/* eslint-disable-next-line */
const socketHandler = new SocketHandler();

export const SocketService = {
	addHandler: (eventName, handler) => socketHandler.addHandler(eventName, handler),
	removeHandler: (eventName, fromGUIOnly) => socketHandler.removeHandler(eventName, fromGUIOnly),
	removeAllHandlers: () => socketHandler.removeAllHandlers(),
	getNodeID: id => 'nodeID_' + id + '@',
	getTargetID: id => 'targetID_' + id + '@',
	getClientID: id => 'clientID_' + id + '@',
	getDiskID: id => 'diskID_' + id + '@',
	getNicID: id => 'nicID_' + id + '@',
	getVolumeID: id => 'volumeID_' + id + '@',
	getDiskSegmentID: id => 'diskSegmentID_' + id + '@',
	getLogID: id => 'logID_' + id + '@',
	getPlatformID: id => 'platformID_' + id + '@',
	getUpgradeAgentID: id => 'upgradeAgentID_' + id + '@',
	getComponentID: id => 'componentID_' + id + '@',
	getUpgradeID: id => 'upgradeID_' + id + '@',
	getUpgradeStepID: id => 'upgradeStepID_' + id + '@',
	getReleaseID: id => 'releaseID_' + id + '@',
	getArtifactID: id => 'artifactID_' + id + '@',
	getKernelID: id => 'kernelID_' + id + '@',
	getOfedID: id => 'ofedID_' + id + '@',
	getOperatingSystemID: id => 'operatingSystemID_' + id + '@',
	getUpgradeScenarioID: id => 'upgradeScenarioID_' + id + '@',
	getUpgradeStepScenarioID: id => 'upgradeStepScenarioID_' + id + '@'
};

export const events = {
	nicsCountChangeEvent: { name: 'nicsCountChangeEvent' },
	disksCountChangeEvent: { name: 'disksCountChangeEvent' },
	serversCountChangeEvent: { name: 'serversCountChangeEvent' },
	clientsCountChangeEvent: { name: 'clientsCountChangeEvent' },
	volumesCountChangeEvent: { name: 'volumesCountChangeEvent' },
	zoneAvailabilityChangeEvent: { name: 'zoneAvailabilityChangeEvent' },
	allocatedSpaceChangeEvent: { name: 'allocatedSpaceChangeEvent' },
	largestVolumesChangeEvent: { name: 'largestVolumesChangeEvent' },
	dirtyBitsChangeEvent: { name: 'dirtyBitsChangeEvent' },
	volumeStatusChangeEvent: { name: 'volumeStatusChangeEvent' },
	volumeActionChangeEvent: { name: 'volumeActionChangeEvent' },
	volumeRemovedEvent: { name: 'volumeRemovedEvent' },
	targetFailureEvent: { name: 'targetFailureEvent' },
	targetWentOnlineEvent: { name: 'targetWentOnlineEvent' },
	targetRemovedEvent: { name: 'targetRemovedEvent' },
	clientFailureEvent: { name: 'clientFailureEvent' },
	clientWentOnlineEvent: { name: 'clientWentOnlineEvent' },
	clientRemovedEvent: { name: 'clientRemovedEvent' },
	formatDiskEvent: { name: 'formatDiskEvent' },
	DiskFinishedFormatEvent: { name: 'DiskFinishedFormatEvent' },
	newTargetEvent: { name: 'newTargetEvent' },
	newClientEvent: { name: 'newClientEvent' },
	backupChangeEvent: { name: 'backupChangeEvent' },
	newDiskEvent: { name: 'newDiskEvent' },
	diskReappearEvent: { name: 'diskReappearEvent' },
	diskStatusChangeEvent: { name: 'diskStatusChangeEvent' },
	diskFailureEvent: { name: 'diskFailureEvent' },
	diskWentOnlineEvent: { name: 'diskWentOnlineEvent' },
	diskEvictedEvent: { name: 'diskEvictedEvent' },
	diskRemovedEvent: { name: 'diskRemovedEvent' },
	driveZeroingProgressChangeEvent: { name: 'driveZeroingProgressChangeEvent' },
	drivePoolChangeEvent: { name: 'drivePoolChangeEvent' },
	volumeDeletionZeroingProgressChangeEvent: { name: 'volumeDeletionZeroingProgressChangeEvent' },
	newNicEvent: { name: 'newNicEvent' },
	nicRemovedEvent: { name: 'nicRemovedEvent' },
	nicFailureEvent: { name: 'nicFailureEvent' },
	nicWentOnlineEvent: { name: 'nicWentOnlineEvent' },
	nicReappearEvent: { name: 'nicReappearEvent' },
	nicChangeEvent: { name: 'nicChangeEvent' },
	newVolumeEvent: { name: 'newVolumeEvent' },
	newLogEvent: { name: 'newLogEvent' },
	logChangedEvent: { name: 'logChangedEvent' },
	allLogsAcknowledgedEvent: { name: 'allLogsAcknowledgedEvent' },
	newPlatformEvent: { name: 'newPlatformEvent' },
	platformRemovedEvent: { name: 'platformRemovedEvent' },
	platformChangedEvent: { name: 'platformChangedEvent' },
	newUpgradeScenarioEvent: { name: 'newUpgradeScenarioEvent' },
	upgradeScenarioRemovedEvent: { name: 'upgradeScenarioRemovedEvent' },
	upgradeScenarioChangedEvent: { name: 'upgradeScenarioChangedEvent' },
	newArtifactEvent: { name: 'newArtifactEvent' },
	artifactRemovedEvent: { name: 'artifactRemovedEvent' },
	artifactChangedEvent: { name: 'artifactChangedEvent' },
	newUpgradeAgentEvent: { name: 'newUpgradeAgentEvent' },
	upgradeAgentChangedEvent: { name: 'upgradeAgentChangedEvent' },
	newComponentEvent: { name: 'newComponentEvent' },
	componentChangedEvent: { name: 'componentChangedEvent' },
	newManagementInClusterEvent: { name: 'newManagementInClusterEvent' },
	updateConfigProfileEvent: { name: 'updateConfigProfileEvent' },
	clientConfigProfileUpdated: { name: 'clientConfigProfileUpdated' },
	targetConfigProfileUpdated: { name: 'targetConfigProfileUpdated' },
	restartRequiredChanged: { name: 'restartRequiredChanged' },
	configProfileUserOverrideChanged: { name: 'configProfileUserOverrideChanged' },
	upgradeAgentRemovedEvent: { name: 'upgradeAgentRemovedEvent' },
	upgradeStatusChangedEvent: { name: 'upgradeStatusChangedEvent' },
	upgradeRemovedEvent: { name: 'upgradeRemovedEvent' },
	newUpgradeEvent: { name: 'newUpgradeEvent' },
	upgradeStepStatusChangedEvent: { name: 'upgradeStepStatusChangedEvent' },
	newReleaseEvent: { name: 'newReleaseEvent' },
	releaseRemovedEvent: { name: 'releaseRemovedEvent' },
	releaseChangedEvent: { name: 'releaseChangedEvent' },
	newKernelEvent: { name: 'newKernelEvent' },
	kernelChangedEvent: { name: 'kernelChangedEvent' },
	kernelRemovedEvent: { name: 'kernelRemovedEvent' },
	newOfedEvent: { name: 'newOfedEvent' },
	ofedChangedEvent: { name: 'ofedChangedEvent' },
	ofedRemovedEvent: { name: 'ofedRemovedEvent' },
	newOperatingSystemEvent: { name: 'newOperatingSystemEvent' },
	operatingSystemChangedEvent: { name: 'operatingSystemChangedEvent' },
	operatingSystemRemovedEvent: { name: 'operatingSystemRemovedEvent' },
	newUpgradeStepScenarioEvent: { name: 'newUpgradeStepScenarioEvent' },
	upgradeStepScenarioRemovedEvent: { name: 'upgradeStepScenarioRemovedEvent' },
	upgradeStepScenarioChangedEvent: { name: 'upgradeStepScenarioChangedEvent' },
};