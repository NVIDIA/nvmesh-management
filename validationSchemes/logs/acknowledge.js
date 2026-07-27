var consts = require('../../consts.js');
var scheme = {
	$id: 'http://management/logs/acknowledge.js',
	properties: {
		body: {
			type: 'object',
			properties: {
				id: { $ref: consts.MANAGEMENT_DEFINITIONS + '/objectID.js#/properties/_id' }
			},
			required: ['id']
		}
	},
	required: ['body']
};

module.exports = scheme;
