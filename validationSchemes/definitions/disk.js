var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/disk.js',
	type: 'object',
	properties: {
		diskID: { $ref: consts.MANAGEMENT_DEFINITIONS + '/diskName.js' },
		node_id: { $ref: consts.MANAGEMENT_DEFINITIONS + '/targetName.js' },
		model: { $ref: consts.MANAGEMENT_DEFINITIONS + '/modelName.js' }
	},
	required: ['diskID', 'node_id', 'model']
};

module.exports = scheme;