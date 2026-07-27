/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* global angular,CookieManager */
var managementApp = angular.module('managementApp');

managementApp.directive('sortableRow', ['$rootScope', function($rootScope) {
	return {
		restrict: 'A',
		replace: false,
		link: function(scope, element, attributes) {
			scope.sortableRowReload = function() {
				var clone = element.children().toArray();
				var finalColumns = [];
				var columnConfig = CookieManager.getJSON('nvmesh-column-config') || {};
				var columnsToShow = columnConfig[attributes['sortableRow']] || {};

				var constColumns = clone.filter(function(col) { return !col.attributes['column-name']; });

				var sortableColumns = clone
					.filter(function(col) { return (col.nodeName == 'TD' || col.nodeName == 'TH') && col.attributes['column-name']; })
					.reduce(function(acc, currCol) {
						var columnName = currCol.attributes['column-name'].value;
						var cacheCols = Object.keys(columnsToShow);
						var colIndexInCache = cacheCols.findIndex(function(c) { return c === columnName; });

						if (colIndexInCache === -1) {
							acc.push(currCol);
						} else {
							currCol.style.display = columnsToShow[columnName] ? '' : 'none';
							acc.splice(colIndexInCache, 0, currCol);
						}

						return acc;
					}, []);

				finalColumns = constColumns.concat(sortableColumns);

				if (!finalColumns.length)
					finalColumns = clone;

				while (element[0].firstChild) {
					element[0].removeChild(element[0].firstChild);
				}

				finalColumns.forEach(function(col) {
					element[0].appendChild(col);
				});
			};

			scope.sortableRowReload();

			$rootScope.$on('columnsChanged-' + attributes['sortableRow'], scope.sortableRowReload);
		}
	};
}]);
