/* global React, $ */

import { keyBy } from '../utils.js';

const { useEffect, useRef } = React;

const Select = ({
	id,
	options = [],
	value = null,
	valueField,
	labelField,
	sortField,
	searchField,
	placeholder,
	create,
	createFilter,
	item,
	reorder = false,
	disabled = false,
	valueAsObject = false,
	render,
	// eslint-disable-next-line no-unused-vars
	onChange = _ => {},
	onDelete,
	onBlur,
	onFocus,
	maxItems,
	multiple = false,
	className = '',
	clearButton = false,
	style,
}) => {
	const selectRef = useRef(null);
	const selectizeRef = useRef(null);
	const onChangeRef = useRef(onChange);

	useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);

	useEffect(() => {
		if (!selectRef.current) return;

		// Initialize Selectize
		const selectElement = $(selectRef.current).selectize({
			plugins: reorder ? ['drag_drop'] : [],
			create,
			createFilter,
			item,
			maxItems,
			valueField,
			labelField,
			searchField,
			sortField,
			render,
			onBlur,
			onFocus,
			onDelete,
			onChange: (value) => {
				let selectedItem = value;

				if (valueAsObject) {
					selectedItem = selectizeRef.current.options[value];
				}
				if (multiple) {
					selectedItem = selectedItem || [];
				}

				onChangeRef.current(selectedItem);
			},
		});

		selectizeRef.current = selectElement[0].selectize;

		// Cleanup
		return () => {
			selectizeRef.current.destroy();
		};
	}, []);

	useEffect(() => {
		if (!selectizeRef.current) return;

		setOptions();
	}, [options]);

	useEffect(() => {
		setValue();

	}, [value]);

	useEffect(() => {
		if (disabled) selectizeRef.current.disable();
		else selectizeRef.current.enable();
	}, [disabled]);


	const setValue = () => {
		let valueToSet = value;

		if (value && valueAsObject && !multiple) {
			valueToSet = value[valueField || 'value'];
		}

		selectizeRef.current?.setValue(valueToSet, true); // 'true' prevents triggering onChange
	};

	const setOptions = () => {
		const selectize = selectizeRef.current;
		const selectizeValueField = valueField || 'value';
		const optionsToSet = options && [...options];

		const existingOptions = Object.values(selectize.options);
		const newOptionsByValue = keyBy(options, opt => opt[selectizeValueField]);

		existingOptions.forEach(option => {
			const optionValue = option[selectizeValueField];

			if (create) {
				selectize.addOption(option);
			} else if (!newOptionsByValue[optionValue]) {
				selectize.removeOption(optionValue);
			} else {
				selectize.updateOption(optionValue, newOptionsByValue[optionValue]);
			}
		});

		// Add new options
		selectize.addOption(optionsToSet);

		// Restore selected value
		setValue();

		// Refresh Selectize dropdown
		selectize.refreshOptions(false);
	};

	return (
		<div style={{ position: 'relative', ...style }} className={className}>
			<select ref={selectRef}
			        id={id}
			        placeholder={placeholder}
			        multiple={multiple}
			/>
			{!multiple && !disabled && clearButton && value &&
				<a className="selectize-control-clear-button"
				   onClick={() => selectizeRef.current?.clear()}>x</a>}
		</div>
	);
};

export default Select;