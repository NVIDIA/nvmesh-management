/* global angular */

var managementApp = angular.module('managementApp');

managementApp.directive('multiSelectBalloon', [function() {
	return { restrict: 'A',
		scope: {
			allPagesSelected: '=',
			isAllSelected: '=',
			totalItems: '=',
			currentlySelected: '='
		},
		replace: true,
		templateUrl: '/javascripts/directives/multiSelectBalloon.html',
		bindToController: true,
		controllerAs: 'multiSelectBallonCtrl',
		controller: ('multiSelectBallonController', ['$scope', function($scope) {
			var controller = this;
			controller.clearSelection = function() {
				$scope.$applyAsync();
			};

			controller.shouldShow = function() {
				if (controller.allPagesSelected == null)
					return false;

				if (controller.isAllSelected && controller.currentlySelected != controller.totalItems)
					return true;
				else {
					controller.allPagesSelected = false;
					return false;
				}
			};
		}
		]) };
}]);