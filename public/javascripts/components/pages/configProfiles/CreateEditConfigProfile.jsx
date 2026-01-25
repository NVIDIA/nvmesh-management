/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, ReactHookForm, consts*/

import Input from '../../core/Input.jsx';
import FormControl from '../../core/FormControl.jsx';
import Modal from '../../core/Modal.jsx';
import { debounce } from '../../utils.js';
import { ConfigurationProfilesService } from '../../services/api/configuration-profiles.service.js';
import Select from '../../core/Select.jsx';
import NodeConfigurationEditor from './NodeConfigurationEditor.jsx';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';

const { useForm, Controller } = ReactHookForm;
const { useState, useRef } = React;

const CreateEditConfigProfile = ({
	profile = { config: {} },
	onCancel = () => {},
	onSubmit = () => {},
}) => {
	const [confirm] = useConfirmationDialog();
	const isClusterDefault = profile.name == consts.configurationProfile.defaults.CLUSTER_DEFAULT;
	const configEditorRef = useRef();
	const [hasNewDefaults, setHasNewDefaults] = useState({});

	const isCreate = profile.isNewProfile;
	const { register, control, handleSubmit, formState, setError, clearErrors } = useForm({
		mode: 'all',
		defaultValues: { ...profile },
		shouldUnregister: true
	});

	const onFormSubmit = async(data) => {
		const editedProfile = {
			...data,
		};

		if (!isCreate)
			editedProfile.uuid = profile.uuid;
		else
			editedProfile.isNewProfile = profile.isNewProfile;

		editedProfile._id = editedProfile.name;

		let confirmed = await confirmEditChanges();
		if (confirmed)
			onSubmit(editedProfile);
	};

	const isNameExist = async(name) => {
		const filter = { name: { $eq: name } };
		const count = await ConfigurationProfilesService.loadTotal(filter);
		return count > 0;
	};

	const validateNameDebounced = debounce(async(value) => {
		const exists = await isNameExist(value);
		return !exists;
	}, 500);

	const handleConfigErrors = (errorsObj, field) => {
		clearErrors(field.name);

		Object.keys(errorsObj).forEach(category => {
			Object.keys(errorsObj[category]).forEach(param => {
				const errorMessages = errorsObj[category][param];
				setError(field.name, {
					type: 'manual',
					message: `Configuration errors in ${category}.${param}: ${errorMessages}`
				});
			});
		});
	};

	const confirmEditChanges = async() => {
		const numOfNodes = profile.hosts ? profile.hosts.length : 0;
		const configChanged = formState.dirtyFields.config;

		if (numOfNodes == 0 || !configChanged)
			// if the profile has no nodes or config was not changed - no need for the confirm.
			return true;

		let changeAffectsNodesText = (<div>
			<p>This will change the configuration on {numOfNodes} nodes.</p>
			<p>Do you want to Continue?</p>
		</div>);
		return confirm(changeAffectsNodesText);
	};

	const validateName = async(value) => {
		const isValid = await validateNameDebounced(value);
		if (!isValid)
			return 'Name already exists';
		else
			return true;
	};

	return (
		<>
			<div className="modal-body">
				<FormControl
					name="name"
					label="Name"
					errorMessage={formState.errors?.name?.message || formState.errors?.nameExists?.message}
				>
					<Input
						name="name"
						className="form-control"
						disabled={!isCreate}
						placeholder="Enter name"
						{...register('name', {
							value: profile.name,
							required: { value: true, message: 'Name is required' },
							pattern: {
								value: /^[a-zA-Z0-9_\-+= ]+$/,
								message: 'Invalid name'
							},
							maxLength: {
								value: 22,
								message: 'Exceed maximum length of 22'
							},
							validate: isCreate ? validateName : undefined
						})}
						autoFocus
						required
					/>
				</FormControl>
				<FormControl
					name="description"
					label="Description"
					errorMessage={formState.errors?.description?.message}
				>
					<Input
						name="description"
						className="form-control"
						placeholder="Enter description"
						{...register('description', {
							value: profile.description,
							maxLength: {
								value: 1024,
								message: 'Exceed maximum length of 1024'
							},
							setValueAs: value => (value.trim() === '' ? undefined : value),
						})}
					/>
				</FormControl>
				<Controller
					name="labels"
					control={control}
					render={({ field }) => (
						<FormControl label="Labels">
							<Select
								id="labels"
								placeholder="Add label"
								value={field.value}
								options={field.value.map(opt => ({ value: opt, text: opt }))}
								onChange={field.onChange}
								create
								multiple
							/>
						</FormControl>
					)}
				/>
				<Controller
					name="config"
					control={control}
					render={({ field }) => (
						<NodeConfigurationEditor
							ref={configEditorRef}
							initialConfig={profile.config}
							hasNewDefaultsChanged={setHasNewDefaults}
							onConfigChange={field.onChange}
							onErrorsChanged={errorsObj => handleConfigErrors(errorsObj, field)}
							value={field.value}
							onChange={field.onChange}
						/>
					)}
				/>
			</div>
			<div className="modal-footer">
				<button
					className="btn btn-primary mgmt-btn-primary"
					onClick={handleSubmit(onFormSubmit)}
					disabled={!formState.isValid || !formState.isDirty}
				>
					{isCreate ? 'Add' : 'Update'}
				</button>
				<button
					className="btn btn-default"
					onClick={() => {
						onCancel();
					}}
				>
					Cancel
				</button>

				{ hasNewDefaults &&
				<button
					className="btn btn-success pull-left"
					onClick={() => {
						if (configEditorRef.current)
							configEditorRef.current.importNewDefaults();
					}}
				>
					Import New Defaults
				</button>}

				{ isClusterDefault && <button
					className="btn btn-warning pull-left"
					onClick={() => {
						if (configEditorRef.current)
							configEditorRef.current.revetToNVmeshDefaults();
					}}
				>
					Revert to NVMesh Defaults
				</button>}
			</div>
		</>
	);
};

const CreateEditConfigProfileModal = ({
	isOpen,
	profile = {},
	handleCancel = () => {},
	onSubmitProfile = () => {}
}) => {
	return (
		<Modal
			isOpen={isOpen}
			disableBackdropClose
			onClose={() => handleCancel()}
			title="Configuration Profile"
			className="modal-lg">
			<CreateEditConfigProfile
				profile={profile}
				onCancel={handleCancel}
				onSubmit={onSubmitProfile}
			/>
		</Modal>
	);
};

export default CreateEditConfigProfileModal;