var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/user.js',
	type: 'object',
	properties: {
		email: { type: 'string', format: 'email' },
		role: { 'enum': [consts.userRoles.OBSERVER, consts.userRoles.ADMIN] },
		notificationLevel: { 'enum': [consts.loggingLevel.NONE, consts.loggingLevel.WARNING, consts.loggingLevel.ERROR] },
		password: { type: 'string', minLength: 1, maxLength: 32 },
		confirmationPassword: { type: 'string' },
		relogin: { type: 'boolean' }
	},
	required: ['email', 'role', 'notificationLevel', 'password', 'confirmationPassword']
};

module.exports = scheme;