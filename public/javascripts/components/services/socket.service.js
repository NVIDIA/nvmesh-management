/* global SOCKET, EVENTS */

export const SocketService = {
	addHandler: (eventName, handler) => SOCKET.addHandler(eventName, handler),
	removeHandler: (eventName, fromGUIOnly) => SOCKET.removeHandler(eventName, fromGUIOnly),
	removeAllHandlers: () => SOCKET.removeAllHandlers(),
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

export const events = EVENTS;