/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, ReactHookForm */

import Input from '../../core/Input.jsx';
import FormControl from '../../core/FormControl.jsx';
import Modal from '../../core/Modal.jsx';
import { OperatingSystemsService } from '../../services/api/operatingSystems.service.js';
import { debounce } from '../../utils.js';
import DistributionTypeSelect from '../operatingSystems/DistributionTypeSelect.jsx';

const { useState, useEffect } = React;
const { useForm } = ReactHookForm;

const CreateEditOperatingSystem = ({
	operatingSystem: operatingSystem = {},
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const isCreate = !operatingSystem.ID;
	const [isLoaded, setIsLoaded] = useState(false);
	const [distributionTypes, setDistributionTypes] = useState([]);
	const [selectedDistributionType, setSelectedDistributionType] = useState(operatingSystem.distributionType);
	const { register, handleSubmit, formState, setError, clearErrors, getValues } = useForm({ mode: 'all' });
	const isFormValid = formState.isValid && !formState.errors.versionExists;

	useEffect(() => {
		const fetchDistributionTypes = async() => {
			const distributionTypesFound = await OperatingSystemsService.getDistributionTypes();
			setDistributionTypes(distributionTypesFound);

			const initialDistributionType = distributionTypesFound.find(dt => dt.name === operatingSystem.distributionType);
			if (initialDistributionType)
				setSelectedDistributionType(initialDistributionType);

			setIsLoaded(true);
		};
		fetchDistributionTypes();
	}, []);

	const onFormSubmit = (data) => {
		const editedOperatingSystem = {
			...operatingSystem,
			...data,
			distributionType: selectedDistributionType
		};
		onSubmit(editedOperatingSystem);
	};

	const isVersionExists = async(version, distributionTypeID) => {
		if (!version || !distributionTypeID)
			return false;

		const filter = { version, distributionTypeID };
		const count = await OperatingSystemsService.loadTotal(filter);
		return count > 0;
	};

	const isVersionExistsDebounced = debounce(async(version, distributionTypeID) => {
		const exists = await isVersionExists(version, distributionTypeID);
		return exists;
	}, 500);

	return isLoaded && (
		<>
			<div className="modal-body">
				<FormControl
					name="version"
					label="Version"
					required
					errorMessage={formState.errors?.version?.message || formState.errors?.versionExists?.message}>
					<Input
						name="version"
						className="form-control"
						placeholder="Enter name"
						{...register('version', {
							value: operatingSystem.version,
							required: 'Version is required',
							pattern: { value: /^[a-zA-Z0-9_.-]*$/, message: 'Invalid version' },
							maxLength: { value: 1024, message: 'exceed maximum length of 1024' }
						})}
						onChange={async(e) => {
							const version = e.target.value;
							const distributionType = distributionTypes.find(dt => dt.name === selectedDistributionType?.name);

							if (distributionType) {
								const alreadyExists = await isVersionExistsDebounced(version, distributionType.ID);
								if (alreadyExists) {
									setError('versionExists', { type: 'custom', message: 'Version already exists' });
								} else {
									clearErrors('versionExists');
								}
							}
						}}
						autoFocus
						required
					/>
				</FormControl>

				<DistributionTypeSelect
					distributionTypes={distributionTypes}
					selectedDistributionType={selectedDistributionType}
					onChange={async(distributionType) => {
						const version = getValues('version');

						if (distributionType) {
							const alreadyExists = await isVersionExistsDebounced(version, distributionType.ID);
							if (alreadyExists) {
								setError('versionExists', { type: 'custom', message: 'Version already exists' });
							} else {
								clearErrors('versionExists');
							}
						} else {
							clearErrors('versionExists');
						}

						setSelectedDistributionType(distributionType);
					}}
				/>
			</div>
			<div className="modal-footer">
				<button
					className="btn btn-primary mgmt-btn-primary"
					onClick={handleSubmit(onFormSubmit)}
					disabled={!isFormValid}>
					{isCreate ? 'Add' : 'Update'}
				</button>
				<button
					className="btn btn-default"
					onClick={() => handleCancel()}>
					Cancel
				</button>
			</div>
		</>
	);
};

const CreateEditOperatingSystemModal = ({
	isOpen,
	operatingSystem: operatingSystem = {},
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {

	return (
		<Modal
			isOpen={isOpen}
			disableBackdropClose
			onClose={() => handleCancel()}
			title="Operating System">
			<CreateEditOperatingSystem
				operatingSystem={operatingSystem}
				handleCancel={handleCancel}
				onSubmit={onSubmit} />
		</Modal>
	);
};

export default CreateEditOperatingSystemModal;