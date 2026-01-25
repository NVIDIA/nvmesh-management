/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, ReactHookForm */

import Input from '../../core/Input.jsx';
import FormControl from '../../core/FormControl.jsx';
import Modal from '../../core/Modal.jsx';

const { useForm } = ReactHookForm;

const CreateEditKey = ({
	keyPair: key = {},
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const isCreate = !key.uuid;
	const { register, handleSubmit, formState } = useForm({ mode: 'all' });

	const onFormSubmit = (data) => {
		const editedKeys = {
			...key,
			...data
		};
		onSubmit(editedKeys);
	};

	return (
		<>
			<div className="modal-body">
				<FormControl
					name="_id"
					label="Name"
					required
					errorMessage={formState.errors?._id?.message}>
					<Input
						name="_id"
						className="form-control"
						disabled={!isCreate}
						placeholder="Enter name"
						{...register('_id', {
							value: key._id,
							required: 'Name is required',
							pattern: { value: /^[\w-]+$/, message: 'Invalid name' },
							maxLength: { value: 1024, message: 'exceed maximum length of 1024' }
						})}
						autoFocus
						required
					/>
				</FormControl>
				<FormControl
					name="description"
					label="Description"
					errorMessage={formState.errors?.description?.message}>
					<Input
						name="description"
						className="form-control"
						placeholder="Enter description"
						{...register('description', {
							value: key.description,
							maxLength: { value: 1024, message: 'exceed maximum length of 1024' }
						})}
					/>
				</FormControl>
			</div>
			<div className="modal-footer">
				<button
					className="btn btn-primary mgmt-btn-primary"
					onClick={handleSubmit(onFormSubmit)}
					disabled={!formState.isValid}>
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

const CreateEditKeyModal = ({
	isOpen,
	keyPair: key = {},
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {

	return (
		<Modal
			isOpen={isOpen}
			disableBackdropClose
			onClose={() => handleCancel()}
			title="Key Pair"
			attachToRoot>
			<CreateEditKey
				keyPair={key}
				handleCancel={handleCancel}
				onSubmit={onSubmit} />
		</Modal>
	);
};

export default CreateEditKeyModal;