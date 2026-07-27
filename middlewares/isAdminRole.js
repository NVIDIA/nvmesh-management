const { isAdmin } = require('../utils');
const { SystemAdminMessage } = require('../modules/error');
const systemMessages = require('../systemMessages');


const isAdminRole = (req, res, next) => {
	if (!isAdmin(req.user))
		return res.status(401).json(new SystemAdminMessage(systemMessages.UNAUTHORIZED).toApiResponse());
		
	next();
};

module.exports = isAdminRole;
