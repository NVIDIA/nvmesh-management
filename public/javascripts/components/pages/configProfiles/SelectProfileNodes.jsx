/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import FormControl from '../../core/FormControl.jsx';
import Input from '../../core/Input.jsx';
import Modal from '../../core/Modal.jsx';
import MultiSelectProfileNodes from './MultiSelectProfileNodes.jsx';

const { useState } = React;

const SelectProfileNodes = ({
	profile = {},
	onCancel = () => {},
	onSubmit = () => {}
}) => {
	const [isDirty, setIsDirty] = useState();

	const initialNodes = profile.hosts.map(nodeID => {
		return { _id: nodeID, isDisabled: true };
	});

	const [selectedNodes, setSelectedNodes] = useState(initialNodes);

	const onClientsChange = (newClients) => {
		setIsDirty(true);
		setSelectedNodes(newClients);
	};

	return (
		<>
			<div className="modal-body">
				<FormControl
					name="name"
					label="Name"
				>
					<Input
						name="name"
						className="form-control"
						disabled={true}
						value={profile.name}
					/>
				</FormControl>
				<MultiSelectProfileNodes
					onChange={onClientsChange}
					initialSelectedNodes={initialNodes}

				/>
			</div>
			<div className="modal-footer">
				<button
					className="btn btn-primary"
					disabled={!selectedNodes.length || !isDirty}
					onClick={() => onSubmit(profile, selectedNodes)}
				>
					Apply
				</button>
				<button
					className="btn btn-default"
					onClick={() => onCancel()}
				>
					Cancel
				</button>

			</div>
		</>
	);
};


const SelectProfileNodesModal = ({
	isOpen,
	profile = {},
	handleCancel = () => {},
	onApplyNodes = () => {},
}) => {
	return (
		<Modal
			isOpen={isOpen}
			disableBackdropClose
			onClose={() => handleCancel()}
			title="Apply Configuration to Nodes"
			className="modal-lg">
			<SelectProfileNodes
				onChange={() => {}}
				profile={profile}
				onCancel={handleCancel}
				onSubmit={onApplyNodes}
			/>
		</Modal>
	);
};

export default SelectProfileNodesModal;