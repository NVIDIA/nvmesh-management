/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = {};

consts.ADMIN_USER = 'admin@nvidia.com';
consts.SYSTEM_USER = 'system@nvidia.com';
consts.PHONE_HOME_USER = 'phoneHome@acme.com';
consts.defaultItemsPerPage = 10;
consts.installDir = '/opt/nvmesh/management';
consts.INTEROP_DB_RELATIVE_PATH = '../interop-db/InteropDB';
consts.ACTIVE_CERT_DIR = '/var/run/nvmesh/tls/nvmeshmgr';

// Certificate types
consts.CERT_TYPES = {
	KEY: 'key',
	CERT: 'cert',
	CA: 'ca'
};

// Standard filenames for certificate types in the active cert directory
consts.CERT_TYPE_FILENAMES = {
	[consts.CERT_TYPES.KEY]: 'key.key',
	[consts.CERT_TYPES.CERT]: 'cert.crt',
	[consts.CERT_TYPES.CA]: 'ca.crt'
};

// Use config to only update existing volumes, not attaching new volumes and not changing type of existing volume
consts.MAGIC_CONFIG_UPDATE_TOKEN = 'F0AAAAAAAAAAAAA';

// Use config to update/attach allow changing type of existing.
consts.MAGIC_CONFIG_FORCE_TOKEN = 'FAAAAAAAAAAAAAA';

consts.SHIFT_KEY_CODE = 16;
consts.NUMBER_OF_EC_MARKERS = 3;
consts.SYSLOG_ID = 'nvmeshmgr';
consts.defaultMetadataVPG = 'DEFAULT_METADATA_RAID_1_VPG';
consts.MetadataVolumeEnding = '_MD';
consts.SNAPSHOT_CLUSTER_SIZE = 1048576 / Math.pow(1000, 3); // 1MiB in GB
consts.SNAPSHOT_CLUSTER_SIZE_IN_BLOCKS = 1048576 / 4096;
consts.VOLUME_HEALTH_COUNTERS_DEBOUNCER_TIMEOUT = 5000;
consts.VOLUME_HEALTH_COUNTERS_RECALCULATION_TIMEOUT = 30000;
consts.MINIMAL_TIME_BETWEEN_CLIENT_REPORT_REQUESTS = 5000;
consts.MINIMAL_TIME_BETWEEN_TOME_KEEPALIVE_REQUESTS = 5000;
consts.MANAGEMENT_TIMED_OUT_INTERVAL_IN_MINUTES = 5;
consts.WS_PROTOCOL_VERSION = 1;

consts.loggingLevel = {
	INFO: 'INFO',
	WARNING: 'WARNING',
	ERROR: 'ERROR',
	DEBUG: 'DEBUG',
	VERBOSE: 'VERBOSE',
	NONE: 'NONE'
};

consts.userRoles = {
	ADMIN: 'Admin',
	OBSERVER: 'Observer'
};

consts.HTTPSServerAuthenticationMethods = {
	CREDENTIALS: 'credentials',
	MTLS: 'MTLS'
};

consts.passportStrategies = {
	LOCAL: 'local',
	CLIENT_CERT: 'client-cert'
};

consts.vbdevStackStatuses = {
	LVOL_STACK_READY: 'lvolStackReady',
	CRYPTO_STACK_READY: 'cryptoStackReady',
	CRYPTO_KEY_SET: 'cryptoKeySet'
};

consts.kafka = {
	MANAGEMENT_GROUP_ID: 'managements-group',
	MINIMAL_TIME_BETWEEN_COMMITS: 5000,
	MAX_CONNECT_TRIES: 10,
	TIME_BETWEEN_CONNECT_TRIES: 5000,
	KAFKA_GC_TIMEOUT: 1000 * 1800, // 30min
	NON_RETRYABLE_ERRORS_GRACE_PERIOD: 10 * 1000,
	RETRY: {
		LEFT: 10,
		DELAY: 10,
		FACTOR: 2,
		MAX_DELAY: 1000
	},
	RECYCLE_CONSUMER: {
		DEBOUNCER_MINIMUM_WAIT: 5000,
		INITIAL_BACKOFF: 2000,
		MAX_BACKOFF: 10000
	},
	LOG_COMPACTION: {
		SEGMENT_BYTES: 32000000, // 32 MB
		SEGMENT_MS: 86400000 // 24 hours
	}
};

consts.kafkaPrincipals = {
	MCS: 'MCS',
	TOMA: 'TOMA',
	UPGRADE_AGENT: 'UPGRADE_AGENT',
	Management: 'management'
};

consts.environment = {
	PRODUCTION: 'production',
	DEVELOPMENT: 'development'
};

consts.systemLimitation = {
	MAX_SEGMENTS_IN_DISK: 124,
	MIN_DISK_SIZE_GB: 2
};

consts.lastMessageLogStatuses = {
	LIVE: 'live',
	TIMED_OUT: 'timedOut',
	HANDLING: 'handling'
};

consts.targetUpdateTypes = {
	ADD: 'add',
	REMOVE: 'remove'
};

consts.lockStatuses = {
	LOCKED: 'locked',
	UNLOCKED: 'unlocked'
};

consts.topicSuffix = {
	TOMA_COMMANDS: '.TOMA.commands',
	LEADER_INCREMENTAL_UPDATES: '.leader.incrementalUpdates',
	LEADER_INCREMENTAL_TARGET_UPDATES: '.leader.incrementalTargetUpdates',
	TOMA_HARDWARE_CONF: '.TOMA.hardwareConfiguration',
	MANAGEMENT_PRIORITY: '.management.priority',
	MANAGEMENT_LOW: '.management.low',
	MANAGEMENT_KEEPALIVE: '.management.keepalive',
	AGENT_MAIN: '.managementAgent.main',
	CLIENT_MAIN: '.client.main',
	UPGRADE_AGENT_COMMANDS: '.upgradeAgent.commands'
};

consts.topicPrefix = {
	DEFAULT: 'default',
	ZONE: 'zone'
};

consts.errno = {
	ETIMEDOUT: 110
};

consts.mongoErrors = {
	DUPLICATE_KEY: 11000,
	UNAUTHORIZED: 13,
	NO_REPLICATION_ENABLED: 76
};

consts.sqliteErrors = {
	UNIQUE_VIOLATION: 'unique violation'
};

consts.kafkaErrors = {
	UNKNOWN_TOPIC_OR_PARTITION: 3
};

consts.mongoMemberHealth = {
	HEALTHY: 1,
	CRITICAL: 0
};

consts.mongoMemberState = {
	STARTUP: 0,
	PRIMARY: 1,
	SECONDARY: 2,
	RECOVERING: 3,
	STARTUP2: 5,
	UNKNOWN: 6,
	ARBITER: 7,
	DOWN: 8,
	ROLLBACK: 9,
	REMOVED: 10
};

consts.mongoReturnDocument = {
	BEFORE: 'before',
	AFTER: 'after'
};

consts.mongoTypes = {
	MISSING: 'missing'
};

consts.websocketMessageTypes = {
	login: 'login',
	loginResponse: 'loginResponse',
	registerToEvents: 'registerToEvents',
	unregisterFromEvents: 'unregisterToEvents',
	eventResponse: 'eventResponse',
	errorResponse: 'errorResponse',
	triggerEvent: 'triggerEvent'
};

consts.websocketErrors = {
	PROTOCOL_VERSION_NOT_SUPPORTED: 1010,
	UNKNOWN_MESSAGE_TYPE: 1011,
	MISSING_REGISTRANT_ID: 1012,
	MALFORMED_JSON: 1030,
	UNAUTHORIZED: 2001
};

consts.webSocketMessages = {
	MANAGEMENT_LOGIN: 0,
	REPORT_TARGET: 1,
	GET_CONFIGURATION_VERSION: 4,
	GET_RESERVATION_VERSION: 5,
	GET_NICS_CSV: 6,
	GET_DISKS_CSV: 7,
	GET_BLOCK_DEVICES_CSV: 8,
	GET_CHUNKS_CSV: 9,
	GET_DISK_SEGMENTS_CSV: 10,
	GET_VOLUMES: 11,
	CHECK_FOR_TARGET_CONTROL_JOBS: 12,
	CHECK_FOR_CLIENT_CONTROL_JOBS: 13,
	CLEAR_CLIENT_RENEW_CONFIGURATION: 14,
	UPDATE_DISK_SEGMENTS_STATUS: 16,
	REGISTER_ON_EVENTS: 17,
	//	ATTACH_VOLUMES: 18,   DEPRECATED
	//	UPDATE_VOLUMES: 19,	  DEPRECATED
	NEW_NIC: 22,
	REAPPEAR_NIC: 23,
	DELETE_NIC: 24,
	ERROR_RESPONSE: 25,
	DISCONNECTION_MESSAGE: 26,
	VOLUME_REMOVED_EVENT: 27,
	MANAGEMENT_LOG_MESSAGE: 28,
	VOLUME_EXTENDED_EVENT: 29,
	VOLUME_REMAP_EVENT: 30,
	DISK_REAPPEAR_EVENT: 31,
	UPDATE_LOG: 32,
	ACK_LOG: 33,
	ATTACH_VOLUMES_EVENT: 34,
	RESTART_VOLUME_EVENT: 36,
	FORMAT_DISK_EVENT: 38,
	GET_TIME: 42,
	DISK_FINISHED_FORMAT_EVENT: 43,
	UPDATE_DISK_SEGMENTS_DIRTY_BITS: 44,
	VOLUME_VERSION_CHANGED: 45,
	UPDATE_PRAID_STATUS: 46,
	UPDATE_DRIVE_ZEROING_PROGRESS: 47,
	SEGMENTS_CHANGES_ON_DISK_EVENT: 48,
	AGENT_KEEP_ALIVE: 51,
	UPDATE_CONFIG_PROFILE: 52,
	TOMA_KEEP_ALIVE: 55,
	CHANGE_NIC: 63,
	NODE_CONFIG_PROFILE_UPDATED: 64,
	NODE_CONFIG_USER_OVERRIDE_UPDATED: 65,

	//CLIENT MESSAGES
	UPDATE_ATTACHMENT_STATUS: 2,
	REPORT_CLIENT: 3,
	CLIENT_CONFIGURATION: 21,
	SEND_CLIENT_REPORT: 49,
	CLIENT_KEEP_ALIVE: 50,
	CAN_EXPORT_VOLUME_VIA_NVMF: 53,
	UNAUTHORIZED_REQUEST: 60,
	RESEND_CONF_REQUEST: 61,
	UPDATE_KEYS: 62,
	UPDATE_CLIENT_KEEPALIVE_TOKEN: 69,

	ATTACH_VOLUMES: 90,
	UPDATE_VOLUMES: 91,
	DETACH_VOLUMES: 92,
	UPDATE_TARGET_NICS: 93,
	GET_TARGET_NICS: 94,
	UPDATE_VOLUME_EMULATION: 95,
	UPDATE_VOLUME_REFERENCE: 96
};

consts.serverErrors = {
	ECONNRESET: 'ECONNRESET'
};

consts.eventSubscriptionModes = {
	REGISTER: 'Register',
	UNREGISTER: 'Unregister'
};

const SECOND = 1000;

consts.DBUUID_FILE_PATH = '/opt/nvmesh/dbUUID';
consts.RESERVED_GPT_BLOCKS = 256; //Roughly 1MB (aligned to blockset)
consts.BLOCK_SIZE = 4096;
consts.BLOCK_SET_SIZE = 256;
consts.DUMMY_DRIVE_MODEL = 'Dummy';
consts.VOLUME_DELETION_ZERO_PROGRESS_INTERVAL = 10000; // 10 seconds
consts.VOLUME_REBUILDING_PROGRESS_INTERVAL = 1000; // 1 second
consts.MONGO_DB_HEALTH_MONITORING_INTERVAL = 10000; // 10 seconds
consts.SOCKET_IO_EVENTS_SUBSCRIPTION_INTERVAL = 1000; // 1 second
consts.UPGRADE_STATUS_CHECK_INTERVAL = 10000; // 10 second
consts.NIC_MTU_THRESHOLD = 4200;
consts.ROCE_NIC_MISSING_REPORTS_LIMIT = 10;
consts.MANAGEMENT_DEFINITIONS = 'http://management/definitions';
consts.MANAGEMENT_DEFINITIONS_ENTITIES = consts.MANAGEMENT_DEFINITIONS + '/entities';
consts.CONFIG_VER_CLUSTER_ID = 'CLUSTER';
consts.MAX_VOLUME_NAME_LENGTH = 22;
consts.ATTACHMENTS_VERSION_TOKEN_FOR_HIDDEN_ATTACHMENT = -1;
consts.DEFAULT_DEBOUNCER_MINIMUM_WAIT = 5 * SECOND;
consts.KAFKA_CONSUMER_MAX_IN_PROCESS_MESSAGES = 5000;
consts.KAFKA_CONSUMER_PAUSE_AGAIN_THRESHOLD = 30 * SECOND;
consts.MAX_SHOW_UNEXPANDED_ATTACHMENTS = 4;

consts.RAIDLevel = {
	CONCATENATED: 'Concatenated',
	JBOD: 'LVM/JBOD',
	STRIPED_RAID_0: 'Striped RAID-0',
	MIRRORED_RAID_1: 'Mirrored RAID-1',
	STRIPED_AND_MIRRORED_RAID_10: 'Striped & Mirrored RAID-10',
	ERASURE_CODING: 'Erasure Coding',
	STRIPED_ERASURE_CODING: 'Striped Erasure Coding'
};

consts.defaultMetadataRAIDLevel = consts.RAIDLevel.MIRRORED_RAID_1;

consts.ecSeparationTypes = {
	FULL: 'Full Separation',
	MINIMAL: 'Minimal Separation',
	IGNORE: 'Ignore Separation'
};

consts.volumeAttachmentStatus = {
	BUSY: 1,
	DETACHED: 2,
	DETACH_FAILED: 3,
	ATTACHED: 4,
	ATTACH_FAILED: 5,
	ATTACHING: 6,
	DETACHING: 7,
	DETACHED_AFTER_SHUTDOWN: 9,
	VOLUME_RESERVATION_DENIED: 17,
	DETACH_FAILED_UNKNOWN_VOLUME: 94
};

consts.volumeAttachmentStatusToName = {
	1: 'BUSY',
	2: 'DETACHED',
	3: 'DETACH_FAILED',
	4: 'ATTACHED',
	5: 'ATTACH_FAILED',
	6: 'ATTACHING',
	7: 'DETACHING',
	9: 'DETACHED_AFTER_SHUTDOWN'
};

consts.volumeAttachmentActions = {
	ATTACHING: 'attaching',
	DETACHING: 'detaching',
	UNAUTHORIZED: 'unauthorized',
	REATTACHING: 're-attaching',
	DETACHING_STALE: 'detaching-stale',
	EVICTING: 'evicting'
};

consts.emulationModes = {
	NONE: 0,
	STATIC: 1,
	HOTPLUG: 2
};

consts.emulationModesToName = {
	0: 'NONE',
	1: 'STATIC',
	2: 'HOTPLUG'
};

consts.emulationModeNames = {
	NONE: 'NONE',
	STATIC: 'STATIC',
	HOTPLUG: 'HOTPLUG'
};

consts.emulationModeOptions = [
	consts.emulationModeNames.NONE,
	consts.emulationModeNames.STATIC,
	consts.emulationModeNames.HOTPLUG
];

consts.reservationModes = {
	NONE: 0,
	SHARED_READ_ONLY: 1,
	SHARED_READ_WRITE: 2,
	EXCLUSIVE_READ_WRITE: 3
};

consts.reservationModesToName = {
	0: 'NONE',
	1: 'SHARED_READ_ONLY',
	2: 'SHARED_READ_WRITE',
	3: 'EXCLUSIVE_READ_WRITE'
};

consts.reservationModeNames = {
	NONE: 'NONE',
	SHARED_READ_ONLY: 'SHARED_READ_ONLY',
	SHARED_READ_WRITE: 'SHARED_READ_WRITE',
	EXCLUSIVE_READ_WRITE: 'EXCLUSIVE_READ_WRITE'
};

consts.reservationModeAttachOptions = [
	consts.reservationModeNames.SHARED_READ_ONLY,
	consts.reservationModeNames.SHARED_READ_WRITE,
	consts.reservationModeNames.EXCLUSIVE_READ_WRITE
];

consts.reservationModePreempts = {
	NO_PREEMPT: 0,
	WEAK_PREEMPT: 1,
	PREEMPT: 2,
	UNKNOWN: 3
};

consts.sharedReservationModes = [consts.reservationModes.SHARED_READ_ONLY, consts.reservationModes.SHARED_READ_WRITE];
consts.writableReservationModes = [consts.reservationModes.EXCLUSIVE_READ_WRITE, consts.reservationModes.SHARED_READ_WRITE];
consts.reservationVersionOutdatedMsg = 'The reservation version is outdated, current reservation version is: ';

consts.logsLevel = {
	INFO: 'INFO',
	DEBUG: 'DEBUG',
	WARNING: 'WARNING',
	ERROR: 'ERROR'
};

consts.evictFailureReasons = {
	VOLUME_WITHOUT_REDUNDENCY: 'You are attempting to evict a drive containing non-redundant segments for one or more logical volumes'
		+ ', In order to evict this drive those volumes must be deleted',
	LAST_LIVE_COPY: 'Evicting this drive will potentially result in data loss as there are no defined/available spare segments',
	MARKED_FOR_REBUILD_SEG_FOUND: 'There\'s a segment that is markedForRebuild already and TOMA didn\'t receive the configuration yet, please try again later'
};

consts.socketStatus = {
	CONNECTED: 'connected',
	DISCONNECTED: 'disconnected',
	CONNECTING: 'connecting'
};

consts.targetHealth = {
	HEALTHY: 'healthy',
	ALMOST_FULL: 'almost_full',
	ALARM: 'alarm',
	CRITICAL: 'critical'
};

// Severity order used when two independent signals (e.g. TOMA state vs. CDV
// extent usage) disagree on a volume's health — take the max.
consts.targetHealthSeverity = {
	healthy: 0,
	almost_full: 1,
	alarm: 2,
	critical: 3
};

consts.diskVendorHexToName = {
	0x1c58: 'HGST',
	0x144d: 'Samsung',
	0x8086: 'Intel',
	0x1344: 'Micron',
	0x1c5f: 'Memblaze',
	0x1179: 'Toshiba',
	0x15b7: 'SanDisk',
	0x1b96: 'WesternDigital',
	0x1e0f: 'KIOXIA',
	0x1414: 'Microsoft',
	0x1b4b: 'Exascend'
};

consts.diskVendorNameToHex = {
	'HGST': 0x1c58,
	'Samsung': 0x144d,
	'Intel': 0x8086,
	'Micron': 0x1344,
	'Memblaze': 0x1c5f,
	'Toshiba': 0x1179,
	'SanDisk': 0x15b7,
	'WesternDigital': 0x1b96,
	'KIOXIA': 0x1e0f,
	'Microsoft': 0x1414,
	'Exascend': 0x1b4b
};

consts.diskStatus = {
	OK: 'Ok',
	MISSING: 'Missing',
	ERROR: 'Error',
	FORMAT_ERROR: 'Format_Error',
	NOT_INITIALIZED: 'Not_Initialized',
	INGESTING: 'Ingesting',
	FROZEN: 'Frozen',
	INITIALIZING: 'Initializing',
	FORMATTING: 'Formatting'
};

consts.driveHealthyStatuses = [
	consts.diskStatus.NOT_INITIALIZED,
	consts.diskStatus.FROZEN,
	consts.diskStatus.FORMATTING,
	consts.diskStatus.INITIALIZING,
	consts.diskStatus.OK
];

consts.driveFormatStatuses = [
	consts.diskStatus.FROZEN,
	consts.diskStatus.FORMATTING
];

consts.driveExcludeReasons = {
	SWITCHED_ZONE: 'Switched-Zone',
	EXPLICIT: 'Explicit',
	IN_USE: 'In-Use',
	NONE: 'None'
};

consts.nicStatus = {
	OK: 'Ok',
	MISSING: 'Missing',
	ERROR: 'Error',
	LINK_DOWN: 'LinkDown'
};

consts.nicProtocol = {
	INFINIBAND: 'Infiniband',
	ROCE: 'RoCE',
	TCP: 'TCP',
	MULTI: 'MULTI', // MULTI = TCP & RoCE
	UNKNOWN: 'Unknown'
};

consts.nodeStatus = {
	OK: 1,
	DOWN: 2,
	UNAVAILABLE: 4,
	DELETING: 5,
	OFFLINE: 6
};

consts.upgradeAgentStatus = {
	ONLINE: 'online',
	OFFLINE: 'offline'
};

consts.upgradeAgentHealth = {
	HEALTHY: 'healthy',
	CRITICAL: 'critical'
};

consts.upgradeAgentInternalHealth = {
	HEALTHY: 'healthy',
	CRITICAL: 'critical'
};

consts.clientStatus = {
	INITIALIZING: 0,
	READY: 1,
	PREP_RM: 2,
	RM_RDY: 3,
	EXITING: 4,
	DOWN: 5
};

consts.clientCriticalStatuses = [
	consts.clientStatus.INITIALIZING,
	consts.clientStatus.RM_RDY,
	consts.clientStatus.EXITING,
	consts.clientStatus.DOWN
];

consts.clientKafkaMessageSeqTypes = {
	KEEPALIVE: 'keepalive',
	REPORT_CLIENT: 'reportClient',
	UPDATE_ATTACHMENT_STATUS: 'updateAttachmentStatus'
};

consts.upgradeAgentKafkaMessageSeqTypes = {
	KEEPALIVE: 'keepalive',
};

consts.configurationProfile = {
	status: {
		OK: 'ok',
		APPLYING: 'applying',
		RESTART_REQUIRED: 'restartRequired'
	},
	defaults: {
		CLUSTER_DEFAULT: 'Cluster Default',
		NVMESH_DEFAULT: 'NVMesh Default',
		NVMESH_DEBUG: 'NVMesh Debug'
	}
};

consts.volumeLockServerTypes = {
	OWNER_SCHEME_FIRST_L_INC_A: 1,
	OWNER_SCHEME_SL_START_INC_A: 2,
	OWNER_SCHEME_SL_START_DEC_A: 3,
	OWNER_SCHEME_SL_START_DEC_C: 4
};

consts.volumeStatuses = {
	PENDING: 'pending',
	TO_BE_DELETED: 'toBeDeleted',
	ONLINE: 'online',
	OFFLINE: 'offline',
	DEGRADED: 'degraded',
	UNAVAILABLE: 'unavailable',
};

consts.volumeActions = {
	EXTENDING: 'extending',
	MARKED_FOR_DELETION: 'markedForDeletion',
	DELETING: 'deleting',
	MARKED_FOR_REBUILD: 'markedForRebuild',
	REBUILDING: 'rebuilding',
	REBUILD_REQUIRED: 'rebuildRequired',
	INITIALIZING: 'initializing',
	BOOTING: 'booting',
	NONE: 'none',
	INIT_ENCRYPTION_REQUIRED: 'initEncryptionRequired',
	INITIALIZING_ENCRYPTION: 'initializingEncryption',
	ADDING_PASSPHRASE: 'addingPassphrase',
	DELETING_PASSPHRASE: 'deletingPassphrase',
	ROTATING_PASSPHRASE: 'rotatingPassphrase'
};

consts.volumeEncryptionCommands = {
	INIT_ENCRYPTION: 'initEncryption',
	REQUEST_RESPONSE: 'encryptionRequestResponse',
	ADD_PASSPHRASE: 'addPassphrase',
	DELETE_PASSPHRASE: 'deletePassphrase',
	ROTATE_PASSPHRASE: 'rotatePassphrase'
};

consts.XTS_KEY_SIZES = {
	XTS_AES_128: 256,
	XTS_AES_256: 512
};

consts.volumeCapacity = {
	MAX: 'MAX',
	NO_CHANGE: 'NOCHANGE'
};

consts.diskSegmentStatuses = {
	INITIALIZING: 'initializing',
	REMAP: 'remap',
	UNDER_RECOVERY_TOMA: 'under_recovery',
	NORMAL: 'normal',
	DEPRECATED: 'deprecated',
	REPLACEMENT: 'replacement',
	DEAD: 'dead',
	MARKED_FOR_REBUILD_OLD: 'markedForRebuild_old',
	MARKED_FOR_REBUILD: 'markedForRebuild',
	ZEROING: 'zeroing',
	BOOTING: 'booting',
	UNKNOWN: 'unknown'
};

consts.tomaStatuses = {
	UNAVAILABLE: 'unavailable',
	DOWN: 'down',
	UP: 'up'
};

consts.managementAgentStatuses = {
	UNAVAILABLE: 'unavailable',
	DOWN: 'down',
	UP: 'up'
};

consts.managementStatuses = {
	DOWN: 'down',
	UP: 'up'
};

consts.clusterStateChangeStatuses = {
	HANDLING: 'handling',
	FINISHED: 'finished'
};

consts.segmentTypes = {
	DATA: 'data',
	EXCELERO_METADATA: 'excelero_metadata'
};

consts.metadataPartitionNames = {
	METADATA: 'excelero_metadata',
	JOURNAL_DATA: 'excelero_journal_data',
	SERJIO_DB: 'excelero_serjio_db'
};

consts.raftRoles = {
	FOLLOWER: 'FOLLOWER'
};

consts.segmentOwners = {
	NVMESH: 'nvmesh',
	SYSTEM: 'system'
};

consts.segmentVitality = {
	UP: 'up',
	DOWN: 'down'
};

consts.updateTypes = {
	FULL: 'full',
	INCREMENTAL: 'incremental'
};

consts.volumeTypes = {
	METADATA_VOLUME: 'METADATA_VOLUME',
	DATA_VOLUME: 'DATA_VOLUME',
};

consts.originTypes = {
	TOMA: 'TOMA',
	TOMA_LEADER: 'TOMA_LEADER',
	CLIENT: 'CLIENT',
	TARGET: 'TARGET',
	MANAGEMENT_AGENT: 'MANAGEMENT_AGENT',
	MANAGEMENT: 'MANAGEMENT',
	UPGRADE_AGENT: 'UPGRADE_AGENT'
};

consts.formatTypes = {
	FORMAT_EC: 'format_ec',
	FORMAT_RAID: 'format_raid'
};

consts.unitType = {
	BINARY: 'binary',
	DECIMAL: 'decimal'
};

consts.driveMetadataSupport = {
	NOT_SUPPORTED: 0,
	INLINE: 1,
	SEPARATE: 2,
	BOTH: 3
};

consts.backupTypes = {
	HOURLY: 'hourly',
	DAILY: 'daily'
};

consts.DEFAULT_BACKUP_ROTATION_THRESHOLD = 20;

consts.entityType = {
	TARGET: 'TARGET',
	CLIENT: 'CLIENT',
	NIC: 'NIC',
	DISK: 'DISK',
	VOLUME: 'VOLUME',
	USER: 'USER',
	CONFIGURATION_PROFILE: 'CONFIGURATION_PROFILE',
	VPG: 'VPG'
};

consts.zoneRankingCriterias = {
	SEGMENTS_IN_ZONE: 'segmentsInZone',
	TARGETS_IN_ZONE: 'targetsInZone',
	AVG_TIME_SPENT_WAITING_FOR_LOCK: 'avgTimeSpentWaitingForLock'
};

consts.missingDriveCheckupInterval = 60 * 1000;
consts.autoEvictMissingDriveAfter = 3 * 60 * 1000;

consts.autoEvictReason = {
	DISK_SIZE_ERROR: 'Drive reports an invalid size or changed its size',
	INVALID_SERIAL: 'Serial is \'UNKNOWN\' or null',
	INVALID_GPT: 'Invalid Partition Table',
	MISSING_GPT: 'Missing Partition Table',
	METADATA_PARTITION_DELETED: 'Metadata partition deleted from GPT',
	EXTRA_METADATA_PARTITION: 'Extra metadata partition found',
	PARTITION_SIZE_CHANGED: 'Partition size was changed',
	SEGMENTS_OVERLAPS: 'Overlapping segments found',
	SEGMENT_OUT_OF_BOUND: 'Segment out of bound',
	SYSTEM_PARTITION_FOUND: 'System partition found on drive',
	DRIVE_FORMATTED_WITH_VOL_SEGMENTS: 'Drive formatted with volume segments',
	DATA_PARTITION_FOUND_AFTER_FORMAT: 'Data partition was found after format',
	MISSING_METADATA_PARTITIONS: 'Drive is missing suitable metadata partitions',
	UNKNOWN_NVMESH_PARTITION: 'Unknown NVMesh partition found on drive',
	DRIVE_UUID_MISMATCH: 'Drive uuid mismatch found',
	IMPORTED_DRIVE: 'Drive was imported from another NVMesh environment',
	DRIVE_INVALID_UUID: 'Drive reported an invalid uuid',
	MISSING_DRIVE: 'Drive is missing',
	DEFAULT: 'Error while processing drive'
};

consts.formatEntityLink = {
	TARGET: function(entityObj) { return '/servers/server/' + entityObj.entityText; },
	CLIENT: function() { return '/clients/'; },
	NIC: function(entityObj) { return '/servers/server/' + entityObj.target; },
	DISK: function(entityObj) { return '/servers/server/' + entityObj.target; },
	VOLUME: function() { return '/volumes/'; },
	USER: function() { return '/users/'; },
	CONFIGURATION_PROFILE: function() { return '/configurationProfiles/'; },
	VPG: function() { return '/volumeProvisioningGroups/'; },
};

consts.getEntityLink = function(metaLink) {
	return consts.formatEntityLink[metaLink.entityType](metaLink);
};

consts.EMPTY_UUID_REGEX = new RegExp('^[0-]*$');
consts.SKIP_DISK_UUID_MAGIC_UUID = '709b6e56-0866-4984-8795-44f033276c92';

consts.diskDisplay = {
	MINIMAL_SEGMENT_PERCENTAGE: 1,
	SEGMENTS_MERGING_THRESHOLD_PERCENTAGE: 4
};

consts.connectionDirection = {
	IN: 'received',
	OUT: 'initiating'
};

consts.defaultFormat = {
	FORMAT_RAID:
	{
		BLOCK_SIZE: 4096,
		METADATA_SIZE: 0
	},
	FORMAT_EC:
	{
		BLOCK_SIZE: 4096,
		METADATA_SIZE: 8
	}
};

consts.userManualURL = 'TBD';
consts.releaseNotesURL = 'TBD';
consts.restAPIURL = '/docs/index.html';
consts.defaultEmail = 'customer.stats+customerName@acme.com';

consts.HANDLE_TIMEDOUT_COMPONENT_INTERVAL = 5 * 1000; // 5 seconds

consts.TARGET_ID_DEFAULT_LENGTH = 24;

consts.encryptionCommandStatuses = {
	NONE: 'none',
	PENDING_SEND: 'pendingSend',
	SENT: 'sent',
	EXECUTED: 'executed'
};
consts.encryptionCommandResults = {
	SUCCESS: 1,
	EXTERNAL_ERROR: 2,
	TOMA_ERROR: 3,
	UNSEEN: 4,
	MANUAL_INTERVENTION_REQUIRED: 5
};

consts.DEFAULT_LOG_EXPIRATION_IN_SECONDS = 60 * 60 * 24 * 30;
consts.kafkaMessageTypes = {
	TOMAToManagament: {
		keepalive: 'keepalive',
		leaderKeepalive: 'leaderKeepalive',
		reportTarget: 'reportTarget',
		updatePRaidReport: 'updatePRaidReport',
		sendPRaidReportResponse: 'sendPRaidReportResponse',
		driveZeroingProgress: 'driveZeroingProgress',
		segmentZeroingProgress: 'segmentZeroingProgress',
		updateDiskSegmentsDirtyBits: 'updateDiskSegmentsDirtyBits',
		encryptionCommandResponse: 'encryptionCommandResponse'
	},
	AgentToManagement: {
		keepalive: 'keepalive',
		configProfileUpdated: 'configProfileUpdated',
		updateConfigProfileUserOverride: 'updateConfigProfileUserOverride',
		updateKeys: 'updateKeys',
		tpvStats: 'tpvStats',
		tpvCompactionStats: 'tpvCompactionStats',
	},
	ClientToManagement: {
		keepalive: 'keepalive',
		updateAttachmentStatus: 'updateAttachmentStatus',
		log: 'log',
		updateLog: 'updateLog',
		ackLog: 'ackLog',
		getTargetNICs: 'getTargetNICs',
	},
	UpgradeAgentToManagement: {
		keepalive: 'keepalive',
		commandResult: 'commandResult'
	},
	ManagementToUpgradeAgent: {
		updateUpgradeAgentKeepaliveToken: 'updateUpgradeAgentKeepaliveToken',
		upgradeAgentCommand: 'upgradeAgentCommand'
	},
	ManagementToAgent: {
		updateAgentToken: 'updateAgentToken',
		updateConfigProfile: 'updateConfigProfile',
	},
	ManagementToClient: {
		updateClientToken: 'updateClientToken',
		attachVolumes: 'attachVolumes',
		updateVolumes: 'updateVolumes',
		detachVolumes: 'detachVolumes',
		updateTargetNICs: 'updateTargetNICs',
		updateVolumeEmulation: 'updateVolumeEmulation',
		updateReferenceIDs: 'updateReferenceIDs',
		volumeRemoved: 'volumeRemoved',
	},
	ManagementToTOMA: {
		updateVolume: 'updateVolume',
		updateTomaKeepaliveToken: 'updateTomaKeepaliveToken',
		updateLeaderKeepaliveToken: 'updateLeaderKeepaliveToken',
		resendReport: 'resendReport',
		hardwareConfiguration: 'hardwareConfiguration',
		formatDrive: 'formatDrive',
		addVolume: 'addVolume',
		addTarget: 'addTarget',
		deleteVolume: 'deleteVolume',
		deleteTarget: 'deleteTarget',
		deleteVolumeCompleted: 'deleteVolumeCompleted',
		reservationModeChange: 'reservationModeChange',
		initEncryption: 'initEncryption',
		addPassphrase: 'addPassphrase',
		deletePassphrase: 'deletePassphrase',
		rotatePassphrase: 'rotatePassphrase',
		requestEncryptionResponse: 'encryptionRequestResponse',
		cdvAllocatorFreeAll: 'cdvAllocatorFreeAll',
		attachSatelliteResponse: 'attachSatelliteResponse',
		preemptClientFromCDV: 'preemptClientFromCDV',
	},
	TOMAToManagement_TP: {
		cdvCapacityWarning: 'cdvCapacityWarning',
		cdvCapacityRestore: 'cdvCapacityRestore',
		cdvAllocatorStats: 'cdvAllocatorStats',
		attachSatelliteRequest: 'attachSatelliteRequest',
		preemptClientFromCDVResponse: 'preemptClientFromCDVResponse',
	}
};

consts.mongoClientOptions = {
	authSource: 'authSource',
	tls: 'tls',
	tlsCertificateKeyFile: 'tlsCertificateKeyFile',
	tlsCertificateKeyFilePassword: 'tlsCertificateKeyFilePassword',
	tlsCAFile: 'tlsCAFile',
	authMechanism: 'authMechanism',
	connectTimeoutMS: 'connectTimeoutMS',
	socketTimeoutMS: 'socketTimeoutMS',
};

consts.mongoConnectionProtocols = {
	SRV: 'mongodb+srv',
	STANDARD: 'mongodb'
};

consts.kafkaErrorMessages = {
	PRODUCER_DISCONNECTED: 'The producer is disconnected'
};

consts.connectionEntities = {
	MONGO_DB: 'mongo_db',
	KAFKA: 'kafka'
};

consts.GB = Math.pow(1000, 3);
consts.GiB = Math.pow(2, 30);
consts.MiB = Math.pow(2, 20);
consts.DECIMAL_BINARY_G_FACTOR = 0.931323;
consts.INITIAL_ATTACHMENTS_VERSION = 0;

consts.entity = {
	client: 'Client',
	upgradeAgent: 'UpgradeAgent',
	configurationProfile: 'Configuration Profile',
	clusterID: 'Cluster ID',
	drive: 'Drive',
	NIC: 'NIC',
	driveClass: 'Drive Class',
	targetClass: 'Target Class',
	keys: 'Keys',
	encryption: 'Encryption',
	generalSettings: 'General Settings',
	passphrase: 'Passphrase',
	password: 'Password',
	target: 'Target',
	user: 'User',
	volume: 'Volume',
	vpg: 'VPG',
	vsg: 'VSG',
	zone: 'Zone',
	management: 'Management',
	kernel: 'Kernel',
	ofed: 'Ofed',
	operatingSystem: 'Operating System',
	platform: 'Platform',
	component: 'Component',
	upgrade: 'Upgrade',
	dbUpgrade: 'DBUpgrade',
	documentUpgradeInterceptor: 'Document Upgrade Interceptor',
	release: 'Release',
	artifact: 'Artifact',
	archType: 'Arch Type',
	distributionType: 'Distribution Type',
	componentType: 'Component Type',
	upgradeType: 'Upgrade Type',
	upgradeStep: 'Upgrade Step',
	upgradeScenario: 'Upgrade Scenario',
	upgradeStepScenario: 'Upgrade Step Scenario'
};

consts.operation = {
	add: 'Add',
	apply: 'Apply',
	attach: 'Attach',
	change: 'Change',
	createAndAttach: 'Create And Attach',
	delete: 'Delete',
	detach: 'Detach',
	detachAndDelete: 'Detach And Delete',
	evict: 'Evict',
	extend: 'Extend',
	initiate: 'Initiate',
	rebuild: 'Rebuild',
	regenerateMessages: 'Regenerate Messages',
	rotate: 'Rotate',
	save: 'Save',
	setZone: 'Set Zone',
	start: 'Start',
	resume: 'Resume',
	update: 'Update',
	format: 'Format',
	end: 'End',
	setEmulationMode: 'Set Emulation Mode',
	execute: 'Execute',
	markAsCompleted: 'Mark As Completed',
	skipFailedMachine: 'Skip Failed Machine',
	provision: 'Provision'
};

consts.componentsPages = {
	kafka: 'kafka',
	logs: 'logs',
	targetClasses: 'targetClasses',
	driveClasses: 'driveClasses',
	generalSettings: 'generalSettings',
	keys: 'keys',
	volumeSecurityGroups: 'volumeSecurityGroups',
	targets: 'targets',
	managementCluster: 'managementCluster',
	users: 'users',
	mongoDB: 'mongoDB',
	platforms: 'platforms',
	components: 'components',
	vpg: 'vpg',
	dashboard: 'dashboard',
	target: 'target',
	volumes: 'volumes',
	backups: 'backups',
	upgrades: 'upgrades',
	upgradeScenarios: 'upgradeScenarios',
	upgradeStepsScenarios: 'upgradeStepsScenarios',
	upgradeAgents: 'upgradeAgents',
	clients: 'clients',
	serviceUnavailable: 'serviceUnavailable',
	drives: 'drives',
	cluster: 'cluster',
	upgrade: 'upgrade',
	releases: 'releases',
	artifacts: 'artifacts',
	kernels: 'kernels',
	ofeds: 'ofeds',
	operatingSystems: 'operatingSystems',
	about: 'about',
	techniciansScreen: 'techniciansScreen',
	pageNotFound: 'pageNotFound',
	configurationProfiles: 'configurationProfiles',
	tpv: 'tpv',
	cdv: 'cdv',
};

consts.dbCollections = {
	USER: 'user',
	VOLUME: 'volume',
	CLIENT: 'client',
	TARGET: 'server',
	DRIVE_CLASS: 'diskClass',
	TARGET_CLASS: 'serverClass',
	VOLUME_PROVISIONING_GROUP: 'volumeProvisioningGroup',
	CONFIGURATION_PROFILE: 'configurationProfile',
	CONFIGURATION_VERSION: 'configurationVersion',
	GLOBAL_SETTINGS: 'globalSettings',
	LAST_MESSAGE_LOG: 'lastMessageLog',
	LOCK: 'lock',
	LOG: 'log',
	KEY: 'key',
	MANAGEMENT_CLUSTER: 'managementCluster',
	NODE_CONFIGURATION: 'nodeConfiguration',
	UPGRADE_AGENT: 'upgradeAgent',
	UPGRADE: 'upgrade',
	UPGRADE_STEP: 'upgradeStep'
};

consts.metadataDBCollections = {
	IDENTIFICATION: 'identification',
	CLUSTER: 'cluster'
};

consts.filtSortTable = {
	defaultCount: 10,
	itemsPerPageOptions: [10, 20, 50]
};

consts.IP_STRATEGIES = {
	MANUAL: 'Manual',
	FQDN: 'FQDN',
	FIRST_INTERFACE_DEFAULT: 'FirstInterfaceDefault',
	SPECIFIC_INTERFACE: 'SpecificInterface',
	FIRST_INTERFACE: 'FirstInterface',
};

consts.RE_REGISTER_TOPICS_INTERVAL = 5 * 1000;

consts.updatableVolumeProperties = ['description', 'limitByNodes', 'limitByDisks', 'VSGs', 'diskClasses', 'serverClasses', 'relativeRebuildPriority',
	'enableNVMf', 'enableCrcCheck', 'selectedClientsForNvmf', 'isReadOnly', 'allowAllocationOnOfflineDrives', 'metadata', 'cdvConfig'];

consts.updatableVpgProperties = ['description', 'VSGs', 'allowAllocationOnOfflineDrives'];

consts.pRaidOptionsPropertiesByRaidLevel = {
	[consts.RAIDLevel.ERASURE_CODING]: ['RAIDLevel', 'stripeSize', 'stripeWidth', 'dataBlocks', 'parityBlocks', 'protectionLevel', 'enableCrcCheck'],
	[consts.RAIDLevel.STRIPED_ERASURE_CODING]: ['RAIDLevel', 'stripeSize', 'stripeWidth', 'dataBlocks', 'parityBlocks', 'protectionLevel', 'enableCrcCheck'],
	[consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10]: ['RAIDLevel', 'stripeSize', 'stripeWidth', 'numberOfMirrors', 'ignoreNodeSeparation', 'enableCrcCheck'],
	[consts.RAIDLevel.MIRRORED_RAID_1]: ['RAIDLevel', 'numberOfMirrors', 'ignoreNodeSeparation', 'enableCrcCheck'],
	[consts.RAIDLevel.STRIPED_RAID_0]: ['RAIDLevel', 'stripeSize', 'stripeWidth'],
	[consts.RAIDLevel.CONCATENATED]: ['RAIDLevel'],
};

consts.updateExcludedPropertiesForVPGVolumes = ['limitByNodes', 'limitByDisks', 'VSGs', 'diskClasses', 'serverClasses', 'enableCrcCheck'];


consts.capacityAllocationTypes = {
	CUSTOM: 'custom',
	MAX: 'max',
	NO_CHANGE: 'nochange'
};

consts.components = {
	CLIENT: 'nvmesh-client',
	MANAGEMENT: 'nvmesh-management',
	TARGET: 'nvmesh-target',
	UPGRADE_AGENT: 'nvmesh-upgrade-agent',
	INTEROP_DB: 'nvmesh-interopdb',
	MONITOR: 'nvmesh-monitor',
	BASE: 'nvmesh-base',
	UTILS: 'nvmesh-utils'
};

const componentNamesRegex = Object.values(consts.components).join('|');
const baseVersionRegex = '[\\d+.]+';
const rpmDebRegex = '\\.(rpm|deb)$';
consts.artifactNameRegex = new RegExp(`^(${componentNamesRegex})[-_](${baseVersionRegex}).*${rpmDebRegex}`);

consts.HOTFIX_RELEASE_SUBSTRING = 'HF';

consts.thirdPartyLibs = {
	LIBRDKAFKA: 'librdkafka'
};

consts.componentTypes = {
	NVMESH_PACKAGE: 'NVMESH_PACKAGE',
	THIRD_PARTY: 'THIRD_PARTY'
};

consts.upgradeExecutionModes = {
	MANUAL: 'manual',
	MANUAL_START: 'manualStart',
	AUTOMATIC: 'automatic'
};

consts.upgradeRedundancyLevels = {
	MINIMAL: 'minimal',
	MAX: 'max',
	NONE: 'none'
};

consts.upgradeStatuses = {
	PENDING_START: 'pendingStart',
	IN_PROGRESS: 'inProgress',
	PAUSED: 'paused',
	COMPLETED: 'completed',
	FAILED: 'failed',
	PRE_UPGRADE_CHECKS_FAILED: 'preUpgradeChecksFailed'
};

consts.upgradeStepCommands = {
	INSTALL: '<install>'
};

consts.upgradeTypes = {
	CLIENT_ONLY: 'clientOnly',
	CLIENT_AND_TARGET: 'clientTarget',
	MANAGEMENT: 'management',
	UPGRADE_AGENT: 'upgradeAgent'
};

consts.upgradeStepStatuses = {
	PENDING: 'pending',
	PENDING_SEND: 'pendingSend',
	COMPLETED: 'completed',
	FAILED: 'failed',
	IN_PROGRESS: 'inProgress',
	MANUALLY_COMPLETED: 'manuallyCompleted',
	SKIPPED: 'skipped'
};

consts.completedUpgradeStepStatuses = [
	consts.upgradeStepStatuses.COMPLETED,
	consts.upgradeStepStatuses.MANUALLY_COMPLETED,
	consts.upgradeStepStatuses.SKIPPED
];

consts.upgradeStepStartConditions = {
	ALL_DONE: 'allDone',
	PREVIOUS_DONE: 'previousDone',
	NONE: 'none' //will start immediately as long the last step for this machine is done.
};

consts.FEATURE_COMPATIBILITY_TYPES = {
	CLIENT: 'clientFeatureCompatibility',
	TARGET: 'targetFeatureCompatibility',
	LEADER: 'leaderFeatureCompatibility',
	MANAGEMENT: 'managementFeatureCompatibility',
	UPGRADE_AGENT: 'upgradeAgentFeatureCompatibility'
};

consts.TOPIC_NAME_PLACEHOLDERS = {
	HOSTNAME: '<HOSTNAME>',
	ZONE: '<ZONE>'
};

consts.SECONDS_TO_WAIT_BETWEEN_CHECK_AND_CLEANUP_UNUSED_TOPICS = 60;
consts.SECONDS_INTERVAL_BETWEEN_CLEANUP_UNUSED_TOPICS_TIME_PASSED = 10;
consts.MAX_METADATA_SIZE = 256 * 1024;

consts.preUpgradeCheckRelaxationsMode = {
	skipVolumeStatusCheck: true,
	allowAlarmClients: true
};

consts.volumeClass = {
	REGULAR: 'REGULAR',
	CDV: 'CDV',
	CDV_MGMT: 'CDV_MGMT',
	TPV: 'TPV',
};

// Suffix appended to a CDV's name to form its allocator-satellite volume name.
// Volumes with this suffix on a regular volume name are reserved for system use.
consts.CDV_MGMT_SUFFIX = '-mgmt';

// Default satellite (CDV-mgmt) volume size: 1 GiB. Holds the CDV allocator
// header + cdv_extent_md[] array. Controlled by cdvConfig.allocatorSizeGib.
consts.CDV_MGMT_SIZE_GIB = 1;

// Max characters in a CDV name. Tighter than the regular volume name limit
// so that '<cdvName>-mgmt' fits within the regular volume name limit.
consts.CDV_NAME_MAX_LENGTH = 16;

// Valid power-of-2 values for CDV and TPV extent sizes.
//
// cdvExtentSizeMibValues floor is 16 MiB. The satellite (CDV-mgmt) volume,
// sized at cdvConfig.allocatorSizeGib GiB (user-configurable, default 1),
// packs 32 × 128-byte records per 4 KiB block — max extents ≈
// allocatorSizeGib × 8 388 576. At default allocatorSizeGib = 1 that's
// ~8.4M extents, so a CDV at the 16 MiB floor holds up to ~128 TiB before
// the satellite ceiling binds. Admins rarely need to raise allocatorSizeGib.
//
// CDVs don't declare a role at creation — the same enum applies to data
// and metadata CDVs alike (TPV_MetadataCDV.md). The finer floor lets
// admins create compact metadata CDVs (e.g. 16 MiB extent on a 1 TiB
// mirror) without the lumpy per-TPV reservation that 64 MiB incurs.
consts.cdvExtentSizeMibValues = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
consts.tpvExtentSizeKBValues = [64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined')
	module.exports = consts;
else
	window.consts = consts;
