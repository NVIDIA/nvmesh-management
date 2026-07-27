const consts = require('../../consts');

const scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/volumeMetadata.js',
	type: 'object',
	maxBytes: consts.MAX_METADATA_SIZE
};

module.exports = scheme;