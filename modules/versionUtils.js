/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../consts.js');

function parseVersionString(input) {
	const result = { packageName: '', baseVersion: '', releaseNumber: '', distTag: '', buildNumber: '', arch: '', extension: '' };

	if (!input || typeof input !== 'string')
		return result;

	const match = input.match(consts.versionStringRegex);
	if (!match)
		return result;

	result.packageName = match[1] || '';
	result.baseVersion = match[2] || '';
	result.releaseNumber = match[3] || '';
	result.distTag = match[4] || '';
	result.buildNumber = match[5] || '';
	result.arch = match[6] || '';
	result.extension = match[7] || '';

	return result;
}

function getVRPartsObj(versionRelease) {
	var parts = versionRelease.split('-');
	return {
		'version': parts[0],
		'release': parts[1]
	};
}

function isAlphaNumeric(char) {
	var anPattern = new RegExp(/^[a-z0-9]+$/i);
	return char.match(anPattern);
}

function isAlpha(char) {
	var anPattern = new RegExp(/^[a-z]+$/i);
	return char.match(anPattern);
}

function compareV(v1, v2) {
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

function compareVersionRelease(vr1, vr2) {
	var vr1PartsObj = getVRPartsObj(vr1);
	var vr2PartsObj = getVRPartsObj(vr2);

	var versionCompareResult = compareV(vr1PartsObj.version, vr2PartsObj.version);

	if (versionCompareResult == 0)
		return compareV(vr1PartsObj.release, vr2PartsObj.release);
	else
		return versionCompareResult;
}

function compareVersions(vr1, vr2) {
	return compareV(vr1, vr2);
}

module.exports = {
	parseVersionString,
	getVRPartsObj,
	compareVersionRelease,
	compareVersions,
};
