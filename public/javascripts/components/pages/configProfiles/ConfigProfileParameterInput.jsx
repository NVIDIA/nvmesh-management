/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import Input from '../../core/Input.jsx';
import Select from '../../core/Select.jsx';
import Toggle from '../../core/Toggle.jsx';

const { forwardRef, useState, useEffect } = React;

const ExamplesList = ({ parameter = {} }) => {
	return (<div className="text-muted">
		<p>{parameter.format}</p>
					Examples:
		<ul>
			{parameter.examples.map((example, idx) => (<li key={idx}>{example}</li>))}
		</ul>
	</div>);
};

const InputValueErrorIcon = ({ inputErrors = [] }) => {
	return (<i className="ion-android-alert red" style={{ marginLeft: '5px' }} title={ inputErrors.join('\n') } />);
};

const InputErrorsList = ({ inputErrors = [] }) => {
	return (<ul className="list-group" style={{ marginTop: '0.2rem' }}>
		{inputErrors.map((error, index) => (
			<li className="list-group-item list-group-item-danger" style={{ padding: '0.2rem 1rem 0.2rem 1rem' }} key={index}>{error}</li>
		))}
	</ul>);
};

const InputWarning = ({ warning = '' }) => {
	return (<span><i className="ion-android-alert yellow" style={{ marginLeft: '5px' }}/> {warning}</span>);
};

const ConfigProfileParameterInput = forwardRef(function ParameterInput({
	initialValue,
	parameter = {},
	disabled = false,
	isNew = false,
	warning = '',
	onChange = () => {},
	onErrorChange = () => {}
}, ref) {
	const isMultiValue = parameter.numOfValues == '*' || parameter.numOfValues > 0;

	const [isFocused, setIsFocused] = useState(false);
	const [inputErrors, setInputErrors] = useState([]);

	useEffect(() => {
		// Propagate the error to parent component
		onErrorChange(inputErrors);
	  }, [inputErrors]);

	const getRegexValidator = function(regexString, errors) {
		return function validateRegex(value) {
			const regExp = new RegExp(regexString);
			const isValid = value.match(regExp);
			if (!isValid) {
				errors.push(`${value} does not match regex ${regExp}`);
				return false;
			}

			return true;
		};
	};

	const getItemValidator = function(parameter) {
		let validate;
		if (parameter.regex) {
			validate = getRegexValidator(parameter.regex);
		} else if (parameter.validationFunction) {
			validate = parameter.validationFunction;
		} else {
			validate = function() { return true; };
		}

		return validate;
	};

	const parseValueIfNeeded = function(parameter, newValue, errors) {
		if (parameter.type === 'number' && newValue !== '') {
			const parsedValue = parseFloat(newValue);
			if (isNaN(parsedValue)) {
				errors.push(`${newValue} is not a valid number`);
				return;
			}
			return parsedValue;
		}
		return newValue;
	};

	const handleChange = newValue => {
		let validate = getItemValidator(parameter);
		const errors = [];

		if (isMultiValue)
			// for MultiValue parameter new Value is an array and we need to validate each item
			newValue
				.map(item => parseValueIfNeeded(parameter, item, errors))
				.forEach(item => validate(item, errors));
		else {
			newValue = parseValueIfNeeded(parameter, newValue, errors);
			validate(newValue, errors);
		}

		onChange(newValue);
		setInputErrors(errors);
	};

	const getMultiValueInput = (param, disabled) => {
		let options = (param.options || []);

		if (param.allowCreate)
			// we need to add the intialValues to the allowed options
			// otherwise Selectize will drop the initialValues
			options = options.concat(initialValue);

		return <Select
			className={inputErrors.length ? 'has-errors' : ''}
			id={param.name}
			ref={ref}
			disabled={disabled}
			options={options.map(opt => ({ text: opt, value: opt }))}
			placeholder={getPlaceholder(param)}
			value={initialValue}
			onChange={value => handleChange(value)}
			onFocus={() => setIsFocused(true)}
			onBlur={() => setIsFocused(false)}
			create={param.allowCreate}
			multiple={true}
		/>;
	};

	const getPlaceholder = (param) => {
		// placeholder is the hint displayed on a text input
		// this will show the first example or the default value
		if (param.examples && param.examples.length)
			return param.examples[0];
		else if (param.default)
			return param.default;
		else
			return '';
	};

	const getSingleValueInput = (param, disabled) => {
		switch (param.type) {
			case 'string':
				return <Input
					className={`form-control ${inputErrors.length ? 'has-errors' : ''}`}
					name={param.name}
					id={param.name}
					ref={ref}
					type="str"
					placeholder={getPlaceholder(param)}
					value={initialValue}
					required={param.required}
					disabled={disabled}
					onFocus={() => {
						setIsFocused(true);
					}}
        			onBlur={() => setIsFocused(false)}
					onChange={e => handleChange(e.target.value)}
				/>;
			case 'number':
				return <Input
					className={`form-control ${inputErrors.length ? 'has-errors' : ''}`}
					id={param.name}
					ref={ref}
					type="number"
					placeholder={getPlaceholder(param)}
					value={initialValue}
					min={param.minimum}
					max={param.maximum}
					required={param.required}
					disabled={disabled}
					onChange={e => handleChange(e.target.value)}
				/>;
			case 'choice':
				return <Select
					className={inputErrors.length ? 'has-errors' : ''}
					id={param.name}
					ref={ref}
					disabled={disabled}
					value={initialValue}
					options={param.options.map(opt => ({ text: opt, value: opt }))}
					onChange={value => handleChange(value)}
					create={false}
				/>;
			case 'boolean':
				return <Toggle
					id={param.name}
					ref={ref}
					isChecked={initialValue}
					disabled={disabled}
					onChange={value => handleChange(value)}
				/>;
			default:
				return <span>{`Unknown parameter type ${param.type}`}</span>;
		}
	};

	return (
		<div className="form-group row">
			<div className="col-lg-6">
				<label caption={parameter.name}>{parameter.displayName}</label>
				{ isNew && (<span className="label label-primary" style={{ marginLeft: '0.5em' }}>New</span>) }
				{ !!inputErrors.length && <InputValueErrorIcon inputErrors={inputErrors} /> }
				<p><small className="text-muted">{parameter.description}</small></p>
			</div>
			<div className="col-lg-6">
				{ isMultiValue && getMultiValueInput(parameter, disabled) }
				{ !isMultiValue && getSingleValueInput(parameter, disabled) }
				{ inputErrors && <InputErrorsList inputErrors={inputErrors} /> }
				{ warning && <InputWarning warning={warning} /> }
				{ parameter.examples && isFocused && <ExamplesList parameter={parameter} /> }
			</div>
		</div>
	);
});

export default ConfigProfileParameterInput;

