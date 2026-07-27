const { Entities } = require('../../modules/error');
const { saveKeys, updateKeys, deleteKeys } = require('../../modules/key');
const { Entity } = require('./entity');

const user = { email: 'admin@excelero.com' };

exports.Key = class Key extends Entity {
	constructor(name, description) {
		super();
		this._id = name;
		this.uuid = null;
		this.description = description;
	}

	save() {
		let self = this;
		return new Promise(resolve => {
			let key = self.preSave();
			saveKeys([key], user, logs => {
				const results = logs.map(l => l.createApiResponse(Entities.Keys.ID, Entities.Keys.UUID));
				this.uuid = key.uuid;
				resolve(results[0]);
			});
		});
	}

	update() {
		let self = this;
		return new Promise(resolve => {
			let key = self.preSave();
			updateKeys([key], user, logs => {
				const results = logs.map(l => l.createApiResponse(Entities.Keys.ID, Entities.Keys.UUID));
				resolve(results[0]);
			});
		});
	}

	delete() {
		let self = this;
		return new Promise(resolve => {
			deleteKeys([{ _id: self._id, uuid: self.uuid }], logs => {
				const results = logs.map(l => l.createApiResponse(Entities.Keys.ID, Entities.Keys.UUID));
				resolve(results[0]);
			});
		});
	}

	getClientKey() {
		return {
			name: this._id,
			uuid: this.uuid
		};
	}
};