const consts = require('../../consts.js');

const schema = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/artifact.js',
	type: 'object',
	properties: {
		name: { $ref: consts.MANAGEMENT_DEFINITIONS + '/artifactName.js' },
		platforms: {
			type: 'array',
			items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/platform.js' }
		}
	},
	required: ['name']
};

module.exports = schema;