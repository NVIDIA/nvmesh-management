/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global angular, $ */
var managementApp = angular.module('managementApp');

managementApp.directive('radioSelect', function() {
	return {
		restrict: 'E',
		scope: {
			value: '=',
			disabled: '=?',
			options: '=',
			onChange: '&'
		},
		link: function($scope, $element) {

			$scope.$watch('options', rebuildOptions);

			function rebuildOptions() {
				$element.empty();

				if (!$scope.options)
					return;

				$scope.options.forEach(function(option) {
					let $optText = $('<span class="text"></span>');
					$optText.html(option.text);
					let $input = $('<input name="group_1" type="radio">');
					let $circle = $('<span class="circle"></span>');
					let $optContainer = $('<label class="option"></label>');

					$optContainer.append($optText);
					$optContainer.append($input);
					$optContainer.append($circle);
					$element.append($optContainer);
				});
			}
		}
	};
});
