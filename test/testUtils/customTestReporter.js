/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const Mocha = require('mocha');
const {
	EVENT_RUN_BEGIN,
	EVENT_RUN_END,
	EVENT_TEST_FAIL,
	EVENT_TEST_PASS,
	EVENT_SUITE_BEGIN,
	EVENT_SUITE_END
} = Mocha.Runner.constants;

const colors = {
	Reset: '\x1b[0m',
	Bright: '\x1b[1m',
	Dim: '\x1b[2m',
	Underscore: '\x1b[4m',
	Blink: '\x1b[5m',
	Reverse: '\x1b[7m',
	Hidden: '\x1b[8m',
	fg: {
		Black: '\x1b[30m',
		Red: '\x1b[31m',
		Green: '\x1b[32m',
		Yellow: '\x1b[33m',
		Blue: '\x1b[34m',
		Magenta: '\x1b[35m',
		Cyan: '\x1b[36m',
		White: '\x1b[37m',
		Crimson: '\x1b[38m'
	},
	bg: {
		Black: '\x1b[40m',
		Red: '\x1b[41m',
		Green: '\x1b[42m',
		Yellow: '\x1b[43m',
		Blue: '\x1b[44m',
		Magenta: '\x1b[45m',
		Cyan: '\x1b[46m',
		White: '\x1b[47m',
		Crimson: '\x1b[48m'
	}
};

// this reporter outputs test results, indenting two spaces per suite
class CustomTestReporter {
	constructor(runner) {
		this._indents = 0;
		const stats = runner.stats;

		runner
			.once(EVENT_RUN_BEGIN, () => {
				console.log('🐴👀');
			})
			.on(EVENT_SUITE_BEGIN, (suite) => {
				this.increaseIndent();
				console.log(`\n${this.indent()}${suite.title}`);
			})
			.on(EVENT_SUITE_END, () => {
				this.decreaseIndent();
			})
			.on(EVENT_TEST_PASS, test => {
				let pre = `${colors.fg.Green}${this.indent()} ✔ ${colors.Reset}`;
				let base = `${colors.Dim}${test.title}${colors.Reset}`;
				let post = `${colors.fg.Yellow}${test.testResultsReport ? test.testResultsReport.getFormattedResults() : ''}${colors.Reset}`;

				console.log(pre, base, post);
			})
			.on(EVENT_TEST_FAIL, (test, err) => {
				console.log(`${this.indent()}fail: ${test.fullTitle()} - error: ${err.message}`);
			})
			.once(EVENT_RUN_END, () => {
				console.log(`end: ${stats.passes}/${stats.passes + stats.failures} ok`);
			});
	}

	indent() {
		return Array(this._indents).join('  ');
	}

	increaseIndent() {
		this._indents++;
	}

	decreaseIndent() {
		this._indents--;
	}
}

module.exports = CustomTestReporter;
