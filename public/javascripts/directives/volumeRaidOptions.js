/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* global angular,consts,$,WATCHERS*/
var managementApp = angular.module('managementApp');

managementApp.directive('volumeRaidOptions', function($http) {
	return {
		restrict: 'E',
		templateUrl: '/javascripts/directives/volumeRaidOptions.html',
		require: ['^form', 'volumeRaidOptions'],
		scope: {
			volume: '=',
			availableMirrors: '=',
			mirrorsCountValid: '=',
			disabled: '=?',
			onChange: '&?',
			control: '='
		},
		controller: function($scope, $timeout) {
			var ctrl = this;

			$scope.$timeout = $timeout;
			$scope.consts = consts;

			$scope.isElectDisabled = true;
			$http.get('/generalSettings/isElectDisabled').success(res => {
				$scope.isElectDisabled = res.isElectDisabled;
			});

			$scope.control.removeRedundantFields = function() {
				switch ($scope.volume.RAIDLevel) {
					case consts.RAIDLevel.MIRRORED_RAID_1:
						delete $scope.volume.stripeWidth;
						delete $scope.volume.stripeSize;

						break;
					case consts.RAIDLevel.ERASURE_CODING:
						//As we aren't current exposing this field, and we'll be using it
						// in the future, all the BL taking it into consideration
						$scope.volume.stripeWidth = 1;
					/* eslint-disable-next-line no-fallthrough */
					case consts.RAIDLevel.STRIPED_ERASURE_CODING:
					case consts.RAIDLevel.STRIPED_RAID_0:
						delete $scope.volume.numberOfMirrors;

						break;
					case consts.RAIDLevel.CONCATENATED:
						delete $scope.volume.numberOfMirrors;
						delete $scope.volume.stripeWidth;
						delete $scope.volume.stripeSize;

						break;
				}


				if (!$scope.control.isECAllocation()) {
					delete $scope.volume.parityBlocks;
					delete $scope.volume.dataBlocks;
					delete $scope.volume.protectionLevel;
				}

				delete $scope.volume.raid1NodeSeparationString;
			};

			$scope.control.isECAllocation = function() {
				return $scope.volume.RAIDLevel === consts.RAIDLevel.ERASURE_CODING || $scope.volume.RAIDLevel === consts.RAIDLevel.STRIPED_ERASURE_CODING;
			};

			$scope.control.isCRCCheckEnabled = 	function() {
				return $scope.volume.enableCrcCheck;
			};

			ctrl.requiredTargetsForEC = function(separation) {
				var dataBlocks = parseInt($scope.volume.dataBlocks);
				var parityBlocks = parseInt($scope.volume.parityBlocks);
				var requiredMirrors = 1;
				separation = separation || $scope.volume.protectionLevel;

				switch (separation) {
					case consts.ecSeparationTypes.FULL:
						requiredMirrors = dataBlocks + parityBlocks;
						break;
					case consts.ecSeparationTypes.MINIMAL:
						requiredMirrors = Math.ceil(((dataBlocks + parityBlocks) / parityBlocks));
						break;
					case consts.ecSeparationTypes.IGNORE:
					default:
						requiredMirrors = 1;
				}

				return requiredMirrors;
			};

			ctrl.reEvaluateMirrorsCountValidity = function() {
				var hasEnoughMirrors;
				switch ($scope.volume.RAIDLevel) {
					case consts.RAIDLevel.ERASURE_CODING:
					case consts.RAIDLevel.STRIPED_ERASURE_CODING:
					case consts.RAIDLevel.ELECT:
						var requiredTargets = ctrl.requiredTargetsForEC();
						hasEnoughMirrors = ($scope.availableMirrors >= requiredTargets - 1);
						break;
					case consts.RAIDLevel.MIRRORED_RAID_1:
					case consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10:
						hasEnoughMirrors = ($scope.availableMirrors >= $scope.volume.numberOfMirrors) || $scope.volume.ignoreNodeSeparation;
						break;
					default:
						hasEnoughMirrors = true;
				}

				$scope.form.$setValidity('hasEnoughMirrors', !!hasEnoughMirrors);
			};

			ctrl.updateIgnoreNodeSeparation = function() {
				$scope.volume.ignoreNodeSeparation = ($scope.volume.raid1NodeSeparationString == 'ignore');
			};

			WATCHERS.push($scope.$watch('volume.raid1NodeSeparationString', function(newValue) {
				if (newValue)
					ctrl.updateIgnoreNodeSeparation();
			}));

			WATCHERS.push($scope.$watch('volume.protectionLevel', function(newValue) {
				if (newValue)
					ctrl.reEvaluateMirrorsCountValidity();
			}));

			WATCHERS.push($scope.$watch('volume.stripeWidth', function(newValue) {
				if (newValue)
					$scope.updateECSeparationValues();
			}));

			WATCHERS.push($scope.$watch('volume.dataBlocks', function(newValue) {
				if (newValue) {
					$scope.updateECSeparationValues();
				}
			}));

			WATCHERS.push($scope.$watch('volume.parityBlocks', function(newValue) {
				if (newValue)
					$scope.updateECSeparationValues();
			}));

			WATCHERS.push($scope.$watch('volume.RAIDLevel', function(newValue) {
				if (newValue)
					$scope.raidLevelChanged();
			}));

			WATCHERS.push($scope.$watchGroup([
				'volume.parityBlocks',
				'volume.dataBlocks',
				'volume.numberOfMirrors',
				'availableMirrors',
				'volume.RAIDLevel',
				'volume.ignoreNodeSeparation'], function() {
				ctrl.reEvaluateMirrorsCountValidity();
			}));
		},
		link: function($scope, $element, attr, ctrls) {
			$scope.form = ctrls[0];
			var ctrl = ctrls[1];

			var targetRedundancySelectize;

			$scope.init_ecSeparation = function() {
				targetRedundancySelectize = $('#select_ecSeparation');
				targetRedundancySelectize.selectize({
					valueField: 'value',
					labelField: 'name',
					create: false,
					options: [
						{
							value: consts.ecSeparationTypes.FULL,
							name: 'N+2 Target Redundancy',
							description: 'Only one volume segment per target. Survive up to two target failures'
						},
						{
							value: consts.ecSeparationTypes.MINIMAL,
							name: 'N+1 Target Redundancy',
							description: 'Up to two volume segments per target. Survive one target failure'
						},
						{
							value: consts.ecSeparationTypes.IGNORE,
							name: 'No Target Redundancy',
							description: 'No restriction on volume segments per target. May not survive even one target failure.'
						},
					],
					render: {
						option: function(item, escape) {
							return '<div>' +
						'<strong>' + item.name + '</strong>' +
						'<br/>' +
						'<small>' + escape(item.description) + '</small>' +
					'</div>';
						}
					}
				});

				// set the initial option from the model
				targetRedundancySelectize[0].selectize.setValue($scope.volume.protectionLevel, false);
				$scope.updateECSeparationValues();

				if ($scope.disabled)
					targetRedundancySelectize[0].selectize.disable();
			};

			$scope.init_raid1NodeSeparation = function() {
				var raid1nodeSeparationSelectize = $('#select_radi1NodeSeparation');
				raid1nodeSeparationSelectize.selectize({
					valueField: 'value',
					labelField: 'name',
					create: false,
					options: [
						{
							value: 'enforce',
							name: '1+1 Target Node Separation',
							description: 'Mirrored volume segments on different targets. Survive one target failure.'
						},
						{
							value: 'ignore',
							name: 'No Target Redundancy',
							description: 'No restriction on volume segments per target. May not survive even one target failure.'
						},
					],
					render: {
						option: function(item, escape) {
							return '<div>' +
						'<strong>' + item.name + '</strong>' +
						'<br/>' +
						'<small>' + escape(item.description) + '</small>' +
					'</div>';
						}
					}
				});

				// set the initial option from the model
				var initialValue = $scope.volume.ignoreNodeSeparation ? 'ignore' : 'enforce';
				raid1nodeSeparationSelectize[0].selectize.setValue(initialValue, false);

				if ($scope.disabled)
					raid1nodeSeparationSelectize[0].selectize.disable();
			};

			$scope.updateECSeparationValues = function() {
				var targetRedundancySelectize = $('#select_ecSeparation')[0];
				if (!$scope.disabled && targetRedundancySelectize) {
					var selectize = targetRedundancySelectize.selectize;
					var parityBlocks = parseInt($scope.volume.parityBlocks);
					var isSingleParity = parityBlocks === 1;

					$scope.$timeout(function() {
						if (isSingleParity) {
							selectize.removeOption(consts.ecSeparationTypes.FULL);
						} else {
							if (!selectize.options['Full Separation']) {
								selectize.addOption({
									value: consts.ecSeparationTypes.FULL,
									name: 'N+2 Target Redundancy',
									description: 'Only one volume segment per target. Survive up to two target failures'
								});

								selectize.options['Full Separation'].$order = 0;
							}

							selectize.updateOption(consts.ecSeparationTypes.FULL, {
								value: consts.ecSeparationTypes.FULL,
								name: 'N+2 Target Redundancy',
								description: 'Only one volume segment per target. Survive up to two target failures (min. '
								+ ctrl.requiredTargetsForEC(consts.ecSeparationTypes.FULL) + ' targets).'
							});
						}

						selectize.updateOption(consts.ecSeparationTypes.MINIMAL, {
							value: consts.ecSeparationTypes.MINIMAL,
							name: 'N+1 Target Redundancy',
							description: 'Up to two volume segments per target. Survive one target failure (min. '
						+ ctrl.requiredTargetsForEC(consts.ecSeparationTypes.MINIMAL) + ' targets).'
						});

						selectize.refreshOptions(false);

						var selectedValue;
						if ($scope.volume.protectionLevel && $scope.volume.protectionLevel in selectize.options)
							selectedValue = $scope.volume.protectionLevel;
						else
							selectedValue = isSingleParity ? consts.ecSeparationTypes.MINIMAL : consts.ecSeparationTypes.FULL;

						targetRedundancySelectize.selectize.setValue(selectedValue, false);
					});
				}
			};

			$scope.raidLevelChanged = function() {
				$scope.setDefaultEnableCrcCheck();
			};

			$scope.setDefaultEnableCrcCheck = function() {
				if ($scope.volume.enableCrcCheck != undefined)
					return;

				switch ($scope.volume.RAIDLevel) {
					case consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10:
					case consts.RAIDLevel.MIRRORED_RAID_1:
						$scope.volume.enableCrcCheck = false;
						break;
					case consts.RAIDLevel.ERASURE_CODING:
					case consts.RAIDLevel.STRIPED_ERASURE_CODING:
						$scope.volume.enableCrcCheck = true;
						break;
					case consts.RAIDLevel.STRIPED_RAID_0:
					case consts.RAIDLevel.CONCATENATED:
						delete $scope.volume.enableCrcCheck;
						break;
				}
			};
		}
	};
});
