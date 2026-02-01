/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import Modal from '../core/Modal.jsx';
import Select from '../core/Select.jsx';
import { ConfigurationProfilesService } from '../services/api/configuration-profiles.service.js';
import FormControl from '../core/FormControl.jsx';

const { useState, useEffect } = React;

const ConfigurationProfile = ({
	nodeIDs = [],
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const [configurationProfiles, setConfigurationProfiles] = useState([]);
	const [selectedProfile, setSelectedProfile] = useState(null);

	useEffect(() => {
		const fetchConfigurationProfiles = async() => {
			const results = await ConfigurationProfilesService.getAll({ name: 1, uuid: 1 });
			setConfigurationProfiles(results);
		};

		fetchConfigurationProfiles();
	}, []);

	const onApply = () => {
		onSubmit(selectedProfile);
	};

	return (
		<>
			<div className="modal-body modal-body-min-height">
				<FormControl label="Select Configuration Profile to apply"
				             name="configurationProfiles">
					<Select id="configurationProfiles"
					        value={selectedProfile}
					        onChange={setSelectedProfile}
					        options={configurationProfiles}
					        valueAsObject
					        valueField="uuid"
					        labelField="name"
					        searchField="name"
					/>
				</FormControl>
				The selected profile will be applied to {nodeIDs.length} node(s).
			</div>
			<div className="modal-footer">
				<button className="btn btn-primary mgmt-btn-primary"
				        onClick={onApply}
				        disabled={!selectedProfile}>
					Apply
				</button>
				<button className="btn btn-default" onClick={() => handleCancel()}>Cancel</button>
			</div>
		</>
	);
};

const ConfigurationProfileModal = ({
	isOpen,
	nodeIDs = [],
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {

	return (
		<Modal isOpen={isOpen}
		       disableBackdropClose
		       onClose={() => handleCancel()}
		       title="Apply Configuration Profile">
			<ConfigurationProfile nodeIDs={nodeIDs}
			                      handleCancel={handleCancel}
			                      onSubmit={onSubmit}/>
		</Modal>
	);
};

export default ConfigurationProfileModal;