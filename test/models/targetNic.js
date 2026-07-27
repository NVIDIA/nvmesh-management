const { Entity } = require('./entity');

exports.TargetNIC = class TargetNIC extends Entity {
	constructor(nicID, nodeID, nodeUUID) {
		super();
		this.nicID = nicID;
		this.nodeID = nodeID;
		this.nodeUUID = nodeUUID;
		this.status = 'Ok';
		this.pkey = 'FFFF';
		this.deviceType = 'mlx5_0';
		this.pci_root = 0;
		this.protocol = 'Infiniband';
		this.guid = nicID;
		this.mtu = 4096;
		this.version = 1;
		this.health = 'healthy';
	}
};
