/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, consts */

import FormControl from '../../../core/FormControl.jsx';
import Input from '../../../core/Input.jsx';

export const RelativeRebuildPriorityControl = ({ defaultValue, RAIDLevel, register, errorMessage }) => {
	return (
		<FormControl
			name="relativeRebuildPriority"
			label="Relative Rebuild Priority"
			className="form-group-sm"
			errorMessage={errorMessage}
		>
			<Input
				type="number"
				className="form-control"
				name="relativeRebuildPriority"
				defaultValue={defaultValue}
				min={0}
				max={10}
				placeholder="Enter Relative Rebuild Priority"
				{...register('relativeRebuildPriority', {
					required: RAIDLevel !== consts.RAIDLevel.CONCATENATED && RAIDLevel !== consts.RAIDLevel.STRIPED_RAID_0,
					valueAsNumber: true,
					min: { value: 0, message: 'Minimum value is 0' },
					max: { value: 10, message: 'Maximum value is 10' }
				})}
			/>
			<i><small>Use &#39;0&#39; for target define</small></i>
		</FormControl>
	);
};