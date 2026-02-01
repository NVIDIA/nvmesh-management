/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import FormControl from '../../core/FormControl.jsx';
import Select from '../../core/Select.jsx';

const KernelSelect = ({
	kernels = [],
	value,
	// eslint-disable-next-line no-unused-vars
	onChange = _ => {},
	placeholder = 'Choose kernel'
}) => {
	return (
		<FormControl label="Kernel" name="kernel">
			<Select
				id="kernels"
				placeholder={placeholder}
				value={value}
				onChange={onChange}
				options={kernels}
				valueAsObject
				valueField='ID'
				labelField='version'
				searchField='version'
			/>
		</FormControl>
	);
};

export default KernelSelect;
