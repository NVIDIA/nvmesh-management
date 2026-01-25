/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, ReactHookForm */

import FormControl from '../../core/FormControl.jsx';
import Input from '../../core/Input.jsx';
import Modal from '../../core/Modal.jsx';
import ToggleButtonGroup from '../../core/ToggleButtonGroup.jsx';

const { useForm, Controller } = ReactHookForm;

const InitEncryption = ({
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {},
	initData
}) => {
	const { register, handleSubmit, formState, control } = useForm({ mode: 'all' });

	const onFormSubmit = (data) => {
		onSubmit(data);
	};

	return (
		<>
			<div className="modal-body">
				<FormControl name="passphrase"
				             label="Passphrase"
				             errorMessage={formState.errors?.passphrase?.message}>
					<Input name="passphrase"
					       type="text"
					       className="form-control"
					       placeholder="Enter passphrase"
					       {...register('passphrase', {
						       required: 'Passphrase is required',
						       minLength: { value: 8, message: 'At least 8 characters required' }
					       })}
					       autoFocus
					/>
				</FormControl>

				<FormControl name="slot"
				             label="Slot"
				             errorMessage={formState.errors?.slot?.message}>
					<Input name="slot"
					       type="number"
					       className="form-control"
					       placeholder="Enter slot"
					       min={0}
					       max={32}
					       {...register('slot', {
						       required: 'Slot is required',
						       value: initData.slot,
						       valueAsNumber: true,
						       min: { value: 0, message: 'Slot must be greater than 0' },
						       max: { value: 32, message: 'Slot must be less than 32' }
					       })}
					/>
				</FormControl>

				<FormControl label="Key Size"
				             name="keySize"
				             errorMessage={formState.errors?.keySize?.message}>
					<Controller
						control={control}
						name="keySize"
						defaultValue={initData.keySize}
						render={({ field: { onChange, value } }) => (
							<ToggleButtonGroup
								value={value}
								onChange={onChange}
								options={[
									{ label: '256', value: 256 },
									{ label: '512', value: 512 }
								]}
							/>
						)}
					/>
				</FormControl>

			</div>
			<div className="modal-footer">
				<button className="btn btn-primary mgmt-btn-primary"
				        onClick={handleSubmit(onFormSubmit)}
				        disabled={!formState.isValid}>
					Init
				</button>
				<button className="btn btn-default" onClick={() => handleCancel()}>Cancel</button>
			</div>
		</>
	);
};

const InitEncryptionModal = ({
	isOpen,
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {},
	initData
}) => {
	return (
		<Modal
			isOpen={isOpen}
			disableBackdropClose
			onClose={() => handleCancel()}
			title="Initialize Encryption">
			<InitEncryption
				handleCancel={handleCancel}
				onSubmit={onSubmit}
				initData={initData}/>
		</Modal>
	);
};

export default InitEncryptionModal; 