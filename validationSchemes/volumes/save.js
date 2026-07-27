const consts = require('../../consts');

const scheme = {
	$id: 'http://management/volumes/save.js',
	properties: {
		body: { $ref: consts.MANAGEMENT_DEFINITIONS + '/volumesCreate.js' }
	},
	required: ['body']
};

module.exports = scheme;