/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global it, describe, log, before */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { runKafkaCommand } = require('../modules/kafka');
const systemMessages = require('../systemMessages');
const dbManager = require('./testUtils/dbManager');
const { setup } = require('./testUtils/setup');


describe('Miscellaneous', () => {
	before(() => dbManager.connect().then(() => setup.newSetup()));

	describe('SystemMessages', () => {
		it('should validate no IDs are duplicated', done => {
			const IDs = new Set();

			for (const [name, systemMessage] of Object.entries(systemMessages)) {
				assert('id' in systemMessage, `Missing ID for system message with name ${name}`);

				const ID = systemMessage.id;
				assert(Number.isInteger(ID), `Found ID is not an integer: ${ID}`);
				assert(!IDs.has(ID), `Found Duplicated ID: ${ID}`);

				IDs.add(ID);
			}

			done();
		});

		it('should validate every word starts with capital letter in header', done => {
			const validateCapitalizedWords = inputString => {
				const words = inputString.split(' ');
				return words.every(word => /^[A-Z]/.test(word));
			};

			const errors = [];

			for (const [name, systemMessage] of Object.entries(systemMessages)) {
				if (systemMessage.header && !validateCapitalizedWords(systemMessage.header))
					errors.push(`The "header" field of systemMessage "${name}" is incorrectly formatted. ` +
						`Expected every word to start with a capital letter, but found "${systemMessage.header}".`);
			}

			assert(!errors.length, errors.join('\n'));
			done();
		});

		it('should validate every systemMessage is used', done => {
			const isKeyUsedInCode = (key, dirPath) => {
				const files = fs.readdirSync(dirPath).filter(f => !f.startsWith('.') && f !== 'node_modules' && f !== 'systemMessages.js');

				for (const file of files) {
					const filePath = path.join(dirPath, file);
					const stat = fs.statSync(filePath);

					if (stat.isDirectory()) {
						if (isKeyUsedInCode(key, filePath))
							return true;

					} else if (file.endsWith('.js')) {
						const content = fs.readFileSync(filePath, 'utf8');
						const regex = new RegExp(`\\b${key}\\b`);

						if (regex.test(content))
							return true;
					}
				}

				return false;
			};

			const projectDir = path.join(__dirname, '../');

			Object.keys(systemMessages).forEach(systemMessage =>
				assert.strictEqual(isKeyUsedInCode(systemMessage, projectDir), true, `The systemMessage "${systemMessage}" is not used anywhere in the code.`));

			done();
		});
	});

	describe('Run Kafka Command', () => {
		const timeoutMs = 10;
		const nonRetriableError = new Error();
		const error = new Error();
		error.retriable = true;
		const retriableError = error;

		const asyncSuccess = async() => {
			await new Promise(resolve => setTimeout(resolve, timeoutMs));
			log.debug(`Success after Waiting ${timeoutMs}ms`);
			return true;
		};

		const asyncThrow = async(retriable) => {
			const error = retriable ? retriableError : nonRetriableError;
			await new Promise(resolve => setTimeout(resolve, timeoutMs));
			log.debug(`Throwing ${retriable ? 'Retriable' : ''} after Waiting ${timeoutMs}ms`);
			throw error;
		};

		it('Successful Execution', async() => {
			const result = await runKafkaCommand(asyncSuccess);
			assert(result);
		});

		it('Non Retriable Error', async() => {
			try {
				await runKafkaCommand(asyncThrow);
				assert();
			} catch (ex) {
				assert(!ex.retriable);
			}
		});

		it('Retriable Error That Fails', async() => {
			try {
				await runKafkaCommand(() => asyncThrow(true));
				assert();
			} catch (ex) {
				assert(ex.retriable);
			}
		});

		it('Retriable Error that Succeed After Retries', async() => {
			let attempt = 0;
			const fn = async() => {
				await new Promise(resolve => setTimeout(resolve, timeoutMs));
				if (attempt < 5) {
					attempt++;
					throw retriableError;
				}
				return true;
			};
			const result = await runKafkaCommand(fn);
			assert(result);
		});

		it('Successful Execution with Arguments', async() => {
			const fn = async(arg1, arg2) => arg1 + arg2;
			const result = await runKafkaCommand(fn, [10, 20]);
			assert.strictEqual(result, 30);
		});

		it('Successful Execution with onSuccessFn', async() => {
			let onSuccessCalled = false;
			const onSuccessFn = () => { onSuccessCalled = true; };
			const result = await runKafkaCommand(asyncSuccess, [], { onSuccessFn });
			assert(result);
			assert(onSuccessCalled, 'onSuccessFn should have been called');
		});

		it('Error thrown in onSuccessFn does not fail the main command execution', async() => {
			const onSuccessFn = () => { throw new Error('Callback failed'); };
			const result = await runKafkaCommand(asyncSuccess, [], { onSuccessFn });
			assert(result);
		});

		it('Successful Execution with custom onErrorFn', async() => {
			let onErrorCalled = false;
			const customError = new Error('Custom error');

			const onErrorFn = () => {
				onErrorCalled = true;
				return false;
			};

			try {
				await runKafkaCommand(() => { throw customError; }, [], { onErrorFn });
				assert.fail('Should have thrown error');
			} catch (ex) {
				assert.strictEqual(ex, customError);
				assert(onErrorCalled, 'onErrorFn should have been called');
			}
		});

		it('Instance ID passed to onErrorFn', async() => {
			const expectedId = 12345;
			const getInstanceID = () => expectedId;
			let capturedId = null;

			const onErrorFn = (ex, id) => {
				capturedId = id;
				return false;
			};

			try {
				await runKafkaCommand(() => { throw new Error(); }, [], {
					getInstanceID,
					onErrorFn
				});
			} catch (e) {
				// ignore
			}

			assert.strictEqual(capturedId, expectedId, 'Instance ID passed to onErrorFn does not match');
		});

		it('Custom retriesLeft configuration', async() => {
			let attempts = 0;
			const fn = async() => {
				attempts++;
				throw retriableError;
			};

			try {
				await runKafkaCommand(fn, [], { retriesLeft: 1, retryDelayMs: 1 });
			} catch (e) {
				// ignore
			}

			assert.strictEqual(attempts, 2, 'Should have attempted exactly twice (1 initial + 1 retry)');
		});
	});
});

