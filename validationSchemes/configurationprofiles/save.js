var consts = require('../../consts.js');
var scheme = {
	$id: 'http://management/configurationprofiles/save.js',
	properties: {
		body: {
			type: 'array',
			items: {
				$ref: consts.MANAGEMENT_DEFINITIONS + '/configurationProfile.js'
			},
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = scheme;