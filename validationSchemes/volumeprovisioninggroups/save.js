const consts = require('../../consts.js');
const scheme = {
	$id: 'http://management/volumeprovisioninggroups/save.js',
	properties: { 
		body: { $ref: consts.MANAGEMENT_DEFINITIONS + '/vpgsCreate.js' }
	}
};

module.exports = scheme;