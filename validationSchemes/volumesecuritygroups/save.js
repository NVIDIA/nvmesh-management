var consts = require('../../consts.js');
var scheme = {
	$id: 'http://management/volumesecuritygroups/save.js',
	properties: {
		body: {
			type: 'array',
			items: {
				$ref: consts.MANAGEMENT_DEFINITIONS + '/vsg.js'
			},
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = scheme;