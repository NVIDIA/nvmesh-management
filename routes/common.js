const { fetchEntityByID, count, tryParseJSON } = require('../utils');

const scope = {};

scope.fetchEntityByID = (entityType, entityID, isMongoObjectID, projection, cb) => {
	fetchEntityByID(entityType, entityID, isMongoObjectID, projection, (error, entity) => {
		if (error)
			return cb(error.createApiResponse());

		cb(entity);
	});
};

scope.getCountEntitiesHandler = (entityType, requiredFilter = {}, defaultFilter = {}) => {
	return (req, res) => {
		const requestFilter = tryParseJSON(req.query.filter) || {};

		// requiredFilter overwrites (requestFilter overwrites defaultFilter)
		const filter = Object.assign({}, defaultFilter, requestFilter, requiredFilter);

		count(entityType, filter, (_, number) => res.json(number));
	};
};

module.exports = scope;