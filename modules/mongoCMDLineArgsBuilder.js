const querystring = require('querystring');

const config = require('./config');
const consts = require('../consts');
const scope = {};

scope.buildMongoConnectionCommandlineArgsByConnectionName = (mongoConnectionName, mongodump = false) => {
	const mongoConf = config.get(mongoConnectionName);

	if (!mongoConf)
		return;

	return scope.buildMongoConnectionCommandlineArgs(config.get(mongoConnectionName), mongodump);
};

function buildMongoURI(mongoConf, mongodump = false) {
	let URI = `${mongoConf.protocol}://`;

	let queryString = {};

	if (mongoConf.options && mongoConf.options.replicaSetName)
		queryString['replicaSet'] = mongoConf.options.replicaSetName;

	if (mongodump && (!mongoConf.transport || !mongoConf.transport.TLS))
		queryString['tls'] = false;

	if (mongoConf.auth && mongoConf.auth.username && mongoConf.auth.password && mongoConf.auth.authenticationDatabase)
		URI += `${mongoConf.auth.username}:${mongoConf.auth.password}@`;

	URI += `${mongoConf.hosts}/${mongoConf.dbName}?${querystring.stringify(queryString)}`;

	return URI;
}

scope.buildMongoConnectionCommandlineArgs = (mongoConf, mongodump = false) => {
	let uri, db, host;

	if (mongoConf.protocol === consts.mongoConnectionProtocols.SRV) {
		const URI = buildMongoURI(mongoConf, mongodump);
		uri = mongodump ? `--uri='${URI}'` : URI;
	} else {
		db = mongodump ? `--db ${mongoConf.dbName}` : mongoConf.dbName;

		const replicateSetPrefix = mongoConf.options.replicaSetName && `${mongoConf.options.replicaSetName}/`;
		host = `--host=${replicateSetPrefix}${mongoConf.hosts}`;
	}

	let authenticationArgs = '';

	if (mongoConf.auth && mongoConf.auth.username && mongoConf.auth.password && mongoConf.auth.authenticationDatabase) {
		authenticationArgs += `--username=${mongoConf.auth.username} `;
		authenticationArgs += `--password='${mongoConf.auth.password}' `;
		authenticationArgs += `--authenticationDatabase=${mongoConf.auth.authenticationDatabase} `;

	} else if (!mongoConf.transport || !mongoConf.transport.TLS) {
		if (!mongodump)
			authenticationArgs += '--tls=false ';
	} else {
		authenticationArgs += mongodump ? '--ssl ' : '--tls ';
		authenticationArgs += '--authenticationDatabase=$external ';
		authenticationArgs += `--authenticationMechanism=${mongoConf.auth.authenticationMechanism} `;
		authenticationArgs += `${mongodump ? '--sslPEMKeyFile' : '--tlsCertificateKeyFile'}=${mongoConf.transport.certificateKeyFile} `;

		if (mongoConf.transport.passphrase)
			authenticationArgs += `${mongodump ? '--sslPEMKeyPassword' : '--tlsCertificateKeyFilePassword'}=${mongoConf.transport.passphrase} `;

		if (mongoConf.transport.CAFile)
			authenticationArgs += `${mongodump ? '--sslCAFile' : '--tlsCAFile'}=${mongoConf.transport.CAFile} `;
	}

	return `${authenticationArgs} ${mongoConf.protocol === consts.mongoConnectionProtocols.SRV ? uri : `${db} ${host}`}`;
};

module.exports = scope;