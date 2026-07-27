let consts = require('../../consts.js');

let scheme = {
	$id: 'http://management/disks/evictdiskbydiskidsanduuids.js',
	properties: {
		body: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					uuid: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' }
				},
				required: ['diskID', 'uuid']
			},
			minItems: 1
		}
	}
};

module.exports = scheme;