/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global angular,$,consts */

var managementApp = angular.module('managementApp', ['ui.bootstrap', 'ipCookie', 'angular-progress-arc', 'treeGrid']);

managementApp.controller('managementController', [
	'ipCookie',
	'$rootScope',
	'$http',
	'$confirm',
	'$context',
	'$alert',
	'$q',
	'keysPressedService',
	function($cookies, $rootScope, $http, $confirm, $context, $alert, $q, keysPressedService) {
		var controller = this;
		controller.user = $context.user;
		controller.userToChange;
		controller.keysPressedService = keysPressedService;
		var isCurrentlyAlive = true;

		controller.keyDown = function(event) {
			if (event.which === consts.SHIFT_KEY_CODE) {
				keysPressedService.shiftDown();
			}
		};

		controller.keyUp = function(event) {
			if (event.which === consts.SHIFT_KEY_CODE) {
				keysPressedService.shiftUp();
			}
		};

		var idleTimeout;

		$http.get('/login/inActivityThreshold').success(function(data) {
			var inActivityThreshold = data;
			resetTimer();

			['onmousemove', 'onmousedown', 'onclick', 'onscroll', 'onkeypress'].forEach(function(event) {
				window[event] = resetTimer;
			});

			function resetTimer() {
				if (idleTimeout)
					clearTimeout(idleTimeout);

				idleTimeout = setTimeout(function() { logout(); }, inActivityThreshold);
			}

			function logout() {
				checkIfAlive(() => {
					if (isCurrentlyAlive)
						window.location.href = '/login/logout';
					else // in case there is no connection to the server try logging out later
						resetTimer();
				});
			}
		});

		$('#firstLoginModal').on('shown.bs.modal', function() {
			var passwordFocusInterval = setInterval(function() {
				$('#password').focus();
				clearInterval(passwordFocusInterval);
			}, 1000);
		});

		$http.get('/config/get/server.auth.authenticationMethod').success(function(data) {
			$rootScope.isMTLS = data === consts.HTTPSServerAuthenticationMethods.MTLS;
		});

		$http.get('/users/checkDefaultPassword').success(function(data) {
			if (data && data.length) {
				var changePassword = data.filter(function(e) { return e.id !== consts.ADMIN_USER; });

				if (changePassword.length)
					controller.userToChange = changePassword[0];
				else {
					controller.userToChange = data[0];
					controller.userToChange.isAdmin = true;
				}

				$('#firstLoginModal').modal('show');
			}
		});

		if (controller.user.isAdmin) {
			$http.get('/nvmeshMetadata/clusterID').success(function(clusterID) {
				if (!clusterID) {
					$('#clusterID').modal('show');
				} else if (clusterID.needReconfirm) {
					controller.clusterID = clusterID.id;
					$('#clusterIDReconfirm').modal('show');
				}
			});
			$http.get('/users/getPhoneHomeUser').success(function(data) {
				if (data && data.email === consts.defaultEmail) {
					controller.phoneHome = data;
					$('#customerName').modal('show');
				}
			});
		}

		controller.saveCustomerName = function() {
			controller.phoneHome.email = consts.defaultEmail.replace(RegExp('\\+.*@'), '+' + controller.customerName + '@');
			$http.post('/users/update', [controller.phoneHome]).success(function(data) {
				var $content = $('.content');
				if (!data[0] || !data[0].success)
					$content.fadingAlert('danger', 'Failed to save Customer Name.');
			});

			$('#customerName').modal('hide');
		};

		controller.saveClusterID = function(isReconfirm) {
			$http.post('/nvmeshMetadata/updateClusterID', { clusterID: controller.clusterID }).success(function(data) {
				var $content = $('.content');
				if (data.success) {
					$content.fadingAlert('success', 'Successfully saved the cluster ID.');
					$rootScope.clusterID = controller.clusterID;

				} else {
					$content.fadingAlert('danger', 'Failed to save the cluster ID.');
				}
			});

			if (isReconfirm)
				$('#clusterIDReconfirm').modal('hide');
			else
				$('#clusterID').modal('hide');
		};

		controller.changeClusterID = function() {
			$('#clusterIDReconfirm').modal('hide');
			$('#clusterID').modal('show');
		};

		$rootScope.setUnitType = function(defaultUnitType) {
			let type = '';

			// Display unitType based on: User preferences > Default preferences > Decimal
			if ($cookies('unitType') === consts.unitType.BINARY) {
				type = consts.unitType.BINARY;
			} else if ($cookies('unitType') === consts.unitType.DECIMAL) {
				type = consts.unitType.DECIMAL;
			} else if (defaultUnitType === consts.unitType.BINARY) {
				type = consts.unitType.BINARY;
			} else if (defaultUnitType === consts.unitType.DECIMAL) {
				type = consts.unitType.DECIMAL;
			} else {
				type = consts.unitType.DECIMAL;
			}

			$rootScope.UNIT_B = 'B';

			if (type === consts.unitType.BINARY) {
				$rootScope.UNIT_P = 'PiB';
				$rootScope.UNIT_T = 'TiB';
				$rootScope.UNIT_G = 'GiB';
				$rootScope.UNIT_M = 'MiB';
				$rootScope.UNIT_K = 'KiB';
				$rootScope.UNIT_VALUE = 1024;
			} else {
				$rootScope.UNIT_P = 'PB';
				$rootScope.UNIT_T = 'TB';
				$rootScope.UNIT_G = 'GB';
				$rootScope.UNIT_M = 'MB';
				$rootScope.UNIT_K = 'KB';
				$rootScope.UNIT_VALUE = 1000;
			}

			$rootScope.UNITS_ARRAY = [
				$rootScope.UNIT_B,
				$rootScope.UNIT_K,
				$rootScope.UNIT_M,
				$rootScope.UNIT_G,
				$rootScope.UNIT_T
			];

		};

		$rootScope.getRedundancyRatio = (volume) => {
			switch (volume.RAIDLevel) {
				case consts.RAIDLevel.MIRRORED_RAID_1:
				case consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10:
					return volume.numberOfMirrors;

				case consts.RAIDLevel.STRIPED_ERASURE_CODING:
				case consts.RAIDLevel.ERASURE_CODING:
					return volume.parityBlocks / volume.dataBlocks;

				case consts.RAIDLevel.CONCATENATED:
				case consts.RAIDLevel.STRIPED_RAID_0:
					return 0;
			}
		};

		if (controller.user.isAdmin) {
			$rootScope.setUnitType();

			$http.get('/generalSettings/load', {}).success(function(data) {
				if (data.success) {
					$rootScope.setUnitType(data.results.defaultUnitType || '');
				}
			});
		} else {
			$rootScope.setUnitType();
		}

		$http.get('/nvmeshMetadata/clusterID', {}).success(function(data) {
			if (data.id)
				$rootScope.clusterID = data.id;
		});


		var isAliveInterval = 5000;
		var failureCounter = 0;
		var IS_ALIVE_MAX_FAILURES = 3;

		function checkIfAlive(cb) {
			var requestCanceler = $q.defer();
			$http.get('/isAlive', { timeout: requestCanceler.promise })
				.then(function onSuccess(response) {
					isCurrentlyAlive = true;
					if (response.data.error?.message?.indexOf('/login') > -1) {
						// save the current URL to redirect back here after login
						const currentUrl = encodeURIComponent(location.pathname + location.search);
						return location.href = '/login?redirectTo=' + currentUrl;
					}

					$('#noConnectionToServerModal').modal('hide');
					$('body').removeClass('blur');
					failureCounter = 0;

				}, function onError(response) {
					if (response.status === 503) {
						return;
					}
					isCurrentlyAlive = false;
					failureCounter++;
					if (failureCounter >= IS_ALIVE_MAX_FAILURES) {
						$('#noConnectionToServerModal').modal('show');
						$('body').addClass('blur');
					}
				});

			setTimeout(function() {
				requestCanceler.resolve();
				cb();
			}, isAliveInterval);
		}

		function checkForIsAlivePeriodically() {
			checkIfAlive(function() {
				checkForIsAlivePeriodically();
			});
		}

		checkForIsAlivePeriodically();

		$http.get('/aboutInfo').success(function(data) {
			controller.hasMongoClusterManagerRole = data.hasMongoClusterManagerRole;

			controller.links = [{
				url: '/',
				icon: 'fa-dashboard',
				caption: 'Dashboard',
				adminOnly: false
			}, {
				url: '/servers',
				icon: 'fa-bullseye',
				caption: 'Targets',
				adminOnly: false
			}, {
				url: '/clients',
				icon: 'fa-server',
				caption: 'Clients',
				adminOnly: false
			}, {
				url: '/volumes',
				icon: 'fa-bolt',
				caption: 'Volumes',
				adminOnly: false
			}, {
				icon: 'fa-cubes',
				caption: 'Thin Provisioning',
				adminOnly: false,
				alpha: true,
				url: '',
				subItems: [{
					url: '/thin-provisioning/cdv',
					icon: 'fa fa-database',
					caption: 'CDVs',
				}, {
					url: '/thin-provisioning/tpv',
					icon: 'fa fa-database',
					caption: 'TPVs',
				}]
			}, {
				url: '/disks',
				icon: 'fa-hdd-o filter:invert(1);',
				caption: 'Drives',
				adminOnly: false
			}, {
				icon: 'fa-gear',
				caption: 'Settings',
				adminOnly: true,
				url: '',
				subItems: [{
					url: '/generalSettings',
					icon: 'fa fa-cogs',
					caption: 'General'
				}, {
					url: '/configurationProfiles',
					icon: 'fa fa-sliders',
					caption: 'Configuration Profiles',
				}, {
					url: '/diskClasses',
					icon: 'fa fa-hdd-o',
					caption: 'Drive Classes'
				}, {
					url: '/keys',
					icon: 'fa fa-key',
					caption: 'Key Pairs'
				}, {
					url: '/volumeSecurityGroups',
					icon: 'fa fa-lock',
					caption: 'Volume Security Groups'
				}, {
					url: '/serverClasses',
					icon: 'fa fa-server',
					caption: 'Target Classes',
				}, {
					url: '/volumeProvisioningGroups',
					icon: 'fa-circle-o',
					caption: 'Provisioning Groups'
				}, {
					url: '/users',
					icon: 'fa-users',
					caption: 'Users',
				}]
			}, {
				icon: 'fa-wrench',
				caption: 'Maintenance',
				adminOnly: false,
				url: '',
				subItems: [{
					url: '/cluster',
					icon: 'fa-sitemap',
					caption: 'NVMesh Cluster',
					adminOnly: true,
				}, {
					url: '/logs',
					icon: 'fa-newspaper-o',
					caption: 'Logs',
					adminOnly: false,
				}, {
					url: '/backups',
					icon: 'fa fa-floppy-o',
					caption: 'Backups',
					adminOnly: true
				}, {
					url: '/upgrades',
					icon: 'fa fa-upload',
					caption: 'Upgrades',
					adminOnly: true
				}]
			}, {
				icon: 'fa-arrow-circle-o-up',
				caption: 'InteropDB',
				adminOnly: true,
				url: '',
				subItems: [
					{
						url: '/operatingSystems',
						icon: 'fa fa-linux',
						caption: 'Operating Systems'
					},
					{
						url: '/kernels',
						icon: 'fa fa-cog',
						caption: 'Kernels'
					},
					{
						url: '/ofeds',
						icon: 'fa fa-plug',
						caption: 'Ofeds'
					},
					{
						url: '/artifacts',
						icon: 'fa fa-cubes',
						caption: 'Artifacts'
					},
					{
						url: '/platforms',
						icon: 'fa fa-server',
						caption: 'Platforms'
					},
					{
						url: '/releases',
						icon: 'fa fa-tags',
						caption: 'Releases'
					},
					{
						url: '/components',
						icon: 'fa fa-puzzle-piece',
						caption: 'Components'
					},
					{
						url: '/upgradeScenarios',
						icon: 'fa fa-rocket',
						caption: 'Upgrade Scenarios'
					},
					{
						url: '/upgradeStepsScenarios',
						icon: 'fa fa-level-up',
						caption: 'Upgrade Steps'
					}]
			}, {
				icon: 'fa-area-chart',
				caption: 'Monitoring',
				adminOnly: true,
				url: '',
				subItems: [{
					url: '/managementCluster',
					icon: 'fa fa-desktop',
					caption: 'Management Cluster',
				},
				{
					url: '/mongoDB',
					icon: 'fa fa-database',
					caption: 'MongoDB',
					disabled: !controller.hasMongoClusterManagerRole,
					title: !controller.hasMongoClusterManagerRole ? 'N/A due to missing mongoDB cluster permissions' : null
				},
				{
					url: '/kafka',
					icon: 'fa fa-bar-chart',
					caption: 'Kafka'
				},
				{
					url: '/upgradeAgents',
					icon: 'fa fa-refresh',
					caption: 'Upgrade Agents'
				}]
			}, {
				url: '/about',
				icon: 'fa fa-info',
				caption: 'About',
			}];

		});

		function collapseSection(element) {

			// get the height of the element's inner content, regardless of its actual size
			var sectionHeight = element.scrollHeight;

			// temporarily disable all css transitions
			var elementTransition = element.style.transition;
			element.style.transition = '';

			// on the next frame (as soon as the previous style change has taken effect),
			// explicitly set the element's height to its current pixel height, so we
			// aren't transitioning out of 'auto'
			requestAnimationFrame(function() {
				element.style.height = sectionHeight + 'px';
				element.style.transition = elementTransition;

				// on the next frame (as soon as the previous style change has taken effect),
				// have the element transition to height: 0
				requestAnimationFrame(function() {
					element.style.height = 0 + 'px';

					// mark the section as "currently collapsed"
					$(element).removeClass('open');
				});
			});
		}

		function expandSection(element) {
			// get the height of the element's inner content, regardless of its actual size
			var sectionHeight = element.scrollHeight;

			// have the element transition to the height of its inner content
			element.style.height = sectionHeight + 'px';

			// when the next css transition finishes (which should be the one we just triggered)
			element.addEventListener('transitionend', function() {
				// remove this event listener so it only gets triggered once
				element.removeEventListener('transitionend', arguments.callee);

				// remove "height" from the element's inline styles, so it can return to its initial value
				element.style.height = null;

			});

			// mark the section as "currently not collapsed"
			$(element).addClass('open');
		}

		controller.toggleSubMenu = function($event) {

			// ignore toggle sub menu if sidebar is collapsed
			if ($('body').hasClass('sidebar-collapse'))
				return;

			var parentNode = $event.currentTarget.parentNode;
			var arrowIcon = $(parentNode).find('i.sub-menu-arrow');
			var subMenuElement = $(parentNode).find('ul')[0];

			if ($(subMenuElement).hasClass('open')) {
				arrowIcon.removeClass('rotated');
				collapseSection(subMenuElement);
			} else {
				arrowIcon.addClass('rotated');
				expandSection(subMenuElement);
			}
		};

		controller.changePassword = function() {
			$http.post('/users/changePassword', {
				_id: controller.userToChange._id,
				uuid: controller.userToChange.uuid,
				password: controller.password,
				confirmationPassword: controller.confirmationPassword
			}).success(function(data) {
				if (!data.success)
					$alert({ title: 'Password change error', text: 'The password couldn\'t be changed' });

				$('#firstLoginModal').modal('hide');
			});
		};

		controller.userManualURL = consts.userManualURL;
		controller.releaseNotesURL = consts.releaseNotesURL;
		controller.restAPIURL = consts.restAPIURL;

		return controller;
	}]);

managementApp.filter('configProfileVersion', function() {
	// formatType can be 'long' or 'short'
	var maxVersionLen = 22;

	return function(configProfile, formatType) {

		if (!configProfile || !(configProfile.id || configProfile.uuid) || !configProfile.name)
			return 'Unavailable';

		if (formatType == 'short') {
			var twoDots = configProfile.name.length > maxVersionLen ? '..' : '';
			return configProfile.name.substring(0, twoDots ? maxVersionLen - 2 : maxVersionLen) + twoDots + ' (' + configProfile.version + ')';
		} else
			// returns 'long' format (Mostly used for on-hover labels)
			return 'Profile: "' + configProfile.name + '" Version: ' + configProfile.version;
	};
});

managementApp.filter('keysCount', function() {
	return function(object) {
		if (!object)
			return 0;

		return Object.keys(object).length;
	};
});


managementApp.filter('ellipsis', function($rootScope) {
	$rootScope.ellipsis = function(text) {
		return text && text.length > 50 ? text.substring(0, 51) + '...' : text;
	};

	return $rootScope.ellipsis;
});

managementApp.run(function($rootScope) {
	$rootScope.CONSTS = consts;
});


function getUnitsToBiggestUnitsFunction($rootScope, getUnitType, fromBytes) {
	return function unitsToBiggestUnitsFunction(units, trunc) {
		if (isNaN(units))
			return units;

		var counter = 0;
		var someUnits = units;

		while (someUnits / $rootScope.UNIT_VALUE >= 1) {
			counter++;
			someUnits /= $rootScope.UNIT_VALUE;
		}

		var division = units / Math.pow($rootScope.UNIT_VALUE, counter);
		var firstConvertionToDecimalRequired = !fromBytes && $rootScope.UNIT_VALUE !== 1000;
		var unitsBeforeTrunc = division * (firstConvertionToDecimalRequired ? consts.DECIMAL_BINARY_G_FACTOR : 1);
		var unitsToDisplay = trunc ? Math.trunc(unitsBeforeTrunc) : (Math.round(unitsBeforeTrunc * 100) / 100);

		return unitsToDisplay + getUnitType(counter);
	};
}

managementApp.filter('gigabytesToBiggestUnits', function($rootScope) {
	function getUnitType(multiplier) {
		var unitType;

		switch (multiplier) {
			case 0:
				unitType = ['GB', 'GiB'];
				break;
			case 1:
				unitType = ['TB', 'TiB'];
				break;
			default:
				unitType = ['PB', 'PiB'];
		}

		return $rootScope.UNIT_VALUE === 1000 ? unitType[0] : unitType[1];
	}

	$rootScope.gigabytesToBiggestUnits = getUnitsToBiggestUnitsFunction($rootScope, getUnitType);
	return $rootScope.gigabytesToBiggestUnits;
});

managementApp.filter('bytesToBiggestUnits', function($rootScope) {
	function getUnitType(multiplier) {
		var unitType;

		switch (multiplier) {
			case 0:
				unitType = ['B', 'B'];
				break;
			case 1:
				unitType = ['KB', 'KiB'];
				break;
			case 2:
				unitType = ['MB', 'MiB'];
				break;
			case 3:
				unitType = ['GB', 'GiB'];
				break;
			case 4:
				unitType = ['TB', 'TiB'];
				break;
			default:
				unitType = ['PB', 'PiB'];
		}

		return $rootScope.UNIT_VALUE === 1000 ? unitType[0] : unitType[1];
	}

	$rootScope.bytesToBiggestUnits = getUnitsToBiggestUnitsFunction($rootScope, getUnitType, true);
	return $rootScope.bytesToBiggestUnits;
});


managementApp.filter('levelToClass', function() {
	return function(level) {
		var labelClass;

		switch (level) {
			case 'INFO':
				labelClass = 'info';
				break;
			case 'WARNING':
				labelClass = 'warning';
				break;
			case 'ERROR':
				labelClass = 'danger';
				break;
			case 'DEBUG':
				labelClass = 'default';
				break;
		}

		return labelClass;
	};
});

