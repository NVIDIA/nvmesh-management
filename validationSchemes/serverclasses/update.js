const consts = require('../../consts.js');
const scheme = {
	$id: 'http://management/serverclasses/update.js',
	properties: {
		body: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					targetNodes: {
						type: 'array',
						items: {
							items: {
								$ref: consts.MANAGEMENT_DEFINITIONS + '/targetName.js'
							},
							minItems: 1
						}
					},
					description: { $ref: consts.MANAGEMENT_DEFINITIONS + '/description.js' },
					_id: { $ref: consts.MANAGEMENT_DEFINITIONS + '/objectID.js#/properties/_id' },
					uuid: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' },
					domains: {
						type: 'array',
						items: {
							$ref: consts.MANAGEMENT_DEFINITIONS + '/domain.js'
						}
					}
				},
				required: ['targetNodes', '_id', 'uuid']
			},
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = scheme;