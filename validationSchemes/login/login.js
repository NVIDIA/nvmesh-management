var scheme = {
	$id: 'http://management/login.js',
	properties: {
		body: {
			type: 'object',
			properties: {
				username: { type: 'string' },
				password: { type: 'string' }
			},
			required: ['username', 'password']
		}
	},
	required: ['body']
};

module.exports = scheme;