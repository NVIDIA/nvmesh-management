/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { Kafka } = require('../node_modules/kafkajs');

const args = process.argv;
let serverAddress;

function log(message) {
	console.log(message);
}

function printUsage() {
	// args[0] is the node command
	// args[1] is the file name
	console.log(`usage:\n node ${args[1]} localhost:9092`);
}

function parseArgs() {
	//log(JSON.stringify(args));
	if (args.length < 3) {
		console.log('Error: missing server address');

		printUsage();
		process.exit(255);
	} else {
		serverAddress = args[2];
	}
}

async function deleteAllTopics() {
	let allTopics = await admin.listTopics();
	if (allTopics.length == 0) {
		log(`No topics found on Kafka server ${serverAddress}`);
		return 1;
	} else {
		log(`Deleting ${allTopics.length} topics: ${allTopics}`);
		await admin.deleteTopics({ topics: allTopics });
		return 0;
	}
}

// ---- Main ----

parseArgs();

const kafka = new Kafka({
	clientId: 'test-script',
	brokers: [serverAddress]
});

const admin = kafka.admin();

deleteAllTopics()
	.then(res => process.exit(res));


