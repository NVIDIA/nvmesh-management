/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, ReactHookForm */

import FormControl from '../../core/FormControl.jsx';
import Input from '../../core/Input.jsx';
import Modal from '../../core/Modal.jsx';

const { useForm } = ReactHookForm;

const ChangePassword = ({
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const { register, handleSubmit, formState, watch } = useForm({ mode: 'all' });

	const onFormSubmit = (data) => {
		onSubmit(data);
	};

	return (
		<>
			<div className="modal-body">
				<FormControl name="newPassword"
				             label="Password"
				             errorMessage={formState.errors?.newPassword?.message}>
					<Input name="newPassword"
					       type="password"
					       className="form-control"
					       placeholder="Choose Password"
					       {...register('newPassword', {
						       required: 'Password is required',
						       maxLength: { value: 32, message: 'exceed maximum length of 32' }
					       })}
					       autoFocus
					/>
				</FormControl>

				<FormControl name="confirmation"
				             label="Re-type password"
				             errorMessage={formState.errors?.confirmation?.message}>
					<Input name="confirmation"
					       type="password"
					       className="form-control"
					       {...register('confirmation', {
						       required: 'Password is required',
						       validate: (val) => {
							       if (watch('newPassword') !== val) {
								       return 'Password entries do no match';
							       }
						       },
					       })}
					/>
				</FormControl>

			</div>
			<div className="modal-footer">
				<button className="btn btn-primary mgmt-btn-primary"
				        onClick={handleSubmit(onFormSubmit)}
				        disabled={!formState.isValid}>
					Change Password
				</button>
				<button className="btn btn-default" onClick={() => handleCancel()}>Cancel</button>
			</div>
		</>
	);
};

const CreateEditUserModal = ({
	isOpen,
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	return (
		<Modal isOpen={isOpen}
		       disableBackdropClose
		       onClose={() => handleCancel()}
		       title="Change Password">
			<ChangePassword handleCancel={handleCancel}
			                onSubmit={onSubmit}/>
		</Modal>
	);
};

export default CreateEditUserModal;