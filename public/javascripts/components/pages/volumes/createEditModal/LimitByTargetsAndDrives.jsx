/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, ReactHookForm */

import FormControl from '../../../core/FormControl.jsx';
import Select from '../../../core/Select.jsx';
import { DisksService } from '../../../services/api/disks.service.js';
import { getProperty } from '../../../utils.js';

const { useState, useEffect } = React;
const { Controller } = ReactHookForm;

const LimitByTargetsAndDrives = ({
	control,
	volume,
	disabled,
	formData,
	targets,
	formPath
}) => {
	const [disksByNodes, setDisksByNodes] = useState([]);
	const getFieldName = (name) => formPath ? `${formPath}.${name}` : name;

	const limitByNodesFormData = getProperty(formData, getFieldName('limitByNodes'));

	useEffect(() => {
		if (limitByNodesFormData?.length) {
			loadDisksByNodes(limitByNodesFormData);
		}
	}, [limitByNodesFormData]);

	const loadDisksByNodes = async(nodeIds) => {
		const payload = nodeIds.map(nodeId => ({ serverID: nodeId }));

		const disks = await DisksService.getDisksByNodes(payload);
		setDisksByNodes(disks);
	};

	return (
		<>
			<FormControl
				name={getFieldName('limitByNodes')}
				label="Targets"
				className="form-group-md"
			>
				<Controller
					control={control}
					name={getFieldName('limitByNodes')}
					value={volume?.limitByNodes}
					render={({ field: { onChange, value } }) => (
						<Select id={getFieldName('limitByNodes')}
						        placeholder="Choose Targets"
						        value={value}
						        onChange={value => {
							        onChange(value);
							        // loadDisksByNodes(value);
						        }}
						        disabled={disabled}
						        valueField="_id"
						        labelField="_id"
						        searchField="_id"
						        multiple
						        options={targets}
						/>
					)}
				/>
			</FormControl>

			<FormControl
				name={getFieldName('limitByDisks')}
				label="Drives"
				className="form-group-md"
			>
				<Controller
					control={control}
					name={getFieldName('limitByDisks')}
					value={volume?.limitByDisks}
					render={({ field: { onChange, value } }) => (
						<Select
							id={getFieldName('limitByDisks')}
							placeholder="Choose Drives"
							value={value}
							onChange={value => {
								onChange(value);
							}}
							disabled={disabled || !limitByNodesFormData?.length}
							valueField="_id"
							searchField="_id"
							labelField="_id"
							multiple
							render={{
								option: (item, escape) => `<div>${escape(item.node_id)} - ${escape(item._id)}</div>`,
								item: (item, escape) => `<div>${escape(item.node_id)} - ${escape(item._id)}</div>`
							}}
							options={disksByNodes}
						/>
					)}
				/>
			</FormControl>
		</>
	);
};

export default LimitByTargetsAndDrives;