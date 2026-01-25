/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const hostnameRegex = /^([a-z](?:[a-z0-9-_.]*[a-z0-9]))$/i;
const nicRegex = /^[a-z][a-z0-9_-]*$/i;

function isAddressAndPort(value, errors) {
	var parts = value.split(':');
	if (parts.length != 2) {
		errors.push(`${value} does not match '<hostname|IPv4>:<port>' `);
		return false;
	}

	var isIP = isIPv4(parts[0]);
	var isHostname = isValidHostname(parts[0]);
	if (!isIP && !isHostname) {
		errors.push(`${parts[0]} does not match hostname regex: ${hostnameRegex} or IPv4 pattern`);
		return false;
	}

	try {
		const portValid = isPort(parts[1], errors);
		return portValid;
	/* eslint-disable-next-line no-unused-vars */
	} catch (ex) {
		errors.push(`Failed to parse port from ${parts[1]}`);
		return false;
	}
}

function isValidHostname(strValue) {
	return strValue.match(hostnameRegex);
}

function isPort(portStr, errors) {
	var port = parseInt(portStr);
	if (isNaN(port)) {
		errors.push(`Port (${portStr}) must be integer`);
		return false;
	}

	let isValid = (port > 1024 && port < 65535);
	if (!isValid) {
		errors.push(`Port (${port}) must be in range 1024 < port < 65535`);
		return false;
	}

	return true;
}

function isIPv4(ipString) {
	var parts = ipString.split('.');
	if (parts.length != 4)
		return false;

	var noErrors = true;
	parts.forEach(function(part) {
		var n = Number(part);
		if (n < 0 || n > 255)
			noErrors = false;
	});

	return noErrors;
}

function getNICValidationFunction(value, errors) {
	var parts = value.split('/');
	if (parts.length > 2) {
		errors.push(`${value} too many /`);
		return false;
	}
	var networkInterface = (parts.length == 1) ? value : parts[0];

	if (!networkInterface) {
		errors.push(`${value} could not parse value`);
		return false;
	}

	if (!parts[0].match(nicRegex)) {
		errors.push(`${value} invalid NIC name "${parts[0]}"`);
		return false;
	}

	if (parts.length > 1) {
		var protocol = parts[1];

		if (protocol != 'RDMA' && protocol != 'TCP') {
			errors.push(`Unknown protocol "${protocol}" allowed: RDMA / TCP`);
			return false;
		}
	}

	return true;
}

const booleanToYesNo = value => value ? 'Yes' : 'No';

const scheme = {
	categories: [
		{
			id: 'cluster',
			name: 'Cluster',
			parameters: [
				{
					name: 'KAFKA_SERVERS',
					displayName: 'Kafka Servers',
					type: 'string',
					description: 'Hosts and ports to connect Kafka servers for communicating with the NVMesh Management servers',
					format: '<Kafka server hostname or IP address : port>, <hostname/IP:port>,… Default port is 9092',
					examples: ['kafka-server1:9092,kafka-server2:9092'],
					numOfValues: '*',
					translationFunction: (values) => values.join(','),
					allowCreate: true,
					validationFunction: isAddressAndPort
				},
				{
					name: 'KAFKA_TLS_ENABLED',
					displayName: 'Kafka TLS enabled',
					type: 'boolean',
					description: 'Enable TLS for communicating with kafka',
					advanced: true
				},
				{
					name: 'KAFKA_CA',
					displayName: 'Kafka CA',
					type: 'string',
					description: 'Full path of Kafka CA file',
					examples: ['/etc/nvmesh/tls/kafka.ca'],
					advanced: true
				},
				{
					name: 'KAFKA_MCS_CERTIFICATE',
					displayName: 'Kafka MCS Certificate',
					type: 'string',
					description: 'Full path of MCS cert file',
					examples: ['/etc/nvmesh/tls/mcs.crt'],
					advanced: true
				},
				{
					name: 'KAFKA_MCS_KEY',
					displayName: 'Kafka MCS key',
					type: 'string',
					description: 'Full path of MCS key file',
					examples: ['/etc/nvmesh/tls/mcs.key'],
					advanced: true
				},
				{
					name: 'KAFKA_TOMA_CERTIFICATE',
					displayName: 'Kafka TOMA Certificate',
					type: 'string',
					description: 'Full path of TOMA cert file',
					examples: ['/etc/nvmesh/tls/toma.crt'],
					advanced: true
				},
				{
					name: 'KAFKA_TOMA_KEY',
					displayName: 'Kafka TOMA key',
					type: 'string',
					description: 'Full path of TOMA key file',
					examples: ['/etc/nvmesh/tls/toma.key'],
					advanced: true
				}
			]
		},
		{
			id: 'client',
			name: 'Client',
			parameters: [
				{
					name: 'NVMESHUM_CLIENT',
					displayName: 'NVMesh User Mode Enabled',
					type: 'boolean',
					description: 'Used to enable NVMesh User Mode (nvmesh) instead of NVMesh Kernel based Client (nvmeshclient)',
					translationFunction: booleanToYesNo
				},
				{
					name: 'NVMESH_MODE',
					displayName: 'NVMesh Mode',
					type: 'choice',
					description: 'Used to control what set of module parameters should be used for NVMesh',
					options: ['', 'nvmesh_oci', 'nvmesh_dpu', 'nvme_pre2.6.0'],
					advanced: true
				},
				{
					name: 'NVMF_IP',
					displayName: 'NVMF IP',
					type: 'string',
					description: 'IP of the nic to use for NVMf target	',
					advanced: true
				},
				{
					name: 'ACCESS_METHOD',
					displayName: 'Access Method',
					description: 'Access method to be used: ISCSI or NVMF',
					type: 'choice',
					options: ['nvmf', 'iscsi'],
					advanced: true
				},
				{
					name: 'ISCSI_TARGET_IP',
					displayName: 'ISCSI Target IP',
					type: 'string',
					description: 'The IP of ISCSI target node',
					format: '<IP>:<PORT>',
					advanced: true
				},
				{
					name: 'ISCSI_INITIATOR_IP',
					displayName: 'ISCSI Initiator IP',
					type: 'string',
					description: 'The IP of the ISCSI initiator remote node',
					advanced: true
				}
			]
		},
		{
			id: 'node',
			name: 'Node',
			parameters: [
				{
					name: 'CONFIGURED_NICS',
					displayName: 'Configured NICs',
					type: 'string',
					description: 'The NICs that NVMesh Clients and Targets can use for IO. An empty value places no limits.',
					format: '<interface name>, <interface name>, ...',
					examples: [
						'ib0,ib1',
						'eno1,eth0',
					],
					numOfValues: '*',
					translationFunction: function(values) {
						return values.join(';');
					},
					allowCreate: true,
					validationFunction: getNICValidationFunction,
					advanced: true
				},
				{
					name: 'BLACKLIST_NICS',
					displayName: 'Blacklist NICs',
					type: 'string',
					description: 'Define the nics that will not be used for NVMesh. To allow all nics to be available leave empty.',
					format: '<interface name>, <interface name>, ...',
					examples: [
						'ib0,ib1',
						'eno1,eth0',
					],
					numOfValues: '*',
					translationFunction: function(values) {
						return values.join(';');
					},
					allowCreate: true,
					validationFunction: getNICValidationFunction,
					advanced: true
				},
				{
					name: 'IPV4_ONLY',
					displayName: 'IPv4 Only',
					type: 'boolean',
					description: 'Only support IPv4 for RoCEv2/TCP',
					default: true,
					advanced: true
				},
				{
					name: 'MAX_SM_QUERY_BURST',
					displayName: 'Maximum SM Query Burst',
					type: 'number',
					description: 'Used to set the maximum burst size of queries to the IB Session Manager.'
						+ ' This parameter is not relevant for RoCE.\nA smaller number here will decrease the load on the SM, '
						+ ' but will increase the initial bring-up time.',
					minimum: 32,
					maximum: 32767,
					advanced: true
				},
				{
					name: 'TCP_ENABLED',
					displayName: 'TCP Enabled',
					type: 'boolean',
					description: 'Enable TCP as possible transport type for NVMesh Client/Target',
					default: false,
					advanced: true
				},
				{
					name: 'IPV6_ONLY',
					displayName: 'IPv6 Only',
					type: 'boolean',
					description: 'Only support IPv6 for RoCEv2/TCP',
					default: false,
					advanced: true
				},
				{
					name: 'TCP_ONLY',
					displayName: 'TCP Only',
					type: 'boolean',
					description: 'Enable usage only of TCP over Ethernet NICs, effectively disabling RDMA',
					default: false,
					advanced: true
				},
				{
					name: 'MCS_MANAGEMENT_TIMEOUT',
					displayName: 'MCS Management timeout',
					type: 'number',
					description: 'Allows detecting a hanging/dead TCP connection between Clients and Targets and the Management Servers',
					minimum: 30,
					maximum: 600,
					default: 30,
					advanced: true
				},
			]
		},
		{
			id: 'target',
			name: 'Target',
			parameters: [
				{
					name: 'NVME_IRQ_AFFINITY_DOMAIN',
					displayName: 'NVMe IRQ affinity domain',
					type: 'choice',
					description: 'Defines how the interrupts for managed NVMe drives are distributed to CPU cores ',
					options: ['none', 'pernuma', 'persocket', 'fullspread'],
					advanced: true
				}
			]
		},
		{
			id: 'logs',
			name: 'Logs',
			parameters: [
				{
					name: 'DUMP_FTRACE_ON_OOPS',
					displayName: 'Dump ftrace on kernel PANIC',
					type: 'boolean',
					description: 'Used to dump the fast log (ftrace) buffers on kernel panic',
					default: true,
					advanced: true
				},
				{
					name: 'MCS_LOGGING_LEVEL',
					displayName: 'MCS Logging Level',
					type: 'choice',
					'options': ['ERROR', 'WARNING', 'INFO', 'DEBUG', 'VERBOSE'],
					description: '',
					advanced: true
				},
				{
					name: 'MCS_LOGGING_VERBOSE_TYPES',
					displayName: 'MCS Logging Verbose Types',
					description: 'When logging level is verbose, controls which message types will be shown. '
						+ 'Change only with direction from NVMesh Customer Support',
					type: 'choice',
					numOfValues: '*',
					translationFunction: function(values) {
						return values.join(',');
					},
					options: [
						'*>MGMT',
						'MGMT>*',
						'CLIENT>MGMT',
						'TOMA>MGMT',
						'MANAGEMENT_AGENT>MGMT',
						'MGMT>CLIENT',
						'MGMT>TOMA',
						'MGMT>MANAGEMENT_AGENT',
					],
					allowCreate: false,
					advanced: true
				},
				{
					name: 'AGENT_LOGGING_LEVEL',
					displayName: 'Management Agent Logging Level',
					type: 'choice',
					options: ['ERROR', 'WARNING', 'INFO', 'DEBUG'],
					description: '',
					advanced: true
				},
				{
					name: 'TOMA_NUM_OF_TRACE_LOGS',
					displayName: 'TOMA number of trace logs',
					description: 'specifies the number of files of history to keep',
					type: 'number',
					minimum: 1,
					maximum: 100,
					default: 40,
					advanced: true
				},
				{
					name: 'TOMA_TRACE_LOG_SIZE',
					displayName: 'TOMA trace log size',
					description: 'specifies the size of a single TOMA trace file',
					type: 'number',
					minimum: 1,
					maximum: 200,
					advanced: true
				},
				{
					name: 'TRACE_BUFS_PER_LOG',
					displayName: 'TOMA buffers per log',
					description: 'specifies the number of 4K buffers saved to a single trace file',
					type: 'number',
					default: 4096,
					advanced: true
				},
				{
					name: 'TRACE_MAX_LOGS',
					displayName: 'TOMA max logs',
					description: 'specifies the number of files of history to keep. The minimal value can’t be lower than the number of CPUs',
					type: 'number',
					default: 64,
					advanced: true
				},
				{
					name: 'LOGGERS_CGROUP',
					displayName: 'Loggers cgroup',
					description: 'Create a c cgroup to limit NVMesh loggers bw',
					type: 'string',
					advanced: true
				},
				{
					name: 'LOGGERS_CGROUP_WRITE_LIMIT',
					displayName: 'Loggers cgroup write limit',
					description: 'Limit the bw of to a specific number of bytes',
					type: 'number',
					default: 41943040,
					advanced: true
				},
			]
		},
		{
			id: 'monitor',
			name: 'Monitor',
			parameters: [
				{
					name: 'MONITOR_MANAGEMENT_USE_TLS',
					displayName: 'Use TLS',
					description: 'Use TLS connectivity when connecting to management',
					type: 'boolean',
					translationFunction: booleanToYesNo
				},
				{
					name: 'MONITOR_MANAGEMENT_USER',
					displayName: 'Management Username',
					description: 'Management username used for the monitor service',
					type: 'string',
				},
				{
					name: 'MONITOR_MANAGEMENT_TLS_CERT',
					displayName: 'TLS Certificate file',
					type: 'string',
					description: 'Full path to cert file for tls connection with management',
					examples: ['/etc/nvmesh/tls/monitor.crt'],

				},
				{
					name: 'MONITOR_MANAGEMENT_TLS_KEY',
					displayName: 'TLS Key file',
					type: 'string',
					description: 'Full path to key file for tls connection with management',
					examples: ['/etc/nvmesh/tls/monitor.key'],
				},
				{
					name: 'MONITOR_MANAGEMENT_TLS_CA',
					displayName: 'TLS CA file',
					type: 'string',
					description: 'Full path to CA file for tls connection with management',
					examples: ['/etc/nvmesh/tls/monitor.ca'],
				},
				{
					name: 'MONITOR_MANAGEMENT_CREDS_FILE',
					displayName: 'Credentials file',
					type: 'string',
					description: 'Full path to management creds file containing data with the following format: <hostname> <user> <base64 encoded passwd>',
					examples: ['/etc/nvmesh/monitor.creds'],
				}

			]
		},
	]
};

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined')
	module.exports = scheme;
else
	window.profileScheme = scheme;
