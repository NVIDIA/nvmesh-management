const consts = require('../../consts.js');

const scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/vsgNamesList.js',
	type: 'array',
	items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/vsgName.js' },
	minItems: 0
};

module.exports = scheme;