const consts = require('../../consts.js');

const schema = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/platform.js',
	type: 'object',
	properties: {
		name: { type: 'string' },
		description: { $ref: consts.MANAGEMENT_DEFINITIONS + '/description.js' },
		archTypeID: { type: 'integer' },
		operatingSystemID: { type: 'integer' },
		kernelID: { type: 'integer' },
		ofedID: { type: 'integer' }
	},
	required: ['name', 'archTypeID', 'operatingSystemID', 'kernelID', 'ofedID']
};

module.exports = schema;