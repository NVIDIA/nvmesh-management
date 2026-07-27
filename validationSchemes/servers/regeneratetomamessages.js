var scheme = {
	$id: 'http://management/servers/regeneratetomamessages.js',
	properties: {
		body: {
			type: 'object',
			properties: {
				zoneID: {
					type: 'integer',
					minimum: 1
				}
			},
			required: ['zoneID']
		}
	}
};

module.exports = scheme;