/* global angular */
var managementApp = angular.module('managementApp');

managementApp.component('sortedTilesDiagram', {
	bindings: {
		items: '=',
		onItemClick: '=',
		valueField: '@',
		displayField: '@'
	},
	controller: ['$scope', function($scope) {
		var controller = this;
		$scope.Math = Math;

		//not linear in order to increase the amount of yellow and orange and decrease green.
		controller.percentToRGB = function(percent) {

			if (percent === 100) {
				percent = 99;
			}

			var colors =
			{
				0: '#97D073',
				20: '#00a65a',
				40: '#F9C117',
				60: '#e38d13',
				80: '#E31D38'
			};

			return colors[Math.floor(percent / 20) * 20];
		};
	}],
	controllerAs: 'sortedTilesDiagramCtrl',
	templateUrl: 'javascripts/directives/sortedTilesDiagram.html'
});


