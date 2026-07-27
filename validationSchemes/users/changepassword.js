const userScheme = require('../definitions/user.js');

const scheme = {
	$id: 'http://management/users/changepassword.js',
	properties: {
		body: {
			type: 'object',
			properties: {
				password: userScheme.properties.password,
				confirmationPassword: userScheme.properties.confirmationPassword
			},
			required: ['password', 'confirmationPassword']
		}
	},
	required: ['body']
};

module.exports = scheme;