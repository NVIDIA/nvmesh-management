/* global angular */

var managementApp = angular.module('managementApp');

managementApp.directive('isIndeterminate', function() {
	return {
		restrict: 'A',
		link: function(scope, element, attributes) {
			scope.$watch(attributes['isIndeterminate'], function(value) {
				element[0].indeterminate = Boolean(value);
			});
		}
	};
});