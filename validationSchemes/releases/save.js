const consts = require('../../consts');

const schema = {
	$id: 'http://management/releases/save.js',
	properties: {
		body: {
			type: 'array',
			items: {
				type: 'object',
				unevaluatedProperties: false,
				properties: {
					releaseName: { $ref: consts.MANAGEMENT_DEFINITIONS + '/version.js' },
					inheritRelationsFrom: { $ref: consts.MANAGEMENT_DEFINITIONS + '/version.js' },
					createPlatforms: { type: 'boolean', default: false },
					platforms: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								name: { type: ['string', 'null'], minLength: 1 },
								os: {
									type: 'object',
									properties: {
										version: { type: 'string' },
										distributionType: { type: 'string' }
									},
									required: ['version', 'distributionType']
								},
								kernel: { type: 'string', minLength: 1 },
								ofed: { type: 'string', minLength: 1 },
								arch: { type: 'string', minLength: 1 },
								artifacts: {
									type: 'array',
									items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/artifactName.js' }
								}
							},
							required: ['name', 'artifacts']
						}
					}
				},
				required: ['releaseName', 'platforms'],
				if: {
					properties: { createPlatforms: { const: true } },
					required: ['createPlatforms']
				},
				then: {
					properties: {
						platforms: {
							items: {
								if: { not: { properties: { name: { type: 'null' } } } },
								then: { required: ['name', 'artifacts', 'os', 'kernel', 'ofed', 'arch'] }
							}
						}
					}
				}
			},
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = schema;