var consts = require('../../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS_ENTITIES + '/diskSegmentEntity.js',
	type: 'object',
	properties: {
		diskID: { type: 'string' },
		type: { type: 'string' },
		lbs: { type: 'integer' },
		lbe: { type: 'integer' },
	},
	required: []
};

scheme.required = Object.keys(scheme.properties);

module.exports = scheme;