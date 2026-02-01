/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global angular,$ */

var managementApp = angular.module('managementApp');

managementApp.factory('$utils', ['$window', function($window) {
	return {
		tryParseJSON: function(jsonString) {
			try {
				var o = JSON.parse(jsonString);
				this.parseDatetime(o);

				//Handle non-exception-throwing cases:
				if (o && typeof o === 'object' && o !== null)
					return o;
				/* eslint-disable-next-line */
			} catch (e) {}

			return false;
		},
		parseDatetime: function(jsonObj) {
			for (var key in jsonObj) {
				//ISODate format
				var regex = /[\d]{4}-[\d]{2}-[\d]{2}T[\d]{2}:[\d]{2}:[\d]{2}.[\d]{3}Z/;
				if (typeof jsonObj[key] === 'string' || jsonObj[key] instanceof String) {
					if (jsonObj[key].match(regex))
						jsonObj[key] = new Date(jsonObj[key]);
				} else if (typeof jsonObj[key] === 'object' && jsonObj[key] !== null)
					this.parseDatetime(jsonObj[key]);
			}

			return jsonObj;
		},
		getQueryStringObj: function() {
			var queryList = $window.location.search.substr(1).split('&');
			var result = {};

			if (queryList[0] !== '' || queryList.length !== 1) {
				for (var i = 0; i < queryList.length; i++) {
					var query = queryList[i].split('=', 2);
					if (query.length === 1) {
						result[query[0]] = '';
					} else {
						var queryValue = decodeURIComponent(query[1].replace(/\+/g, ' '));
						result[query[0]] = this.tryParseJSON(queryValue) ? this.tryParseJSON(queryValue) : queryValue;
					}
				}
			}

			return result;
		},
		handleResultsFadingAlerts: function(action, entity, results) {
			var $content = $('.content');
			var pastAction;

			if (action.endsWith('e'))
				// create => created, delete => deleted
				pastAction = action + 'd';
			else if (action.endsWith('y'))
				// remove the y and add ied (e.g. apply => applied)
				pastAction = action.substring(0, action.length - 1) + 'ied';
			else {
				// edit => edited
				pastAction = action + 'ed';
			}

			for (var resultIndex in results) {
				var result = results[resultIndex];
				$content.fadingAlert(
					result.success ? 'success' : 'danger',
					result.success
						? entity + ' ' + result._id + ' ' + pastAction + ' successfully.'
						: 'Couldn\'t ' + action + ' ' + entity + ': ' + result._id + '. Error: ' + JSON.stringify(result.error));
			}
		},
		equalInValue: function equalInValue(a, b) {
			if (a === null)
				return b === null;

			if (Array.isArray(a) != Array.isArray(b))
				return false;

			if (typeof a !== typeof b)
				return false;

			if (!(typeof a === 'object'))
				return a == b;

			var aKeys = Object.keys(a);
			for (var i = 0; i < aKeys.length; i++) {
				var key = aKeys[i];
				if (! (key in b))
					return false;

				if (!equalInValue(a[key], b[key]))
					return false;
			}

			return true;
		},
		pipe: function(funcs) {
			return function(value) {
				return funcs.reduce(function(currentValue, currentFunction) { return currentFunction(currentValue); }, value);
			};
		},
		filterData: function(filter) {
			return function(data) {
				function filterObjKeys(obj, filterRegex) {
					return Object.keys(obj).filter(function(key) { return filterRegex.test(obj[key][col]); });
				}

				var col;
				var isDataArray = Array.isArray(data);
				var filteredData = isDataArray ? [] : {};

				if ($.isEmptyObject(filter)) {
					filteredData = data;
				} else {
					col = Object.keys(filter)[0];
					var regex = RegExp(filter[col]['$regex'], 'i');

					if (isDataArray) {
						filteredData = data.filter(function(stat) { return regex.test(stat[col]); });
					} else {
						var filteredKeys = filterObjKeys(data, regex);
						filteredKeys.forEach(function(key) {
							filteredData[key] = data[key];
						});
					}
				}

				return filteredData;
			};
		},
		sortData: function(sort) {
			return function(data) {
				function doSort(values, sortDirection) {
					var sorted = values.sort(function(a, b) { return (a[col] > b[col]) ? 1 : ((b[col] > a[col]) ? -1 : 0); });
					if (sortDirection === -1)
						sorted = sorted.reverse();

					return sorted;
				}

				var col;
				var isDataArray = Array.isArray(data);
				var sortedData = isDataArray ? [] : {};

				if ($.isEmptyObject(sort)) {
					sortedData = data;
				} else {
					col = Object.keys(sort)[0];
					var sortDirection = sort[col];

					if (isDataArray) {
						sortedData = doSort(data, sortDirection);
					} else {
						var sortedKeys = doSort(Object.keys(data), sortDirection);
						sortedKeys.forEach(function(key) {
							sortedData[key] = data[key];
						});
					}
				}

				return sortedData;
			};
		},
		pageData: function(page, count) {
			return function(data) {
				var isDataArray = Array.isArray(data);
				var pagedData = isDataArray ? [] : {};
				var doSlice = function(data) { return data.slice(page * count, page * count + count); };

				if (isDataArray)
					pagedData = doSlice(data);
				else
					doSlice(Object.keys(data)).forEach(function(key) { pagedData[key] = data[key]; });

				return pagedData;
			};
		},
		// Assuming property can be primitive or array of primitives
		arePropertiesDiffer(value1, value2) {
			if (Array.isArray(value1) && Array.isArray(value2)) {
				if (value1.length !== value2.length) return true;
				return value1.some((item, index) => this.arePropertiesDiffer(item, value2[index]));
			}

			return value1 !== value2;
		},
		isEntityUpdated(originalEntity, entityToEdit, updatableProperties) {
			return originalEntity && updatableProperties.some(p => this.arePropertiesDiffer(entityToEdit[p], originalEntity[p]));
		}
	};
}]);
