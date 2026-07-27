var consts = require('../../consts.js');
var scheme = {
	$id: 'http://management/volumes/extend.js',
	properties: {
		body: {
			type: 'array',
			items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/extendedVolume.js' },
			minItems: 1
		}
	}
};
module.exports = scheme;
