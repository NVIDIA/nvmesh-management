/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import { ConfigurationProfilesService } from '../../services/api/configuration-profiles.service.js';
import Toggle from '../../core/Toggle.jsx';
import ConfigProfileParameterInput from './ConfigProfileParameterInput.jsx';
import { Tabs, Tab } from '../../core/Tabs.jsx';


const { useState, useEffect, forwardRef, useImperativeHandle, useRef } = React;

const NodeConfigurationEditor = forwardRef(function NodeConfigurationEditor({
	initialConfig = {},
	onErrorsChanged = () => {},
	hasNewDefaultsChanged = () => {},
	onConfigChange = () => {}
}, ref) {
	const scheme = window.profileScheme;

	const [config, setConfig] = useState(initialConfig);
	const [advancedMode, setAdvancedMode] = useState(false);
	const [categoriesWithNewParams, setCategoriesWithNewParams] = useState(new Set());
	const [newParameters, setNewParameters] = useState(new Set());
	const [filteredCategories, setFilteredCategories] = useState(scheme.categories);
	const [newDefaults, setNewDefaults] = useState(false);
	const [errors, setErrors] = useState({});

	const nvmeshDefaultProfileRef = useRef();

	const fetchDefaultProfile = async() => {
		nvmeshDefaultProfileRef.current = await ConfigurationProfilesService.getNVMeshDefaultProfile();
		checkIfHasNewDefaults();
	};

	// run once
	useEffect(() => {
		fetchDefaultProfile();
	}, []);

	useEffect(() => {
		const hasNewDefaults = !!Object.keys(newDefaults).length;
		hasNewDefaultsChanged(hasNewDefaults);
	}, [newDefaults]);

	useEffect(() => {
		onErrorsChanged(errors);
	}, [errors]);

	useEffect(() => {
		markCategoriesWithNewParams();
	}, [newParameters]);

	useEffect(() => {
		handleUpdatedAdvancedMode();
	}, [advancedMode]);

	const handleUpdatedAdvancedMode = () => {
		if (advancedMode) {
			showAllCategories();
		} else {
			filterSimpleCategories();
		}
	};

	const paramsFilter = param => {
		if (advancedMode)
			// show all params
			return true;
		else
			// show only params which are not 'advanced'
			return !param.advanced;
	};

	const importNewDefaults = () => {
		const newConfig = { ...config };
		const newParams = new Set();
		for (let paramName in newDefaults) {
			newConfig[paramName] = newDefaults[paramName];
			newParams.add(paramName);
		}

		setConfig(newConfig);
		setNewDefaults({});
		setNewParameters(newParams);
	};

	const revetToNVmeshDefaults = () => {
		setConfig(nvmeshDefaultProfileRef.current.config);

		// notify parent
		onConfigChange(config);
	};

	// expose only specific functions to parent
	useImperativeHandle(ref, () => ({
		importNewDefaults,
		revetToNVmeshDefaults
	}));

	const checkIfHasNewDefaults = function() {
		let newDefaultsDict = {};
		for (var paramName in nvmeshDefaultProfileRef.current.config) {
			if (!(paramName in initialConfig)) {
				newDefaultsDict[paramName] = nvmeshDefaultProfileRef.current.config[paramName];
				newParameters.add(paramName);
			}
		}

		setNewDefaults(newDefaultsDict);
		setNewParameters(newParameters);
	};

	const filterSimpleCategories = () => {
		// filters categories to show only ones who have at least one simple param
		let filtered = scheme.categories.filter(function(category) {
			return category.parameters.some(function(parameter) {
				return !parameter.advanced;
			});
		});

		setFilteredCategories(filtered);
	};

	const showAllCategories = () => {
		setFilteredCategories(scheme.categories);
	};

	const markCategoriesWithNewParams = function() {
		const newCategoriesWithNewParams = new Set();
		if (!newParameters || !newParameters.size)
			return setCategoriesWithNewParams(newCategoriesWithNewParams);

		// there is at least one new parameter
		scheme.categories.forEach(function(category) {
			category.parameters.forEach(function(param) {
				if (newParameters.has(param.name)) {
					newCategoriesWithNewParams.add(category.name);
				}
			});
		});

		if (!newCategoriesWithNewParams.size)
			console.warn(`Found ${newParameters.size} new parameters in "NVMesh Default" profile but they were not found the profileScheme`, newParameters);
		setCategoriesWithNewParams(newCategoriesWithNewParams);
	};

	const getWarningMessage = function(paramName) {
		let warningMessage = '';

		if (['CONFIGURED_NICS', 'BLACKLIST_NICS'].includes(paramName)) {
			let { CONFIGURED_NICS = [], BLACKLIST_NICS = [] } = initialConfig || {};
			const commonItems = CONFIGURED_NICS.filter(i => BLACKLIST_NICS.includes(i));

			if (commonItems.length)
				warningMessage = `Pay Attention! The following NICs are configured both in CONFIGURED_NICS and BLACKLIST_NICS: ${commonItems}`;
		}

		return warningMessage;
	};

	const handleParamValueChange = (param, category, newValue) => {
		let oldValue = config[param.name];
		if (oldValue != newValue) {
			// we do not call setConfig here so we don't trigger a re-render
			config[param.name] = newValue;

			// notify parent
			onConfigChange(config);
		}
	};

	/**
	 * Set the errors varaible with structure:
	 * errors = {
	 *  'Cluster': {  // category name
	 *      'KAFKA_SERVERS': [ // parameter name
	 * 			'Specific error for this parameter',  //parameter error string
	 *          'Another error for this parameter'    //parameter error string
	 * 			]
	 *   }
	 * }
	 */
	const handleParamErrorChange = (param, category, paramErrors) => {
		// duplicate dicts so we don't edit the errors directly
		let errDict = { ...errors };
		let categoryErrors = { ...errDict[category.name] };

		if (!paramErrors.length) {
			// param has no errors
			delete categoryErrors[param.name];

		} else
			categoryErrors[param.name] = paramErrors;

		errDict[category.name] = categoryErrors;

		if (!Object.keys(categoryErrors).length)
			// no params with errors in this category
			delete errDict[category.name];

		setErrors(errDict);
	};

	const getTabHeader = (category) => {
		const categoryHasErrors = category.name in errors && Object.keys(errors[category.name]).length;
		const categoryHasNewParams = categoriesWithNewParams.has(category.name);

		return (<>
			<span className='mr-5'>{category.name}</span>
			{categoryHasErrors && <i className='fa fa-exclamation ml-5' style={{ color: 'red' }}/>}
			{categoryHasNewParams && <i className='fa fa-star ml-5' style={{ color: 'green' }} title='Has New Parameters'/>}
		</>);
	};

	 return (
		<>
			<div className="pull-right" style={{ position: 'relative', marginBottom: '-50px' }}>
				<div className="form-group row">
					<span className="col-md-8" style={{ top: '5px', left: '20px' }}>Advanced Options</span>
					<div className="col-md-4">
						<Toggle
							isChecked={advancedMode}
							onChange={(value) => {
								setAdvancedMode(value);
							}}/>
					</div>

				</div>

			</div>
			<Tabs>
				{
					filteredCategories.map(category => (
						<Tab header={getTabHeader(category)}
							key={category.id}
							name={`tab_category_${category.id}`}
							id={category.id}>
							{
								category.parameters?.filter(paramsFilter)
									.map((param) => (
										<ConfigProfileParameterInput
											key={param.name}
											parameter={param}
											initialValue={config[param.name]}
											isDisabled={false}
											isNew={newParameters.has(param.name)}
											warning={getWarningMessage(param.name)}
											onChange={newValue => handleParamValueChange(param, category, newValue)}
											onErrorChange={newErrors => handleParamErrorChange(param, category, newErrors)}
										/>
									))
							}
						</Tab>
					))
				}
			</Tabs>
		</>
	);
});

export default NodeConfigurationEditor;