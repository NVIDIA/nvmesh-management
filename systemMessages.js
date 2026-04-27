/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable max-len */

const consts = require('./consts');

const getAuditHeader = (entity, operation) => `${entity} ${operation} Request`;

var systemMessages = {
	UNAUTHORIZED: {
		message: 'Operation not permitted. This action can only be performed by an Admin.',
		id: 401,
		header: 'Unauthorized',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UNPROCESSABLE_ENTITY: {
		message: 'REST API Validation Error',
		id: 422,
		header: 'Validation Error',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	MONGO_ERROR: {
		message: 'Management received an unexpected generic error from mongo, shutting down.',
		id: 2000,
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	MONGO_CONNECTION_ERROR: {
		message: 'Failed to connect to mongo, so shutting down; if mongo is up and restarting both management and mongo does not help, contact support.',
		id: 20010,
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SQLITE_CONNECTION_ERROR: {
		message: 'Failed to connect to SQLITE InteropDB, so shutting down.',
		header: 'SQLITE Connection Error',
		id: 200101,
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UNEXPECTED_INTEROP_DB_ERROR: {
		message: 'Management received an unexpected error from interop-db.',
		id: 200102,
		header: 'Interop DB Error',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	MONGO_CONNECTION_CLOSED: {
		message: 'Connection to mongo closed, so shutting down; if mongo is up and restarting both management and mongo does not help, contact support.',
		id: 20011,
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_CONNECTION_ERROR: {
		message: 'Failed to connect to kafka; if kafka is up and restarting both management and kafka does not help, contact support.',
		id: 3000,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_SEND_MESSAGE_ERROR: {
		message: 'Failed to send a message to Kafka, contact support.',
		id: 3001,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_CREATE_TOPIC_ERROR: {
		message: 'Failed to create Kafka topics, contact support.',
		id: 3002,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_GENERIC_CONSUMER_ERROR: {
		message: 'Management received an unexpected generic error from Kafka consumer, contact support.',
		id: 3003,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_COMMIT_OFFSET_ERROR: {
		message: 'Management received an unexpected generic error from Kafka while trying to commit offsets, contact support.',
		id: 3004,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_DELETE_TOPICS_ERROR: {
		message: 'Management received an unexpected generic error from Kafka while trying to delete topics, contact support.',
		id: 3005,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_LIST_TOPICS_ERROR: {
		message: 'Management received an unexpected generic error from Kafka while trying to list topics, contact support.',
		id: 3006,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_FETCH_OFFSETS_ERROR: {
		message: 'Management received an unexpected generic error from Kafka while trying to fetch offsets, contact support.',
		id: 3007,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_DELETE_RECORDS_ERROR: {
		message: 'Management received an unexpected generic error from Kafka while trying to delete topic records, contact support.',
		id: 3008,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_UNKNOWN_MESSAGE_TYPE: {
		message: 'Received a message from Kafka with unknown messageType!',
		id: 3009,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_MESSAGE_WITHOUT_MESSAGE_TYPE: {
		message: 'Received a message from Kafka without messageType!',
		id: 3010,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_UNSUPPORTED_ORIGIN_TYPE: {
		message: 'Received a message from Kafka with unsupported originType!',
		id: 3011,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_CONSUMER_PAUSE_FAILED: {
		message: 'Kafka Consumer Pause Failed',
		id: 3012,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_CONSUMER_RESUME_FAILED: {
		message: 'Kafka Consumer Resume Failed',
		id: 3013,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_GET_PAUSED_TOPICS_FAILED: {
		message: 'Kafka Get Paused Topics Failed',
		id: 3014,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	RUN_KAFKA_COMMAND_ON_SUCCESS_ERROR: {
		message: 'Error in onSuccessFn of runKafkaCommand',
		id: 3015,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_PREP_SEND_MSG_ERROR: {
		message: 'Failed to prepare a message to send to Kafka, contact support.',
		id: 3016,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CERT_CREATE_DIRECTORY_FAILED: {
		message: 'Failed to create certificates directory, shutting down.',
		id: 3018,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CERT_COPY_FAILED: {
		message: 'Failed to copy certificate, shutting down.',
		id: 3019,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CERT_READ_FAILED: {
		message: 'Failed to read certificate, shutting down.',
		id: 3020,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	APP_UNCAUGHT_EXCEPTION: {
		message: 'An unexpected application error occurred in the management, shutting down, contact support.',
		id: 1000,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	APP_GRACEFUL_SHUTDOWN: {
		message: 'Starting a clean shutdown per user request.',
		id: 1005,
		sysLogLevel: consts.loggingLevel.INFO
	},
	APP_GRACEFUL_SHUTDOWN_EXITING: {
		message: 'Completed a clean shutdown per user request.',
		id: 1008,
		sysLogLevel: consts.loggingLevel.INFO
	},
	APP_CERT_DIRECTORY_UNKNOWN: {
		message: 'Unkown cert directory provided, shutting down.',
		id: 1009,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	APP_GENERAL_SETTINGS_LOAD_FAILED: {
		message: 'Failed to load general settings; therefore, shutting down; see additional info for error information, fix and restart.',
		id: 1015,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	APP_VERSION_UNKNOWN: {
		message: 'Unable to figure out which version is being used from current environment, so not starting to be on the safe side.',
		id: 1018,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	APP_STATS_CONF_PARSE_FAILED: {
		message: 'Could not parse "sendStatsInterval" field in configuration file; minimum value is 1 hour.',
		id: 1020,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	APP_SEND_STATS_EMAIL_FAILED: {
		message: 'Failed to send statistics email, additional info may have more information on the failure.',
		id: 1021,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	APP_CREATE_SERVER_BOOTSTRAP_FAILED: {
		message: 'Startup failed, see additional info.',
		id: 1023,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	APP_MGMT_ID_GET_FAILED: {
		message: 'Failed to get management ID',
		id: 1031,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	APP_MGMT_ID_SAVE_FAILED: {
		message: 'Failed to write management ID to persistent storage, this may lead to incorrect identification of the management on next startup; check whether storage space is full.',
		id: 1032,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	APP_MGMT_ID_VERIFY_FAILED: {
		message: 'It seems that the identity of management based upon the IP address and port to use is inconsistent with that used previously, sleeping for 10 seconds and trying again, contact support if this persists.',
		id: 1033,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	APP_MGMT_ID: {
		message: 'Management ID',
		id: 1034,
		sysLogLevel: consts.loggingLevel.INFO
	},
	APP_CERT_RELOAD_SUCCESS: {
		message: 'TLS certificates reloaded successfully',
		id: 1035,
		header: 'Certificate Reload Success',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isSecurity: true
	},
	APP_CERT_RELOAD_FAILED: {
		message: 'Failed to reload TLS certificates',
		id: 1036,
		header: 'Certificate Reload Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR,
		isSecurity: true
	},
	APP_CERT_RELOAD_NO_SERVERS: {
		message: 'Cannot reload certificates: HTTPS servers not initialized',
		id: 1037,
		header: 'Certificate Reload Skipped',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isSecurity: true
	},
	BOOTSTRAP_BACKUPS_LOAD_FROM_CACHE: {
		message: 'Failed to load backup from cache',
		id: 1038,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	NO_TOPICS_FOUND_IN_INTEROPDB: {
		message: 'No topics found in interop-db',
		id: 1039,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_MARKED_FOR_REBUILD: {
		message: 'Volume marked for rebuild',
		id: 1040,
		header: 'Volume Marked For Rebuild',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	VOLUME_REBUILD_STARTED: {
		message: 'Volume rebuild started successfully',
		id: 10401,
		header: 'Volume Rebuild Started',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	TARGET_DETECTED: {
		message: 'A new target node was detected',
		id: 1044,
		header: 'New Target',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	TARGET_DELETE_NIC_NOT_FOUND: {
		message: 'There is no such NIC in the system',
		id: 1045,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	TARGET_WENT_ONLINE: {
		message: 'A Target went online',
		id: 1046,
		header: 'Target Online',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	DRIVE_AUTOMATICALLY_REMOVED: {
		message: 'A Drive was automatically deleted',
		id: 1047,
		header: 'Drive Automatically Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	DRIVE_DETECTED: {
		message: 'A new Drive was detected',
		id: 1048,
		header: 'New Drive',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	DRIVE_REAPPEARED: {
		message: 'A Drive has reappeared',
		id: 1049,
		header: 'Drive Reappeared',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	DRIVE_WENT_ONLINE: {
		message: 'A Drive went online',
		id: 1051,
		header: 'Drive Online',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	NIC_REAPPEARED: {
		message: 'A NIC has reappeared',
		id: 1053,
		header: 'NIC Reappeared',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	NIC_DETECTED: {
		message: 'A new NIC was detected',
		id: 1054,
		header: 'New NIC',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	NIC_WENT_ONLINE: {
		message: 'A NIC went online',
		id: 1056,
		header: 'NIC Online',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	DRIVE_AUTOMATICALLY_EVICTED: {
		message: 'A Drive was automatically evicted',
		id: 1057,
		header: 'Drive Automatically Evicted',
		logLevel: consts.loggingLevel.WARNING,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	CLIENT_DETECTED: {
		message: 'A new Client was detected',
		id: 1060,
		header: 'New Client',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	MANAGEMENT_HA_WS_PROTOCOL_UNSUPPORTED: {
		message: 'Identified other management system with a different websocket protocol version which is not supported.',
		id: 1061,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	GENERAL_SETTINGS_CHANGED: {
		message: 'General Settings changed',
		id: 1063,
		sysLogLevel: consts.loggingLevel.INFO
	},
	BOOTSTRAP_GENERAL_SETTINGS_LOAD_FAILED: {
		message: 'General settings failed to load during event generalSettingsChangeEvent',
		id: 1064,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	BOOTSTRAP_GENERAL_SETTINGS_RELOADED: {
		message: 'General settings reloaded successfully during event generalSettingsChangeEvent',
		id: 1065,
		sysLogLevel: consts.loggingLevel.INFO
	},
	BOOTSTRAP_GENERAL_SETTINGS_LOAD_FAILED_ON_STARTUP: {
		message: 'Failed to load the management configuration files, check them for a possible syntax error, shutting down.',
		id: 1066,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	BACKUP_NOT_FOUND: {
		message: 'Backup not found',
		id: 1067,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DBBACKUP_BACKUP_REMOVE_FAILED: {
		message: 'Could not delete the oldest backup while rotating, this may lead to excessive storage space usage.',
		id: 1068,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DBBACKUP_BACKUP_DUMP_FAILED: {
		message: 'An unexpected error occurred while trying to generate a backup file, this may be a result of lack of storage space, contact support if the root cause is unclear.',
		id: 1069,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DBBACKUP_INVALID_CONFIGURATION: {
		message: 'Invalid value for hourly backup interval, which should be between 1 and 24, disabling the backup mechanism.',
		id: 1072,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DBBACKUP_BACKUP_CREATION_FAILED: {
		message: 'Failed to backup the database',
		id: 1074,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DBBACKUP_RELEASE_LOCK_FAILED: {
		message: 'An unexpected error occurred when completing a backup, contact support if this happens on subsequent backups.',
		id: 1075,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DBBACKUP_CLOSE_LOCK_FD_FAILED: {
		message: 'An unexpected error occurred when completing a backup, contact support if this happens on subsequent backups.',
		id: 1076,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DBBACKUP_EXEC_FCNTL_FAILED: {
		message: 'An unexpected error occurred when doing a backup, contact support if this happens on subsequent backups.',
		id: 1077,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SAVE_RELEASE_SUCCESS: {
		message: 'Release saved successfully',
		header: 'Release Saved',
		id: 10771,
		sysLogLevel: consts.loggingLevel.INFO,
		logLevel: consts.loggingLevel.INFO
	},
	SAVE_RELEASE_FAILED: {
		message: 'Release save failed',
		header: 'Release Save Failed',
		id: 10772,
		sysLogLevel: consts.loggingLevel.ERROR,
		logLevel: consts.loggingLevel.ERROR
	},
	MISSING_DISTRIBUTION_TYPES: {
		message: 'Distribution type not found',
		id: 10773,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	MISSING_PLATFORM_DEPENDENCIES: {
		message: 'Platform dependency not found',
		id: 10774,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	MISSING_PLATFORMS_DEPENDENCIES: {
		message: 'Platforms dependencies not found',
		id: 10775,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	FAILED_TO_CREATE_ENTITIES: {
		message: 'Failed to create InteropDB entities',
		id: 10776,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	FAILED_CREATE_UPDATE_RELEASE: {
		message: 'Failed to create or update release',
		id: 10777,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	MISSING_ARTIFACTS_IN_RELEASE: {
		message: 'Artifacts not found in release',
		id: 10778,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	MISSING_PLATFORMS_IN_ARTIFACT: {
		message: 'Platforms not found in artifact',
		id: 10779,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	MISSING_PLATFORMS_IN_ARTIFACTS: {
		message: 'Platforms not found in artifacts',
		id: 10780,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	MORE_THAN_ONE_ARTIFACT_BASE_VERSION_FOR_COMPONENT: {
		message: 'More than one artifact base version for the same component',
		id: 10781,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	MISSING_RELEASES: {
		message: 'Releases not found',
		id: 10782,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	COMPONENT_VERSION_NOT_FOUND: {
		message: 'Component version not found',
		id: 10783,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	ENRICH_VERSIONS_FOR_RELEASE_FAILED: {
		message: 'Failed to enrich versions for release',
		id: 10784,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	COMPONENT_VERSION_NOT_FOUND_IN_NEWLY_CREATED_COMPONENTS: {
		message: 'Component version not found in newly created components',
		id: 10785,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	ADD_NVMESH_PACKAGE_COMPATIBILITIES_FAILED: {
		message: 'Failed to add nvmesh package compatibilities',
		id: 10786,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	FAILED_TO_UPDATE_COMPONENTS: {
		message: 'Failed to update components',
		id: 10787,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	PREPARED_UPGRADE_SCENARIO_NOT_FOUND: {
		message: 'Prepared upgrade scenario not found',
		id: 10790,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	FAILED_TO_PREPARE_UPGRADE_SCENARIOS_FOR_UPDATE: {
		message: 'Failed to prepare upgrade scenarios for update',
		id: 10791,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	FAILED_TO_UPDATE_UPGRADE_SCENARIOS: {
		message: 'Failed to update upgrade scenarios',
		id: 10792,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	INCOMPLETE_ARTIFACTS_FOR_INHERITANCE: {
		message: 'Incomplete artifacts for inheritance. All NVMesh package components must have artifacts when inheriting from a release.',
		id: 10793,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	FAILED_TO_LOOKUP_FOR_UPGRADE_SCENARIO_COMPONENT_NAME: {
		message: 'Failed to lookup for upgrade scenario component name',
		id: 10794,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	FAILED_TO_LOOKUP_FOR_UPGRADE_SCENARIO_N_MINUS_1_COMPONENT_VERSION: {
		message: 'Failed to lookup for upgrade scenario n-1 component version',
		id: 10795,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	FAILED_TO_LOOKUP_FOR_UPGRADE_SCENARIO_N_COMPONENT_VERSION: {
		message: 'Failed to lookup for upgrade scenario n component version',
		id: 10796,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	OBJ_NOTIFIER_FAILED_TO_READ_BACKUPS_DIR: {
		message: 'Failed to read backups from directory.',
		id: 1081,
		header: 'Failed To Read Backup Directory',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	OBJ_NOTIFIER_FAILED_TO_READ_BACKUP: {
		message: 'Failed to read a backup file',
		id: 1082,
		header: 'Failed To Read Backup File',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	COMPONENT_VERSION_CHANGED: {
		message: 'A component version change has been completed',
		id: 1083,
		header: 'Component Version Changed',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	OBJ_NOTIFIER_UPDATE_OBJ: {
		message: 'Failed to update object from event',
		id: 1097,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	OBJ_NOTIFIER_UPDATE_CACHE: {
		message: 'Failed to update cache',
		id: 1099,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UTILS_CREATE_VPG_RESERVATION_FAILURE: {
		message: 'Failed to allocate VPG reserved space',
		id: 1144,
		header: 'VPG Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UTILS_INC_NVMF_EXPORTID_BY_CLIENT_FAILURE: {
		message: 'Failed to increment nvmfExportID for client.',
		id: 1147,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UTILS_ADD_SEGMENT_TO_DISK_OVERLAP: {
		message: 'Found overlap during add segment',
		id: 1149,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UTILS_ADD_SEGMENT_TO_DISK_OUT_OF_BOUND: {
		message: 'Failed to add Disk Segment to Drive',
		id: 1150,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_TOPIC_LOOKUP_FAILED: {
		message: 'Failed to get kafka topics name',
		id: 1151,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SNAPSHOT_DATA_VOLUME_CAPACITY_LOWER_THAN_SOURCE_VOLUME_CAPACITY: {
		message: 'Snapshot requested capacity should be either empty or greater-equal to source volume capacity + 1MiB (cluster size).',
		id: 1161,
		header: 'Failed To Create Snapshot',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR

	},
	UTILS_FORCE_DELETE_VOLUMES_SAVE_AUTO_REMOVED_FAILURE: {
		message: 'Failed to save Disk Segments of the auto-removed Volume',
		id: 1175,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UTILS_FORCE_DELETE_VOLUMES_DELETE_VOLUME_FAILURE: {
		message: 'Failed to delete Volume',
		id: 1177,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UTILS_UPDATE_DEFAULT_DOMAIN: {
		message: 'Default domain changed',
		id: 1189,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	UTILS_READ_BASH_VARIABLES_FILE_FAILURE: {
		message: 'Failed to read bash file',
		id: 1190,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UTILS_MAKE_DIR_FAILURE: {
		message: 'Failed to create directory',
		id: 1199,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UTILS_WRITE_TO_FILE_FAILURE: {
		message: 'Failed to write into file.',
		id: 1200,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	LOGIN_ATTEMPT_FAILED: {
		message: 'User login attempt failed',
		id: 1263,
		header: 'Login Failed',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.DEBUG,
		isSecurity: true
	},
	LOGIN_AUTHENTICATION_FAILED: {
		message: 'Login authentication failure.',
		id: 1264,
		header: 'Login Failed',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.ERROR,
		isSecurity: true
	},
	LOGIN_SUCCESS: {
		message: 'User logged in successfully',
		id: 1265,
		header: 'Login Success',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.DEBUG,
		isSecurity: true
	},
	LOGIN_LOGOUT_SUCCESS: {
		message: 'User logged out successfully',
		id: 1266,
		header: 'Logout Success',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.DEBUG,
		isSecurity: true
	},
	LOGOUT_FAILED: {
		message: 'User failed to logout',
		id: 12666,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	LOGIN_NOT_LOGGED_IN: {
		message: 'Please login via the /login route.',
		id: 1267,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	CHANGING_PASSWORD_REQUIRED: {
		message: 'Changing password is required',
		id: 1268,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	MONGODB_REPLICA_SET_MEMBER_NOT_FOUND: {
		message: 'MongoDB replica set member not found',
		id: 1273,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	MONGODB_REPLICA_SET_HOST_WENT_UP: {
		message: 'A MongoDB replica set member went up',
		id: 1274,
		header: 'MongoDB RS Member Up',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	MONGODB_REPLICA_SET_HOST_WENT_DOWN: {
		message: 'A MongoDB replica set member went down',
		id: 1275,
		header: 'MongoDB RS Member Down',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	SANITY_LARGEST_SEGMENT_INCORRECT: {
		message: 'During sanity check we found that the following drive\'s computational fields are incorrect',
		id: 1281,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	SANITY_VOLUME_ZONE_VIOLATION: {
		message: 'Volume sanity failed on zones violation',
		id: 1282,
		header: 'Sanity Failed',
		logLevel: consts.loggingLevel.WARNING,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	SANITY_VOLUME_BAD_FIELD_VALUES: {
		message: 'Volume sanity failed on bad capacity/blocks fields value',
		id: 1283,
		header: 'Sanity Failed',
		logLevel: consts.loggingLevel.WARNING,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	SANITY_OVERLAPPING_SEGMENTS: {
		message: 'Volume sanity failed on overlapping segments',
		id: 1284,
		header: 'Sanity Failed',
		logLevel: consts.loggingLevel.WARNING,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	SANITY_SEGMENT_SANITY_FAILED: {
		message: 'Drive sanity failed on bad value in diskSegment',
		id: 1285,
		header: 'Sanity Failed',
		logLevel: consts.loggingLevel.WARNING,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	SANITY_NODE_CONFIG_PROFILE_NOT_FOUND: {
		message: 'During sanity check profile was not found',
		id: 1287,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	SANITY_NODE_CONFIG_PROFLIE_VERSION_NOT_UPDATED: {
		message: 'During sanity config profile was not updated',
		id: 1288,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	SANITY_SEGMENT_RANGE_ERROR: {
		message: 'Drive sanity failed on range error',
		id: 1286,
		header: 'Sanity Failed',
		logLevel: consts.loggingLevel.WARNING,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	SANITY_ENTITY_HAS_NO_HANDLED_BY: {
		message: 'Sanity: Entity has no .handledBy field',
		id: 1289,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	KEYS_DELETE_REQUEST: {
		message: 'REST API Request: Delete Keys',
		id: 15111,
		header: getAuditHeader(consts.entity.keys, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	KEYS_UPDATE_REQUEST: {
		message: 'REST API Request: Update Keys',
		id: 15112,
		header: getAuditHeader(consts.entity.keys, consts.operation.update),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	KEYS_SAVE_REQUEST: {
		message: 'REST API Request: Save Keys',
		id: 15113,
		header: getAuditHeader(consts.entity.keys, consts.operation.save),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	KEYS_DELETE_NOT_FOUND: {
		message: 'Cant find key',
		id: 15114,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	KEYS_DELETED: {
		message: 'Key deleted successfully',
		id: 15115,
		header: 'Key Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	KEYS_DELETE_FAILED: {
		message: 'Failed to delete Key',
		id: 15116,
		header: 'Key Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KEYS_SAVED: {
		message: 'Key saved successfully',
		id: 15117,
		header: 'Key Saved',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	KEYS_SAVE_FAILED: {
		message: 'Failed to save Key',
		id: 15118,
		header: 'Key Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KEYS_UPDATED: {
		message: 'Key updated successfully',
		id: 15119,
		header: 'Key Updated',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	KEYS_UPDATE_FAILED: {
		message: 'Failed to update Key',
		id: 15120,
		header: 'Key Update Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UPDATE_KEY_NOT_FOUND: {
		message: 'Cant find key',
		id: 15121,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	TARGET_MULTIPLE_NICS_WITH_SAME_ID: {
		message: 'Found NICs with same IDs',
		id: 1325,
		header: 'Duplicate NICs ID',
		logLevel: consts.loggingLevel.WARNING,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	TARGET_MULTIPLE_DRIVES_WITH_SAME_ID: {
		message: 'Found Drives with same IDs',
		id: 1326,
		header: 'Duplicate Drives ID',
		logLevel: consts.loggingLevel.WARNING,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	TARGET_UPDATE_GPT_PROPERTIES_FAILED: {
		message: 'Failed to update GPT properties',
		id: 1327,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	TARGET_SAVE_NEW_NODE_ID_ON_VOLUMES_FAILED: {
		message: 'Failed to save new nodeID to Volumes',
		id: 1336,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	TARGET_DRIVE_RELOCATION_CAUSED_SEPARATION_VIOLATION: {
		message: 'Drive relocation caused a separation violation on volume',
		id: 1337,
		header: 'Separation Violation',
		logLevel: consts.loggingLevel.WARNING,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	TARGET_DRIVE_RELOCATION_RESOLVED_SEPARATION_VIOLATION: {
		message: 'Drive relocation resolved separation violation on volume',
		id: 1338,
		header: 'Separation Violation Resolved',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	TARGET_NIC_MTU_TOO_HIGH_FOR_ROCE_OR_IB: {
		message: 'MTU id higher than expected',
		id: 1340,
		header: 'Wrong MTU Found',
		logLevel: consts.loggingLevel.WARNING,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	VALIDATION_SCHEME_FILES_READ_FAILED: {
		message: 'Failed to read files containing validation schemes',
		id: 1352,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_CLIENT_PERMISSION_GRANTED: {
		message: 'Permission granted on client.',
		id: 1357,
		header: 'Permission Granted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	VOLUME_CALCULATE_AND_UPDATE_VOLUME_STATUS_FAILED: {
		message: 'Failed to calculate and update volume status',
		id: 1378,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_STATUS_CHANGED_TO_OFFLINE: {
		message: 'Volume status changed to offline',
		id: 1382,
		header: 'Volume Offline',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_STATUS_CHANGED_TO_DEGRADED: {
		message: 'Volume status changed to degraded',
		id: 1383,
		header: 'Volume Degraded',
		logLevel: consts.loggingLevel.WARNING,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	VOLUME_STATUS_REBUILD_REQUIRED: {
		message: 'Volume requires rebuild',
		id: 1384,
		header: 'Volume Rebuild Required',
		logLevel: consts.loggingLevel.WARNING,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	VOLUME_STATUS_CHANGED_TO_ONLINE: {
		message: 'Volume status changed to online',
		id: 1385,
		header: 'Volume Online',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	VOLUME_STATUS_BACK_ONLINE: {
		message: 'Volume back to online status',
		id: 1386,
		header: 'Volume Online',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	WEBSOCKET_CONNECTION_ERROR: {
		message: 'Found websocket connection error',
		id: 1405,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	WEBSOCKET_HA_LOGIN_FAILURE: {
		message: 'Failed to login via websocket to other management',
		id: 1411,
		header: 'Management HA Login Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	WEBSOCKET_HA_JOIN_MANAGEMENTS_CLUSTER_FAILURE: {
		message: 'Failed to join management cluster',
		id: 1412,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	WEBSOCKET_MSG_RECEIVED: {
		message: 'Received websocket message',
		id: 1413,
		sensitiveFields: ['password'],
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	INDEX_FAILED_TO_CHECK_ADMIN_PASSWORD: {
		message: 'Failed to check if it is admin password',
		id: 1438,
		header: 'Authentication Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	INDEX_FAILED_TO_CHECK_CONFIRMATION_EMAIL: {
		message: 'Failed to check confirmation email',
		id: 14381,
		header: 'Authentication Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	INDEX_GET_COUNTERS_FAILURE: {
		message: 'Failed to get counters',
		id: 1439,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VPG_DELETE_FAILURE: {
		message: 'Failed to delete VPG',
		id: 1458,
		header: 'VPG Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_ENCRYPTION_COMMAND_FAILED: {
		message: 'Volume encryption command request failed',
		id: 1459,
		header: 'Volume Encryption Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	RUN_ENCRYPTION_COMMAND_FAILED: {
		message: 'Running encryption command failed',
		id: 14591,
		header: 'Volume Encryption Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	RUN_ENCRYPTION_COMMAND_SUCCESS: {
		message: 'Encryption command ran successfully',
		id: 14592,
		header: 'Volume Encryption Success',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	ENCRYPTION_MANUAL_INTERVENTION_REQUIRED: {
		message: 'Volume encryption manual intervention required',
		id: 1460,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	ENCRYPTION_TOMA_ERROR: {
		message: 'Volume encryption TOMA error',
		id: 1461,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	ENCRYPTION_EXTERNAL_ERROR: {
		message: 'Volume encryption external error',
		id: 1462,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	ENCRYPTION_RESPONSE_ACKNOWLEDGE_SUCCESS: {
		message: 'Encryption response acknowledged successfully',
		id: 1463,
		header: 'Volume Encryption Success',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	ENCRYPTION_RESPONSE_ACKNOWLEDGE_FAILED: {
		message: 'Failed acknowledging encryption response',
		id: 1464,
		header: 'Volume Encryption Failed',
		sysLogLevel: consts.loggingLevel.ERROR
	},
	ZONE_NOT_FOUND: {
		message: 'Zone not found',
		id: 1465,
		header: 'Volume Encryption Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	NO_TARGETS_IN_ZONE: {
		message: 'No targets available in zone for encryption operation',
		id: 1466,
		header: 'Volume Encryption Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_FAILED_TO_REBUILD: {
		message: 'Failed to rebuild volume.',
		id: 1469,
		header: 'Rebuild Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_FAILED_TO_UPDATE: {
		message: 'Failed to updat volume',
		id: 1472,
		header: 'Update Volume Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	APP_VERSION_FILE_CONTENT_DEFORMED: {
		message: 'Malformed version file found',
		id: 1473,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	APP_VERSION_FILE_MISSING: {
		message: 'Missing version file',
		id: 1474,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	APP_VERSION_FILE_READ_EXCEPTION: {
		message: 'Unexpected exception while trying to read version file',
		id: 1475,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	TARGET_UP_REQUIRES_ATTENTION: {
		message: 'Target is up, but requires attention',
		id: 1476,
		header: 'Target Failure',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	TARGET_UP_NVMESH_TARGET_DOWN: {
		message: 'Target is up, but the NVMesh Target is down',
		id: 1477,
		header: 'Target Failure',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	TARGET_UP_NVMESH_TOMA_DOWN: {
		message: 'Target is up, but the NVMesh TOMA is down',
		id: 1478,
		header: 'Target Failure',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	TARGET_DOWN: {
		message: 'Target is down',
		id: 1479,
		header: 'Target Failure',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	DRIVE_FAILURE_FORMAT_ERROR: {
		message: 'Drive reported format failure',
		id: 1480,
		header: 'Drive Failure',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	DRIVE_FAILURE_OFFLINE: {
		message: 'Drive is offline',
		id: 1481,
		header: 'Drive Failure',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	DRIVE_FAILURE: {
		message: 'Drive failure',
		id: 1482,
		header: 'Drive Failure',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	DRIVE_ADDED_TO_NVMESH_POOL: {
		message: 'Drive now managed by NVMesh',
		id: 1483,
		header: 'Drive Pool Change',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	DRIVE_REMOVED_FROM_NVMESH_POOL: {
		message: 'Drive no longer managed by NVMesh',
		id: 1484,
		header: 'Drive Pool Change',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	NIC_MISSING: {
		message: 'NIC is missing',
		id: 1485,
		header: 'NIC Missing',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	NIC_FAILURE: {
		message: 'NIC failure',
		id: 1486,
		header: 'NIC Failure',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	DRIVE_NOT_FOUND: {
		message: 'Drive not found',
		id: 1487,
		header: 'Drive Not Found',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DRIVE_FORMAT_CANCELLED_TARGET_NOT_APPROVED: {
		message: 'Cannot format a drive of a Target that has not been approved yet',
		id: 1488,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DRIVE_FORMAT_CANCELLED_BAD_STATUS: {
		message: 'Formatting is not allowed due to drive status',
		id: 1490,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DRIVE_FORMAT_CANT_RAID_FORMAT_WHILE_EC_FORMAT_REQUIRED: {
		message: 'Cannot perform raid format on ec supported drive when \'enableLegacyFormatting\' is false in management.js.conf',
		id: 14881,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	DRIVE_FORMAT_CANT_EC_FORMAT_WHILE_NONE_SUPPORTED: {
		message: 'Cannot perform format ec on none supported Drive',
		id: 14882,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	DRIVE_FORMAT_CANT_FORMAT_DRIVE_WITH_VOLUMES: {
		message: 'Cannot perform format on Drive that has volumes',
		id: 14883,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	DRIVE_FORMAT_CANT_FORMAT: {
		message: 'Failed to format drive',
		id: 14884,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SANITY_AUTO_REMOVE_PENDING_VOLUME_FAILED: {
		message: 'Failed to delete pending volumes while sanity and recover',
		id: 1493,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SANITY_PENDING_VOLUME_AUTO_REMOVED: {
		message: 'Pending Volumes deleted successfully while sanity and recover',
		id: 1494,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	SANITY_DUPLICATE_SEGMENTS: {
		message: 'Duplicated segments found during sanity and recover',
		id: 1495,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	DRIVE_IN_USE_CANNOT_DELETE: {
		message: 'Cannot delete a drive that is in use for volumes',
		id: 1497,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	SANITY_SEGMENT_WRONG_NODE_ID: {
		message: 'Wrong node ID found during sanity and recover',
		id: 1498,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	SANITY_SEGMENT_WRONG_DISK_ID: {
		message: 'Wrong diskID found during sanity and recover',
		id: 1499,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	SANITY_ZEROED_LARGEST_SEGMENT: {
		message: 'Largest segment was zeroed but the total sum of segments didnt not occupy all drives blocks',
		id: 1500,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	SANITY_SEGMENT_NOT_FOUND_ON_ANY_SERVER: {
		message: 'Segment not found on any target while sanity and recover',
		id: 1501,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	SANITY_SEGMENT_FOUND_ON_MULTIPLE_SERVER: {
		message: 'A segment have been found on multiple targets',
		id: 1502,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	SANITY_VOLUME_SEGMENTS_NOT_ON_ANY_SERVER: {
		message: 'Segment not found on any target while sanity and recover',
		id: 1503,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	SANITY_BLOCKS_CALC_MISMATCH: {
		message: 'Blocks calculation mismatch while sanity and recover',
		id: 1504,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	UTILS_SEGMENT_OUT_OF_BOUND: {
		message: 'Segment is out of bound',
		id: 1505,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	DRIVE_IS_EXCLUDED_CANNOT_DELETE: {
		message: 'Cannot delete an excluded drive',
		id: 1506,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	UTILS_SAVE_VOLUMES_DRIVECLASS_NOT_FOUND: {
		message: 'Drive Class not found while creating volume',
		id: 1512,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UTILS_SAVE_VOLUMES_SERVERCLASS_NOT_FOUND: {
		message: 'Target Class not found while creating volume',
		id: 1513,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UTILS_SAVE_VOLUMES_VPG_NOT_FOUND: {
		message: 'VPG not found while creating volume',
		id: 1514,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SNAPSHOT_CREATE_MDV_FAILURE: {
		message: 'Failed to create Metadata Volume for Snapshot',
		id: 1517,
		header: 'Create Snapshot Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UTILS_CREATE_VOLUME_EXTENSION_FAILURE: {
		message: 'Failed to create volume extension',
		id: 1519,
		header: 'Create VPG Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SNAPSHOT_CREATE_DATA_VOLUME_FAILURE: {
		message: 'Failed to create data volume',
		id: 1520,
		header: 'Create Snapshot Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SNAPSHOT_SOURCE_VOLUME_NOT_FOUND: {
		message: 'Failed to find Source Volume',
		id: 1521,
		header: 'Volume Not Found',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SNAPSHOT_SOURCE_VOLUME_NOT_READ_ONLY: {
		message: 'Snapshot source volume is not read-only',
		id: 1522,
		header: 'Invalid Snapshot Source',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UTILS_CREATE_VOLUME_FAILURE_NAME_EXISTS: {
		message: 'Volume name already exists',
		id: 1523,
		header: 'Volume Name Already Exists',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UTILS_GET_DATA_DISKS_FOR_RAID1_FAILURE_NOT_ENOUGH_DRIVES: {
		message: 'Failed to get data Drives for RAID1 - Not enough drives',
		id: 1524,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UTILS_GET_DATA_DISKS_FOR_RAID1_FAILURE_DOMAIN_VIOLATION: {
		message: 'Failed to get data Drives for RAID1 due to a domain violation - identical drives returned with different domain identifers',
		id: 1525,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UTILS_GET_DRIVES_FOR_RAID1_FAILURE: {
		message: 'Failed to get Drives for RAID1',
		id: 1526,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UTILS_GET_DRIVES_FOR_STRIPED_VOLUME_FAILURE: {
		message: 'Failed to get Drives for Stripped Volume',
		id: 1527,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VPG_SAVE_FAILURE_DUP_KEY: {
		message: 'VPG ID already exists',
		id: 1531,
		header: 'Create VPG Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KEY_SAVE_FAILURE_DUP_KEY: {
		message: 'Key ID already exists',
		id: 15311,
		header: 'Create Key Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VPG_SAVE_FAILURE: {
		message: 'Failed to save VPG',
		id: 1532,
		header: 'Create VPG Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CONFIG_PROFILE_SAVE_FAILED: {
		message: 'Failed to save Configuration Profile',
		id: 1536,
		header: 'Create Configuration Profile Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CONFIG_PROFILE_DELETE_FAILED: {
		message: 'Failed to delete Configuration Profile',
		id: 1537,
		header: 'Delete Configuration Profile Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CONFIG_PROFILE_DELETE_FAILED_NOT_FOUND: {
		message: 'Configuration profile not found',
		id: 15371,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CONFIG_PROFILE_DELETE_FAILED_NOT_ALLOWED: {
		message: 'Configuration profile is not deletable',
		id: 15372,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CONFIG_PROFILE_UPDATE_FAILED: {
		message: 'Failed to update Configuration Profile',
		id: 1538,
		header: 'Update Configuration Profile Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CONFIG_PROFILE_APPLY_FAILED: {
		message: 'Failed to Apply Configuration Profile',
		id: 1539,
		header: 'Apply Configuration Profile Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CONFIG_PROFILE_APPLIED: {
		message: 'Configuration Profile Applied',
		id: 1540,
		header: 'Configuration Profile Applied',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	UTILS_SEGMENTS_OVERLAP_METADATA_SEGMENT_UUID_CHANGED: {
		message: 'Overlap metadata segment uuid changed',
		id: 1542,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_UNKNOWN_RAID_TYPE: {
		message: 'Unknown RAID Type',
		id: 15421,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_NOT_FOUND: {
		message: 'Volume not found',
		id: 1543,
		header: 'Volume Not Found',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	LOCK_NO_ZONE_FOR_ALLOCATION: {
		message: 'No zones found to lock for allocation',
		id: 1544,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DBBACKUP_READ_BACKUP_INFO_FROM_FS_FAILED: {
		message: 'Failed to read backup information from file system',
		id: 1545,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DBBACKUP_FAILED_TO_TAKE_FS_LOCK: {
		message: 'Failed to take file system lock while trying to backup',
		id: 1546,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DBBACKUP_MORE_RECENT_BACKUP_FOUND: {
		message: 'Skipping backup as a more recent backup file was found on the file system',
		id: 1547,
		sysLogLevel: consts.loggingLevel.INFO
	},
	DBBACKUP_FILESYSTEM_ACCESS_FAILED: {
		message: 'Failed to write backup into the configured file system path',
		id: 1548,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DBBACKUP_DIRECTORY_DOES_NOT_EXISTS: {
		message: 'Backup directory do not exists',
		id: 1549,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DBBACKUP_BACKUP_RENAME_AFTER_COMPLETION_FAILED: {
		message: 'Failed to rename temp backup file to final backup file on completion',
		id: 1551,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	EXTERNAL_LOG_MSG: {
		message: '<Will be Replaced By The Client Message>',
		id: 1550,
		header: 'Will Be Replaced By The Client Header',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	VOLUME_NAME_ILLEGAL: {
		message: 'Illegal Volume name',
		id: 1552,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	LIMITED_MONGO_ADMIN_FEATURE: {
		message: 'The mongoDB authenticated user does not have the proper privileges for admin operations',
		id: 1553,
		header: 'Limited MongoDB Feature',
		logLevel: consts.loggingLevel.WARNING,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	LIMITED_MONGO_RS_FEATURE: {
		message: 'The mongoDB authenticated user does not have the proper privileges for cluster operations',
		id: 1554,
		header: 'Limited MongoDB Feature',
		logLevel: consts.loggingLevel.WARNING,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	KAFKA_GROUP_ID_NOT_FOUND: {
		message: 'Kafka group ID not found',
		id: 1955,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CHECK_FOR_UNUSED_TOPICS_FAILED: {
		message: 'Failed to check for unused topics',
		id: 1956,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CLEANUP_UNUSED_TOPICS_FAILED: {
		message: 'Failed to cleanup unused topics',
		id: 1957,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DISK_FORMAT_FAILED: {
		message: 'Failed to format drive',
		id: 15531,
		header: 'Format Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DISK_FORMATTED: {
		message: 'Drive is going to be formatted',
		id: 15532,
		header: 'Drive Formatted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	DELETE_DISK_SERVER_NOT_FOUND: {
		message: 'Server not found while trying to delete drive',
		id: 15533,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DELETE_DISK_DISK_NOT_FOUND: {
		message: 'Drive not found while trying to delete drive',
		id: 15534,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DISK_DELETED: {
		message: 'Drive deleted',
		id: 15535,
		header: 'Drive Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	DRIVE_DELETE_FAILED: {
		message: 'Failed to delete Drive',
		id: 155355,
		header: 'Drive Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DISK_DELETE_REQUEST: {
		message: 'REST API Request: Delete Drive',
		id: 15536,
		header: getAuditHeader(consts.entity.drive, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	DISK_FORMAT_REQUEST: {
		message: 'REST API Request: Format Drive',
		id: 15537,
		header: getAuditHeader(consts.entity.drive, consts.operation.format),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	SERVER_DELETE_REQUEST: {
		message: 'REST API Request: Delete Target',
		id: 15538,
		header: getAuditHeader(consts.entity.target, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	SERVER_DELETE_NIC_REQUEST: {
		message: 'REST API Request: Delete NIC',
		id: 15539,
		header: getAuditHeader(consts.entity.NIC, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	TARGET_NOT_FOUND: {
		message: 'Target not found',
		id: 15545,
		header: 'Target Not Found',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	NIC_DELETE_FAILED: {
		message: 'NIC Delete Failed',
		id: 15541,
		header: 'NIC Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	NIC_DELETED: {
		message: 'NIC Deleted',
		id: 15540,
		header: 'NIC Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	TARGET_DELETE_NIC_MISSING: {
		message: 'NIC is missing',
		id: 15542,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VSG_NAME_ALREADY_EXISTS: {
		message: 'VSG name already exists',
		id: 155421,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	ZONE_ALREADY_ASSIGNED: {
		message: 'Zone already assigned for this target',
		id: 15543,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SET_ZONE_TARGET_NOT_FOUND: {
		message: 'Target not found',
		id: 15544,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_UNDERGOING_REBUILD: {
		message: 'Volume action changed to rebuilding',
		id: 1555,
		header: 'Volume Rebuilding',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	SERVER_CONNECTION_RESET: {
		message: 'Server got CONNRESET error, this could happen when the CM websocket is trying to connect to the HTTP server port',
		id: 1556,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	APP_SEND_EMAIL_FAILED: {
		message: 'Failed to send email, additional info may have more information on the failure.',
		id: 1559,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_NOT_READY: {
		message: 'Volume is not ready',
		id: 1569,
		header: 'Volume Not Ready',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	MISSING_NODE_ID_IN_CONFIGURATION_PROFILE: {
		message: 'Failed to apply configuration profile to node - missing nodeID!',
		id: 1601,
		header: 'Apply Configuration Profile Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	TIMED_OUT_EVENT: {
		message: 'Timed out waiting for an event.',
		id: 1602,
		header: 'Timed Out',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UPDATE_CAPACITY: {
		message: 'Changing volume capacity via volumeUpdate is not allowed. Please use volume/extend',
		id: 1603,
		header: 'Wrong API',
		logLevel: consts.loggingLevel.WARNING,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	CHANGE_READ_ONLY_ON_SOURCE: {
		message: 'Cannot set readOnly = false. Volume is being used as a Source Volume',
		id: 1604,
		header: 'Update Volume Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	READ_WRITE_VOLUME: {
		message: 'Cannot set volume as ReadOnly. Volume is reserved with a ReadWrite permission',
		id: 1605,
		header: 'Update Volume Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UNKNOWN_RAID_LEVEL: {
		message: 'Unknown RAID Level',
		id: 1606,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CLIENT_SNAPSHOTS_NOT_SUPPORTED: {
		message: 'The client does not support Snapshots',
		id: 1607,
		header: 'Attach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CLIENT_NOT_FOUND: {
		message: 'Client not found',
		id: 1608,
		header: 'Client Not Found',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SNAPSHOT_SOURCE_VOLUME_NOT_ATTACHED: {
		message: 'Source volume not attached to client',
		id: 1609,
		header: 'Attach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SNAPSHOT_SOURCE_VOLUME_ATTACHMENT_NOT_READY: {
		message: 'Source volume attachment is not ready',
		id: 1610,
		header: 'Attach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_STATE_ATTACHING: {
		message: 'Volume attachment state changed to: Attaching',
		id: 1611,
		header: 'Volume Attachement State Changed',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	ADDED_REF_ID: {
		message: 'ReferenceID added to Volume Attachment',
		id: 16112,
		header: 'ReferenceID Added',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	CLIENT_HAS_ATTACHMENT: {
		message: 'Snapshot already attached or in progress of being attached.',
		id: 1613,
		header: 'Attach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	FAILED_TO_ATTACH_SNAPSHOT: {
		message: 'Failed to attach Snapshot volumes',
		id: 1614,
		header: 'Attach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	FAILED_TO_DETACH_SNAPSHOT: {
		message: 'Failed to detach Snapshot volumes',
		id: 1615,
		header: 'Detach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	REPORT_NOT_SAVED: {
		message: 'Target report not saved',
		id: 1617,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	TARGETS_MISSING_IN_ZONES_CACHE: {
		message: 'Some targets are missing in the zones cache',
		id: 1619,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UNAUTHORIZED_ATTACH_REQUEST: {
		message: 'Unauthorized attach request',
		id: 1620,
		header: 'Unauthorized Attach Access',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	ATTACH_CLIENT_UPDATE_FAILED: {
		message: 'Client not found or is intializing',
		id: 1621,
		header: 'Attach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	INC_ATTACHMNETS_VERSION_FAILED: {
		message: 'Failed to update client attachmentsVersion.',
		id: 162110,
		header: 'Attach Failed',
		logLevel: consts.loggingLevel.WARNING,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	DETACH_CLIENT_NOT_FOUND_OR_VOLUME_NOT_ATTACHED: {
		message: 'Client not found or volume already detached',
		id: 1622,
		header: 'Detach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_NOT_ATTACHED: {
		message: 'The volume is not attached to the client',
		id: 162222,
		header: 'Detach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	MISSING_REF_ID: {
		message: 'The requested referenceID is already detached from this client',
		id: 162223,
		header: 'Detach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CONFIG_PROFILE_SAVE_REQUEST: {
		message: 'REST API Request: Save Configuration Profile',
		id: 1623,
		header: getAuditHeader(consts.entity.configurationProfile, consts.operation.save),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	CONFIG_PROFILE_SAVED: {
		message: 'Configuration Profile saved successfully',
		id: 1624,
		header: 'Configuration Profile Created',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	CONFIG_PROFILE_DELETE_REQUEST: {
		message: 'REST API Request: Delete Configuration Profile',
		id: 1625,
		header: getAuditHeader(consts.entity.configurationProfile, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	CONFIG_PROFILE_APPLY_REQUEST: {
		message: 'REST API Request: Apply Configuration Profile',
		id: 16251,
		header: getAuditHeader(consts.entity.configurationProfile, consts.operation.apply),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	CONFIG_PROFILE_NOT_FOUND: {
		message: 'Configuration Profile not found',
		id: 16252,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CONFIG_PROFILE_DELETED: {
		message: 'Configuration Profile deleted successfully',
		id: 1626,
		header: 'Configuration Profile Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	CONFIG_PROFILE_UPDATE_REQUEST: {
		message: 'REST API Request: Update Configuration Profile',
		id: 1627,
		header: getAuditHeader(consts.entity.configurationProfile, consts.operation.update),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	CONFIG_PROFILE_UPDATED: {
		message: 'Configuration Profile updated successfully',
		id: 1628,
		header: 'Configuration Profile Updated',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	CLIENT_DELETE_REQUEST: {
		message: 'REST API Request: Delete Clients',
		id: 162711,
		header: getAuditHeader(consts.entity.client, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	UPGRADE_AGENT_DELETE_REQUEST: {
		message: 'REST API Request: Delete Upgrade Agents',
		id: 162722,
		header: getAuditHeader(consts.entity.upgradeAgent, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	UPGRADE_MISSING_SCENARIO: {
		message: 'No scenario found for upgrade',
		id: 162733,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UPGRADE_NO_STEPS_TO_EXECUTE: {
		message: 'No steps to execute for the selected machines - all components are already in the destination version',
		id: 162744,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DRIVECLASS_DRIVE_NOT_FOUND: {
		message: 'Drive Class not found',
		id: 162521,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DRIVECLASS_DRIVE_OUT_OF_SERVICE: {
		message: 'Drive is out of service',
		id: 162522,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DRIVECLASS_DRIVE_BAD_STATUS: {
		message: 'Drive cannot be used due to incompatible status',
		id: 162523,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DRIVECLASS_SAVE_FAILED: {
		message: 'Failed to save Drive Class',
		id: 162524,
		header: 'Drive Class Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DRIVECLASS_SAVED: {
		message: 'Drive Class saved successfully',
		id: 162525,
		header: 'Drive Class Saved',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	DRIVECLASS_UPDATE_FAILED: {
		message: 'Failed to update Drive Class',
		id: 162526,
		header: 'Drive Class Update Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DRIVECLASS_UPDATE_VOLUME_IN_USE: {
		message: 'Drive Class used by volume(s)',
		id: 162527,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DRIVECLASS_UPDATED_NOT_FOUND: {
		message: 'Drive Class not found',
		id: 1625271,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DRIVECLASS_UPDATED: {
		message: 'Drive Class updated successfully',
		id: 162528,
		header: 'Drive Class Updated',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	DRIVECLASS_DELETE_FAILED: {
		message: 'Failed to delete Drive Class',
		id: 162529,
		header: 'Drive Class Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DRIVECLASS_DELETE_USED: {
		message: 'Drive Class used by volume(s)',
		id: 162530,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DRIVECLASS_DELETE_NOT_FOUND: {
		message: 'Drive Class not found',
		id: 162531,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DRIVECLASS_DELETED: {
		message: 'Drive Class deleted successfully',
		id: 162532,
		header: 'Drive Class Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	DRIVECLASS_SAVE_REQUEST: {
		message: 'REST API Request: Drive Class Save',
		id: 162533,
		header: getAuditHeader(consts.entity.driveClass, consts.operation.save),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	DRIVECLASS_UPDATE_REQUEST: {
		message: 'REST API Request: Drive Class Update',
		id: 162534,
		header: getAuditHeader(consts.entity.driveClass, consts.operation.update),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	DRIVECLASS_DELETE_REQUEST: {
		message: 'REST API Request: Drive Class Delete',
		id: 162535,
		header: getAuditHeader(consts.entity.driveClass, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	DRIVECLASS_SAVE_NAME_ALREADY_EXISTS: {
		message: 'Drive Class name already exists',
		id: 162536,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DRIVECLASS_SAVE_FAILED_DRIVE_WITH_DOMAIN_CONFLICT: {
		message: 'Drive Class not saved due to domain conflict of a disk',
		id: 162537,
		header: 'Drive Class Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	TARGETCLASS_DOMAIN_CONFLICT_ON_DRIVE_REAPPEARING: {
		message: 'Drive reappearing caused a domain conflict with other Target Classs',
		id: 162538,
		header: 'Drive Reappearing Caused Domain Conflict',
		logLevel: consts.loggingLevel.WARNING,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	TARGETCLASS_SAVE_FAILED_TARGET_WITH_DOMAIN_CONFLICT: {
		message: 'Target Class not saved due to domain conflict of a target',
		id: 320,
		header: 'Target Class Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	TARGETCLASS_FAILED_TARGET_NOT_FOUND: {
		message: 'Target Class not found',
		id: 321,
		header: 'Target Class Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	TARGETCLASS_UPDATE_FAILED_TARGET_NOT_FOUND: {
		message: 'Target Class not found',
		id: 322,
		header: 'Target Class Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	TARGETCLASS_SAVE_FAILED: {
		message: 'Failed to save Target Class',
		id: 323,
		header: 'Target Class Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	TARGETCLASS_SAVED: {
		message: 'Target Class saved successfully',
		id: 324,
		header: 'Target Class Saved',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	TARGETCLASS_UPDATE_FAILED: {
		message: 'Failed to update Target Class',
		id: 325,
		header: 'Target Class Update Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	TARGETCLASS_UPDATE_VOLUME_IN_USE: {
		message: 'Target Class used by volume(s)',
		id: 326,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	TARGETCLASS_NOT_FOUND: {
		message: 'Target Class not found',
		id: 327,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	TARGETCLASS_UPDATED: {
		message: 'Target Class updated successfully',
		id: 328,
		header: 'Target Class Updated',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	TARGETCLASS_DELETE_FAILED: {
		message: 'Failed to delete Target Class',
		id: 329,
		header: 'Target Class Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	TARGETCLASS_DELETE_USED: {
		message: 'Target Class used by volume(s)',
		id: 330,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	TARGETCLASS_DELETE_NOT_FOUND: {
		message: 'Target Class not found',
		id: 331,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	TARGETCLASS_DELETED: {
		message: 'Target Class deleted successfully',
		id: 332,
		header: 'Target Class Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	TARGETCLASS_SAVE_REQUEST: {
		message: 'REST API Request: Target Class Save',
		id: 333,
		header: getAuditHeader(consts.entity.targetClass, consts.operation.save),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	TARGETCLASS_UPDATE_REQUEST: {
		message: 'REST API Request: Target Class Update',
		id: 334,
		header: getAuditHeader(consts.entity.targetClass, consts.operation.update),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	TARGETCLASS_DELETE_REQUEST: {
		message: 'REST API Request: Target Class Delete',
		id: 335,
		header: getAuditHeader(consts.entity.targetClass, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	TARGETCLASS_SAVE_NAME_ALREADY_EXISTS: {
		message: 'Target Class name already exists',
		id: 336,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	TARGETCLASS_UPDATE_NOT_FOUND: {
		message: 'Target Class not found',
		id: 337,
		header: 'Target Class Update Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DRIVECLASS_UPDATE_NOT_FOUND: {
		message: 'Drive Class not found',
		id: 338,
		header: 'Drive Class Update Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CLIENT_DELETED: {
		message: 'Client deleted successfully',
		id: 16281,
		header: 'Client Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	UPGRADE_AGENT_DELETED: {
		message: 'Upgrade Agent deleted successfully',
		id: 16285,
		header: 'Upgrade Agent Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	UPGRADE_AGENT_DELETE_FAILED: {
		message: 'Failed to delete upgrade agent',
		id: 16286,
		header: 'Upgrade Agent Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UPGRADE_AGENT_CREATE_FAILED: {
		message: 'Failed to create upgrade agent - missing featureCompatibilityVersion',
		id: 16287,
		header: 'Upgrade Agent Creation Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UPGRADE_NOT_FOUND: {
		message: 'Upgrade not found',
		id: 16288,
		header: 'Upgrade Not Found',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CLIENT_DELETE_FAILED: {
		message: 'Failed to delete client',
		id: 16282,
		header: 'Client Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DISK_EVICT_REQUEST: {
		message: 'REST API Request: Evict Drive',
		id: 1629,
		header: getAuditHeader(consts.entity.drive, consts.operation.evict),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	DISK_CANT_BE_EVICTED: {
		message: 'Drive can not be evicted',
		id: 1630,
		header: 'Can\'t Evict Drive',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DISK_EVICT_FAILED: {
		message: 'Failed to evict Drive',
		id: 1631,
		header: 'Drive Evict Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CANNOT_EVICT_DISK: {
		message: 'Cannot evict disk with status NOT_INITIALIZED or in EXCLUDED state',
		id: 16311,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DISK_EVICTED: {
		message: 'Drive evicted successfully',
		id: 1632,
		header: 'Drive Evicted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	DRIVE_REINSTATED: {
		message: 'Drive reinstated successfully',
		id: 16331,
		header: 'Drive Reinstated',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	DISK_REINSTATE_REQUEST: {
		message: 'REST API Request: Reinstate Drive',
		id: 16312,
		header: getAuditHeader(consts.entity.drive, consts.operation.reinstate),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	DRIVE_REINSTATE_FAILED: {
		message: 'Failed to reinstate Drive',
		id: 16332,
		header: 'Drive Reinstate Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DRIVE_REINSTATE_RESUME_AFTER_FORMAT_FAILED: {
		message: 'Failed to resume Drive reinstate after format',
		id: 163321,
		header: 'Drive Reinstate Resume Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DRIVE_REINSTATE_IN_PROGRESS: {
		message: 'Drive reinstate is in progress',
		id: 16333,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DRIVE_REINSTATE_NOT_OUT_OF_SERVICE: {
		message: 'Cannot reinstate drive: drive must be evicted before reinstate',
		id: 163331,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DRIVE_REINSTATE_NON_PROTECTED_SEGMENTS: {
		message: 'Cannot reinstate drive: drive has non-protected segments',
		id: 163332,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DRIVE_REINSTATE_NO_DATA_SEGMENTS: {
		message: 'Cannot reinstate drive: drive has no data segments to reinstate',
		id: 163333,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DRIVE_REINSTATE_SERVER_VERSION_CONFLICT: {
		message: 'Drive changed during reinstate, retrying',
		id: 16337,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	DRIVE_REINSTATE_VOLUME_UPDATE_FAILED: {
		message: 'Failed to update volume during reinstate, sanity will recover',
		id: 16338,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	GENERAL_SETTINGS_UPDATE_REQUEST: {
		message: 'REST API Request: Update General Settings',
		id: 1633,
		header: getAuditHeader(consts.entity.generalSettings, consts.operation.update),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	GENERAL_SETTINGS_UPDATE_FAILED: {
		message: 'Failed to update General Settings',
		id: 1634,
		header: 'General Settings Update Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	GENERAL_SETTINGS_UPDATED: {
		message: 'General Settings updated successfully',
		id: 1635,
		header: 'General Settings Updated',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	SERVER_EVICT_REQUEST: {
		message: 'REST API Request: Evict Target',
		id: 1636,
		header: getAuditHeader(consts.entity.target, consts.operation.evict),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	SERVER_DELETE_FAILED: {
		message: 'Failed to delete Target',
		id: 1638,
		header: 'Delete Target Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	TARGET_MARKED_FOR_DELETION: {
		message: 'Target marked for deletion',
		id: 1639,
		header: 'Target Marked For Deletion',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	SERVER_DELETE_MISSING: {
		message: 'Cant find target to delete',
		id: 1640,
		header: 'Delete Target Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SET_ZONE_REQUEST: {
		message: 'REST API Request: Set Zone',
		id: 1641,
		header: getAuditHeader(consts.entity.target, consts.operation.setZone),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	REGEN_TOMA_MSGS_REQUEST: {
		message: 'REST API Request: Regenerate TOMA Messages',
		id: 16411,
		header: getAuditHeader(consts.entity.zone, consts.operation.regenerateMessages),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	REGEN_TOMA_MSGS_FAILED: {
		message: 'Failed to Regenerate TOMA Messages',
		id: 16412,
		header: 'TOMA Messages Regeneration Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	REGEN_TOMA_MSGS_SUCCESS: {
		message: 'TOMA Messages regenerated successfully',
		id: 16413,
		header: 'TOMA Messages Regenerated',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	REGEN_TOMA_MSGS_ZONE_NOT_FOUND: {
		message: 'Failed to Regenerate TOMA Messages - Zone not found',
		id: 16414,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SET_ZONE_FAILED_DB: {
		message: 'Failed to set Zone - DB Error',
		id: 1642,
		header: 'Set Zone Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SET_ZONE_SUCCESS: {
		message: 'Zone set successfully',
		id: 16421,
		header: 'Zone Set',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	SET_ZONE_FAILED: {
		message: 'Failed to set Zone',
		id: 1643,
		header: 'Set Zone Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	USERS_SAVE_REQUEST: {
		message: 'REST API Request: Save User',
		id: 1644,
		header: getAuditHeader(consts.entity.user, consts.operation.save),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	USERS_SAVE_FAILED: {
		message: 'Failed to save users',
		id: 1645,
		header: 'Users Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	USER_NOT_FOUND: {
		message: 'User not found',
		id: 16451,
		header: 'User Not Found',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	USER_SAVE_FAILED: {
		message: 'Failed to save user',
		id: 1646,
		header: 'User Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	USER_SAVED: {
		message: 'User saved successfully',
		id: 1647,
		header: 'User Saved',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	USER_CANNOT_CHANGE_PASSWORD: {
		message: 'Cannot change other user\'s password',
		id: 1648,
		header: 'User Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	EMAIL_ALREADY_TAKEN: {
		message: 'Email already taken',
		id: 1649,
		header: 'User Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	USERS_UPDATE_REQUEST: {
		message: 'REST API Request: Update User',
		id: 1650,
		header: getAuditHeader(consts.entity.user, consts.operation.update),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	USER_UPDATE_NOT_FOUND: {
		message: 'User to update not found',
		id: 1651,
		header: 'User Update Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	USER_UPDATE_FAILED: {
		message: 'Failed to update user',
		id: 1652,
		header: 'User Update Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	USER_UPDATED: {
		message: 'User updated successfully',
		id: 1653,
		header: 'User Updated',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	USERS_UPDATE_FAILED: {
		message: 'Failed to update users',
		id: 1654,
		header: 'User Update Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	USERS_DELETE_REQUEST: {
		message: 'REST API Request: Delete User',
		id: 1655,
		header: getAuditHeader(consts.entity.user, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	USER_DELETE_UNDELETABLE: {
		message: 'User can\'t be deleted',
		id: 1656,
		header: 'User Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	USER_DELETE_NOT_FOUND: {
		message: 'User delete not found',
		id: 1657,
		header: 'User Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	USER_DELETE_FAILED: {
		message: 'Failed to delete user',
		id: 1658,
		header: 'User Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	USER_DELETED: {
		message: 'User deleted successfully',
		id: 1659,
		header: 'User Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	VOLUMES_SAVE_REQUEST: {
		message: 'REST API Request: Save Volume',
		id: 1660,
		header: getAuditHeader(consts.entity.volume, consts.operation.save),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	VPG_RESERVATION_MADE: {
		message: 'VPG reservation made successfully',
		id: 1661,
		header: 'VPG Created',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	EXTENSION_CREATED: {
		message: 'Extension created successfully',
		id: 1662,
		header: 'Volume Extended',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	VOLUME_SAVED: {
		message: 'Volume saved successfully',
		id: 1663,
		header: 'Volume Saved',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	VOLUME_SAVE_FAILED: {
		message: 'Failed to save volume',
		id: 1664,
		header: 'Volume Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_FAILED_TO_RESOLVE_VPG: {
		message: 'Failed resolve VPG',
		id: 1665,
		header: 'Volume Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SNAPSHOT_SAVED: {
		message: 'Snapshot saved successfully',
		id: 1667,
		header: 'Volume Saved',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	GENERAL_VOLUME_ERROR: {
		message: 'Failed to operate volume',
		id: 1668,
		header: 'Volume Operation Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_EXTEND_REQUEST: {
		message: 'REST API Request: Extend Volume',
		id: 1669,
		header: getAuditHeader(consts.entity.volume, consts.operation.extend),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	VOLUME_EXTENDED: {
		message: 'Volume extended successfully',
		id: 1670,
		header: 'Volume Extended',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	VOLUME_EXTEND_NOT_FOUND: {
		message: 'Volume to extend not found',
		id: 1671,
		header: 'Volume Extend Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_EXTEND_SNAPSHOT_ERROR: {
		message: 'Failed to extend volume due to snapshot error',
		id: 1672,
		header: 'Volume Extend Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_EXTEND_CAPACITY_ERROR: {
		message: 'Failed to extend volume due to capacity issue',
		id: 1673,
		header: 'Volume Extend Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_EXTEND_FAILURE_NO_CHUNKS: {
		message: 'Failed to extend volume due to missing chunks on the volume',
		id: 1674,
		header: 'Volume Extend Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_EXTEND_CREATE_EXTENSION_FAILED: {
		message: 'Failed to extend volume due to extension create failed',
		id: 1675,
		header: 'Volume Extend Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_EXTEND_ORGINAL_FAILED: {
		message: 'Failed to update original volume after extend',
		id: 1676,
		header: 'Volume Extend Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_UPDATE_NOT_FOUND: {
		message: 'Volume to update not found',
		id: 1677,
		header: 'Volume Extend Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_UPDATED: {
		message: 'Volume updated successfully',
		id: 1678,
		header: 'Volume Updated',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	VOLUME_UPDATE_REQUEST: {
		message: 'REST API Request: Update Volume',
		id: 1679,
		header: getAuditHeader(consts.entity.volume, consts.operation.update),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	INIT_ENCRYPTION_REQUEST: {
		message: 'REST API Request: Init Volume Encryption',
		id: 16791,
		header: getAuditHeader(consts.entity.encryption, consts.operation.initiate),
		sensitiveFields: ['passphrase'],
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	ACKNOWLEDGE_RESPONSE_REQUEST: {
		message: 'REST API Request: Encryption Acknowledge Response',
		id: 16780,
		header: getAuditHeader(consts.entity.encryption, consts.operation.initiate),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	ALL_LOGS_ACKNOWLEDGED: {
		message: 'All logs acknowledged',
		id: 16781,
		header: 'All Logs Acknowledged',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	LOG_NOT_FOUND: {
		message: 'Log not found',
		id: 16782,
		header: 'Log Not Found',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	ENCRYPTION_ALREADY_INITIALIZED: {
		message: 'Volume encryption already initialized',
		id: 16792,
		header: 'Encryption Command Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_NOT_READY_FOR_INIT_ENCRYPTION: {
		message: 'Volume is not ready for init encryption.',
		id: 167921,
		header: 'Encryption Command Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_ENCRYPTION_NOT_INITIALIZED: {
		message: 'Volume encryption not initialized.',
		id: 167922,
		header: 'Encryption Command Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_MISSING_IS_ENCRYPTED: {
		message: 'Volume must be created with isEncrypted: true',
		id: 16793,
		header: 'Encryption Command Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SET_ENCRYPTION_COMMAND_FAILED: {
		message: 'Failed to set the encryption command. Either the volume doesn\'t exist, or another encryption command is already in progress.',
		id: 16794,
		header: 'Encryption Command Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	ADD_PASSPHRASE_REQUEST: {
		message: 'REST API Request: Add Passphrase',
		id: 16795,
		header: getAuditHeader(consts.entity.passphrase, consts.operation.add),
		sensitiveFields: ['currentPassphrase', 'newPassphrase'],
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	DELETE_PASSPHRASE_REQUEST: {
		message: 'REST API Request: Delete Passphrase',
		id: 16796,
		header: getAuditHeader(consts.entity.passphrase, consts.operation.delete),
		sensitiveFields: ['currentPassphrase'],
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	ROTATE_PASSPHRASE_REQUEST: {
		message: 'REST API Request: Rotate Passphrase',
		id: 16797,
		header: getAuditHeader(consts.entity.passphrase, consts.operation.rotate),
		sensitiveFields: ['currentPassphrase', 'newPassphrase'],
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	GET_EXECUTING_TOMA_FOR_ENCRYPTION_FAILURE: {
		message: 'Failed to get executing TOMA for encryption command',
		id: 16798,
		header: 'Encryption Command Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	GET_EXECUTING_TOMA_FOR_ENCRYPTION_FAILURE_UNAVAILABLE_TARGET: {
		message: 'Failed to get executing TOMA for encryption command. There are no available targets',
		id: 16799,
		header: 'Encryption Command Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	OPERATION_NOT_SUPPORTED_FOR_SNAPSHOTS: {
		message: 'This operation is not supported for a snapshot volume',
		id: 1680,
		header: 'Volume Operation Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_DELETE_REQUEST: {
		message: 'REST API Request: Delete Volume',
		id: 1681,
		header: getAuditHeader(consts.entity.volume, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	VOLUME_DELETE_NOT_FOUND: {
		message: 'Volume to delete not found',
		id: 1682,
		header: 'Volume Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_DELETE_IN_USE: {
		message: 'Volume to delete in use',
		id: 1683,
		header: 'Volume Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_DELETE_CHECK_SOURCE_IN_USE_FAILED: {
		message: 'Failed to check if source volume is in use',
		id: 1685,
		header: 'Volume Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_DELETE_SOURCE_IN_USE: {
		message: 'Volume source is in use',
		id: 1686,
		header: 'Volume Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_DELETE_FAILED: {
		message: 'Failed to delete volume',
		id: 1687,
		header: 'Volume Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_DELETE_PENDING: {
		message: 'Volume is already in pending delete state',
		id: 1688,
		header: 'Volume Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_MARKED_FOR_DELETION: {
		message: 'Volume marked for deletion',
		id: 1689,
		header: 'Volume Marked For Deletion',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	SNAPSHOT_MARKED_FOR_DELETION: {
		message: 'Snapshot marked for deletion',
		id: 1690,
		header: 'Snapshot Marked For Deletion',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	VOLUME_REBUILD_REQUEST: {
		message: 'REST API Request: Rebuild Volume',
		id: 1691,
		header: getAuditHeader(consts.entity.volume, consts.operation.rebuild),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	CLIENT_ATTACH_REQUEST: {
		message: 'REST API Request: Attach Volume',
		id: 1692,
		header: getAuditHeader(consts.entity.client, consts.operation.attach),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	CLIENT_ATTACH_VOLUME_NOT_FOUND: {
		message: 'Volume to attach not found',
		id: 1693,
		header: 'Attach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CLIENT_ATTACH_VOLUME_CONFIGURATION_ERROR: {
		message: 'Error while getting attach volume configuration.',
		id: 1694,
		header: 'Attach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	BUILD_RESPONSES_ERROR: {
		message: 'Failed to attach volume',
		id: 1695,
		header: 'Attach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SNAPSHOT_ATTACH_MONGO_ERROR: {
		message: 'Failed to attach snapshot',
		id: 1697,
		header: 'Attach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SNAPSHOT_SOURCE_VOLUME_ERROR: {
		message: 'Failed to validate snapshot source volume',
		id: 1698,
		header: 'Attach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VALIDATE_SOURCE_ERROR: {
		message: 'Failed to validate snapshot source volume attached',
		id: 1699,
		header: 'Attach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SNAPSHOT_STATE_ATTACHING: {
		message: 'Snapshot attachment state changed to: Attaching',
		id: 1701,
		header: 'Attachment State Changed',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	CLIENT_DETACH_REQUEST: {
		message: 'REST API Request: Detach Volume',
		id: 1702,
		header: getAuditHeader(consts.entity.client, consts.operation.detach),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	DETACH_VOLUME_GENERAL_ERROR: {
		message: 'Failed to detach volume',
		id: 1703,
		header: 'Detach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DETACH_VOLUME_HANDLE_SNAPSHOT_ERROR: {
		message: 'Failed to detach snapshot',
		id: 1704,
		header: 'Detach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DETACH_VOLUME_UPDATE_ERROR: {
		message: 'Failed to update volume to detach',
		id: 1705,
		header: 'Detach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	PENDING_DETACH_VOLUME_UPDATE_ERROR: {
		message: 'Failed to update volume to pending detach',
		id: 17051,
		header: 'Detach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_STATE_DETACHING: {
		message: 'Volume attachment state changed to: Detaching',
		id: 1706,
		header: 'Attachment State Changed',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	VOLUME_REMOVED_REF_ID: {
		message: 'Volume attachment state remained Attaching. Removed referenceID.',
		id: 17061,
		header: 'Removed ReferenceID',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	SNAPSHOT_STATE_DETACHING: {
		message: 'Snapshot attachment state changed to: Detaching',
		id: 1708,
		header: 'Attachment State Changed',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	VALIDATE_RESERVATION_READ_ONLY_ERROR: {
		message: 'Requested Write permissions but the volume is ReadOnly',
		id: 1716,
		header: 'Reservation Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VALIDATE_RESERVATION_MISMATCH: {
		message: 'Reservation version mismatch',
		id: 1717,
		header: 'Reservation Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VALIDATE_RESERVATION_PREEMPT_ERROR: {
		message: 'Request cannot be fulfill, the requested Reservation Mode doesn\'t comply with the volume Reservation Mode, please use the preempt flag to transition.',
		id: 1718,
		header: 'Reservation Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VALIDATE_RESERVATION_MISMATCH_UPDATE_FAILED: {
		message: 'Failed to update the volume, reservation version mismatch, please retry',
		id: 1719,
		header: 'Reservation Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_IS_PART_OF_SNAPSHOT: {
		message: 'Volume is part of a snapshot',
		id: 1720,
		header: 'Attach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UTILS_SAVE_VOLUMES_VSG_NOT_FOUND: {
		message: 'VSG not found',
		id: 1721,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_UPDATE_VALIDATION_FAILED: {
		message: 'Failed to validate volume to update',
		id: 1722,
		header: 'Volume Update Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CLUSTER_ID_UPDATED: {
		message: 'Cluster ID updated successfully',
		id: 16918,
		header: 'Cluster ID Updated',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	UPDATE_CLUSTER_ID_FAILED: {
		message: 'Failed to update cluster ID',
		id: 16919,
		header: 'Cluster ID Update Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UPDATE_CLUSTER_ID_REQUEST: {
		message: 'REST API Request: Update Cluster ID',
		id: 16920,
		header: getAuditHeader(consts.entity.clusterID, consts.operation.update),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	MANAGEMENT_CLUSTER_NOT_FOUND: {
		message: 'Management Cluster not found',
		id: 151110,
		header: 'Management Cluster Not Found',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	MANAGEMENT_CLUSTER_DELETE_REQUEST: {
		message: 'REST API Request: Delete Management',
		id: 151111,
		header: getAuditHeader(consts.entity.management, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	DELETE_MANAGEMENT_FAILED: {
		message: 'Failed to delete Management',
		id: 151112,
		header: 'Management Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DELETE_MANAGEMENT_SUCCESS: {
		message: 'Management deleted successfully',
		id: 151113,
		header: 'Management Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	CANT_DELETE_OWN_MANAGEMENT: {
		message: 'Can not delete own Management',
		id: 151114,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CANT_DELETE_CONNECTED_MANAGEMENT: {
		message: 'Management must be offline for at least 5 minutes before deletion is allowed',
		id: 151115,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CANT_FIND_MANAGEMENT: {
		message: 'Management not found',
		id: 151116,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VSG_DELETE_REQUEST: {
		message: 'REST API Request: Volume Security Group Delete',
		id: 16921,
		header: getAuditHeader(consts.entity.vsg, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	VSG_UPDATE_REQUEST: {
		message: 'REST API Request: Volume Security Group Update',
		id: 16922,
		header: getAuditHeader(consts.entity.vsg, consts.operation.update),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	VSG_SAVE_REQUEST: {
		message: 'REST API Request: Volume Security Group Save',
		id: 16923,
		header: getAuditHeader(consts.entity.vsg, consts.operation.save),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	VSG_SAVED: {
		message: 'Volume Security Group saved successfully',
		id: 16924,
		header: 'VSG Saved',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
	},
	VSG_UPDATED: {
		message: 'Volume Security Group updated successfully',
		id: 16925,
		header: 'VSG Updated',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
	},
	VSG_DELETED: {
		message: 'Volume Security Group deleted successfully',
		id: 16926,
		header: 'VSG Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
	},
	VSG_SAVE_FAILED: {
		message: 'Failed to save Volume Security Group',
		id: 16927,
		header: 'VSG Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	VSG_UPDATE_FAILED: {
		message: 'Failed to update Volume Security Group',
		id: 16928,
		header: 'VSG Update Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	VSG_DELETE_FAILED: {
		message: 'Failed to delete Volume Security Group',
		id: 16929,
		header: 'VSG Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	VSG_DELETE_NOT_FOUND: {
		message: 'VSG not found',
		id: 16930,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KEY_NOT_FOUND: {
		message: 'Key not found',
		id: 16931,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VSG_NOT_FOUND: {
		message: 'VSG not found',
		id: 16932,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SANITY_AUTO_REMOVE_IS_EXTENSION_VOLUME_FAILED: {
		message: 'Failed to auto remove dirty volume with isExtension',
		id: 1560,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SANITY_AUTO_REMOVE_IS_EXTENSION_SEGMENT_FAILED: {
		message: 'Failed to auto remove dirty segment with isExtension',
		id: 15601,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SANITY_IS_EXTENSION_VOLUME_AUTO_REMOVED: {
		message: 'Automatically removed dirty volume with isExtension',
		id: 1561,
		sysLogLevel: consts.loggingLevel.INFO
	},
	FAILED_TO_UPDATE_SNAPSHOT_AFTER_MDV_CREATED: {
		message: 'Failed to update snapshot after metadata volume was created',
		id: 1562,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SNAPSHOT_CANNOT_DELETE_METADATA_VOLUME: {
		message: 'Cannot delete a metadata volume. Please delete the snapshot volume',
		id: 1563,
		header: 'Volume Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SNAPSHOT_OPERATION_NOT_PERMITTED_FOR_MD_VOLUME: {
		message: 'This operation is not permitted for a metadata volume.',
		id: 1564,
		header: 'Snapshot Operation Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_MESSAGE_COMPLETION_WITH_ERROR: {
		message: 'Failed to handle kafka message',
		id: 1565,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SERVER_REPORT_FINISHED_WITH_ERROR: {
		message: 'Handle target report finished with error',
		id: 1566,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	LEADER_KEEPALIVE_VALIDATION_FAILURE: {
		message: 'Failed to validate leader keepalive',
		id: 1567,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	LEADER_KEEPALIVE_ZONE_NOT_FOUND: {
		message: 'Failed to handle leader keepalive, zone not found',
		id: 1568,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	TOMA_KEEPALIVE_WITHOUT_TOKEN: {
		message: 'Failed to handle TOMA keepalive, no toma token found',
		id: 1570,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CANT_DELETE_INITALIZING_VOLUME: {
		message: 'Volume with action initializing cant be deleted.',
		id: 1571,
		header: 'Volume Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_DELETE_CHECK_IN_USE: {
		header: 'Volume Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR,
		message: 'Failed to check if the volume to delete is in use',
		id: 168411
	},
	CANT_EDIT_VOLUME_CUSTOM_PROPS_WHILE_VPG_USED: {
		message: `Cannot edit the following volume properties while the volume is using a VPG: ${consts.updateExcludedPropertiesForVPGVolumes.join(', ')}`,
		id: 168412,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CANT_EDIT_CRC_CHECK_FOR_RAID_LEVEL: {
		message: 'Cannot edit enableCrcCheck for this RAID level',
		id: 168413,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CANT_EXTEND_INITALIZING_VOLUME: {
		message: 'Volume with action initializing cant be extended.',
		id: 1572,
		header: 'Volume Extend Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	TOMA_IS_UP_ERR: {
		message: 'To perform this operation TOMA should be down on all of the targets. Please shut down TOMA on the following nodes and retry.',
		id: 1573,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CHANGE_PASSWORD_REQUEST: {
		message: 'REST API Request: Change Password',
		id: 1574,
		header: getAuditHeader(consts.entity.password, consts.operation.change),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	OPERATION_NOT_PERMITTED_NOT_ADMIN: {
		message: 'Operation not permitted. This action can only be performed by an Admin or by logged in user.',
		id: 1575,
		header: 'Change Password Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CHANGE_PASSWORD_PASSWORDS_DONT_MATCH: {
		message: 'Password and Confirmation Password don\'t match',
		id: 1576,
		header: 'Change Password Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CHANGE_PASSWORD_FAILED_TO_UPDATE: {
		message: 'Failed to update password',
		id: 1577,
		header: 'Change Password Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	PASSWORD_CHANGED: {
		message: 'Password changed successfully',
		id: 1578,
		header: 'Password Changed',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	KAFKA_DISCONNECT_CONSUMER_ERROR: {
		message: 'Management received an unexpected disconnect error from Kafka.',
		id: 1579,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_CRASH_CONSUMER_ERROR: {
		message: 'Received unexpected and unknown error from kafka consumer:',
		id: 1580,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CANT_DELETE_MARKED_FOR_DELETION_VOLUME: {
		message: 'Volume with action marked for deletion cant be deleted.',
		id: 1581,
		header: 'Delete Volume Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CANT_EDIT_MARKED_FOR_DELETION_VOLUME: {
		message: 'Volume with action marked for deletion cant be edited.',
		id: 1582,
		header: 'Update Volume Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	FAILED_TO_INIT_KAFKA_ADMIN: {
		message: 'Failed to initiate kafka admin',
		id: 1584,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	FAILED_TO_INIT_KAFKA_PRODUCER: {
		message: 'Failed to initiate kafka producer',
		id: 1585,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_DISCONNECT_PRODUCER_ERROR: {
		message: 'Failed to disconnect kafka producer',
		id: 1586,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_RECYCLE_PRODUCER_ERROR: {
		message: 'Failed to recycle kafka producer',
		id: 1587,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UNKNOWN_AUTH_METHOD: {
		message: 'Unknown authentication method in management.js.conf. The value of httpsServerAuthenticationMethod should be \'credentials\' or \'MTLS\'.',
		id: 1588,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VPG_EXTEND_FAILED: {
		message: 'Failed to extend VPG',
		id: 1591,
		header: 'Extend VPG Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VPG_DELETE_REQUEST: {
		message: 'REST API Request: Delete VPG',
		id: 1592,
		header: getAuditHeader(consts.entity.vpg, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	VPG_DELETED: {
		message: 'VPG deleted',
		id: 1593,
		header: 'VPG Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	VPG_DELETE_FAILED: {
		message: 'Failed to delete VPG',
		id: 1594,
		header: 'VPG Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DELETE_VPG_NOT_FOUND: {
		message: 'Failed to find the VPG to delete',
		id: 15941,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DELETE_VPG_FAILED_DEFAULT_VPG: {
		message: 'Default VPG is not deletable',
		id: 15942,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DELETE_VPG_FAILED_IN_USE: {
		message: 'VPG in use by volumes',
		id: 15943,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DELETE_VPG_FAILED: {
		message: 'Failed to delete VPG',
		id: 15944,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DELETE_VPG_FAILED_DELETE: {
		message: 'Failed to delete VPG',
		id: 15945,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VPG_UPDATE_REQUEST: {
		message: 'REST API Request: Update VPG',
		id: 1595,
		header: getAuditHeader(consts.entity.vpg, consts.operation.update),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	VPG_UPDATED: {
		message: 'VPG updated',
		id: 1596,
		header: 'VPG Updated',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	VPG_UPDATE_FAILED: {
		message: 'Failed to update VPG',
		id: 1597,
		header: 'VPG Updated Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VPG_SAVE_REQUEST: {
		message: 'REST API Request: Save VPG',
		id: 1598,
		header: getAuditHeader(consts.entity.vpg, consts.operation.save),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	VPG_SAVED: {
		message: 'VPG saved',
		id: 1599,
		header: 'VPG Saved',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	VPG_SAVE_FAILED: {
		message: 'Failed to save VPG',
		id: 16000,
		header: 'VPG Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	PROJECTION_MUST_INCLUDE_BD_NAME: {
		message: 'Projection must include block_devices\'s name',
		id: 16010,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	PROJECTION_MUST_INCLUDE_VOLUME_ID: {
		message: 'Projection must include volumes\'s _id',
		id: 16020,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	FAILED_TO_LOAD_CLIENTS: {
		message: 'Failed to load clients',
		id: 16030,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	FAILED_TO_LOAD_VOLUMES: {
		message: 'Failed to load volumes',
		id: 16040,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	FAILED_TO_INIT_KAFKA_TOPICS: {
		message: 'Failed to initialize Kafka topics',
		id: 16050,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	FAILED_TO_FETCH_TOPICS_METADATA: {
		message: 'Failed to fet topics metadata',
		id: 16100,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_TOPICS_METADATA_NO_FOUND: {
		message: 'Kafka topics metadata not found',
		id: 16110,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	FAILED_TO_CREATE_TOPIC_ACL: {
		message: 'Failed to create topic access list',
		id: 16130,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VPG_NOT_MD_TYPE: {
		message: `The VPG for the metadata volume is not of type ${consts.volumeTypes.METADATA_VOLUME}`,
		id: 16140,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SANITY_SNAPSHOT_WITHOUT_METADATA: {
		message: 'Found a Snapshot volume with no metadata',
		id: 16150,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	SANITY_SNAPSHOT_METADATA_WITH_NO_DATA: {
		message: 'Found a Snapshot Metadata volume but its snapshot volume could not be found',
		id: 16160,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	DETACH_FAILED_NOT_A_SNAPSHOT: {
		message: 'Snapshot Detach Failed - Volume is not a snapshot',
		id: 16170,
		header: 'Detach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SANITY_SEGMENTS_WITHOUT_VOLUMES: {
		message: 'Found segments on drives without volumes.',
		id: 16180,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	SANITY_SEGMENTS_WITH_INVALID_STATUS_FOUND: {
		message: 'Handling volume segments with invalid statuses on drive that need to be remapped.',
		header: 'Sanity Failed',
		id: 16181,
		logLevel: consts.loggingLevel.DEBUG,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	SANITY_SEGMENTS_TO_DEPRECATE_FOUND: {
		message: 'Handling volume segments to deprecate on drive that need to be deprecated.',
		header: 'Sanity Failed',
		id: 16182,
		logLevel: consts.loggingLevel.DEBUG,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	EXTEND_VOLUME_VERSION_FAILED: {
		message: 'Failed to extend volume. It looks like the volume version changed during the extend operation. Please try again.',
		id: 16190,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	FAILED_TO_CREATE_PARTITIONS: {
		message: 'Failed to create topic partitions',
		id: 16200,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VPG_EXTEND_REQUEST: {
		message: 'REST API Request: Extend VPG',
		id: 16210,
		header: getAuditHeader(consts.entity.vpg, consts.operation.extend),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	VPG_NOT_FOUND: {
		message: 'VPG not found',
		id: 16220,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DEFAULT_VPG_NOT_EDITABLE: {
		message: 'Can not delete/update default VPG',
		id: 16230,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UNSUPPORTED_VPG_CAPACITY: {
		message: 'Updated VPG reserved space must be greater or equal to the old reserved space',
		id: 16240,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VPG_CAPACITY_UPDATE_NOT_ALLOWED: {
		message: 'Changing VPG capacity via /update is not allowed. Please use VPG extend',
		id: 16245,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VPG_RESERVED_VOLUME_NOT_FOUND: {
		message: 'VPG reserved volume not found',
		id: 16250,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VPG_EXTENDED: {
		message: 'VPG extended successfully',
		id: 16260,
		header: 'VPG Extended',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	VPG_RECLAIM_REQUEST: {
		message: 'REST API Request: Reclaim VPG reserved space',
		id: 16350,
		header: getAuditHeader(consts.entity.vpg, consts.operation.reclaim),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	VPG_RECLAIMED: {
		message: 'VPG reserved space reclaimed successfully',
		id: 16351,
		header: 'VPG Reclaimed',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	VPG_RECLAIM_FAILED: {
		message: 'Failed to reclaim VPG reserved space',
		id: 16352,
		header: 'VPG Reclaim Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VPG_RECLAIM_NOTHING_TO_RECLAIM: {
		message: 'No unused reserved space to reclaim',
		id: 16353,
		sysLogLevel: consts.loggingLevel.INFO
	},
	SANITY_RECLAIMING_RESERVED_VOLUME_FOUND: {
		message: 'Found reserved volume stuck in RECLAIMING state from a crashed management',
		id: 16355,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	SANITY_RECLAIMING_RESERVED_VOLUME_RECOVERED: {
		message: 'Rebuilt reserved volume from disk after a crashed reclaim operation',
		id: 16356,
		sysLogLevel: consts.loggingLevel.INFO
	},
	SANITY_RECLAIMING_RESERVED_VOLUME_RECOVERY_FAILED: {
		message: 'Failed to recover reserved volume after a crashed reclaim operation',
		id: 16357,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SANITY_RECLAIMING_RESERVED_VOLUME_ROLLED_BACK: {
		message: 'Rolled back pending reclaim on reserved volume after a crashed management',
		id: 16359,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	SANITY_VPG_CAPACITY_MISMATCH_FIXED: {
		message: 'VPG capacity was out of sync with its reserved volume and has been corrected',
		id: 163581,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	VPG_RESERVED_VOLUME_IS_RECLAIMING: {
		message: 'The VPG reserved volume is currently being reclaimed',
		id: 16358,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CLIENT_ALREADY_HAS_SNAPSHOT_ATTACHED: {
		message: 'The client already has a snapshot attached.',
		id: 16270,
		header: 'Attach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	FAILED_UPDATE_SEGMENTS_IN_ZONE: {
		message: 'Failed to update segmentsInZone counter on the lock after force deleting the segments.',
		id: 16280,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SANITY_AVAILABLE_BLOCKS_MISMATCH_FIX: {
		message: 'Fixing available blocks on drive',
		id: 16290,
		sysLogLevel: consts.loggingLevel.WARNING
	},
	SANITY_AVAILABLE_BLOCKS_MISMATCH_FIX_FAIL: {
		message: 'Failed to update available blocks on drive',
		id: 16300,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CANT_DELETE_CLIENT: {
		message: 'Unable to delete the client. The client may not exist or may still be active. Please ensure that the client is inactive before attempting deletion.',
		id: 16273,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CANT_DELETE_UPGRADE_AGENT: {
		message: 'Unable to delete the upgrade agent. The upgrade agent may not exist or may still be online. Please ensure that the upgrade agent is offline before attempting deletion.',
		id: 162721,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CANT_FIND_CONFIG_PROFILE_TO_UPDATE: {
		message: 'Unable to update the configuration profile. The configuration profile may not exist or may not be editable.',
		id: 16274,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CANT_DELETE_TARGET: {
		message: 'Unable to delete the target. The target may not exist or may still be active. Please ensure that the target is inactive before attempting deletion.',
		id: 162751,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	FAILED_GET_TARGETS: {
		message: 'Failed to get targets for change reservation mode message for TOMA',
		id: 16302,
		header: 'Reservation Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	FAILED_WAIT_FOR_PENDING_ATTACHMENT: {
		message: 'Failed waiting for pending attachment',
		id: 16303,
		header: 'Attach/Detach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CANT_FIND_ENTITY: {
		message: 'Can\'t find requested entity',
		id: 16271,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	PROJECTION_VALIDATION: {
		message: 'Projection query parameter must not contain both inclusion and exclusion',
		id: 16272,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SERVICE_UPGRADE_MODE: {
		message: 'Management is in upgrade mode and cannot process new requests',
		id: 16268,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	SERVICE_SHUTTING_DOWN: {
		message: 'Management is shutting down and cannot process new requests',
		id: 16269,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CONFIG_PROFILE_VALIDATION_FAILED: {
		message: 'Config profile validation failed',
		id: 16275,
		header: 'Configuration Profile Operation Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CONFIG_PROFILE_NAME_NOT_ALLOWED: {
		message: 'Config profile name is not allowed',
		id: 16277,
		header: 'Configuration Profile Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CONFIG_PROFILE_ALREADY_EXISTS: {
		message: 'Config profile already exists',
		id: 16278,
		header: 'Configuration Profile Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UNMATCHED_ZONES_LOCKED_ON_VOLUME_REBUILD: {
		message: 'Found unmatching zones already locked for volume on start rebuild, possibly multiple zones for the same volume',
		id: 16276,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UNMATCHED_ZONES_LOCKED_ON_DISK_EVICT: {
		message: 'Found unmatching zones already locked for disk on evict',
		id: 162761,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	CLIENT_SET_EMULATION_MODE_REQUEST: {
		message: 'REST API Request: Set Emulation Mode',
		id: 162771,
		header: getAuditHeader(consts.entity.client, consts.operation.setEmulationMode),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true,
		isSecurity: true
	},
	FAILED_UPDATE_EMULATION: {
		message: 'Failed to set emulation mode, verify that the client exists and is a UM client.',
		id: 162781,
		header: 'Set Emulation Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	ATTACHMENT_NOT_EXISTS: {
		message: 'There is no such attachment',
		id: 16279,
		header: 'Set Emulation Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_EMULATION_MODE_CHANGED: {
		message: 'Volume attachment emulation mode changed',
		id: 162811,
		header: 'Attachment Emulation Mode Changed',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	NOT_UM_CLIENT_EMULATION: {
		message: 'This client does not support emulation',
		id: 162821,
		header: 'Attach Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	FAILED_TO_SET_EMULATION: {
		message: 'Failed to set emulation',
		id: 16283,
		header: 'Set Emulation Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	ATTACHMENT_NOT_ATTACHING: {
		message: 'Attachment action is not "attaching"',
		id: 16284,
		header: 'Set Emulation Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	IP_IDENTIFICATION_NO_FORCE_IP: {
		message: 'No forceIP provided in config for Manual strategy.',
		id: 16500,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	IP_IDENTIFICATION_NO_SPECIFIC_INTERFACE: {
		message: 'No specific interface name provided in config.',
		id: 16501,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	IP_IDENTIFICATION_INVALID_IDENTIFICATION_STRATEGY: {
		message: 'Invalid ipIdentificationStrategy config value',
		id: 16502,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	IP_IDENTIFICATION_FQDN_FAILED: {
		message: 'Failed resolving FQDN\'s IP',
		id: 16503,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	IP_IDENTIFICATION_NO_DEFAULT_IP: {
		message: 'No default route IP found.',
		id: 16504,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	IP_IDENTIFICATION_DEFAULT_IP_FAILED: {
		message: 'Failed retrieving default route\'s IP',
		id: 16505,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	IP_IDENTIFICATION_SPECIFIC_INTERFACE_FAILED: {
		message: 'Failed to resolve specific interface',
		id: 16506,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KERNEL_SAVE_REQUEST: {
		message: 'REST API Request: Save Kernels',
		id: 11700,
		header: getAuditHeader(consts.entity.kernel, consts.operation.save),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	KERNEL_UPDATE_REQUEST: {
		message: 'REST API Request: Update Kernels',
		id: 11701,
		header: getAuditHeader(consts.entity.kernel, consts.operation.update),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	KERNEL_DELETE_REQUEST: {
		message: 'REST API Request: Delete Kernels',
		id: 11702,
		header: getAuditHeader(consts.entity.kernel, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	KERNEL_SAVED: {
		message: 'Kernel saved',
		id: 11703,
		header: 'Kernel Saved',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	KERNEL_SAVE_FAILED: {
		message: 'Failed to save kernel',
		id: 11704,
		header: 'Kernel Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KERNEL_UPDATED: {
		message: 'Kernel updated',
		id: 11705,
		header: 'Kernel Updated',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	KERNEL_UPDATE_FAILED: {
		message: 'Failed to update kernel',
		id: 11706,
		header: 'Kernel Update Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KERNEL_DELETED: {
		message: 'Kernel deleted',
		id: 11707,
		header: 'Kernel Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	KERNEL_DELETE_FAILED: {
		message: 'Failed to delete kernel',
		id: 11708,
		header: 'Kernel Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	LOAD_KERNELS_FAILED: {
		message: 'Failed to load kernels',
		id: 11709,
		header: 'Kernels Load Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	OFED_SAVE_REQUEST: {
		message: 'REST API Request: Save Ofeds',
		id: 11710,
		header: getAuditHeader(consts.entity.ofed, consts.operation.save),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	OFED_UPDATE_REQUEST: {
		message: 'REST API Request: Update Ofeds',
		id: 11711,
		header: getAuditHeader(consts.entity.ofed, consts.operation.update),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	OFED_DELETE_REQUEST: {
		message: 'REST API Request: Delete Ofeds',
		id: 11712,
		header: getAuditHeader(consts.entity.ofed, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	OFED_SAVED: {
		message: 'Ofed saved',
		id: 11713,
		header: 'Ofed Saved',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	OFED_SAVE_FAILED: {
		message: 'Failed to save ofed',
		id: 11714,
		header: 'Ofed Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	OFED_UPDATED: {
		message: 'Ofed updated',
		id: 11715,
		header: 'Ofed Updated',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	OFED_UPDATE_FAILED: {
		message: 'Failed to update ofed',
		id: 11716,
		header: 'Ofed Update Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	OFED_DELETED: {
		message: 'Ofed deleted',
		id: 11717,
		header: 'Ofed Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	OFED_DELETE_FAILED: {
		message: 'Failed to delete ofed',
		id: 11718,
		header: 'Ofed Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	LOAD_OFEDS_FAILED: {
		message: 'Failed to load ofeds',
		id: 11719,
		header: 'Ofeds Load Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	OPERATING_SYSTEM_SAVE_REQUEST: {
		message: 'REST API Request: Save Operating Systems',
		id: 11720,
		header: getAuditHeader(consts.entity.operatingSystem, consts.operation.save),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	OPERATING_SYSTEM_UPDATE_REQUEST: {
		message: 'REST API Request: Update Operating Systems',
		id: 11721,
		header: getAuditHeader(consts.entity.operatingSystem, consts.operation.update),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	OPERATING_SYSTEM_DELETE_REQUEST: {
		message: 'REST API Request: Delete Operating Systems',
		id: 11722,
		header: getAuditHeader(consts.entity.operatingSystem, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	OPERATING_SYSTEM_SAVED: {
		message: 'Operating system saved',
		id: 11723,
		header: 'Operating System Saved',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	OPERATING_SYSTEM_SAVE_FAILED: {
		message: 'Failed to save operating system',
		id: 11724,
		header: 'Operating System Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	OPERATING_SYSTEM_UPDATED: {
		message: 'Operating system updated',
		id: 11725,
		header: 'Operating System Updated',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	OPERATING_SYSTEM_UPDATE_FAILED: {
		message: 'Failed to update operating system',
		id: 11726,
		header: 'Operating System Update Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	OPERATING_SYSTEM_DELETED: {
		message: 'Operating system deleted',
		id: 11727,
		header: 'Operating System Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	OPERATING_SYSTEM_DELETE_FAILED: {
		message: 'Failed to delete operating system',
		id: 11728,
		header: 'Operating System Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	LOAD_OPERATING_SYSTEMS_FAILED: {
		message: 'Failed to load operating systems',
		id: 11729,
		header: 'Operating Systems Load Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	LOAD_DISTRIBUTION_TYPES_FAILED: {
		message: 'Failed to load distribution types',
		id: 11730,
		header: 'Distribution Types Load Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	PLATFORM_SAVE_REQUEST: {
		message: 'REST API Request: Save Platforms',
		id: 16600,
		header: getAuditHeader(consts.entity.platform, consts.operation.save),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	PLATFORM_SAVED: {
		message: 'Platform saved',
		id: 16601,
		header: 'Platform Saved',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	PLATFORM_SAVE_REQUEST_FAILED: {
		message: 'Failed to create platforms',
		id: 16602,
		header: 'Platform Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	LOAD_PLATFORMS_FAILED: {
		message: 'Failed to load platforms',
		id: 16603,
		header: 'Platforms Load Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	PLATFORM_DELETE_REQUEST: {
		message: 'REST API Request: Delete Platforms',
		id: 16604,
		header: getAuditHeader(consts.entity.platform, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	PLATFORM_DELETED: {
		message: 'Platform deleted',
		id: 16605,
		header: 'Platform Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	PLATFORM_DELETE_REQUEST_FAILED: {
		message: 'Failed to delete platform',
		id: 16606,
		header: 'Platform Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	PLATFORM_UPDATE_REQUEST: {
		message: 'REST API Request: Update Platforms',
		id: 16607,
		header: getAuditHeader(consts.entity.platform, consts.operation.update),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	PLATFORM_UPDATED: {
		message: 'Platform updated',
		id: 16608,
		header: 'Platform Updated',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	PLATFORM_UPDATE_REQUEST_FAILED: {
		message: 'Failed to update platform',
		id: 16609,
		header: 'Platform Update Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	ARTIFACT_SAVE_REQUEST: {
		message: 'REST API Request: Save Artifacts',
		id: 17600,
		header: getAuditHeader(consts.entity.artifact, consts.operation.save),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	ARTIFACT_SAVED: {
		message: 'Artifact saved',
		id: 17601,
		header: 'Artifact Saved',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
	},
	ARTIFACT_SAVE_REQUEST_FAILED: {
		message: 'Failed to create artifacts',
		id: 17602,
		header: 'Artifact Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	LOAD_ARTIFACTS_FAILED: {
		message: 'Failed to load artifacts',
		id: 17603,
		header: 'Artifacts Load Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	ARTIFACT_DELETE_REQUEST: {
		message: 'REST API Request: Delete Artifacts',
		id: 17604,
		header: getAuditHeader(consts.entity.artifact, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	ARTIFACT_DELETED: {
		message: 'Artifact deleted',
		id: 17605,
		header: 'Artifact Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
	},
	ARTIFACT_DELETE_REQUEST_FAILED: {
		message: 'Failed to delete artifact',
		id: 17606,
		header: 'Artifact Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	ARTIFACT_UPDATE_REQUEST: {
		message: 'REST API Request: Update Artifacts',
		id: 17607,
		header: getAuditHeader(consts.entity.artifact, consts.operation.update),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	ARTIFACT_UPDATED: {
		message: 'Artifact updated',
		id: 17608,
		header: 'Artifact Updated',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
	},
	ARTIFACT_UPDATE_REQUEST_FAILED: {
		message: 'Failed to update artifact',
		id: 17609,
		header: 'Artifact Update Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	UPGRADE_SCENARIO_SAVE_REQUEST: {
		message: 'REST API Request: Save Upgrade Scenarios',
		id: 17610,
		header: getAuditHeader(consts.entity.upgradeScenario, consts.operation.save),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	UPGRADE_SCENARIO_SAVED: {
		message: 'Upgrade Scenario saved',
		id: 17611,
		header: 'Upgrade Scenario Saved',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
	},
	UPGRADE_SCENARIO_SAVE_REQUEST_FAILED: {
		message: 'Failed to create upgrade scenarios',
		id: 17612,
		header: 'Upgrade Scenario Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	UPGRADE_SCENARIO_UPDATE_REQUEST: {
		message: 'REST API Request: Update Upgrade Scenarios',
		id: 17613,
		header: getAuditHeader(consts.entity.upgradeScenario, consts.operation.update),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	UPGRADE_SCENARIO_UPDATED: {
		message: 'Upgrade Scenario Updated',
		id: 17614,
		header: 'Upgrade Scenario Saved',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
	},
	UPGRADE_SCENARIO_UPDATE_REQUEST_FAILED: {
		message: 'Failed to update upgrade scenarios',
		id: 17615,
		header: 'Upgrade Scenario Update Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	UPGRADE_SCENARIO_DELETE_REQUEST: {
		message: 'REST API Request: Delete Upgrade Scenarios',
		id: 17616,
		header: getAuditHeader(consts.entity.upgradeScenario, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	UPGRADE_SCENARIO_DELETED: {
		message: 'Upgrade Scenario Deleted',
		id: 17617,
		header: 'Upgrade Scenario Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
	},
	UPGRADE_SCENARIO_DELETE_REQUEST_FAILED: {
		message: 'Failed to delete upgrade scenarios',
		id: 17618,
		header: 'Upgrade Scenario Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	UPGRADE_STEP_SCENARIO_SAVE_REQUEST: {
		message: 'REST API Request: Save Upgrade Step Scenarios',
		id: 17619,
		header: getAuditHeader(consts.entity.upgradeStepScenario, consts.operation.save),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	UPGRADE_STEP_SCENARIO_SAVED: {
		message: 'Upgrade Step Scenario Saved',
		id: 17620,
		header: 'Upgrade Step Scenario Saved',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
	},
	UPGRADE_STEP_SCENARIO_SAVE_REQUEST_FAILED: {
		message: 'Failed to create upgrade step scenarios',
		id: 17621,
		header: 'Upgrade Step Scenario Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	UPGRADE_STEP_SCENARIO_UPDATE_REQUEST: {
		message: 'REST API Request: Update Upgrade Step Scenarios',
		id: 17622,
		header: getAuditHeader(consts.entity.upgradeStepScenario, consts.operation.update),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	UPGRADE_STEP_SCENARIO_UPDATED: {
		message: 'Upgrade Step Scenario Updated',
		id: 17623,
		header: 'Upgrade Step Scenario Updated',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
	},
	UPGRADE_STEP_SCENARIO_UPDATE_REQUEST_FAILED: {
		message: 'Failed to update upgrade step scenarios',
		id: 17624,
		header: 'Upgrade Step Scenario Update Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	UPGRADE_STEP_SCENARIO_DELETE_REQUEST: {
		message: 'REST API Request: Delete Upgrade Step Scenarios',
		id: 17625,
		header: getAuditHeader(consts.entity.upgradeStepScenario, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	UPGRADE_STEP_SCENARIO_DELETED: {
		message: 'Upgrade Step Scenario Deleted',
		id: 17626,
		header: 'Upgrade Step Scenario Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
	},
	UPGRADE_STEP_SCENARIO_DELETE_REQUEST_FAILED: {
		message: 'Failed to delete upgrade step scenarios',
		id: 17627,
		header: 'Upgrade Step Scenario Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	RELEASE_SAVE_REQUEST: {
		message: 'REST API Request: Save Releases',
		id: 18600,
		header: getAuditHeader(consts.entity.release, consts.operation.save),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	RELEASE_SAVED: {
		message: 'Release saved',
		id: 18601,
		header: 'Release Saved',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
	},
	RELEASE_SAVE_REQUEST_FAILED: {
		message: 'Failed to create releases',
		id: 18602,
		header: 'Release Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	LOAD_RELEASES_FAILED: {
		message: 'Failed to load releases',
		id: 18603,
		header: 'Releases Load Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	RELEASE_DELETE_REQUEST: {
		message: 'REST API Request: Delete Releases',
		id: 18604,
		header: getAuditHeader(consts.entity.release, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	RELEASE_DELETED: {
		message: 'Release deleted',
		id: 18605,
		header: 'Release Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
	},
	RELEASE_DELETE_REQUEST_FAILED: {
		message: 'Failed to delete release',
		id: 18606,
		header: 'Release Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	RELEASE_UPDATE_REQUEST: {
		message: 'REST API Request: Update Releases',
		id: 18607,
		header: getAuditHeader(consts.entity.release, consts.operation.update),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	RELEASE_UPDATED: {
		message: 'Release updated',
		id: 18608,
		header: 'Release Updated',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
	},
	RELEASE_UPDATE_REQUEST_FAILED: {
		message: 'Failed to update release',
		id: 18609,
		header: 'Release Update Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	RELEASE_NOT_FOUND: {
		message: 'Release not found',
		id: 18610,
		header: 'Release Not Found',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	COMPONENT_SAVE_REQUEST_FAILED: {
		message: 'Failed to create components',
		id: 16630,
		header: 'Component Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	LOAD_COMPONENTS_VERSIONS_FAILED: {
		message: 'Failed to load components',
		id: 16631,
		header: 'Components Load Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	COMPONENT_SAVE_REQUEST: {
		message: 'REST API Request: Save Components',
		id: 16629,
		header: getAuditHeader(consts.entity.component, consts.operation.save),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	COMPONENT_DELETE_REQUEST: {
		message: 'REST API Request: Delete Components',
		id: 16628,
		header: getAuditHeader(consts.entity.component, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	COMPONENT_SAVED: {
		message: 'Component saved',
		id: 16627,
		header: 'Component Saved',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	COMPONENT_DELETED: {
		message: 'Component deleted',
		id: 16626,
		header: 'Component Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	COMPONENT_UPDATE_REQUEST: {
		message: 'REST API Request: Update Components',
		id: 16632,
		header: getAuditHeader(consts.entity.component, consts.operation.update),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	COMPONENT_UPDATED: {
		message: 'Component updated',
		id: 16633,
		header: 'Component Updated',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	COMPONENT_DELETE_REQUEST_FAILED: {
		message: 'Failed to delete component',
		id: 16634,
		header: 'Component Delete Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	COMPONENT_UPDATE_REQUEST_FAILED: {
		message: 'Failed to update component',
		id: 16635,
		header: 'Component Update Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	LOAD_COMPONENTS_FAILED: {
		message: 'Failed to load components',
		id: 16636,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	FAILED_TO_LOAD_UPGRADE_SCENARIOS: {
		message: 'Failed to load upgrade scenarios',
		id: 16637,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	FAILED_TO_LOAD_UPGRADE_STEP_SCENARIOS: {
		message: 'Failed to load upgrade step scenarios',
		id: 16639,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	FAILED_TO_LOAD_UPGRADE_TYPES: {
		message: 'Failed to load upgrade types',
		id: 16638,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	FAILED_TO_LOAD_UPGRADES: {
		message: 'Failed to load upgrades',
		id: 16700,
		header: 'Upgrades Load Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	FAILED_TO_LOAD_POSSIBLE_UPGRADES: {
		message: 'Failed to load possible upgrades',
		id: 167000,
		header: 'Possible Upgrades Load Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UPGRADE_AGENT_NOT_FOUND: {
		message: 'Upgrade Agent not found',
		id: 16701,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	FAILED_TO_LOAD_UPGRADE_AGENTS: {
		message: 'Failed to load upgrade agents',
		id: 16800,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UPGRADE_SAVE_REQUEST: {
		message: 'REST API Request: Save Upgrades',
		id: 16801,
		header: getAuditHeader(consts.entity.upgrade, consts.operation.save),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	UPGRADE_SAVE_REQUEST_FAILED: {
		message: 'Failed to create upgrade',
		id: 16802,
		header: 'Upgrade Save Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UPGRADE_SAVED: {
		message: 'Upgrade saved',
		id: 16803,
		header: 'Upgrade Saved',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	UPGRADE_DELETE_REQUEST: {
		message: 'REST API Request: Delete Upgrades',
		id: 16804,
		header: getAuditHeader(consts.entity.upgrade, consts.operation.delete),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	UPGRADE_DELETED: {
		message: 'Upgrade deleted',
		id: 16805,
		header: 'Upgrade Deleted',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	UPGRADE_DELETE_REQUEST_FAILED: {
		message: 'Failed to delete upgrade',
		id: 16806,
		header: getAuditHeader(consts.entity.upgrade, consts.operation.delete),
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	LOAD_SUPPORTED_DB_COLLECTION_VERSIONS_FAILED: {
		message: 'Failed to load supported DB collection versions',
		id: 16807,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UPGRADE_START_REQUEST: {
		message: 'REST API Request: Manually start Upgrade',
		id: 16808,
		header: getAuditHeader(consts.entity.upgrade, consts.operation.start),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	UPGRADE_FAILED_TO_TAKE_LOCK: {
		message: 'Failed to take a lock',
		id: 16809,
		header: 'Upgrade Start Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	UPGRADE_FAILED_TO_START: {
		message: 'Failed to start upgrade',
		id: 16810,
		header: 'Upgrade Start Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	UPGRADE_STARTED: {
		message: 'Upgrade started',
		id: 16811,
		header: 'Upgrade Started',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	UPGRADE_STEP_CANNOT_BE_EXECUTED_UPGRADE_PAUSED: {
		message: 'Upgrade is paused',
		id: 16812,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	UPGRADE_STEP_CANNOT_BE_EXECUTED_HIT_BREAKPOINT: {
		message: 'Hit breakpoint',
		id: 16813,
		sysLogLevel: consts.loggingLevel.DEBUG
	},
	UPGRADE_RESUME_REQUEST: {
		message: 'REST API Request: Manually resume Upgrade',
		id: 16814,
		header: getAuditHeader(consts.entity.upgrade, consts.operation.resume),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	UPGRADE_RESUMED: {
		message: 'Upgrade resumed',
		id: 16815,
		header: 'Upgrade Resumed',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	UPGRADE_STEP_SET_BREAKPOINT_FAILED: {
		message: 'Upgrade step not found or is not in pending state',
		id: 16816,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UPGRADE_SAVE_REQUEST_FAILED_CANNOT_GET_UPGRADE_AGENT: {
		message: 'Failed to create upgrade, cannot get one or more of the specified machines',
		id: 16817,
		header: getAuditHeader(consts.entity.upgrade, consts.operation.save),
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR,
		isAudit: true
	},
	UPGRADE_STEP_MARK_AS_COMPLETED_FAILED: {
		message: 'Upgrade step not found or is not in failed state',
		id: 16818,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UPGRADE_STEP_MARK_AS_COMPLETED_REQUEST: {
		message: 'REST API Request: Mark upgrade step as completed',
		id: 16819,
		header: getAuditHeader(consts.entity.upgradeStep, consts.operation.markAsCompleted),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	UPGRADE_STEP_MARKED_AS_COMPLETED: {
		message: 'Upgrade step marked as completed',
		id: 16820,
		sysLogLevel: consts.loggingLevel.INFO
	},
	UPGRADE_SKIP_MACHINE_REQUEST: {
		message: 'REST API Request: Skip failed machine in upgrade',
		id: 16821,
		header: getAuditHeader(consts.entity.upgrade, consts.operation.skipFailedMachine),
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO,
		isAudit: true
	},
	UPGRADE_FAILED_MACHINE_SKIPPED: {
		message: 'Failed machine skipped',
		id: 16822,
		header: 'Failed Machine Skipped',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	NO_FAILED_STEPS_TO_SKIP: {
		message: 'No failed steps to skip',
		id: 16823,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	INVALID_NUMBER_OF_MIRRORS: {
		message: `Unsupported number of mirrors for the selected RAID level. Supported: ${consts.validNumberOfMirrors.join(', ')}`,
		id: 16824,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	FEATURE_COMPATIBILITY_VERSION_NOT_MET: {
		message: 'Some cluster components do not meet the minimum feature compatibility version required for this feature',
		id: 16825,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UPGRADE_STEP_CANNOT_BE_EXECUTED_UNHEALTHY_PRAID: {
		message: 'Executing this step will cause the volume to become offline',
		id: 17000,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UPGRADE_STEP_CANNOT_BE_EXECUTED_REDUNDANCY_WILL_BE_VIOLATED: {
		message: 'Executing this step will violate the upgrade\'s minimal redundancy requirement',
		id: 17001,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UPGRADE_STEP_CANNOT_BE_EXECUTED_VOLUME_STATE: {
		message: 'Cannot execute step: volume state is not yet up to date with the leader',
		id: 17005,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UPGRADE_STEP_CANNOT_BE_EXECUTED_LEADER_NOT_RECONCILED: {
		message: 'Cannot execute step: leader has not yet reconciled',
		id: 17006,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UPGRADE_STEP_CANNOT_BE_EXECUTED_LEADER_HAS_NOT_OBSERVED_PREV_TARGET: {
		message: 'Cannot execute step: leader has not yet observed the previous target restart',
		id: 17007,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	RELEASE_ARTIFACTS_NOT_FOUND: {
		message: 'Release artifacts not found',
		id: 17008,
		sysLogLevel: consts.loggingLevel.ERROR,
	},
	UPGRADE_STEP_CANNOT_FIND_ARTIFACTS: {
		message: 'InteropDB missing artifacts for install',
		id: 17002,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	UPGRADE_FAILED: {
		message: 'Upgrade failed',
		id: 17003,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	FAILED_TO_LOAD_UPGRADE_STEPS: {
		message: 'Failed to load upgrade steps',
		id: 17004,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	ZONE_HARDWARE_CONFIGURATION_FAILED: {
		message: 'Failed to get zone hardware configuration',
		id: 168071,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	COMPONENTS_VERSIONS_NOT_COMPATIBLE: {
		message: 'Components versions are not compatible',
		id: 100,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	INTEROPDB_GET_COMPATIBILITIES_FAILED: {
		message: 'Failed to get component compatibilities from InteropDB',
		id: 101,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	NOT_ALL_NVMESH_COMPONENTS_ARE_IN_THE_SAME_VERSION: {
		message: 'Not all NVMesh components are in the same version',
		id: 102,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	NOT_ALL_NVMESH_COMPONENTS_ARE_IN_HEALTHY_STATE: {
		message: 'Not all NVMesh components are in healthy state',
		id: 103,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	PRE_UPGRADE_CHECKS_FAILED: {
		message: 'Failed to perform pre-upgrade checks',
		id: 104,
		header: 'Upgrade Failed',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	LIB_NOT_COMPATIBLE_WITH_NVMESH_PACKAGE: {
		message: '3rd party library version is not compatible with NVMesh package',
		id: 105,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	NOT_ALL_VOLUMES_ARE_HEALTHY: {
		message: 'Not all volumes are healthy',
		id: 106,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	MISSING_LIB_FOUND_ON_A_COMPONENT: {
		message: 'Missing 3rd party library found on a component',
		id: 107,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	INTEROPDB_GET_REQUIREMENTS_FAILED: {
		message: 'Failed to get requirements from InteropDB',
		id: 108,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	REQUIRED_COMPATIBILITIES_NOT_FOUND: {
		message: 'Component requirements are not met',
		id: 109,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	MISSING_NVMESH_PACKAGE_VERSION_ON_A_COMPONENT: {
		message: 'Missing NVMesh package version on a component',
		id: 110,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	NO_COMPATIBILITIES_FOUND_FOR_LIB: {
		message: 'No compatibilities found for lib',
		id: 111,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_TOPIC_GC_ERROR: {
		message: 'GC operations finished with error',
		id: 18000,
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	KAFKA_RECYCLE_CONSUMER_ERROR: {
		message: 'Failed to recycle Kafka consumer',
		id: 18001,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	INTEROPDB_VERSION_CHANGED: {
		message: 'InteropDB version changed, going to reconnect',
		id: 1120,
		header: 'InteropDB Version Changed',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	SYSTEM_INFO: {
		message: 'Management started with the following system information',
		id: 11211,
		header: 'System Info',
		logLevel: consts.loggingLevel.INFO,
		sysLogLevel: consts.loggingLevel.INFO
	},
	NOT_ENOUGH_AVAILABLE_MIRRORS_FOR_THE_SELECTED_RAID_LEVEL: {
		message: 'Not enough available mirrors for the selected RAID level',
		id: 1121,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	VOLUME_IS_BEING_DELETED: {
		message: 'Volume is being deleted',
		id: 11212,
		header: 'Volume Being Deleted',
		logLevel: consts.loggingLevel.ERROR,
		sysLogLevel: consts.loggingLevel.ERROR
	},
	DESTINATION_VERSION_NOT_VALID_FOR_HOSTS: {
		message: 'Destination version is not a valid upgrade target for the selected hosts',
		id: 11213,
		sysLogLevel: consts.loggingLevel.ERROR
	}
};
// add the key name to each systemMessage, for debugging purposes
// until we have more explanatory message for each systemMessage
function addSystemMessagesName() {
	Object.keys(systemMessages).forEach(key => {
		systemMessages[key].internalName = key;
	});
}

addSystemMessagesName();

module.exports = systemMessages;
