/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, ReactHookForm */

import Toggle from '../../../core/Toggle.jsx';
import { AccordionPanel, Panel } from '../../../core/AccordionPanel.jsx';
import MultiSelectClients from '../../../shared/MultiSelectClients.jsx';

const { Controller } = ReactHookForm;

export const NVMfAccessControl = ({ formData, control, volume }) => {
	return (
		<>
			<div className="form-group aligned centred">
				<label>Enable Access Via NVMf:</label>
				{(!formData.name || formData.name.indexOf('_') === -1) && <Controller
					control={control}
					name="enableNVMf"
					defaultValue={volume.enableNVMf}
					render={({ field: { onChange, value } }) => (
						<Toggle
							isChecked={value}
							onChange={onChange}
						/>
					)}
				/>}
				{formData.name && formData.name.indexOf('_') !== -1 && (
					<div className="has-error">
						<i className="ion ion-alert-circled red"
						   title="Cannot enable access via NVMf for a volume containing an underscore in its name"></i>
					</div>
				)}

			</div>

			{formData.enableNVMf && <Panel>
				<AccordionPanel title="Clients Providing NVMf Access" open>
					<Controller
						control={control}
						name="selectedClientsForNvmf"
						defaultValue={volume.selectedClientsForNvmf}
						render={({ field: { onChange, value } }) => (
							<MultiSelectClients onChange={onChange}
							                    initialSelectedClients={value?.map(clientID => ({ clientID }))}/>
						)}
					/>
				</AccordionPanel>
			</Panel>}
		</>
	);
};

export default NVMfAccessControl;