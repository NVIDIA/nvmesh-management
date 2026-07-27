exports.Entity = class Entity {
	preSave() {
		return JSON.parse(JSON.stringify(this));
	}

	save() {
		let derivedClassName = this.constructor.name;
		throw new Error(`Not Implemented. ${derivedClassName} does not implements save() method`);
	}
};