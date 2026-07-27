class TestResultsReport {
	constructor() {
		this.testResultsObj = {};
	}

	updateTestResults(key, val) {
		this.testResultsObj[key] = val;
	}

	getFormattedResults() {
		let results = '|';

		if (this.testResultsObj.moreInfo)
			results += ` ${this.testResultsObj.moreInfo} |`;

		if (this.testResultsObj.time)
			results += ` (${this.testResultsObj.time}ms)`;

		return results;
	}
}

exports.TestResultsReport = TestResultsReport;