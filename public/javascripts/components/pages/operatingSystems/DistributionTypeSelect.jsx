/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import FormControl from '../../core/FormControl.jsx';
import Select from '../../core/Select.jsx';

const DistributionTypeSelect = ({
	distributionTypes = [],
	selectedDistributionType,
	// eslint-disable-next-line no-unused-vars
	onChange = _ => {},
	placeholder = 'Choose distribution type'
}) => {

	return (
		<FormControl label="Distribution Type" name="distributionType">
			<Select
				id="distributionTypes"
				placeholder={placeholder}
				value={selectedDistributionType}
				onChange={onChange}
				options={distributionTypes}
				valueAsObject
				valueField="ID"
				labelField="name"
				searchField={['name']}
				render={{
					option: (item, escape) => `<div>${escape(item.name)}</div>`,
					item: (item, escape) => `<div>${escape(item.name)}</div>`
				}}
			/>
		</FormControl>
	);
};

export default DistributionTypeSelect;
