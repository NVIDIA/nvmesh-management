var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/configurationProfileHosts.js',
	type: 'array',
	items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/targetName.js' }
};
module.exports = scheme;