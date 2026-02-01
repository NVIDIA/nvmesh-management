/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, ReactHookForm */

import Input from '../../core/Input.jsx';
import FormControl from '../../core/FormControl.jsx';
import Modal from '../../core/Modal.jsx';

import PlatformsFiltSort from '../platforms/PlatformsFiltSort.jsx';

const { useState } = React;
const { useForm } = ReactHookForm;

const CreateEditArtifact = ({
	artifact = {},
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const isCreate = !artifact.ID;
	const [selectedPlatforms, setSelectedPlatforms] = useState(artifact.platforms || []);

	const { register, handleSubmit, formState } = useForm({ mode: 'all' });

	const onFormSubmit = (data) => {
		const editedArtifact = {
			...artifact,
			...data,
			platforms: selectedPlatforms
		};

		onSubmit(editedArtifact);
	};

	return (
		<>
			<div className="modal-body">
				<FormControl name="name"
				             label="Name"
				             errorMessage={formState.errors?.name?.message}>
					<Input name="name"
					       className="form-control"
					       placeholder="Enter name"
					       {...register('name', {
						       value: artifact.name,
						       required: 'Name is required',
						       pattern: { value: /^[a-zA-Z0-9_.*-]*$/, message: 'Invalid name' },
						       maxLength: { value: 1024, message: 'exceed maximum length of 1024' }
					       })}
					       autoFocus
					/>
				</FormControl>

				<PlatformsFiltSort
					tableId="artifactPlatformsPage"
					queryParamsEnabled={false}
					multiselectOptions={{
						enabled: true,
						initiallySelectedRows: artifact.platforms,
						onSelectedRowsChange: setSelectedPlatforms,
						isViewSelectedEnabled: true
					}}
				/>
			</div>
			<div className="modal-footer">
				<button className="btn btn-primary mgmt-btn-primary"
				        onClick={handleSubmit(onFormSubmit)}
				        disabled={!formState.isValid}>
					{isCreate ? 'Add' : 'Update'}
				</button>
				<button className="btn btn-default" onClick={() => handleCancel()}>Cancel</button>
			</div>
		</>
	);
};

const CreateEditArtifactModal = ({
	isOpen,
	artifact = {},
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const isCreate = !artifact.ID;

	return (
		<Modal
			isOpen={isOpen}
			disableBackdropClose
			onClose={() => handleCancel()}
			title={isCreate ? 'Add Artifact' : 'Edit Artifact'}
			className="modal-xl">
			<CreateEditArtifact
				artifact={artifact}
				handleCancel={handleCancel}
				onSubmit={onSubmit}/>
		</Modal>
	);
};

export default CreateEditArtifactModal;