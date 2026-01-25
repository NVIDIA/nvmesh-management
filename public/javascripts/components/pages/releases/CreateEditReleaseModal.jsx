/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, ReactHookForm */

import Input from '../../core/Input.jsx';
import FormControl from '../../core/FormControl.jsx';
import Modal from '../../core/Modal.jsx';
import ArtifactsFiltSort from '../artifacts/ArtifactsFiltSort.jsx';

const { useState } = React;
const { useForm } = ReactHookForm;

const buildSaveReleasePayload = ({ version, artifacts }) => {
	const NO_PLATFORM_NAME = null;
	const platformsMap = new Map();

	artifacts.forEach(artifact => {
		const targetPlatformNames = artifact.platforms?.length ? artifact.platforms.map(p => p.name) : [NO_PLATFORM_NAME];

		targetPlatformNames.forEach(platform => {
			if (!platformsMap.has(platform))
				platformsMap.set(platform, { name: platform, artifacts: [] });

			platformsMap.get(platform).artifacts.push(artifact.name);
		});
	});

	return {
		releaseName: version,
		platforms: Array.from(platformsMap.values())
	};
};

const CreateEditRelease = ({
	release = {},
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const isCreate = !release.ID;
	const [selectedArtifacts, setSelectedArtifacts] = useState(release.artifacts || []);

	const { register, handleSubmit, formState } = useForm({ mode: 'all' });

	const onFormSubmit = (data) => {
		const editedRelease = {
			...release,
			...data,
			artifacts: selectedArtifacts
		};

		if (!isCreate)
			return onSubmit(editedRelease);

		const payload = buildSaveReleasePayload(editedRelease);
		onSubmit(payload);
	};

	return (
		<>
			<div className="modal-body">
				<FormControl name="version"
				             label="Version"
				             errorMessage={formState.errors?.version?.message}>
					<Input name="version"
					       className="form-control"
					       placeholder="Enter version"
					       {...register('version', {
						       value: release.version,
						       required: 'Version is required',
						       pattern: { value: /^[a-zA-Z0-9_.-]*$/, message: 'Invalid version' },
						       maxLength: { value: 20, message: 'exceed maximum length of 20' }
					       })}
					       autoFocus
					/>
				</FormControl>

				<ArtifactsFiltSort
					tableId="releasesArtifacts"
					queryParamsEnabled={false}
					multiselectOptions={{
						enabled: true,
						initiallySelectedRows: selectedArtifacts,
						onSelectedRowsChange: setSelectedArtifacts,
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

const CreateEditReleaseModal = ({
	isOpen,
	release = {},
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const isCreate = !release.ID;

	return (
		<Modal
			isOpen={isOpen}
			disableBackdropClose
			onClose={() => handleCancel()}
			title={isCreate ? 'Add Release' : 'Edit Release'}
			className="modal-xl">
			<CreateEditRelease
				release={release}
				handleCancel={handleCancel}
				onSubmit={onSubmit}/>
		</Modal>
	);
};

export default CreateEditReleaseModal;