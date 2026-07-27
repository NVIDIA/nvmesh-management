/* global */
var serverClassModule = require('../../modules/serverClass.js');
const { Entity } = require('./entity.js');
const consts = require('../../consts');
const { Entities } = require('../../modules/error.js');

exports.TargetClass = class TargetClass extends Entity {
	constructor(name, targetIDs) {
		super();
		this._id = name;
		this.name = name;
		this.domains = [];
		this.servers = []; // DEPRECATED ?
		this.targetNodes = targetIDs;
	}

	save() {
		return new Promise((resolve, reject) => {
			let targetClassObj = this.preSave();
			let user = { email: consts.ADMIN_USER };
			serverClassModule.saveTargetClasses([targetClassObj], user, (logs) => {
				const results = logs.map(l => l.createApiResponse(Entities.ServerClass.ID, Entities.ServerClass.UUID));

				if (results[0].error)
					return reject(results[0].error);

				resolve(results[0]);
			});
		});
	}
};
