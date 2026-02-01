/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

var scope = {};
module.exports = scope;

let logger = require('../logger.js');
var systemMessages = require('../systemMessages.js');
var consts = require('../consts.js');

var path = require('path');
const { KafkaJSError } = require('kafkajs');
let utils = require('../utils.js');
let entityToCreateLinkFn = {}, logLevelToSysLogLevelFn = {};

scope.afterModuleLoaded = function() {
	logger = require('../logger.js');
	utils = require('../utils.js');
	entityToCreateLinkFn = {
		[scope.Entities.Target.ID]: logger.createTargetLink,
		[scope.Entities.Client.ID]: logger.createClientLink,
		[scope.Entities.Volume.ID]: logger.createVolumeLink,
		[scope.Entities.Volume.name]: logger.createVolumeLink,
		[scope.Entities.Drive.ID]: logger.createDiskLink,
		[scope.Entities.User.ID]: logger.createUserLink,
		[scope.Entities.User.email]: logger.createUserLink,
		[scope.Entities.ConfigurationProfile.ID]: logger.createConfigurationProfileLink,
		[scope.Entities.NIC.ID]: logger.createNICLink,
		[scope.Entities.VPG.ID]: logger.createVPGLink,
		[scope.Entities.VPG.name]: logger.createVPGLink,
	};
	logLevelToSysLogLevelFn = {
		[consts.loggingLevel.DEBUG]: logger.sysDEBUG,
		[consts.loggingLevel.VERBOSE]: logger.sysVERBOSE,
		[consts.loggingLevel.INFO]: logger.sysINFO,
		[consts.loggingLevel.WARNING]: logger.sysWARNING,
		[consts.loggingLevel.ERROR]: logger.sysERROR,
	};
};
scope.createMetaObj = (header, links = {}, user, id, isSecurity, isAudit, managementID = app.get('managementId')) => {
	return { header, links, user, id, isSecurity, isAudit, managementID };
};

scope.Entities = {
	Error: 'error',
	ErrorEvent: 'errorEvent',
	Stack: 'stack',
	Exception: 'exception',
	StdOut: 'stdout',
	StdErr: 'stderr',
	ErrorCode: 'errorCode',
	ExitCode: 'exitCode',
	Signal: 'signal',
	Path: 'path',
	Port: 'port',
	Content: 'content',
	UseSSL: 'useSSL',
	IP: 'IP',
	Iport: 'Iport',
	SystemInfo: 'systemInfo',
	ManagementDefaultDomain: 'managementDefaultDomain',
	ManagementID: 'managementID',
	ManagementDBUUID: 'managementDBUUID',
	ManagementVersion: 'managementVersion',
	ManagementDescribe: 'managementDescribe',
	ManagementHostname: 'managementHostname',
	ConfigurationVersion: 'configurationVersion',
	ConnectionDirection: 'connectionDirection',
	module: 'module',
	encryptionParams: 'encryptionParams',
	ConfigurationValue: 'configurationValue',
	InterfaceName: 'interfaceName',
	FeatureCompatibilityType: 'featureCompatibilityType',
	FeatureCompatibilityVersion: 'featureCompatibilityVersion',
	dbEra: 'dbEra',
	DocumentID: 'DocumentID',
	Collection: 'Collection',
	UpgradeScript: 'UpgradeScript',
	WSProtocolVersion: 'wsProtocolVersion',
	ChangeID: 'changeID',
	Count: 'count',
	modules: {
		security: 'security'
	},
	ApiRequest: {
		UUID: 'ApiRequestUUID',
		URL: 'ApiRequestURL',
		address: 'ApiRequestAddress',
		timestamp: 'ApiRequestTimestamp',
		user: 'ApiRequestUser',
		role: 'ApiRequestRole',
		managementID: 'ApiRequestManagementID'
	},
	KafkaConfigs: {
		Replica: 'kafkaConfigReplica',
		Partition: 'kafkaConfigPartition'
	},
	KafkaTopics: 'kafkaTopics',
	KafkaConsumerGroup: {
		ID: 'KafkaConsumerGroupID',
		Description: 'description'
	},
	KafkaConsumer: {
		ID: 'kafkaConsumerID'
	},
	httpsServerAuthenticationMethod: 'httpsServerAuthenticationMethod',
	ManagementCluster: {
		URL: 'url',
		ID: 'managementClusterID'
	},
	Backup: {
		hourlyBackupInterval: 'hourlyBackupInterval'
	},
	Event: {
		name: 'eventName'
	},
	Time: {
		seconds: 'seconds',
		minutes: 'minutes'
	},
	Domain: {
		scope: 'domainScope',
		identifier: 'domainIdentifier'

	},
	Volume: {
		ID: 'volumeID',
		UUID: 'volumeUUID',
		status: 'volumeStatus',
		action: 'volumeAction',
		numberOfMirrors: 'volumeNumberOfMirrors',
		type: 'volumeType',
		RAIDLevel: 'volumeRaidLevel',
		name: 'volumeName',
		minimumCapacity: 'minimumCapacity',
		definition: 'volumeDefinition',
		capacity: 'volumeCapacity',
		reservation: 'volumeReservation',
		encryptionCommand: 'encryptionCommand',
		metadataVolumeID: 'metadataVolumeID',
		sourceVolumeID: 'sourceVolumeID',
		emulation: 'volumeEmulation',
		referenceID: 'attachmentReferenceID'
	},
	Attachment: {
		status: 'status'
	},
	Chunk: {
		UUID: 'chunkUUID'
	},
	PRaid: {
		UUID: 'pRaidUUID'
	},
	DiskSegment: {
		NAME: 'diskSegment',
		UUID: 'diskSegmentUUID',
		start: 'diskSegmentStart',
		end: 'diskSegmentEnd',
		type: 'diskSegmentType',
		nodeID: 'diskSegmentNodeID',
		diskID: 'diskSegmentDiskID',
		attribute: 'diskSegmentAttribute'
	},
	Target: {
		ID: 'targetID',
		UUID: 'targetUUID',
		status: 'targetStatus',
		zone: 'targetZone',
		reportID: 'reportID',
		tomaToken: 'tomaToken',
		hostname: 'hostname',
		featureCompatibilityVersion: 'targetFeatureCompatibilityVersion',
		executingTOMA: 'executingTOMA'
	},
	TomaLeader: {
		Zone: 'leaderZoneID',
		FeatureCompatibilityVersion: 'zoneFeatureCompatibilityVersion'
	},
	Drive: {
		UUID: 'driveUUID',
		ID: 'driveSerial',
		status: 'driveStatus',
		vendor: 'driveVendor',
		health: 'driveHealth',
		autoEvictReason: 'driveAutoEvictReason',
		endurancePercentage: 'driveEndurancePercentage',
		availableBlocks: 'driveAvailableBlocks',
		model: 'driveModel',
		GPT: {
			firstUsableLBA: 'GPTFirstUsableLBA',
			lastUsableLBA: 'GPTLastUsableLBA',
			partitionGUID: 'GPTPartitionGUID',
			partitionType: 'GPTPartitionType',
			dbUUID: 'GPTDBUUID',
			diskGUID: 'GPTDiskGUID'
		}
	},
	NIC: {
		ID: 'NICID',
		UUID: 'NICUUID',
		GUID: 'NICGUID',
		status: 'NICStatus',
		MTU: 'NICMTU'
	},
	Client: {
		ID: 'clientID',
		UUID: 'clientUUID',
		status: 'clientStatus',
		authorizedKey: 'clientAuthorizedKey',
		featureCompatibilityVersion: 'clientFeatureCompatibilityVersion'
	},
	ConfigurationNode: {
		ID: 'configurationNodeID'
	},
	Mongo: {
		host: 'host',
		replicaName: 'replicaName',
		URI: 'URI',
		projection: 'projection'
	},
	SQLITE: {
		dbPath: 'dbPath'
	},
	Socket: {
		ID: 'socketID',
		isConnected: 'socketIsConnected',
		state: 'socketState',
		reasonCode: 'socketReasonCode',
		description: 'socketDescription'
	},
	DriveClass: {
		ID: 'driveClassID',
		UUID: 'driveClassUUID',
		description: 'driveClassDescription'
	},
	ServerClass: {
		ID: 'serverClassID',
		UUID: 'serverClassUUID',
		description: 'serverClassDescription'
	},
	VPG: {
		ID: 'vpgID',
		UUID: 'vpgUUID',
		name: 'vpgName',
		type: 'vpgType',
		capacity: 'vpgCapacity',
		definition: 'vpgDefinition',
	},
	VSG: {
		ID: 'vsgID',
		UUID: 'vsgUUID',
		description: 'vsgDescription',
	},
	Keys: {
		ID: 'keyID',
		UUID: 'keyUUID',
		description: 'keyDescription',
	},
	Registrant: {
		ID: 'registrantID',
		type: 'registrantType'
	},
	ConfigurationProfile: {
		ID: 'configurationProfileID',
		UUID: 'configurationProfileUUID',
		name: 'configurationProfileName',
		config: 'configurationProfileConfiguration',
		labels: 'configurationProfileLabels',
		version: 'configurationProfileVersion'
	},
	GeneralSettings: {
		settings: 'generalSettings'
	},
	User: {
		ID: 'userID',
		UUID: 'userUUID',
		email: 'userEmail',
		role: 'userRole',
		notificationLevel: 'userNotificationLevel',
		changePassword: 'changePassword',
		resetPassword: 'resetPassword',
		newPassword: 'newPassword'
	},
	KafkaMessage: {
		messageType: 'messageType',
		originType: 'originType'
	},
	Platform: {
		ID: 'platformID',
		name: 'platformName'
	},
	Artifact: {
		ID: 'artifactID',
		name: 'artifactName'
	},
	UpgradeScenario: {
		ID: 'upgradeScenarioID',
		sourceVersion: 'upgradeScenarioSourceVersion',
		destinationVersion: 'upgradeScenarioDestinationVersion',
		upgradeTypeID: 'upgradeScenarioUpgradeTypeID'
	},
	UpgradeStepScenario: {
		ID: 'upgradeStepScenarioID',
		name: 'upgradeStepScenarioName',
		command: 'upgradeStepScenarioCommand',
		timeout: 'upgradeStepScenarioTimeout',
		verificationCommand: 'upgradeStepScenarioVerificationCommand',
		isVolumeAffected: 'upgradeStepScenarioIsVolumeAffected',
		arguments: 'upgradeStepScenarioArguments'
	},
	Kernel: {
		ID: 'kernelID',
		version: 'kernelVersion'
	},
	Ofed: {
		ID: 'ofedID',
		version: 'ofedVersion'
	},
	OperatingSystem: {
		ID: 'operatingSystemID',
		version: 'operatingSystemVersion',
		distributionType: 'operatingSystemDistributionType'
	},
	Component: {
		ID: 'componentID',
		name: 'componentName',
		component: 'componentComponent',
		componentType: 'componentComponentType',
		version: 'componentVersion',
		health: 'componentHealth',
		requirement: 'componentRequirement'
	},
	Upgrade: {
		ID: 'upgradeID',
		UUID: 'upgradeUUID',
		Type: 'upgradeType',
		DestinationVersion: 'upgradeDestinationVersion',
		ExecutionMode: 'upgradeExecutionMode',
		MinRedundancyLevel: 'upgradeMinRedundancyLevel',
		MachinesToUpgrade: 'upgradeMachinesToUpgrade',
		SkipMachinesOnFailure: 'upgradeSkipMachinesOnFailure',
		MaxErrorsThreshold: 'upgradeMaxErrorsThreshold'
	},
	UpgradeStep: {
		ID: 'upgradeStepID',
	},
	UpgradeAgent: {
		ID: 'upgradeAgentID',
		UUID: 'upgradeAgentUUID',
		OSType: 'upgradeAgentOSType',
		OSVersion: 'upgradeAgentOSVersion',
		ArchType: 'upgradeAgentArchType',
		featureCompatibilityVersion: 'upgradeAgentFeatureCompatibilityVersion',
		Kernel: 'upgradeAgentKernel',
		OFED: 'upgradeAgentOFED',
		KeepAlive: 'upgradeAgentKeepAlive'
	},
	Release: {
		ID: 'releaseID',
		name: 'releaseName',
		version: 'releaseVersion'
	},
	InteropDB: {
		version: 'InteropDBVersion',
		Error: {
			name: 'InteropDBErrorName',
			code: 'InteropDBErrorCode',
			message: 'InteropDBErrorMessage'
		}
	}
};

scope.Differentiators = {
	New: 'new',
	Old: 'old',
	Local: 'local',
	Remote: 'remote',
	Former: 'former',
	Latter: 'latter',
	Existing: 'existing',
	Calculated: 'calculated',
	First: 'first',
	Second: 'second',
	Max: 'max',
	Expected: 'expected',
	Found: 'found',
	Source: 'source',
	Destination: 'destination',
	Missing: 'missing'
};

function getValueAndComplementValueObject(value, complementValue) {
	return { value, complementValue };
}

scope.getDriveID = (driveID, targetID) => getValueAndComplementValueObject(driveID, targetID);
scope.getNICID = (nicID, targetID) => getValueAndComplementValueObject(nicID, targetID);

const DEFAULT_STACK_ENTRIES_TO_SKIP = 2;
const SKIP_ONE_ADDITIONAL_STACK_ENTRY = 1;

function getStackEntryInfo(stackEntriesToSkip) {
	var orig = Error.prepareStackTrace;
	Error.prepareStackTrace = function(_, stack) { return stack; };
	var err = new Error();
	var v8Stack = err.stack;
	Error.prepareStackTrace = orig;

	var entry = v8Stack[stackEntriesToSkip];

	return `${path.basename(entry.getFileName())}:${entry.getLineNumber()}`;
}

scope.SystemMessage = class SystemMessage {
	constructor(systemMessage, innerMessage, stackEntriesToSkip = 0) {
		this.isLogged;
		this.systemMessage = systemMessage;
		this.innerMessage = innerMessage;
		this.additionalInfo = {
			id: this.systemMessage.id,
			File: getStackEntryInfo(DEFAULT_STACK_ENTRIES_TO_SKIP + stackEntriesToSkip),
			indexes: {}
		};
	}

	obfuscateInfo(obj) {
		if (!this.systemMessage?.sensitiveFields?.length)
			return obj;

		if (obj instanceof Array)
			for (const [index, element] of obj.entries()) {
				obj[index] = this.obfuscateInfo(element);

				return obj;
			}

		if (typeof obj === 'object')
			for (let key in obj) {
				if (this.systemMessage.sensitiveFields && this.systemMessage.sensitiveFields.includes(key))
					obj[key] = '***';
				else {
					obj[key] = this.obfuscateInfo(obj[key]);
				}
			}

		return obj;
	}

	linkInfo(entity, key, value) {
		return value;
	}

	addInfo(key, value, differentiator, complementValue) {
		const entity = key;

		if (differentiator)
			key = `${key}(${differentiator})`;

		if (key in this.additionalInfo.indexes)
			key = `${key}(${++this.additionalInfo.indexes[key]})`;
		else
			this.additionalInfo.indexes[key] = 0;

		if (value && typeof value === 'object' && 'value' in value && 'complementValue' in value)
			({ value, complementValue } = value);

		value = this.obfuscateInfo(value);
		value = this.linkInfo(entity, key, value, complementValue);

		this.additionalInfo[key] = value;
		return this;
	}

	getUnwantedAdditionalKeys() {
		return ['indexes'];
	}

	resolveLinks() {
		return utils.extend(true, {}, this.additionalInfo);
	}

	toString() {
		const addInfoArray = [];
		const msg = this.systemMessage.message ? `${this.systemMessage.message}. ` : '';
		const additionalInfo = utils.extend(true, {}, this.additionalInfo);

		this.getUnwantedAdditionalKeys().forEach((key) => {
			delete additionalInfo[key];
		});

		Object.keys(additionalInfo).forEach((key) => {
			let valueFormated;
			const value = additionalInfo[key];

			if (value instanceof SystemMessage)
				valueFormated = value.toString();
			else if (value instanceof KafkaJSError)
				valueFormated = value.toString();
			else if (typeof value === 'object')
				valueFormated = JSON.stringify(value);
			else
				valueFormated = value;

			addInfoArray.push(`${key}: ${valueFormated}`);
		});

		return `${msg}${addInfoArray.join('. ')}`;
	}

	toApiResponse() {
		const resolvedAdditionalInfo = this.resolveLinks();

		this.getUnwantedAdditionalKeys().concat(['File']).forEach((key) => {
			delete resolvedAdditionalInfo[key];
		});

		if (resolvedAdditionalInfo.error && !this.innerMessage) {
			this.innerMessage = resolvedAdditionalInfo.error;
			delete resolvedAdditionalInfo.error;
		}

		const response = {
			message: this.systemMessage.message || this.systemMessage.internalName,
			...resolvedAdditionalInfo
		};

		if (this.innerMessage)
			response.innerMessage = (this.innerMessage instanceof SystemMessage) ? this.innerMessage.toApiResponse() : this.innerMessage;

		return response;
	}

	log() {
		(this.getLogMethod() || logger.sysDEBUG)(this);
		this.isLogged = true;
		return this;
	}

	getLogMethod() {
		return logLevelToSysLogLevelFn[this.systemMessage.sysLogLevel];
	}

	getAdditionalInfoByKey(key) {
		return this.resolveLinks()[key];
	}

	createApiResponse(primaryIDKey, primaryUUIDKey) {
		const isError = [this.systemMessage.logLevel, this.systemMessage.sysLogLevel].includes(consts.loggingLevel.ERROR);
		const resolvedAdditionalInfo = this.resolveLinks();

		return utils.createApiResponse(
			resolvedAdditionalInfo[primaryIDKey],
			resolvedAdditionalInfo[primaryUUIDKey],
			!isError,
			isError ? this.toApiResponse() : null
		);
	}
};

scope.SystemAdminMessage = class SystemAdminMessage extends scope.SystemMessage {
	constructor(systemMessage) {
		super(systemMessage, null, SKIP_ONE_ADDITIONAL_STACK_ENTRY);
		this.metaObj = scope.createMetaObj(systemMessage.header, {}, null, null, systemMessage.isSecurity, systemMessage.isAudit);
		this.sysLogLevel = systemMessage.sysLogLevel || consts.loggingLevel.DEBUG;
	}

	getUnwantedAdditionalKeys() {
		return super.getUnwantedAdditionalKeys().concat(['File']);
	}

	getLogMethod() {
		return logger[this.systemMessage.logLevel];
	}

	setID(ID) {
		this.metaObj.id = ID;
		return this;
	}

	linkInfo(entity, key, value, complementValue) {
		if (entity in entityToCreateLinkFn) {
			const createdLink = entityToCreateLinkFn[entity](value, complementValue);

			// if link should have been created with target, create the link only if target (aka complementValue) exists - otherwise broken link
			if (!('target' in createdLink) || createdLink.target) {
				this.metaObj.links[key] = entityToCreateLinkFn[entity](value, complementValue);
				value = `{${key}}`;
			}
		}

		return value;
	}

	resolveLinks() {
		return Object.entries(this.additionalInfo)
			.reduce((acc, [key, value]) => ({ ...acc, [key]: logger.resolveLink(value, this.metaObj, false) }), {});
	}
};

scope.MongoError = class MongoError extends scope.SystemMessage {
	constructor(err, systemMessage) {
		super(systemMessage || systemMessages.MONGO_ERROR, null, SKIP_ONE_ADDITIONAL_STACK_ENTRY);
		this.err = err;
		this.addInfo(scope.Entities.Error, `${this.err}`);
	}

	get isDuplicateKeyError() {
		return this.err.code && this.err.code == consts.mongoErrors.DUPLICATE_KEY;
	}

	get isUnauthorizedError() {
		return this.err.code && this.err.code == consts.mongoErrors.UNAUTHORIZED;
	}

	get isNoReplicationEnabledError() {
		return this.err.code && this.err.code == consts.mongoErrors.NO_REPLICATION_ENABLED;
	}

	get errmsg() {
		return this.err.errmsg;
	}

	getLogLevel() {
		var GLOBAL_SETTINGS = app.get('globalSettings');
		var level = GLOBAL_SETTINGS && GLOBAL_SETTINGS.loggingLevel;
		return level || null;
	}
};

scope.InteropDBError = class InteropDBError extends scope.SystemMessage {
	constructor(err) {
		super(systemMessages.UNEXPECTED_INTEROP_DB_ERROR, null, SKIP_ONE_ADDITIONAL_STACK_ENTRY);

		if (err.message)
			this.addInfo(scope.Entities.InteropDB.Error.message, err.message);

		if (err.name)
			this.addInfo(scope.Entities.InteropDB.Error.name, err.name);

		const code = err.parent?.code || err.original?.code;
		if (code)
			this.addInfo(scope.Entities.InteropDB.Error.code, code);
	}
};
