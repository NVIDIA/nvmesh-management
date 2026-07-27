var consts = require('../../consts.js');

let updateScheme = {
	$id: 'http://management/generalsettings/update.js',
	properties: {
		body: { $ref: consts.MANAGEMENT_DEFINITIONS + '/generalSettings.js' }
	},
	required: ['body']
};

module.exports = updateScheme;