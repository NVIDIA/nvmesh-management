/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, ReactHookForm */

import Input from '../../core/Input.jsx';
import ArchTypesSelect from './ArchTypesSelect.jsx';
import OperatingSystemSelect from './OperatingSystemSelect.jsx';
import KernelSelect from './KernelSelect.jsx';
import OfedSelect from './OfedSelect.jsx';
import FormControl from '../../core/FormControl.jsx';
import Modal from '../../core/Modal.jsx';

import { PlatformsService } from '../../services/api/platforms.service.js';
import { KernelsService } from '../../services/api/kernels.service.js';
import { OfedsService } from '../../services/api/ofeds.service.js';
import { OperatingSystemsService } from '../../services/api/operatingSystems.service.js';

const { useState, useEffect } = React;
const { useForm, Controller } = ReactHookForm;

const CreateEditPlatform = ({
	platform = {},
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const isCreate = !platform.ID;
	const [archTypes, setArchTypes] = useState([]);
	const [isLoaded, setIsLoaded] = useState(false);
	const [operatingSystems, setOperatingSystems] = useState([]);
	const [kernels, setKernels] = useState([]);
	const [ofeds, setOfeds] = useState([]);

	const { register, handleSubmit, formState, control } = useForm({ mode: 'all' });

	useEffect(() => {
		Promise.all([
			PlatformsService.getAllArchTypes(),
			OperatingSystemsService.loadOperatingSystems({}, { 'distributionType.name': 1, 'version': 1 }, 0, 0),
			KernelsService.loadKernels({}, { 'version': 1 }, 0, 0),
			OfedsService.loadOfeds({}, { 'version': 1 }, 0, 0)
		]).then(([archTypes, operatingSystems, kernels, ofeds]) => {
			setArchTypes(archTypes);
			setOperatingSystems(operatingSystems);
			setKernels(kernels);
			setOfeds(ofeds);
			setIsLoaded(true);
		});
	}, []);

	const onFormSubmit = (data) => {
		const editedPlatform = {
			...platform,
			...data,
		};

		onSubmit(editedPlatform);
	};

	return isLoaded && (
		<>
			<div className="modal-body">
				<FormControl name="name"
				             label="Name"
				             errorMessage={formState.errors?.name?.message}>
					<Input name="name"
					       className="form-control"
					       disabled={!isCreate}
					       placeholder="Enter name"
					       {...register('name', {
						       value: platform.name,
						       required: 'Name is required',
						       pattern: { value: /^[a-zA-Z0-9_.-]*$/, message: 'Invalid name' },
						       maxLength: { value: 1024, message: 'exceed maximum length of 1024' }
					       })}
					       autoFocus
					/>
				</FormControl>
				<FormControl name="description"
				             label="Description"
				             errorMessage={formState.errors?.description?.message}>
					<Input name="description"
					       className="form-control"
					       placeholder="Enter description"
					       {...register('description', {
						       value: platform.description,
						       maxLength: { value: 1024, message: 'exceed maximum length of 1024' }
					       })}
					/>
				</FormControl>

				<Controller
					control={control}
					name="archTypeID"
					defaultValue={platform.archType?.ID}
					rules={{
						required: 'Architecture is required'
					}}
					render={({ field: { onChange, value } }) => (
						<ArchTypesSelect
							archTypes={archTypes}
							value={archTypes.find(a => a.ID === value)}
							onChange={v => onChange(v?.ID)}
						/>
					)}
				/>
				<Controller
					control={control}
					name="operatingSystemID"
					defaultValue={platform.operatingSystem?.ID}
					rules={{
						required: 'Operating System is required'
					}}
					render={({ field: { onChange, value } }) => (
						<OperatingSystemSelect
							operatingSystems={operatingSystems}
							value={operatingSystems.find(o => o.ID === value)}
							onChange={v => onChange(v?.ID)}
						/>
					)}
				/>

				<Controller
					control={control}
					name="kernelID"
					defaultValue={platform.kernel?.ID}
					rules={{
						required: 'Kernel is required'
					}}
					render={({ field: { onChange, value } }) => (
						<KernelSelect
							kernels={kernels}
							value={kernels.find(k => k.ID === value)}
							onChange={v => onChange(v?.ID)}
						/>
					)}
				/>

				<Controller
					control={control}
					name="ofedID"
					defaultValue={platform.ofed?.ID}
					rules={{
						required: 'Ofed is required'
					}}
					render={({ field: { onChange, value } }) => (
						<OfedSelect
							ofeds={ofeds}
							value={ofeds.find(o => o.ID === value)}
							onChange={v => onChange(v?.ID)}
						/>
					)}
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

const CreateEditPlatformModal = ({
	isOpen,
	platform = {},
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {

	return (
		<Modal
			isOpen={isOpen}
			disableBackdropClose
			onClose={() => handleCancel()}
			title="Platform"
			className="modal-lg">
			<CreateEditPlatform
				platform={platform}
				handleCancel={handleCancel}
				onSubmit={onSubmit}/>
		</Modal>
	);
};

export default CreateEditPlatformModal;