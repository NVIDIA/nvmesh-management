var consts = require('../../consts.js');
var scheme = {
	$id: 'http://management/volumes/update.js',
	properties: {
		body: {
			type: 'array',
			items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/updatedVolume.js' },
			minItems: 1
		}
	}
};
module.exports = scheme;
