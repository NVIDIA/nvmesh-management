var consts = require('../../consts.js');

var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/limitByConstrains.js',
	allOf: [
		{ anyOf: [
			{ not: { required: ['diskClasses'] } }, { properties: { diskClasses: { anyOf: [{ maxItems: 0 }, { type: 'null' }] } } }
		] },
		{ anyOf: [
			{ not: { required: ['serverClasses'] } }, { properties: { serverClasses: { anyOf: [{ maxItems: 0 }, { type: 'null' }] } } }
		] },
		{ anyOf: [
			{ not: { required: ['VPG'] } }, { properties: { VPG: { maxLength: 0 } } }
		] },
	]
};
module.exports = scheme;