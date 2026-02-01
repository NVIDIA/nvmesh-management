/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import FormControl from '../../core/FormControl.jsx';
import Select from '../../core/Select.jsx';

const ComponentTypesSelect = ({
	componentTypes = [],
	selectedComponentType,
	// eslint-disable-next-line no-unused-vars
	onChange = _ => {},
	placeholder = 'Choose component type'
}) => {
	return (
		<FormControl label="Component Type" name="componentType">
			<Select id="componentTypes"
				placeholder={placeholder}
				value={selectedComponentType}
				onChange={onChange}
				options={componentTypes}
				valueAsObject
				valueField='ID'
				labelField='name'
				searchField='name'
			/>
		</FormControl>
	);
};

export default ComponentTypesSelect;
