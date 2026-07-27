exports.MultipleZonesResults = class MultipleZonesResults {
	constructor() {
		this.zones = {};
	}

	getZonesList() {
		return Object.keys(this.zones);
	}

	getZonesSet() {
		return new Set(this.getZonesList());
	}
};

exports.PRaidsZonesResult = class PRaidsZonesResult extends exports.MultipleZonesResults {
	constructor(pRaidUUIDs, pRaidsResult) {
		super();
		this.pRaidsNotFound = new Set();
		this.pRaidUUIDs = new Set(pRaidUUIDs);
		this._handlePRaids(pRaidsResult);
	}

	_handlePRaids(pRaidsResult) {
		var found = new Set();
		pRaidsResult.forEach(target => {
			this._addPRaidResult(target);
			found.add(target.node_id);
		});

		this.pRaidUUIDs.forEach(id => {
			if (!found.has(id))
				this.pRaidsNotFound.add(id);
		});
	}

	_addPRaidResult(pRaid) {
		if (!this.zones[pRaid.zone])
			this.zones[pRaid.zone] = [];
		this.zones[pRaid.zone].push(pRaid.uuid);
	}
};

exports.TargetsZonesResult = class TargetsZonesResult extends exports.MultipleZonesResults {
	constructor(targetIDs, targets) {
		super();
		this.pendingTargets = new Set();
		this.notFoundTargets = new Set();
		this.targetIDs = new Set(targetIDs);

		this._handleTargets(targets);
	}

	_handleTargets(targets) {
		var foundTargets = new Set();
		targets.forEach(target => {
			this._addTargetResult(target);
			foundTargets.add(target.node_id);
		});

		this.targetIDs.forEach(id => {
			if (!foundTargets.has(id))
				this.notFoundTargets.add(id);
		});
	}

	_addTargetResult(target) {
		if (target.isPending || !target.zone)
			this.pendingTargets.add(target.node_id);
		else {
			if (!this.zones[target.zone])
				this.zones[target.zone] = [];
			this.zones[target.zone].push(target.node_id);
		}
	}
};