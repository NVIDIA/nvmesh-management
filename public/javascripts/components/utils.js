/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global consts */

export function getProperty(obj, path) {
	return path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), obj);
}
export function setProperty(obj, path, value) {
	let temp = obj;
	const keys = path.split('.');

	keys.slice(0, -1).forEach(k => {
		if (!Object.hasOwn(temp, k)) temp[k] = {}; // Ensure the key exists
		temp = temp[k];
	});

	temp[keys[keys.length - 1]] = value;
}

export function keyBy(array, keyFn) {
	if (!Array.isArray(array)) {
		throw new TypeError('Expected an array as the first argument');
	}
	if (typeof keyFn !== 'function') {
		throw new TypeError('Expected a function as the second argument');
	}

	return array.reduce((acc, item) => {
		const key = keyFn(item);
		acc[key] = item;
		return acc;
	}, {});
}

export function groupBy(array, keyFun) {
	return array.reduce((acc, curr) => {
		const key = keyFun(curr);
		(acc[key] = acc[key] || []).push(curr);
		return acc;
	}, {});
}

export function extractErrorMsg(responseError) {
	if (typeof responseError !== 'object') {
		return responseError;
	}
	if (responseError.innerMessage) {
		return `${responseError.message}${
			` - ${
				typeof responseError.innerMessage === 'object'
					? responseError.innerMessage.message
					: responseError.innerMessage
			}`
		}`;
	}

	return responseError.message;
}

export function extractResults(responses) {
	const responsesBySuccess = groupBy(responses, response => response.success ? 'success' : 'failed');
	responsesBySuccess.success = responsesBySuccess.success || [];
	responsesBySuccess.failed = responsesBySuccess.failed || [];

	responsesBySuccess.failed = groupBy(responsesBySuccess.failed, response => extractErrorMsg(response.error));

	return responsesBySuccess;
}

/**
 * This function delays the execution of a function by `interval`
 * and makes sure that the function is not called more than once in the duration of `interval`.
 * If multiple calls were made in the duration of `interval` only the last `func` will be called.
 *
 * If no initial delay is needed, please use the function `throttle` instead.
 */
export function debounce(f, interval) {
	let timer = null;

	function debouncedFunction(...args) {
		clearTimeout(timer);

		return new Promise((resolve, reject) => {
			timer = setTimeout(async() => {
				try {
					resolve(await f(...args));
				} catch (error) {
					reject(error);
				}
			}, interval);
		});
	}

	debouncedFunction.cancel = () => {
		clearTimeout(timer);
		timer = null;
	};

	return debouncedFunction;
}

/**
 * This function ensures that `fetchFunc` is not called more than once every `minWaitMS`.
 * If multiple calls were made in the duration of `minWaitMS` only the last call `fetchFunc` will be executed.
 * `fetchFunc` should not accept any parameters or a callback, and not all calls to this function will be executed.
 */
export function throttledFetch(fetchFunc, minWaitMS) {
	let suppressTimer = null;
	let shouldRunAgain = false;

	function throttledFunction() {
		if (suppressTimer) {
			shouldRunAgain = true;
			return;
		}

		// no timer, so we can call the function immediately
		try {
			fetchFunc();
		} catch (error) {
			console.error(error);
		}

		suppressTimer = setTimeout(() => {
			suppressTimer = null;
			shouldRunAgain = false;

			if (shouldRunAgain) {
				throttledFunction();
			}
		}, minWaitMS);
	}

	return throttledFunction;
}

export const getConfigProfileVersion = (configProfile, isShort) => {
	if (!configProfile || !(configProfile.id || configProfile.uuid) || !configProfile.name)
		return 'Unavailable';

	if (isShort) {
		return `${configProfile.name} (${configProfile.version})`;
	} else
		return `Profile: "${configProfile.name}" Version: ${configProfile.version}`;
};

export const ellipsis = (text, maxLength = 50) =>{
	return text && text.length > maxLength ? text.substring(0, maxLength + 1) + '...' : text;
};


export function toPercent(free, total) {
	if (!total) return 0;
	return Math.round((free / total) * 100);
}

export function partition(array, isValid) {
	return array.reduce(([pass, fail], elem) => {
		return isValid(elem) ? [[...pass, elem], fail] : [pass, [...fail, elem]];
	}, [[], []]);
}

export const isEqualSet = (a, b) =>
	a instanceof Set && b instanceof Set &&
	a.size === b.size &&
	[...a].every(value => b.has(value));

//Return A-B
export const difference = (setA, setB) => new Set([...setA].filter(x => !setB.has(x)));

export const pipe = funcs => {
	return value => {
		return funcs.reduce((currentValue, currentFunction) => { return currentFunction(currentValue); }, value);
	};
};

// This is a copy of the function in versionUtils.js
export const parseVersionString = (input) => {
	const result = { packageName: '', baseVersion: '', releaseNumber: '', distTag: '', buildNumber: '', arch: '', extension: '' };

	if (!input || typeof input !== 'string') return result;

	const match = input.match(consts.versionStringRegex);
	if (!match) return result;

	result.packageName = match[1] || '';
	result.baseVersion = match[2] || '';
	result.releaseNumber = match[3] || '';
	result.distTag = match[4] || '';
	result.buildNumber = match[5] || '';
	result.arch = match[6] || '';
	result.extension = match[7] || '';
	return result;
};

export const getBaseVersion = (version) => {
	return parseVersionString(version).baseVersion;
};


function isAlphaNumeric(char) {
	var anPattern = new RegExp(/^[a-z0-9]+$/i);
	return char.match(anPattern);
}

function isAlpha(char) {
	var anPattern = new RegExp(/^[a-z]+$/i);
	return char.match(anPattern);
}

/**
 * Validates a version string that can be either a basic version string or a valid regex pattern
 * @param {string} value - The version string to validate
 * @returns {boolean|string} - Returns true if valid, or an error message string if invalid
 */
export function validateVersion(value) {
	if (!value) return 'Version is required';

	// Check if it's enclosed between forward slashes (regex pattern)
	if (value.startsWith('/') && value.endsWith('/') && value.length > 2) {
		const regexContent = value.slice(1, -1); // Remove the surrounding slashes

		// Don't allow empty regex content
		if (!regexContent.trim()) {
			return 'Regex pattern cannot be empty';
		}

		// Check if it's a valid regex pattern
		try {
			new RegExp(regexContent);
			return true; // Valid regex
		} catch (e) {
			return 'Invalid regex pattern';
		}
	}

	// Not enclosed in slashes, check if it matches the basic version pattern
	if (/^[a-zA-Z0-9_.-]*$/.test(value)) {
		return true; // Valid basic version string
	}

	return 'Version must be either a valid version string (alphanumeric, dots, dashes, underscores) ' +
		'or a valid regex pattern enclosed in forward slashes (/pattern/)';
}

export function compareV(v1, v2) {
	/* easy comparison to see if versions are identical */
	if (v1 == v2)
		return 0;

	var isNum;
	var v1Idx = 0;
	var v2Idx = 0;
	var str1Idx;
	var str2Idx;

	/* loop through each version segment of str1 and str2 and compare them */
	while (v1Idx < v1.length || v2Idx < v2.length) {
		while (v1Idx < v1.length && !isAlphaNumeric(v1[v1Idx]) && v1[v1Idx] != '~' && v1[v1Idx] != '^')
			v1Idx++;
		while (v2Idx < v2.length && !isAlphaNumeric(v2[v2Idx]) && v2[v2Idx] != '~' && v2[v2Idx] != '^')
			v2Idx++;

		/* handle the tilde separator, it sorts before everything else */
		if (v1[v1Idx] == '~' || v2[v2Idx] == '~') {
			if (v1[v1Idx] != '~') return 1;
			if (v2[v2Idx] != '~') return -1;
			v1Idx++;
			v2Idx++;
			continue;
		}

		/*
		* Handle caret separator. Concept is the same as tilde,
		* except that if one of the strings ends (base version),
		* the other is considered as higher version.
		*/
		if (v1[v1Idx] == '^' || v2[v2Idx] == '^') {
			if (v1Idx == v1.length) return -1;
			if (v2Idx == v2.length) return 1;
			if (v1[v1Idx] != '^') return 1;
			if (v2[v2Idx] != '^') return -1;
			v1Idx++;
			v2Idx++;
			continue;
		}

		/* If we ran to the end of either, we are finished with the loop */
		if (v1Idx == v1.length || v2Idx == v2.length)
			break;

		str1Idx = v1Idx;
		str2Idx = v2Idx;

		/* grab first completely alpha or completely numeric segment */
		/* leave v1Idx and v2Idx pointing to the start of the alpha or numeric */
		/* segment and walk str1Idx and str2Idx to end of segment */
		if (!isNaN(v1[str1Idx])) {
			while (str1Idx < v1.length && !isNaN(v1[str1Idx])) str1Idx++;
			while (str2Idx < v2.length && !isNaN(v2[str2Idx])) str2Idx++;
			isNum = true;
		} else {
			while (str1Idx < v1.length && isAlpha(v1[str1Idx])) str1Idx++;
			while (str2Idx < v2.length && isAlpha(v2[str2Idx])) str2Idx++;
			isNum = false;
		}

		/* this cannot happen, as we previously tested to make sure that */
		/* the first string has a non-null segment */
		if (v1Idx == str1Idx)
			return -1;	/* arbitrary */

		/* take care of the case where the two version segments are */
		/* different types: one numeric, the other alpha (i.e. empty) */
		/* numeric segments are always newer than alpha segments */
		/* XXX See patch #60884 (and details) from bugzilla #50977. */
		if (v2Idx == str2Idx)
			return (isNum ? 1 : -1);

		var v1SegStr = v1.substring(v1Idx, str1Idx);
		var v2SegStr = v2.substring(v2Idx, str2Idx);

		if (isNum) {
			v1SegStr = parseInt(v1SegStr);
			v2SegStr = parseInt(v2SegStr);
		}

		/* will return which one is greater - even if the two */
		/* segments are alpha or if they are numeric.  don't return  */
		/* if they are equal because there might be more segments to */
		/* compare */
		if (v1SegStr != v2SegStr) {
			return v1SegStr < v2SegStr ? -1 : 1;
		}

		v1Idx = str1Idx;
		v2Idx = str2Idx;
	}

	/* this catches the case where all numeric and alpha segments have */
	/* compared identically but the segment separating characters were */
	/* different */
	if (v1Idx == v1.length && v2Idx == v2.length)
		return 0;

	/* whichever version still has characters left over wins */
	if (v1Idx == v1.length)
		return -1;
	else
		return 1;
}

/**
 * Copies properties from a source object to a new object, but only if they are defined in the source.
 * @param {Object} item - The source object.
 * @param {Array} allowedProperties - An array of property names to copy.
 * @returns {Object} A new object containing the copied properties.
 */
export function copyDefinedProperties(item, allowedProperties) {
	const apiItem = {};

	allowedProperties.forEach(property => {
		if (item[property] !== undefined)
			apiItem[property] = item[property];
	});

	return apiItem;
}
