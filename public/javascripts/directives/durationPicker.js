/* global angular */
var managementApp = angular.module('managementApp');

managementApp.component('durationPicker', {
	bindings: {
		seconds: '=?',
		minutes: '=?',
		hours: '=?',
		days: '=?',
		model: '='
	},
	controller: ['$scope', function($scope) {
		var controller = this;
		$scope.Math = Math;

		controller.calcTime = function(){

			controller.selectedSeconds = Math.floor(controller.selectedSeconds);

			if (!controller.seconds)
				controller.selectedMinutes = Math.floor(controller.selectedMinutes);

			if (!controller.minutes)
				controller.selectedHours = Math.floor(controller.selectedHours);

			if (!controller.hours)
				controller.selectedDays = Math.floor(controller.selectedDays);


			controller.model = controller.selectedSeconds +
							controller.selectedMinutes * 60 +
							controller.selectedHours * 3600 +
							controller.selectedDays * 86400;

			setDisplay();
		};

		var setDisplay = function() {

			controller.selectedDays = Math.floor(controller.model / 86400);

			if (controller.hours)
				controller.selectedHours = Math.floor((controller.model % 86400) / 3600);

			if (controller.minutes)
				controller.selectedMinutes = Math.floor((controller.model % 3600) / 60);

			if (controller.seconds)
				controller.selectedSeconds = controller.model % 60;
		};

		if (controller.model)
			setDisplay();
		else {
			controller.selectedDays = 0;
			controller.selectedHours = 0;
			controller.selectedMinutes = 0;
			controller.selectedSeconds = 0;
		}

		$scope.$watch('durationPickerCtrl.model', function(newVal, oldVal) {
			if (controller.model && controller.model != oldVal)
				setDisplay();
		});

	}],
	controllerAs: 'durationPickerCtrl',
	templateUrl: 'javascripts/directives/durationPicker.html'
});


