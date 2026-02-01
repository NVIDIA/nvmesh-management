/* global $, moment */

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

			return {
				$gt: today,
				$lt: tomorrow
			};
		case 'dateRange':
			var value = $input.val(); //value="01/01/2015 - 01/31/2015"
			var valueArr = value.split('-');
			var from = new Date(valueArr[0]);
			var to = new Date(valueArr[1]);

			return {
				$gt: from,
				$lt: to
			};
		case 'choice':
			return $input.val();
		default:
			return {
				$regex: $input.val(),
				$options: 'i'
			};
	}
}

function createInputTypeChoice($input, $headerCell, changeHandler) {
	var option = $('<option>').attr('value', '').html('');
	$input.append(option);
	var choices;

	try {
		choices = $headerCell.attr('data-choices').split(',');
	} catch (e) {
		// eslint-disable-next-line no-console
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
				return {
					value: choice,
					text: choice
				};
			}
		});
	} else {
		// support input of type Object where the key is the value and the obj[key] is the text
		options = Object.keys(choices).map(function(key) {
			return {
				value: key,
				text: choices[key]
			};
		});
	}

	options.forEach(function(item) {
		var option = $('<option>').attr('value', item.value).html(item.text);
		$input.append(option);
	});

	$input.on('change', changeHandler);
}

function formatDateRange(startDate, endDate) {
	const formatDate = (d) => moment(d).format('MM/DD/YYYY HH:mm A');

	return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

function createInputTypeDateRange($input, dataTableChangeHandler, value) {
	$input.attr({
		'class': 'text-center form-control',
		placeholder: 'Date Range Modified'
	});

	const options = {
		timePicker: true,
		timePickerIncrement: 1,
		opens: 'center',
		autoUpdateInput: false,
		locale: {
			format: 'MM/DD/YYYY h:mm A'
		}
	};

	$input.daterangepicker(options);

	if (value && value.start && value.end) {
		$input.data('daterangepicker').setStartDate(value.start);
		$input.data('daterangepicker').setEndDate(value.end);
		$input.val(formatDateRange(value.start, value.end));
	}

	$input.on('apply.daterangepicker', function(ev, picker) {
		const start = picker.startDate.toDate();
		const end = picker.endDate.toDate();

		$(this).val(formatDateRange(start, end));

		dataTableChangeHandler(ev, () => $input.val());
	});
}

function createInputTypeCheckBox($input, dataTableChangeHandler) {
	var checkValues = [null, true, false];
	var index = 0;
	$input[0].indeterminate = true;
	//vm.checkModel = checkValues[index];

	$input.on('change', function(e) {
		var state = checkValues[++index % checkValues.length];
		$input[0].checked = state;
		$input[0].indeterminate = state === null;

		dataTableChangeHandler(e, function() {
			return $input[0].indeterminate === false;
		});
	});
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

function convertDateRange(obj) {
	const start = new Date(obj.$gt);
	const end = new Date(obj.$lt);

	return {
		start,
		end
	};
}

const sortDirectionToIcon = {
	'1': 'ion-arrow-up-b',
	'-1': 'ion-arrow-down-b'
};

export const filtsort = function(data) {
	var $table = $(data.table);
	var sort = data.sort || {};
	var filter = data.filter || {};
	var inputTimeout;

	var $headerRow = $table.find('tr').eq(0);
	var $filterInput = $('<input>').addClass('form-control');
	var $filterSelect = $('<select>').addClass('form-control');
	var $filterRow = $('<tr>');

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

		this.classList.remove('column-over');

		if (draggedColumn != this) {
			moveColumn(draggedColumn.cellIndex, this.cellIndex);
		}

		const columns = $headerRow.children();
		const colNames = Array.from(columns)
			.map(col => col.attributes['column-name']?.value)
			.filter(name => name != null);

		if (data.onColumnsReorder) {
			data.onColumnsReorder(colNames);
		}
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

	//Create sort
	$table.find('th[data-sortable]').each(function() {
		const field = $(this).attr('data-field');
		const dataDirection = $(this).attr('data-direction');
		let defaultClass = '';
		let defaultWidth = 0;

		if (sort[field]) {
			const fieldDirection = sort[field];
			defaultClass = sortDirectionToIcon[fieldDirection];
			defaultWidth = 9;
		} else if (dataDirection) {
			const direction = dataDirection === 'asc' ? 1 : -1;
			sort[field] = direction;
			defaultClass = sortDirectionToIcon[direction];
			defaultWidth = 9;
		}

		var $i = $('<i>').addClass(defaultClass);
		$i.css({ width: defaultWidth });
		$(this).prepend($i).addClass('noselect');

		$(this).on('click', function(event) {
			event.stopPropagation();

			const $clickedTh = $(this);
			const $clickedIcon = $clickedTh.find('i').first();
			const direction = sort[field] ? sort[field] * -1 : 1;

			$table.find('th[data-sortable]').removeAttr('data-direction').find('i').not($clickedIcon).animate({ width: 0 }, 100);
			$clickedIcon.removeClass('ion-arrow-down-b ion-arrow-up-b');
			$clickedIcon.addClass(sortDirectionToIcon[direction]);

			$clickedIcon.animate({ width: 9 }, 100);

			sort = {
				[field]: direction
			};

			if (data.onSortChange) {
				data.onSortChange(sort);
			}
		});
	});

	const renderFiltSort = function() {
		// delete old filter row if exists
		if (data.isMultiselect) {
			$filterRow.children(':gt(0)').remove();
		} else {
			$filterRow.empty();
		}

		//create filter row
		$table.find('thead > tr:first-child th').each(function(index) {
			var $th = $('<th>');
			if (data.isMultiselect && index === 0) {
				return;
			}
			var $headerCell = $(this);
			$th[0].style.display = $headerCell[0].style.display;
			$th.attr('column-name', $headerCell.attr('column-name'));
			var dataType = $headerCell.attr('data-type');
			var dataPlaceHolder = $headerCell.attr('data-placeholder');
			var $meterialCheckBox;
			var id = $headerCell.attr('filter-id');
			var $input = getInputType(dataType) === 'choice' ? $filterSelect.clone() : $filterInput.clone();
			var $element = $input;

			this.addEventListener('dragenter', columnDragEnter, false);
			this.addEventListener('dragleave', columnDragLeave, false);
			this.addEventListener('dragstart', columnDragStart, false);
			this.addEventListener('dragover', columnDragOver, false);
			this.addEventListener('drop', columnDrop, false);
			this.addEventListener('dragend', columnDragEnd, false);

			const inputType = getInputType(dataType);
			const currField = $headerCell.context.dataset.field;
			let value;
			if (filter[currField]) {
				const filterParamsFieldValue = filter[currField];

				switch (inputType) {
					case 'choice':
						value = filterParamsFieldValue;
						break;
					case 'dateRange':
						value = convertDateRange(filterParamsFieldValue);
						break;
					case 'checkbox':
						value = !filterParamsFieldValue.$ne;
						break;
					default:
						value = filterParamsFieldValue.$regex;
				}
			} else if (inputType === 'checkbox')
				value = null;

			$input.attr({
				'id': id,
				'type': getInputType(dataType),
				'placeholder': dataPlaceHolder,
				'title': dataPlaceHolder,
			});

			//meterial checkbox
			if (getInputType(dataType) === 'checkbox') {
				$meterialCheckBox = $('<div>').addClass('md-checkbox');
				var $label = $('<label>');
				$label.attr({ 'for': id });

				$meterialCheckBox.append($input);
				$meterialCheckBox.append($label);
				$element = $meterialCheckBox;
			}


			switch (inputType) {
				case 'choice':
					createInputTypeChoice($input, $headerCell, dataTableChangeHandler);
					break;
				case 'dateRange':
					createInputTypeDateRange($input, dataTableChangeHandler, value);
					break;
				case 'checkbox':
					createInputTypeCheckBox($input, dataTableChangeHandler);
					break;
				default:
					$input.on('input', dataTableChangeHandler);
			}

			if (value !== undefined)
				if (inputType === 'checkbox' && value !== null) {
					$input.prop('checked', value);
					$input[0].indeterminate = value === null;
				} else if (inputType === 'dateRange')
					$input.val(formatDateRange(value.start, value.end));
				else
					$input.val(value);


			function dataTableChangeHandler(e, hasValue) {
				if (inputTimeout)
					clearTimeout(inputTimeout);

				if (!hasValue)
					hasValue = function() {
						return e && e.target.value;
					};

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
					data.onFilterChange({ ...filter });
				}, 300);
			}

			$input.prop('disabled', !$(this).is('[data-filterable]'));

			$th.append($element);
			$filterRow.append($th);
		});

		$headerRow.after($filterRow);
	};

	if (data.isMultiselect) {
		var $th = $('<th>');
		$th.attr('id', 'all-checkbox-cell'); // Add an ID
		$th.addClass('fixed-size-column select-column'); // Add classes

		$filterRow.append($th);
	}

	renderFiltSort();

	if (data.onReady) {
		data.onReady(sort);
	}

	return {
		renderFiltSort
	};
};