// definitions/componentVersion.js
const consts = require('../../consts');
const idOnlyObject = {
	type: 'object',
	properties: {
		ID: { type: 'integer' }
	},
	required: ['ID']
};
const schema = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/component.js',
	type: 'object',
	properties: {
		version: { $ref: consts.MANAGEMENT_DEFINITIONS + '/version.js' },
		componentID: { type: 'integer' },
		componentTypeID: { type: 'integer' },
		platforms: {
			type: 'array',
			items: idOnlyObject
		},
		requirements: {
			type: 'array',
			items: idOnlyObject
		},
		compatibilities: {
			type: 'array',
			items: idOnlyObject
		}
	},
	required: ['version', 'componentID', 'componentTypeID']
};

module.exports = schema;