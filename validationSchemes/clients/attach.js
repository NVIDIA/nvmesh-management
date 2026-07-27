var consts = require('../../consts.js');
var scheme = {
	$id: 'http://management/clients/attach.js',
	properties: {
		body: {
			type: 'object',
			properties: {
				client: { $ref: consts.MANAGEMENT_DEFINITIONS + '/objectID.js#/properties/_id' },
				clientUUID: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' },
				volumes: {
					type: 'array',
					items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/attachVolume.js' },
					minItems: 1
				}
			},
			required: ['client', 'clientUUID', 'volumes']
		}
	},
	required: ['body']
};

module.exports = scheme;