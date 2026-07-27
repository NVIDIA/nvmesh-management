const consts = require('../../consts.js');
const scheme = {
	$id: 'http://management/servers/deletenic.js',
	properties: {
		body: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					nicID: { $ref: consts.MANAGEMENT_DEFINITIONS + '/nicID.js' },
					targetID: { $ref: consts.MANAGEMENT_DEFINITIONS + '/targetName.js' },
					targetUUID: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' }
				},
				required: ['nicID', 'targetID', 'targetUUID']
			},
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = scheme;