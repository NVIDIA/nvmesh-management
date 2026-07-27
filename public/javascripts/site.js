/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* eslint-disable-next-line */
/* global INTERVALS,WATCHERS, SOCKET,io,angular,CookieManager,jQuery,$,Cookies,consts */

/* eslint-disable-next-line no-global-assign */
INTERVALS = [];
/* eslint-disable-next-line no-global-assign */
WATCHERS = [];
function SocketHandler() {
	this.socket = new io();
	this.registeredEvents = {};
}

function jqId(myid) {
	return myid.replace(/(:|\.|\[|\]|,|=)/g, '\\$1');
}

SocketHandler.prototype.addHandler = function(eventName, handler) {
	if (eventName in this.registeredEvents) {
		this.removeHandler(eventName, true);
	} else {
		this.socket.emit('registerToEvent', { name: eventName });
	}

	this.registeredEvents[eventName] = 1;
	this.socket.on(eventName, handler);
};

SocketHandler.prototype.removeHandler = function(eventName, fromGUIOnly) {

	this.socket.removeAllListeners(eventName);
	if (this.registeredEvents[event]) {
		if (!fromGUIOnly)
			this.socket.emit('unregisterFromEvents', [eventName]);
		delete this.registeredEvents[eventName];
	}

};

SocketHandler.prototype.removeAllHandlers = function() {
	for (var event in this.registeredEvents)
		this.socket.removeAllListeners(event);

	this.socket.emit('unregisterFromEvents', Object.keys(this.registeredEvents));

	this.registeredEvents = {};
};

/* eslint-disable-next-line */
SOCKET = new SocketHandler();

// eslint-disable-next-line no-undef
EVENTS = {
	nicsCountChangeEvent: { name: 'nicsCountChangeEvent' },
	disksCountChangeEvent: { name: 'disksCountChangeEvent' },

	serversCountChangeEvent: { name: 'serversCountChangeEvent' },
	clientsCountChangeEvent: { name: 'clientsCountChangeEvent' },
	volumesCountChangeEvent: { name: 'volumesCountChangeEvent' },
	zoneAvailabilityChangeEvent: { name: 'zoneAvailabilityChangeEvent' },

	allocatedSpaceChangeEvent: { name: 'allocatedSpaceChangeEvent' },
	largestVolumesChangeEvent: { name: 'largestVolumesChangeEvent' },
	dirtyBitsChangeEvent: { name: 'dirtyBitsChangeEvent' },
	volumeStatusChangeEvent: { name: 'volumeStatusChangeEvent' },
	volumeActionChangeEvent: { name: 'volumeActionChangeEvent' },
	volumeRemovedEvent: { name: 'volumeRemovedEvent' },

	targetFailureEvent: { name: 'targetFailureEvent' },
	targetWentOnlineEvent: { name: 'targetWentOnlineEvent' },
	targetRemovedEvent: { name: 'targetRemovedEvent' },

	clientFailureEvent: { name: 'clientFailureEvent' },
	clientWentOnlineEvent: { name: 'clientWentOnlineEvent' },
	clientRemovedEvent: { name: 'clientRemovedEvent' },

	formatDiskEvent: { name: 'formatDiskEvent' },
	DiskFinishedFormatEvent: { name: 'DiskFinishedFormatEvent' },
	newTargetEvent: { name: 'newTargetEvent' },
	newClientEvent: { name: 'newClientEvent' },
	backupChangeEvent: { name: 'backupChangeEvent' },
	newDiskEvent: { name: 'newDiskEvent' },
	diskReappearEvent: { name: 'diskReappearEvent' },
	diskStatusChangeEvent: { name: 'diskStatusChangeEvent' },
	diskFailureEvent: { name: 'diskFailureEvent' },
	diskWentOnlineEvent: { name: 'diskWentOnlineEvent' },
	diskEvictedEvent: { name: 'diskEvictedEvent' },
	diskRemovedEvent: { name: 'diskRemovedEvent' },
	driveZeroingProgressChangeEvent: { name: 'driveZeroingProgressChangeEvent' },
	drivePoolChangeEvent: { name: 'drivePoolChangeEvent' },
	volumeDeletionZeroingProgressChangeEvent: { name: 'volumeDeletionZeroingProgressChangeEvent' },

	newNicEvent: { name: 'newNicEvent' },
	nicRemovedEvent: { name: 'nicRemovedEvent' },
	nicFailureEvent: { name: 'nicFailureEvent' },
	nicWentOnlineEvent: { name: 'nicWentOnlineEvent' },
	nicReappearEvent: { name: 'nicReappearEvent' },
	nicChangeEvent: { name: 'nicChangeEvent' },

	newVolumeEvent: { name: 'newVolumeEvent' },

	newLogEvent: { name: 'newLogEvent' },
	logChangedEvent: { name: 'logChangedEvent' },
	allLogsAcknowledgedEvent: { name: 'allLogsAcknowledgedEvent' },
	newPlatformEvent: { name: 'newPlatformEvent' },
	platformRemovedEvent: { name: 'platformRemovedEvent' },
	platformChangedEvent: { name: 'platformChangedEvent' },

	newUpgradeScenarioEvent: { name: 'newUpgradeScenarioEvent' },
	upgradeScenarioRemovedEvent: { name: 'upgradeScenarioRemovedEvent' },
	upgradeScenarioChangedEvent: { name: 'upgradeScenarioChangedEvent' },

	newArtifactEvent: { name: 'newArtifactEvent' },
	artifactRemovedEvent: { name: 'artifactRemovedEvent' },
	artifactChangedEvent: { name: 'artifactChangedEvent' },

	newUpgradeAgentEvent: { name: 'newUpgradeAgentEvent' },
	upgradeAgentChangedEvent: { name: 'upgradeAgentChangedEvent' },

	newComponentEvent: { name: 'newComponentEvent' },
	componentChangedEvent: { name: 'componentChangedEvent' },

	newManagementInClusterEvent: { name: 'newManagementInClusterEvent' },

	updateConfigProfileEvent: { name: 'updateConfigProfileEvent' },
	clientConfigProfileUpdated: { name: 'clientConfigProfileUpdated' },
	targetConfigProfileUpdated: { name: 'targetConfigProfileUpdated' },
	restartRequiredChanged: { name: 'restartRequiredChanged' },
	configProfileUserOverrideChanged: { name: 'configProfileUserOverrideChanged' },
	upgradeAgentRemovedEvent: { name: 'upgradeAgentRemovedEvent' },

	upgradeStatusChangedEvent: { name: 'upgradeStatusChangedEvent' },
	upgradeRemovedEvent: { name: 'upgradeRemovedEvent' },
	newUpgradeEvent: { name: 'newUpgradeEvent' },
	upgradeStepStatusChangedEvent: { name: 'upgradeStepStatusChangedEvent' },

	newReleaseEvent: { name: 'newReleaseEvent' },
	releaseRemovedEvent: { name: 'releaseRemovedEvent' },
	releaseChangedEvent: { name: 'releaseChangedEvent' },

	newKernelEvent: { name: 'newKernelEvent' },
	kernelChangedEvent: { name: 'kernelChangedEvent' },
	kernelRemovedEvent: { name: 'kernelRemovedEvent' },

	newOfedEvent: { name: 'newOfedEvent' },
	ofedChangedEvent: { name: 'ofedChangedEvent' },
	ofedRemovedEvent: { name: 'ofedRemovedEvent' },

	newOperatingSystemEvent: { name: 'newOperatingSystemEvent' },
	operatingSystemChangedEvent: { name: 'operatingSystemChangedEvent' },
	operatingSystemRemovedEvent: { name: 'operatingSystemRemovedEvent' },

	newUpgradeStepScenarioEvent: { name: 'newUpgradeStepScenarioEvent' },
	upgradeStepScenarioRemovedEvent: { name: 'upgradeStepScenarioRemovedEvent' },
	upgradeStepScenarioChangedEvent: { name: 'upgradeStepScenarioChangedEvent' },
};

/* eslint-disable-next-line no-unused-vars */
function getNodeID(id) {
	return 'nodeID_' + id;
}

/* eslint-disable-next-line no-unused-vars */
function getTargetID(id) {
	return 'targetID_' + id;
}

/* eslint-disable-next-line no-unused-vars */
function getClientID(id) {
	return 'clientID_' + id;
}

/* eslint-disable-next-line no-unused-vars */
function getDiskID(id) {
	return 'diskID_' + id;
}

/* eslint-disable-next-line no-unused-vars */
function getNicID(id) {
	return 'nicID_' + id;
}

/* eslint-disable-next-line no-unused-vars */
function getVolumeID(id) {
	return 'volumeID_' + id;
}

/* eslint-disable-next-line no-unused-vars */
function getDiskSegmentID(id) {
	return 'diskSegmentID_' + id;
}

/* eslint-disable-next-line no-unused-vars */
function getLogID(id) {
	return 'logID_' + id + '@';
}

/* eslint-disable-next-line no-unused-vars */
function getPlatformID(id) {
	return 'platformID_' + id + '@';
}

/* eslint-disable-next-line no-unused-vars */
function getUpgradeAgentID(id) {
	return 'upgradeAgentID_' + id + '@';
}

/* eslint-disable-next-line no-unused-vars */
function getComponentID(id) {
	return 'componentID_' + id + '@';
}

(function($) {
	$(function() {
		var $body = $('body');

		$body.on('click', 'a[disabled="disabled"]', function() {
			return false;
		});

		// Disables shift and control text selection, so it will not override shift checking
		// in multi select tables
		$body.mousedown(function(e) {
			if (e.ctrlKey || e.shiftKey) {
				// For non-IE browsers
				e.preventDefault();
			}
		});

		window.onbeforeunload = function() {
			SOCKET.removeAllHandlers();
		};

		//Handle cases were the page was refreshed.
		$('.angular-bootstrap').addClass('bootstrapped');

		//pjax configuration
		$(document).pjax('a[data-pjax!="false"]', '.content', { timeout: 5000 });

		//A hack to take 'back' control from pjax
		$(window).off('popstate.pjax');
		$(window).on('popstate.pjax', function(event) {
			if (!event.state)
				return;

			var options = {
				url: event.state.url,
				container: event.state.container,
				timeout: event.state.timeout,
				id:	event.state.id,
				fragment: event.state.fragment,
				scrollTo: false,
				push: false,

			};

			$.pjax(options);
		});

		$(document).on('pjax:start', function() {
			INTERVALS.forEach(function(i) {
				clearInterval(i);
			});

			angular.element('.angular-bootstrap').scope().$destroy();

			/* eslint-disable-next-line no-global-assign */
			WATCHERS = [];

			SOCKET.removeAllHandlers();

			$('.content').animate({ left: '2000px' }, function(){ });
		});

		$(document).on('pjax:send', function() {
			//Add progress bar
			if ($('#progress').length === 0) {
				$('body').append($('<div><dt/><dd/></div>').attr('id', 'progress'));
				$('#progress').width((50 + Math.random() * 30) + '%');
			}
		});

		$(document).on('pjax:complete', function() {
		//End loading animation
			$('#progress').width('101%').delay(200).fadeOut(400, function() {
				$(this).remove();
			});
		});

		$(document).on('pjax:end', function() {
			$('.content').finish().animate({ left: 0 }, 200);

			var elementsToBootstrap = $('.angular-bootstrap');
			if (elementsToBootstrap.length) {
				angular.element(elementsToBootstrap).injector().invoke([
					'$compile', function($compile) {
						var scope = angular.element(elementsToBootstrap).scope();
						scope.$apply(function() {
							$compile(elementsToBootstrap)(scope);
						});
					}
				]);

				elementsToBootstrap.addClass('bootstrapped');
			}

			fixNavigationActiveState();
		});

		//fix navigation active state
		fixNavigationActiveState();

		$('.treeview > a').click(function() {
			var $icon = $(this).find('>i');

			$icon.toggleClass('fa-circle fa-circle-o');
		});
	});

	function getIconByStatus(status) {
		var $i = $('<i>').addClass('ion');
		var ionClass;

		switch (status.toLowerCase()) {
			case 'danger':
				ionClass = 'ion-alert-circled';
				break;
			case 'success':
				ionClass = 'ion-checkmark-round';
				break;
		}

		return $i.addClass(ionClass);
	}

	$.fn.fadingAlert = function(status, msg, additionalData) {
		var $alertsContainer = $('.fading-alerts-container');

		if (!$alertsContainer.length) {
			$alertsContainer = $('<div>').addClass('fading-alerts-container');
			$(this).append($alertsContainer);
		}

		var isSuccess = status.toLowerCase() === 'success';
		var $alert = $('<div>').addClass('alert alert-' + status + ' fading-alert');
		var $close = $('<a href="#">').addClass('close').attr({ 'data-dismiss': 'alert', 'aria-label': 'close' }).html('&times;');
		var $strong = $('<strong>').text((isSuccess ? 'Success' : 'Failed') + '!');
		var $text = $('<span>').text(msg);
		var $subText = $('<small>');

		if (additionalData)
			$subText.text(additionalData);

		$alert.append($close, getIconByStatus(status), $strong, $text, $subText);

		$alertsContainer.append($alert);

		var startFadeOutAfter = 5000;
		var removeAlertAfter = 6000;

		if (!isSuccess) {
			startFadeOutAfter = 10000;
			removeAlertAfter = 11000;
		}

		setTimeout(function() { $alert.addClass('fade in slide'); }, 50);
		setTimeout(function() { $alert.removeClass('slide fade in'); }, startFadeOutAfter);
		setTimeout(function() { $alert.remove(); }, removeAlertAfter);
	};

	function getInputType(dataType) {
		switch (dataType) {
			case 'boolean':
				return 'checkbox';
			case 'date':
				return 'date';
			case 'dateRange':
				return 'dateRange';
			case 'choice':
				return 'choice';
			default:
				return 'text';
		}
	}

	function getValue(dataType, $input) {
		switch (dataType) {
			case 'boolean':
				return $input.is(':checked') || { $ne: true };
			case 'date':
				var today = new Date($input.val());
				var tomorrow = new Date((new Date(today)).setDate(today.getDate() + 1));

				return { $gt: today, $lt: tomorrow };
			case 'dateRange':
				var value = $input.val(); //value="01/01/2015 - 01/31/2015"
				var valueArr = value.split('-');
				var from = new Date(valueArr[0]);
				var to = new Date(valueArr[1]);

				return { $gt: from, $lt: to };
			case 'choice':
				return $input.val();
			default:
				return { $regex: $input.val(), $options: 'i' };
		}
	}

	function createInputTypeChoice($input, $headerCell, changeHandler) {
		var option = $('<option>').attr('value', '').html('');
		$input.append(option);
		var choices;

		try {
			choices = JSON.parse($headerCell.attr('data-choices'));
		} catch (e) {
			console.warn(e);
			choices = [];
		}

		var options;
		if (Array.isArray(choices)) {
			// support input of type Array
			options = choices.map(function(choice) {
				if (choice.value && choice.text) {
					// support array of objects with value and text
					return choice;
				} else {
					// support array of string values
					return { value: choice, text: choice };
				}
			});
		} else {
			// support input of type Object where the key is the value and the obj[key] is the text
			options = Object.keys(choices).map(function(key) {
				return { value: key, text: choices[key] };
			});
		}

		options.forEach(function(item) {
			var option = $('<option>').attr('value', item.value).html(item.text);
			$input.append(option);
		});

		$input.on('change', changeHandler);
	}

	function createInputTypeDateRange($input, dataTableChangeHandler) {
		$input.attr({ 'class': 'text-center form-control', placeholder: 'Date Range Modified' });
		$input.daterangepicker({
			timePicker: true,
			timePickerIncrement: 1,
			opens: 'center',
			autoUpdateInput: false,
			locale: {
				format: 'MM/DD/YYYY h:mm A'
			}
		});

		$input.on('apply.daterangepicker', function(ev, picker) {
			$(this).val(picker.startDate.format('MM/DD/YYYY HH:mm') + ' - ' + picker.endDate.format('MM/DD/YYYY HH:mm'));
			dataTableChangeHandler(ev, function() { return $input.val(); });
		});
	}

	function createInputTypeCheckBox($input, dataTableChangeHandler) {
		var checkValues = [null, true, false];
		var index = 0;
		$input[0].indeterminate = true;
		//vm.checkModel = checkValues[index];

		$input.on('change', function(e){
			var state = checkValues[++index % checkValues.length];
			$input[0].checked = state;
			$input[0].indeterminate = state === null;

			dataTableChangeHandler(e, function(){
				return $input[0].indeterminate === false;
			});
		});
	}

	function updateColumnConfig(columns, itemName) {
		var columnConfig = CookieManager.getJSON('nvmesh-column-config') || {};

		if (!columnConfig[itemName]){
			columnConfig[itemName] = {};
			columns.each(function(col) {
				if (columns[col].attributes['column-name'])
					columnConfig[itemName][columns[col].attributes['column-name'].value] = !columns[col].attributes['default-hidden'];
			});
		} else {
			const cols = Object.values(columns)
				.filter(col => col.attributes && col.attributes['column-name']);

			var columnNames = cols.map(function(col) { return col.attributes['column-name'].value; });
			var columnNamesCookie = Object.keys(columnConfig[itemName]);

			columnNamesCookie.forEach(function(colInCookie) {
				if (columnNames.indexOf(colInCookie) === -1)
					delete columnConfig[itemName][colInCookie];
			});

			columnNames.forEach(function(colName) {
				if (columnNamesCookie.indexOf(colName) === -1) {
					const col = cols.find(col => col.attributes['column-name'].value === colName);
					columnConfig[itemName][colName] = !col.attributes['default-hidden'];
				}
			});
		}

		CookieManager.setJSON('nvmesh-column-config', columnConfig);
	}

	const customTableFilters = {
		domainsTableFilter: (filter, $input) => {
			let inputValue = $input.val();
			if (inputValue) {
				let inputValueParts = inputValue.split(':');

				if (inputValueParts.length > 1 && inputValueParts[1].length > 0) {
					delete filter['domains.scope'];
					filter['domains'] = {
						$elemMatch: {
							'scope': { $regex: inputValueParts[0] + '$', $options: 'i' },
							'identifier': { $regex: '^' + inputValueParts[1], $options: 'i' }
						}
					};
				} else {
					delete filter['domains'];
					filter['domains.scope'] = { $regex: inputValueParts[0], $options: 'i' };
				}
			} else {
				delete filter['domains'];
				delete filter['domains.scope'];
			}

			return filter;
		}
	};

	$.fn.filtSort = function(data) {
		var $table = $(this);
		var sort = data.sort || {};
		var filter = data.filter || {};
		var inputTimeout;

		var $headerRow = $table.find('tr').eq(0);
		var $filterInput = $('<input>').addClass('form-control');
		var $filterSelect = $('<select>').addClass('form-control');
		var $filterRow = $('<tr>');
		var itemName = $headerRow.attr('sortable-row');
		$filterRow.attr('sortable-row', itemName);

		var columns = $headerRow.children();
		updateColumnConfig(columns, itemName);

		data.scope?.sortableRowReload();

		//setup pagination
		var defaultPerPageOptions = [10, 20, 50];
		var paginationSelector = data.paginationName ? '#' + data.paginationName : '[id*="agination"]';
		var pagination = $table.parent().find(paginationSelector);

		if (pagination.length > 0) {
			pagination.after('<items-per-page id="' + pagination[0].id + '-items" tooltip="items per page"><select></select></items-per-page>');

			var customItemsPerPage = pagination.attr('items-per-page');
			var perPageOptions = customItemsPerPage ? JSON.parse(customItemsPerPage) : defaultPerPageOptions;

			var perPageSelect = $('#' + jqId(pagination[0].id + '-items') + ' > select');
			var paginationCookies = CookieManager.getJSON('nvmesh-pagination') || {};

			perPageSelect.attr('id', pagination[0].id + 'PerPage'); //Add ID to page
			perPageOptions.forEach(function(perPage){
				perPageSelect.append($('<option>', { text: perPage, value: perPage }));
			});
			perPageSelect.on('change', function() {
				paginationCookies = CookieManager.getJSON('nvmesh-pagination') || {};
				paginationCookies[pagination[0].id] = parseInt(this.value);
				CookieManager.setJSON('nvmesh-pagination', paginationCookies);
				data.load(filter, sort);
			});

			perPageSelect.val(paginationCookies[pagination[0].id] || consts.defaultItemsPerPage);
		}

		var draggedColumn = null;

		function columnDragEnter() {
			// this / e.target is the current hover target.
			this.classList.add('column-over');
		}

		function columnDragLeave() {
			this.classList.remove('column-over'); // this / e.target is previous target element.
		}

		function columnDragStart(e) {
			this.classList.add('column-dragged');
			draggedColumn = this;

			e.dataTransfer.setData('text/plain', '');
			e.dataTransfer.setDragImage(createDraggingPreview(this.innerText), -10, -10);
		}

		function columnDragEnd() {
			this.classList.remove('column-dragged');
			this.classList.remove('column-over');
		}

		function columnDragOver(e) {
			if (e.preventDefault) {
				e.preventDefault(); // Necessary. Allows us to drop.
			}


			if (e.dataTransfer)
				e.dataTransfer.dropEffect = 'move'; // See the section on the DataTransfer object.

			return false;
		}

		function columnDrop(e) {
			if (e.stopPropagation) {
				e.stopPropagation(); // stops the browser from redirecting.
			}

			//var itemName = $headerRow.attr('sortable-row');

			this.classList.remove('column-over');

			if (draggedColumn != this) {
				moveColumn(draggedColumn.cellIndex, this.cellIndex);
			}

			var columnConfig = CookieManager.getJSON('nvmesh-column-config') || {};
			var newConfig = {};

			var columns = $headerRow.children();
			columns.each(function(col) {
				if (columns[col].attributes['column-name'])
					newConfig[columns[col].attributes['column-name'].value] =
					columnConfig[itemName][columns[col].attributes['column-name'].value];
			});

			columnConfig[itemName] = newConfig;
			CookieManager.setJSON('nvmesh-column-config', columnConfig);
		}

		function createDraggingPreview(columnHeaderText) {

			var elem = document.getElementById('drag-preview');

			if (!elem) {
				elem = document.createElement('div');
				elem.id = 'drag-preview';
				document.body.appendChild(elem);
			}

			elem.textContent = columnHeaderText;

			return elem;
		}

		function moveColumn(initialIndex, targetIndex) {
			for (var index = 0; index < $table[0].rows.length; index++) {
				var row = $table[0].rows[index];

				var cell = row.cells[initialIndex];
				var insertBefore = row.cells[targetIndex];
				row.deleteCell(initialIndex);
				row.insertBefore(cell, insertBefore);
			}
		}

		//create filter row
		$table.find('th').each(function() {
			var $headerCell = $(this);
			var $th = $('<th>');
			$th[0].style.display = $headerCell[0].style.display;
			$th.attr('column-name', $headerCell.attr('column-name'));
			var dataType = $headerCell.attr('data-type');
			var dataPlaceHolder = $headerCell.attr('data-placeholder');
			var $meterialCheckBox;
			var id = $headerCell.attr('filter-id');
			var $input = getInputType(dataType) == 'choice' ? $filterSelect.clone() : $filterInput.clone();
			var $element = $input;

			this.addEventListener('dragenter', columnDragEnter, false);
			this.addEventListener('dragleave', columnDragLeave, false);
			this.addEventListener('dragstart', columnDragStart, false);
			this.addEventListener('dragover', columnDragOver, false);
			this.addEventListener('drop', columnDrop, false);
			this.addEventListener('dragend', columnDragEnd, false);

			$input.attr({ 'id': id,
				'type': getInputType(dataType),
				'placeholder': dataPlaceHolder,
				'title': dataPlaceHolder });

			//meterial checkbox
			if (getInputType(dataType) === 'checkbox') {
				$meterialCheckBox = $('<div>').addClass('md-checkbox');
				var $label = $('<label>');
				$label.attr({ 'for': id });

				$meterialCheckBox.append($input);
				$meterialCheckBox.append($label);
				$element = $meterialCheckBox;
			}

			var inputType = getInputType(dataType);

			switch (inputType) {
				case 'choice':
					createInputTypeChoice($input, $headerCell, dataTableChangeHandler);
					break;
				case 'dateRange':
					createInputTypeDateRange($input, dataTableChangeHandler);
					break;
				case 'checkbox':
					createInputTypeCheckBox($input, dataTableChangeHandler);
					break;
				default:
					$input.on('input', dataTableChangeHandler);
			}

			function dataTableChangeHandler(e, hasValue) {
				if (inputTimeout)
					clearTimeout(inputTimeout);

				if	(!hasValue)
					hasValue = function() { return e && e.target.value; };

				var hasVal = hasValue();
				var customFilterFunc = $headerCell.attr('custom-data-filter');

				if (customFilterFunc) {
					customTableFilters[customFilterFunc](filter, $(e.target));
				} else if (hasVal) {
					filter[$headerCell.attr('data-field')] = getValue(dataType, $(e.target));
				} else {
					delete filter[$headerCell.attr('data-field')];
				}

				inputTimeout = setTimeout(function() {
					data.load(filter, sort);
				}, 300);
			}

			$input.prop('disabled', !$(this).is('[data-filterable]'));

			$th.append($element);
			$filterRow.append($th);
		});

		$headerRow.after($filterRow);

		if (data.scope) {
			angular.element($filterRow).injector().invoke([
				'$compile', function($compile) {
					var scope = data.scope;
					scope.$apply(function() {
						$compile($filterRow)(scope);
					});
				}
			]);
		}

		//Create sort
		$table.find('th[data-sortable]').each(function() {
			var initialDirection = $(this).attr('data-direction');
			var defaultClass = 'ion-arrow-down-b';
			var defaultWidth = 0;

			if (initialDirection && jQuery.isEmptyObject(sort)) {
				if (initialDirection === 'asc') {
					sort[$(this).attr('custom-data-sort-field') || $(this).attr('data-field')] = 1;
					defaultClass = 'ion-arrow-up-b';
				} else {
					sort[$(this).attr('custom-data-sort-field') || $(this).attr('data-field')] = -1;
				}
				defaultWidth = 9;
				data.load(filter, sort);
			}

			var $i = $('<i>').addClass(defaultClass);
			$i.animate({ width: defaultWidth }, 300);
			$(this).prepend($i).addClass('noselect');

			$(this).click(function() {
				sort = {};

				if ($(this).is('[data-direction]'))
					$i.toggleClass('ion-arrow-down-b ion-arrow-up-b');
				else {
					$table.find('th[data-sortable]').removeAttr('data-direction').find('i').not($i).animate({ width: 0 }, 100);
					$i.animate({ width: 9 }, 100);
				}

				$(this).attr('data-direction', function(i, attr) {
					var direction = (!attr || attr === 'desc') ? 'asc' : 'desc';

					sort[$(this).attr('custom-data-sort-field') || $(this).attr('data-field')] = direction === 'asc' ? 1 : -1;

					return direction;
				});
				data.load(filter, sort);
			});
		});
	};
})(jQuery);

function fixNavigationActiveState() {
	var menuListItems = $('.sidebar-menu li').removeClass('selected').removeClass('selected-parent');

	var openPageMenuItem = menuListItems.get().filter(function isOpenPage(e) {
		var page = window.location.pathname.split('/')[1];
		var link = $(e).find('a').attr('href');
		return (link && link.split('/')[1] === page) || $(e).find('a[data-sublinks*="' + page + '"]').length;
	});

	$(openPageMenuItem).addClass('selected');

	var $selectedParent = $(openPageMenuItem).parents('li');
	$selectedParent.addClass('selected-parent');

	var $subMenuArrow = $selectedParent.find('i.sub-menu-arrow');
	$subMenuArrow.addClass('rotated');

	var $selectedSubMenu = $selectedParent.children('ul');
	$selectedSubMenu.addClass('open');
}

function tryParseJSON(jsonString) {
	if (jsonString === undefined || jsonString === '')
		return false;

	try {
		var o = JSON.parse(jsonString);

		parseDatetime(o);

		//Handle non-exception-throwing cases:
		if (o && typeof o === 'object' && o !== null)
			return o;
		/* eslint-disable-next-line */
	} catch (e) { }

	return false;
}

function parseDatetime(jsonObj) {
	for (var key in jsonObj) {
		var regex = /[\d]{4}-[\d]{2}-[\d]{2}T[\d]{2}:[\d]{2}:[\d]{2}.[\d]{3}Z/;
		if (typeof jsonObj[key] === 'string' || jsonObj[key] instanceof String) {
			if (jsonObj[key].match(regex))
				jsonObj[key] = new Date(jsonObj[key]);
		} else if (typeof jsonObj[key] === 'object' && jsonObj[key] !== null) {
			parseDatetime(jsonObj[key]);
		}
	}

	return jsonObj;
}

//Wrapper for js.cookie.js to allow for empty JSON cookies
/* eslint-disable-next-line no-global-assign */
CookieManager = {
	get: function(name) {
		return Cookies.get(name);
	},
	getJSON: function(name) {
		return tryParseJSON(Cookies.get(name)) || {};
	},
	set: function(name, value, attributes) {
		Cookies.set(name, value, attributes);
	},
	setJSON: function(name, value, attributes) {
		Cookies.set(name, JSON.stringify(value), attributes);
	},
	remove: function(name, attributes) {
		Cookies.remove(name, attributes);
	}
};

(function validateColumnConfigCookieVersion() {
	var columnConfig = CookieManager.getJSON('nvmesh-column-config');
	var version = 2;
	if (columnConfig && (!columnConfig.version || columnConfig.version !== version)) {
		CookieManager.setJSON('nvmesh-column-config', { version: version });
	}
})();