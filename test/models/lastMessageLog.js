
exports.LastMessageLog = class LastMessageLog {
	constructor(nodeID, originType, msgType, msgSeq, token, dateModified) {
		this._id = {
			id: nodeID,
			type: originType
		};
		this.messageType = msgType;
		this.messageSequence = msgSeq;
		this.token = token;
		this.dateModified = dateModified;

		this.origin = nodeID;
		this.nodeID = nodeID;
		this.status = 'live';
	}
};