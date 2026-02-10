/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

global.appRoot = __dirname;

const consts = require('./consts.js');
const { versions } = require('./modules/version.js');

// Initialize OpenTelemetry before express
const openTelemetry = require('./modules/openTelemetry.js');
openTelemetry.init();

var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var passport = require('passport');
var localStrategy = require('passport-local').Strategy;
var session = require('express-session');
var layouts = require('express-ejs-layouts');
var fs = require('fs');
var dns = require('dns');
var { execSync } = require('child_process');
var https = require('https');
var winston = require('winston');
var os = require('os');
var childProcess = require('child_process');
var exec = childProcess.exec;
var async = require('async');
var interopDB = require('interop-db');
var moment = require('moment');

var EventEmitter = require('eventemitter3');
var WebSocket = require('websocket').server;

const { apidoc: { version: APIVersion } } = require('./package.json');
var utils = require('./utils.js');
var logger = require('./logger.js');
var bootstrapper = require('./bootstrapper.js');
var websocket = require('./modules/websocket.js');
var websocketCommon = require('./modules/websocketCommon');
var config = require('./modules/config.js');
var generalSettingsModule = require('./modules/generalSettings.js');
var mongoDBModule = require('./modules/mongoDB.js');
var lockModule = require('./modules/lock.js');
var managementClusterModule = require('./modules/managementCluster.js');
var systemMessages = require('./systemMessages.js');
var cert = require('./modules/cert.js');
var ClientCertStrategy = require('./modules/clientCertStrategy').Strategy;
var { Entities, MongoError, SystemMessage, SystemAdminMessage, InteropDBError, Differentiators } = require('./modules/error.js');

require('winston-mongodb').MongoDB;

var winstonLogLevels = {
	ERROR: 0,
	WARNING: 1,
	INFO: 2,
	DEBUG: 3
};

var winstonLogLevelsColors = {
	DEBUG: 'green',
	INFO: 'cyan',
	WARNING: 'yellow',
	ERROR: 'red'
};

process.on('uncaughtException', function(err) {
	if (err.errno == consts.serverErrors.ECONNRESET)
		new SystemMessage(systemMessages.SERVER_CONNECTION_RESET).addInfo(Entities.Stack, err.stack).log();
	else {
		const systemMsg = new SystemMessage(systemMessages.APP_UNCAUGHT_EXCEPTION).addInfo(Entities.Stack, err.stack);

		console.log(systemMsg);

		if (global.app)
			systemMsg.log();

		process.exit(1);
	}
});

process.on('SIGUSR2', async function() {
	logger.sysDEBUG('Received signal SIGUSR2');
	const timestamp = moment().format('YYYY-MM-DD_HH-mm-ss');
	const dumpDir = `/var/log/nvmesh/mgmtStats/${timestamp}/`;
	await utils.dumpInternalState(dumpDir);
});

var eventEmitter = new EventEmitter();

var winstonLogger = winston.createLogger({ levels: winstonLogLevels });
winston.addColors(winstonLogLevelsColors);

var routes = require('./routes/index');
var cluster = require('./routes/cluster');
var login = require('./routes/login');
var users = require('./routes/users');
var logs = require('./routes/logs');
var servers = require('./routes/servers');
var volumes = require('./routes/volumes');
var clients = require('./routes/clients');
var disks = require('./routes/disks');
var diskClasses = require('./routes/diskClasses');
var keys = require('./routes/keys');
var volumeSecurityGroups = require('./routes/volumeSecurityGroups');
var serverClasses = require('./routes/serverClasses');
var volumeProvisioningGroup = require('./routes/volumeProvisioningGroups');
var backups = require('./routes/backups');
var kernels = require('./routes/kernels.js');
var ofeds = require('./routes/ofeds.js');
var operatingSystems = require('./routes/operatingSystems.js');
var platforms = require('./routes/platforms.js');
var releases = require('./routes/releases.js');
var artifacts = require('./routes/artifacts.js');
var upgrades = require('./routes/upgrades.js');
var upgradeScenarios = require('./routes/upgradeScenarios.js');
var upgradeStepsScenarios = require('./routes/upgradeStepsScenarios.js');
var upgradeSteps = require('./routes/upgradeSteps.js');
var upgradeAgents = require('./routes/upgradeAgents.js');
var components = require('./routes/components.js');
var managementCluster = require('./routes/managementCluster');
var generalSettings = require('./routes/generalSettings');
var configurationProfiles = require('./routes/configurationProfiles');
var nvmeshMetadata = require('./routes/nvmeshMetadata');
var mongoDB = require('./routes/mongoDB');
var techniciansScreen = require('./routes/techniciansScreen');
var kafkaRoutes = require('./routes/kafka');
const kafka = require('./modules/kafka');
const isServiceAvailable = require('./middlewares/isServiceAvailable');
const isAuthenticated = require('./middlewares/isAuthenticated');
const shouldChangePassword = require('./middlewares/shouldChangePassword');
const isValidRequest = require('./middlewares/isValidRequest');

// eslint-disable-next-line no-global-assign
app = express();

app.set('concurrentSessions', {});

app.set('projectRoot', __dirname);
app.set('syslogID', 'nvmeshmgr');
app.set('authorizedConnections', {});

app.set('communicationStats', {});

app.set('timedIntervals', { intervals: {} });

async function gracefulShutdown() {
	const kafkaConsumer = app.get('kafkaConsumer');
	app.set('isShuttingDown', true);

	new SystemMessage(systemMessages.APP_GRACEFUL_SHUTDOWN).log();

	if (kafkaConsumer && !kafka.isConsumerPaused) {
		await kafka.pauseConsumer();
	}

	await kafka.gracefulClearPendingCommits();

	// Graceful shutdown of kafka components
	if (kafkaConsumer) {
		await kafkaConsumer.disconnect();
	}

	await openTelemetry.stopInstrumentation();

	lockModule.acquireGlobalLock(() => {
		new SystemMessage(systemMessages.APP_GRACEFUL_SHUTDOWN_EXITING).log();
		lockModule.releaseGlobalLock(() => {
			process.exit(0);
		});
	});
}

process.on('SIGTERM', function() {
	logger.sysDEBUG('Received signal SIGTERM');
	gracefulShutdown();
});

process.on('SIGINT', () => {
	logger.sysDEBUG('Received signal SIGINT');
	gracefulShutdown();
});

process.on('SIGQUIT', () => {
	logger.sysDEBUG('Received signal SIGQUIT');
	gracefulShutdown();
});

function reloadCertificates() {
	const server = app.get('httpsServer');
	const webSocketServer = app.get('httpsWebSocketServer');

	if (!server || !webSocketServer) {
		new SystemAdminMessage(systemMessages.APP_CERT_RELOAD_NO_SERVERS).log();
		return;
	}

	if (!config.get('useSSL')) {
		logger.sysDEBUG('SSL is not enabled, skipping certificate reload');
		return;
	}

	try {
		const httpsServerAuthenticationMethod = config.get('server.auth.authenticationMethod');
		const useHAWithMTLS = config.get('websocket.auth.useHAWithMTLS');

		// Reload REST server certificates
		const restServerOptions = getServerOptions(
			'server.auth.tlsOptions',
			httpsServerAuthenticationMethod === consts.HTTPSServerAuthenticationMethods.MTLS
		);
		server.setSecureContext(restServerOptions);
		logger.sysDEBUG('REST server certificates reloaded successfully');

		// Reload WebSocket server certificates
		const haServerOptions = getServerOptions('websocket.auth.tlsOptions', useHAWithMTLS);
		webSocketServer.setSecureContext(haServerOptions);
		logger.sysDEBUG('WebSocket server certificates reloaded successfully');

		new SystemAdminMessage(systemMessages.APP_CERT_RELOAD_SUCCESS).log();
	} catch (err) {
		new SystemAdminMessage(systemMessages.APP_CERT_RELOAD_FAILED)
			.addInfo(Entities.Exception, err.message)
			.addInfo(Entities.Stack, err.stack)
			.log();
	}
}

process.on('SIGHUP', function() {
	logger.sysDEBUG('Received signal SIGHUP');
	reloadCertificates();
});

function getServerOptions(configName, isMTLS) {
	const serverTLSConfig = config.get(configName);
	const subdirName = configName.split('.')[0];

	if (!['websocket', 'server'].includes(subdirName)) {
		new SystemMessage(systemMessages.APP_CERT_DIRECTORY_UNKNOWN).log();
		process.exit(1);
	}

	const activeCertSubDir = cert.prepareCertSubDir(subdirName);

	let options = {
		key: cert.getCertFile(activeCertSubDir, serverTLSConfig.key, consts.CERT_TYPES.KEY),
		cert: cert.getCertFile(activeCertSubDir, serverTLSConfig.cert, consts.CERT_TYPES.CERT)
	};

	if (serverTLSConfig.limitToSSLCipherSuites.length)
		options.ciphers = serverTLSConfig.limitToSSLCipherSuites;

	if (isMTLS) {
		options.ca = cert.getCertFile(activeCertSubDir, serverTLSConfig.ca, consts.CERT_TYPES.CA);
		options.rejectUnauthorized = true; // if certificate is not signed by the CA then drop the connection
		options.requestCert = true; // client have to send its own Cert
	}

	return options;
}

bootstrapper.afterModulesLoaded(() => {});

function doAfterDatabasesArePopulatedAndConnected() {
	var mongoClient = app.get('mongoClient');
	var db = app.get('db');
	var userCollection = db.collection('user');

	generalSettingsModule.load({}, function(err, GLOBAL_SETTINGS) {
		if (err) {
			new SystemMessage(systemMessages.APP_GENERAL_SETTINGS_LOAD_FAILED).log();
			process.exit(1);
		} else
			logger.sysDEBUG('Settings loaded successfully');

		app.use(session({
			secret: 'SomeVeryOriginalSecretKey',
			resave: true,
			saveUninitialized: true
		}));

		app.use(passport.initialize());
		app.use(passport.session());

		app.set('eventEmitter', eventEmitter);

		// view engine setup
		app.set('views', path.join(__dirname, 'views'));
		app.set('view engine', 'ejs');
		app.set('managementLogger', winstonLogger);
		app.use(layouts);

		app.use(favicon(__dirname + '/public/images/favicon.ico'));

		var jsonLimit = config.get('MAX_JSON_SIZE');

		if (GLOBAL_SETTINGS.MAX_JSON_SIZE)
			jsonLimit = GLOBAL_SETTINGS.MAX_JSON_SIZE + 'mb';

		app.use(bodyParser.json({ limit: jsonLimit }));
		app.use(bodyParser.urlencoded({ extended: false }));
		app.use(cookieParser());
		app.use(express.static(path.join(__dirname, 'public')));

		app.locals.user = 'placeholder';

		app.set('APIVersion', APIVersion);

		utils.readVersionFile((err, version) => {
			if (err || !version.changeID) {
				new SystemMessage(systemMessages.APP_VERSION_UNKNOWN).addInfo(Entities.Exception, err).log();
				process.exit(1);
			}
			app.set('changeID', version.changeID);
		});

		app.use('/login', login);

		const routerAPI = express.Router();
		routerAPI.use(isServiceAvailable, isAuthenticated, shouldChangePassword);

		routerAPI.use('/cluster', cluster);
		routerAPI.use('/users', isValidRequest, users);
		routerAPI.use('/logs', isValidRequest, logs);
		routerAPI.use('/servers', isValidRequest, servers);
		routerAPI.use('/volumes', isValidRequest, volumes);
		routerAPI.use('/clients', isValidRequest, clients);
		routerAPI.use('/disks', isValidRequest, disks);
		routerAPI.use('/diskClasses', isValidRequest, diskClasses);
		routerAPI.use('/keys', isValidRequest, keys);
		routerAPI.use('/volumeSecurityGroups', isValidRequest, volumeSecurityGroups);
		routerAPI.use('/serverClasses', isValidRequest, serverClasses);
		routerAPI.use('/volumeProvisioningGroups', isValidRequest, volumeProvisioningGroup);
		routerAPI.use('/backups', backups);
		routerAPI.use('/kernels', isValidRequest, kernels);
		routerAPI.use('/ofeds', isValidRequest, ofeds);
		routerAPI.use('/operatingSystems', isValidRequest, operatingSystems);
		routerAPI.use('/platforms', isValidRequest, platforms);
		routerAPI.use('/releases', isValidRequest, releases);
		routerAPI.use('/artifacts', isValidRequest, artifacts);
		routerAPI.use('/upgrades', isValidRequest, upgrades);
		routerAPI.use('/upgradeScenarios', isValidRequest, upgradeScenarios);
		routerAPI.use('/upgradeStepsScenarios', isValidRequest, upgradeStepsScenarios);
		routerAPI.use('/upgradeSteps', isValidRequest, upgradeSteps);
		routerAPI.use('/upgradeAgents', isValidRequest, upgradeAgents);
		routerAPI.use('/components', isValidRequest, components);
		routerAPI.use('/managementCluster', managementCluster);
		routerAPI.use('/generalSettings', isValidRequest, generalSettings);
		routerAPI.use('/configurationProfiles', isValidRequest, configurationProfiles);
		routerAPI.use('/nvmeshMetadata', nvmeshMetadata);
		routerAPI.use('/mongoDB', mongoDB);
		routerAPI.use('/techniciansScreen', techniciansScreen);
		routerAPI.use('/kafka', kafkaRoutes);

		app.use('/', routerAPI);
		app.use('/', isAuthenticated, shouldChangePassword, routes);

		// catch 404 and forward to error handler
		app.use(function(req, res) {
			if (req.headers.accept && req.headers.accept.toLowerCase().includes('html')) {
				if (config.get('useSSL'))
					res.setHeader('Strict-Transport-Security', 'max-age=31536000');

				const renderData = {};
				if (req.headers['x-pjax'])
					renderData.layout = false;

				renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };
				renderData.componentName = consts.componentsPages.pageNotFound;

				return res.render('react', renderData);
			}

			return res.status(404).json({ success: false, err: '404 (Not Found)' });
		});

		//error handlers
		//development error handler
		//will print stacktrace
		//Setting isDev because getting 'env' parameter is costy (performance wise).
		var environment = config.get('productionEnvironment') === false ? consts.environment.DEVELOPMENT : consts.environment.PRODUCTION;

		logger.logToConsole('Setting environment: ' + environment);

		var loggingLevel = GLOBAL_SETTINGS.loggingLevel || consts.loggingLevel.INFO;
		logger.logToConsole('Setting loggingLevel: ' + loggingLevel);

		if (config.get('productionEnvironment') === false) {
			app.set('isDev', true);
			app.use(function(err, req, res) {
				res.status(err.status || 500).json({
					message: err.message,
					error: err
				});
			});
		} else {
			app.set('isDev', false);
			//production error handler
			//no stacktraces leaked to user
			app.use(function(err, req, res) {
				res.status(err.status || 500).json({
					message: err.message,
					error: {}
				});
			});
		}

		function createServerAndSockets(err) {
			var server;
			var webSocketServer;
			var webSocketServerPort = config.get('webSocketServerPort');
			var port = config.get('port');

			if (err) {
				new SystemMessage(systemMessages.APP_CREATE_SERVER_BOOTSTRAP_FAILED).addInfo(Entities.Error, err).log();
				process.exit(1);
			}

			function connectionEstablished(port) {
				logger.logToConsole('Listening on port ' + port);
			}

			function setServerTimeout(server) {
				server.setTimeout(config.get('server.timeout'));
				server.keepAliveTimeout = config.get('server.keepAliveTimeout');
			}

			function handleRawSocketRequestToMGMT(req) {
				websocketCommon.handleRawSocketRequest(req, websocket.handleNewConnection);
			}

			if (config.get('useSSL')) {
				const restServerOptions = getServerOptions(
					'server.auth.tlsOptions',
					httpsServerAuthenticationMethod === consts.HTTPSServerAuthenticationMethods.MTLS
				);

				server = https.createServer(restServerOptions, app);
				setServerTimeout(server);
				server.listen(port, function() {
					connectionEstablished(port);
				});

				const haServerOptions = getServerOptions('websocket.auth.tlsOptions', useHAWithMTLS);
				webSocketServer = https.createServer(haServerOptions, express()).listen(webSocketServerPort, function() {
					connectionEstablished(webSocketServerPort);
				});

				// Store server references for certificate reloading
				app.set('httpsServer', server);
				app.set('httpsWebSocketServer', webSocketServer);
			} else {
				server = app.listen(port, function() {
					connectionEstablished(port);
				});
				setServerTimeout(server);

				webSocketServer = express().listen(webSocketServerPort, function() {
					connectionEstablished(webSocketServerPort);
				});
			}

			if (server) {
				logger.sysDEBUG('Creating socket');
				var serverConfig = config.get('websocket.serverConfig');
				serverConfig.httpServer = webSocketServer;

				var wsServer = new WebSocket(serverConfig);

				wsServer.on('request', handleRawSocketRequestToMGMT);

				//Create socket
				var io = require('socket.io')(server);
				var clientCount = 1;
				app.set('socket', io);

				io.on('connection', function(socket) {
					socket.clientID = 'GUI_client_' + clientCount;
					clientCount += 1;
					logger.sysDEBUG(socket.clientID + ' connected to socket.io!');

					function onEventCallback(eventArgs) {
						socket.emit(eventArgs.eventName, eventArgs);
					}

					websocketCommon.addNewSocketIO(socket.clientID, onEventCallback);

					socket.on('registerToEvent', function(eventToRegister) {
						websocketCommon.addEventsToPendingClusterEventSubscriptions(socket.clientID, [eventToRegister.name],
							consts.eventSubscriptionModes.REGISTER);
					});

					socket.on('unregisterFromEvents', function(events) {
						websocketCommon.addEventsToPendingClusterEventSubscriptions(socket.clientID, events, consts.eventSubscriptionModes.UNREGISTER);
					});

					socket.on('disconnect', function() {
						logger.sysDEBUG(socket.clientID + ' disconnected');
						websocketCommon.removeSocketIO(socket.clientID);
						// we need to save all the events this client is registered to
						websocketCommon.unregisterFromAllSocketEvents(socket.clientID, true);
					});
				});

				if (httpsServerAuthenticationMethod === consts.HTTPSServerAuthenticationMethods.MTLS) {
					const db = app.get('db');
					const userCollection = db.collection('user');

					userCollection.updateMany(
						{ shouldChangePassword: { $exists: true } },
						{ $set: { shouldChangePassword: false } },
						err => {
							if (err)
								new MongoError(err).log();
						}
					);
				}
			}
		}

		function setNodeVersion() {
			var nodeVersionCmd = 'node -v';
			try {
				exec(nodeVersionCmd, function(err, stdout, stderr) {
					if (err)
						logger.sysDEBUG(`Error while trying to get nodeJS version, err: ${JSON.stringify(err)} output: ${stderr}`);
					else
						app.set('nodeVersion', stdout.slice(1).trim());
				});
			} catch (e) {
				logger.sysDEBUG('Failed to spawn a process that gets nodeJS version', e);
			}
		}

		function setMongoVersion(db) {
			var adminDb = db.admin();
			adminDb.serverStatus(function(err, info) {
				if (err) {
					const mongoErr = new MongoError(err);
					if (mongoErr.isUnauthorizedError) {
						new SystemAdminMessage(systemMessages.LIMITED_MONGO_ADMIN_FEATURE).log();
						app.set('hasMongoRootRole', false);
					} else {
						mongoErr.log();
					}
				} else {
					app.set('mongoVersion', info.version);
					app.set('hasMongoRootRole', true);
				}
			});
		}

		function setIsMongoReplicated(db, cb) {
			var adminDb = db.admin();
			adminDb.replSetGetStatus(function(err) {
				if (err) {
					const mongoErr = new MongoError(err);
					if (mongoErr.isUnauthorizedError) {
						new SystemAdminMessage(systemMessages.LIMITED_MONGO_RS_FEATURE).log();
						app.set('hasMongoClusterManagerRole', false);
						cb();
					} else if (mongoErr.isNoReplicationEnabledError) {
						app.set('isMongoReplicated', false);
						app.set('hasMongoClusterManagerRole', true);
						cb();
					} else {
						mongoErr.log();
					}
				} else {
					app.set('isMongoReplicated', true);
					app.set('hasMongoClusterManagerRole', true);
					cb();
				}
			});
		}

		//Add MongoDB transport - pay attention that expireAfterSeconds is set only on collection creation!
		winstonLogger.add(new winston.transports.MongoDB({ db: mongoClient,
			collection: 'log',
			level: 'INFO',
			metaKey: 'meta',
			capped: false,
			expireAfterSeconds: consts.DEFAULT_LOG_EXPIRATION_IN_SECONDS }));

		const httpsServerAuthenticationMethod = config.get('server.auth.authenticationMethod');
		const useHAWithMTLS = config.get('websocket.auth.useHAWithMTLS');
		if (!Object.values(consts.HTTPSServerAuthenticationMethods).includes(httpsServerAuthenticationMethod)) {
			new SystemMessage(systemMessages.UNKNOWN_AUTH_METHOD)
				.addInfo(Entities.httpsServerAuthenticationMethod, httpsServerAuthenticationMethod).log();
			process.exit(1);
		}

		//Send authentication
		if (httpsServerAuthenticationMethod === consts.HTTPSServerAuthenticationMethods.CREDENTIALS)
			passport.use(new localStrategy(function(email, password, done) {
				utils.authenticate(email, password, function(err, user) {
					if (!user)
						return done(null, false, { message: 'Wrong credentials' });

					return done(null, user);
				});
			}));
		else if (httpsServerAuthenticationMethod === consts.HTTPSServerAuthenticationMethods.MTLS)
			passport.use(new ClientCertStrategy(function(clientCert, done) {
				utils.authenticateClientCert(clientCert, (err, user) => {
					if (err)
						return done(err);
					if (!user)
						return done(null, false, { message: 'Failed to authenticate.' });

					return done(null, user);
				});
			}));

		passport.serializeUser(function(user, done) {
			done(null, user.email);
		});

		passport.deserializeUser(function(id, done) {
			userCollection.findOne({ email: id }, function(err, user) {
				if (err)
					done(new Error('User ' + id + ' does not exist'));

				done(null, user);
			});
		});

		//Configure PhoneHome email.
		userCollection.updateOne(
			{ _id: 'phoneHome@acme.com', email: consts.PHONE_HOME_USER },
			{ $set: { email: config.get('supportEmail').toLowerCase() } },
			function(err) {
				if (err)
					new MongoError(err).log();
			}
		);

		setNodeVersion();
		setMongoVersion(db);
		setIsMongoReplicated(db, mongoDBModule.checkClusterHealthPeriodically);

		function resolveIPAddress(callback) {
			function resolveFQDN(callback) {
				const fqdn = os.hostname();
				dns.lookup(fqdn, { family: 4 }, (err, address) => {
					if (!err) {
						logger.sysDEBUG(`Using FQDN's IP: ${address}`);
						return callback(address);
					}
					terminate(new SystemMessage(systemMessages.IP_IDENTIFICATION_FQDN_FAILED).addInfo(Entities.Exception, err.message));
				});
			}

			function resolveFirstInterfaceDefault(callback) {
				try {
					const defaultIP = execSync('ip route | grep -E "default .* src" | awk \'{print $9}\'')
						.toString().trim();
					if (defaultIP) {
						logger.sysDEBUG(`Using default route's IP: ${defaultIP}`);
						return callback(defaultIP);
					}
					terminate(new SystemMessage(systemMessages.IP_IDENTIFICATION_NO_DEFAULT_IP));
				} catch (err) {
					terminate(new SystemMessage(systemMessages.IP_IDENTIFICATION_DEFAULT_IP_FAILED).addInfo(Entities.Exception, err.message));
				}
			}

			function resolveSpecificInterface(interfaceName, callback) {
				const interfaces = os.networkInterfaces();
				const selectedInterface = interfaces[interfaceName]?.find(iface => iface.family === 'IPv4' && !iface.internal);
				if (selectedInterface) {
					logger.sysDEBUG(`Using specific interface (${interfaceName}) IP: ${selectedInterface.address}`);
					return callback(selectedInterface.address);
				}
				terminate(new SystemMessage(systemMessages.IP_IDENTIFICATION_SPECIFIC_INTERFACE_FAILED)
					.addInfo(Entities.InterfaceName, interfaceName));
			}

			function resolveFirstInterface(callback) {
				const firstIp = utils.getIPAddress();
				logger.sysDEBUG(`Using first available IP: ${firstIp}`);
				return callback(firstIp);
			}

			function terminate(systemMsg) {
				if (systemMsg) {
					systemMsg.log();
				}
				process.exit(1);
			}

			const ipIdentificationStrategy = config.get('ipIdentificationStrategy');

			if (ipIdentificationStrategy === consts.IP_STRATEGIES.MANUAL) {
				const forceIP = config.get('forceIP');
				if (!forceIP) {
					return terminate(new SystemMessage(systemMessages.IP_IDENTIFICATION_NO_FORCE_IP));
				}
				logger.sysDEBUG(`Using forced IP: ${forceIP}`);
				return callback(forceIP);
			}
			if (ipIdentificationStrategy === consts.IP_STRATEGIES.FQDN) {
				return resolveFQDN(callback);
			}
			if (ipIdentificationStrategy === consts.IP_STRATEGIES.FIRST_INTERFACE_DEFAULT) {
				return resolveFirstInterfaceDefault(callback);
			}
			if (ipIdentificationStrategy === consts.IP_STRATEGIES.SPECIFIC_INTERFACE) {
				const specificInterfaceName = config.get('specificInterfaceName');
				if (!specificInterfaceName) {
					return terminate(new SystemMessage(systemMessages.IP_IDENTIFICATION_NO_SPECIFIC_INTERFACE));
				}
				return resolveSpecificInterface(specificInterfaceName, callback);
			}
			if (ipIdentificationStrategy === consts.IP_STRATEGIES.FIRST_INTERFACE) {
				return resolveFirstInterface(callback);
			}

			return terminate(new SystemMessage(systemMessages.IP_IDENTIFICATION_INVALID_IDENTIFICATION_STRATEGY)
				.addInfo(Entities.ConfigurationValue, ipIdentificationStrategy));
		}

		var hostname = os.hostname();
		var oldManagementId = false;
		var managementIdPath = '/var/opt/nvmesh/mgr/management_id';
		var updateManagementIdPath = '/var/opt/nvmesh/mgr/update_management_id';
		var currIp = '';
		var managementIdSet = false;
		var managementId = '';

		async.whilst(function(callback) { callback(null, !managementIdSet); }, function(callback) {
			resolveIPAddress(ip => {
				currIp = ip;
				managementId = currIp + ':' + config.get('webSocketServerPort');
				logger.sysDEBUG('managementId = ' + managementId);

				if (fs.existsSync(managementIdPath)) {
					var savedManagementId = null;

					try {
						savedManagementId = fs.readFileSync(managementIdPath, 'utf8');
					} catch (ex) {
						new SystemMessage(systemMessages.APP_MGMT_ID_GET_FAILED).addInfo(Entities.Path, managementIdPath)
							.addInfo(Entities.Exception, ex).log();
					}
					if (savedManagementId) {
						if (savedManagementId === managementId) {
							managementIdSet = true;
						} else if (fs.existsSync(updateManagementIdPath)) {
							oldManagementId = savedManagementId;
							managementIdSet = true;
						}
					}
				} else {
					managementIdSet = true;
					try {
						fs.writeFileSync(managementIdPath, managementId);
					} catch (ex) {
						new SystemMessage(systemMessages.APP_MGMT_ID_SAVE_FAILED).addInfo(Entities.Path, managementIdPath)
							.addInfo(Entities.Exception, ex).log();
						managementIdSet = false;
					}
				}

				if (!managementIdSet) {
					new SystemMessage(systemMessages.APP_MGMT_ID_VERIFY_FAILED).log();
					setTimeout(callback, 10000);
				} else
					callback();
			});

		}, function() {
			app.set('hostname', hostname);
			app.set('ipAddress', currIp);
			app.set('webSocketServerPort', config.get('webSocketServerPort'));
			app.set('managementId', managementId);
			app.set('mgmtOutboundClusterConnections', {});
			app.set('mgmtInboundClusterConnections', {});
			new SystemMessage(systemMessages.APP_MGMT_ID).addInfo(Entities.ManagementID, managementId).log();

			lockModule.init(() => {
				const bootstrap = () => bootstrapper.bootstrap(createServerAndSockets);

				if (!oldManagementId) {
					bootstrap();
				} else {
					try {
						fs.unlinkSync(updateManagementIdPath);
					} catch (ex) {
						logger.sysDEBUG(`nvmeshmgr - could not delete ${updateManagementIdPath}, ex: ${ex}`);
					}

					try {
						fs.writeFileSync(managementIdPath, managementId);
					} catch (ex) {
						logger.sysDEBUG(`nvmeshmgr - could not write ${managementIdPath}, ex: ${ex}`);
					}

					managementClusterModule.deleteManagementFromClusterAndConfiguration(oldManagementId, bootstrap);
				}
			});
		});
	});
}

mongoDBModule.initDBsConnections(() => {
	// interopdb connect and fetch supportedDBCollectionVersions must come right after MongoDB connect and before the first db query
	interopDB.connect(consts.INTEROP_DB_RELATIVE_PATH, err => {
		if (err) {
			new SystemMessage(systemMessages.SQLITE_CONNECTION_ERROR)
				.addInfo(Entities.SQLITE.dbPath, consts.INTEROP_DB_RELATIVE_PATH)
				.addInfo(Entities.Error, new InteropDBError(err))
				.log();
			process.exit(1);
		}

		const rpmVersion = versions.rpmVersion;

		app.set('interopDB', interopDB);
		app.set('rpmVersion', rpmVersion);
		app.set('managementVersion', rpmVersion);
		app.set('versionsFromFile', versions.versionsFromFile);
		app.set('managementCompatibilityVersion', '1');

		interopDB.getSupportedMongoCollections(rpmVersion.split('-')[0], (results) => {
			const allDBsCollectionNames = Object.values(consts.dbCollections).concat(Object.values(consts.metadataDBCollections));
			const missingCollections = allDBsCollectionNames.filter((collectionName) => !results.data?.[collectionName]?.length);

			// make sure every collection of both mgmtDB and metadataDB got version from interop-db
			if (results.error || !results.data || missingCollections.length) {
				const systemMessage = new SystemMessage(systemMessages.LOAD_SUPPORTED_DB_COLLECTION_VERSIONS_FAILED);

				if (missingCollections.length)
					missingCollections.forEach((collectionName) => systemMessage.addInfo(Entities.Collection, collectionName, Differentiators.Missing));

				if (results.error)
					systemMessage.addInfo(Entities.Error, new InteropDBError(results.error));

				systemMessage.log();
				process.exit(1);
			}

			app.set('supportedDBCollectionVersions', results.data);

			mongoDBModule.populateInitialDBCollections((err) => {
				if (err) {
					logger.sysDEBUG('Failed to populate DB collections on startup');
					new MongoError(err).log();
					process.exit(1);
				}

				doAfterDatabasesArePopulatedAndConnected();
			});
		});
	});
});

module.exports = app;
