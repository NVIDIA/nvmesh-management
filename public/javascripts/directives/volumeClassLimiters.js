/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* global angular,WATCHERS*/
var managementApp = angular.module('managementApp');

managementApp.directive('volumeClassLimiters', function($http, $rootScope) {
	return {
		restrict: 'E',
		templateUrl: '/javascripts/directives/volumeClassLimiters.html',
		require: ['^form', 'volumeClassLimiters'],
		scope: {
			volume: '=',
			control: '=',
			volumeCtrl: '=',
			disabled: '=?',
			clear: '=?'
		},
		controller: function($scope) {
			var ctrl = this;

			ctrl.serverClassesSelectize = null;
			ctrl.diskClassesSelectize = null;
			ctrl.domainsSelectize = null;

			ctrl.enable = function() {
				ctrl.serverClassesSelectize && ctrl.serverClassesSelectize.enable();
				ctrl.diskClassesSelectize && ctrl.diskClassesSelectize.enable();
				ctrl.domainsSelectize && ctrl.domainsSelectize.enable();
			};

			ctrl.disable = function() {
				ctrl.serverClassesSelectize && ctrl.serverClassesSelectize.disable();
				ctrl.diskClassesSelectize && ctrl.diskClassesSelectize.disable();
				ctrl.domainsSelectize && ctrl.domainsSelectize.disable();
			};

			ctrl.clear = function() {
				//Clear old remains of servers from the selectize if exists.
				if (ctrl.serverClassesSelectize)
					ctrl.serverClassesSelectize.clear();

				if (ctrl.diskClassesSelectize)
					ctrl.diskClassesSelectize.clear();

				if (ctrl.domainsSelectize)
					ctrl.domainsSelectize.clear();

				return true;
			};

			WATCHERS.push($scope.$watch('clear', function() {
				if ($scope.clear) {
					ctrl.clear();
					$scope.clear = false;
				}
			}));

			WATCHERS.push($scope.$watch('disabled', function() {
				if ($scope.disabled)
					ctrl.disable();
				else
					ctrl.enable();
			}));

			WATCHERS.push($scope.$watch('volumeCtrl.editMode', function(editMode) {
				if (ctrl.domainsSelectize)
					if (editMode)
						ctrl.domainsSelectize.disable();
					else
						ctrl.domainsSelectize.enable();
			}));

			WATCHERS.push($scope.$watch('volume', function(newValue) {
				if (newValue) {
					if (ctrl.serverClassesSelectize && ctrl.diskClassesSelectize && ctrl.domainsSelectize) {
						ctrl.clear();
						ctrl.addItems();
					}
				}
			}));

			ctrl.addItems = function() {
				if (!$scope.volume)
					return;
				ctrl.serverClassesSelectize.addItems($scope.volume.serverClasses);
				ctrl.diskClassesSelectize.addItems($scope.volume.diskClasses);
				ctrl.domainsSelectize.addItems($scope.volume.domain);
			};
		},
		link: function($scope, $element, attr, ctrls) {
			$scope.form = ctrls[0];
			var ctrl = ctrls[1];

			$scope.initSelectizes = function() {
				Promise.all([
					$scope.initServerClassSelectize(),
					$scope.initDiskClassSelectize(),
					$scope.initDomainSelectize()
				]).then(() => {
					ctrl.addItems();
					$scope.volumeCtrl.getDisks();

					if ($scope.disabled)
						ctrl.disable();
				});
			};

			$scope.initServerClassSelectize = function() {
				return new Promise(function(resolve, reject) {
					$http.get('/serverClasses/all/0/0').success(function(data) {
						ctrl.serverClassesSelectize = $element.find('#serverClassesSelect').selectize({
							create: false,
							onChange: function(e) {
								$rootScope.$evalAsync(function() {
									$scope.volume.serverClasses = e;
									$scope.volumeCtrl.getDisks();
								});
							}
						})[0].selectize;

						//Add available options
						ctrl.serverClassesSelectize.addOption(data.map(function(d) { return { text: d._id, value: d._id }; }));

						resolve();
					}).error(reject);
				});
			};

			$scope.initDiskClassSelectize = function() {
				return new Promise(function(resolve, reject) {
					$http.get('/diskClasses/all/0/0').success(function(data) {
						ctrl.diskClassesSelectize = $element.find('#diskClassesSelect').selectize({
							create: false,
							onChange: function(e) {
								$rootScope.$evalAsync(function() {
									$scope.volume.diskClasses = e;
									$scope.volumeCtrl.getDisks();
								});
							}
						})[0].selectize;

						//Add available options
						ctrl.diskClassesSelectize.addOption(data.map(function(d) { return { text: d._id, value: d._id }; }));
						resolve();
					}).error(reject);
				});
			};

			$scope.initDomainSelectize = function() {
				return new Promise(function(resolve, reject) {
					$http.get('/serverClasses/getDomains').success(updateDomainsSelectize).error(reject);
					$http.get('/diskClasses/getDomains').success(updateDomainsSelectize).error(reject);

					function updateDomainsSelectize(data) {
						ctrl.domainsSelectize = $element.find('#domainsSelect').selectize({
							create: false,
							onChange: function(e) {
								$rootScope.$evalAsync(function() {
									if (e)
										$scope.volume.domain = e;
									else 
										delete $scope.volume.domain;
								});
							}
						})[0].selectize;

						//Add available options
						ctrl.domainsSelectize.addOption(data.map(function(d) { return { text: d, value: d }; }));
						resolve();
					}
				});
			};

			$scope.initSelectizes();
		}
	};
});
