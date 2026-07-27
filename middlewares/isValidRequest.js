const logger = require('../logger');
const systemMessages = require('../systemMessages');
const { SystemAdminMessage, Entities } = require('../modules/error');
const { getValidationFunctionByScheme, getValidationErrors } = require('../modules/validation');

const isValidRequest = (req, res, next) => {
	const isAcceptHTML = req.headers.accept.toLowerCase().includes('html');

	if (isAcceptHTML)
		return next();

	const route = req.baseUrl.split('/')[1];
	const endpoint = req.path.split('/')[1];
	const scheme = 'http://management/' + route + (endpoint ? '/' + endpoint : '') + '.js';
	const validate = getValidationFunctionByScheme(scheme);

	if (!validate)
		return next();

	if (validate(req))
		return next();

	const validationErrors = getValidationErrors(validate.errors);
	logger.sysDEBUG('Invalid REST request, validationErrors: ', validationErrors);
	res.status(422).json(new SystemAdminMessage(systemMessages.UNPROCESSABLE_ENTITY).addInfo(Entities.Error, validationErrors).createApiResponse());
};

module.exports = isValidRequest;
