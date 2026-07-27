/* global React, ReactHookForm, consts */

import FormControl from '../../core/FormControl.jsx';
import Input from '../../core/Input.jsx';
import Modal from '../../core/Modal.jsx';
import Select from '../../core/Select.jsx';
import { UsersService } from '../../services/api/users.service.js';
import { extractErrorMsg } from '../../utils.js';
import { useAlerts } from '../../core/Alert.jsx';

const { useState } = React;
const { useForm, Controller } = ReactHookForm;

const EMAIL_REGEXP = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const FIRST_EMAIL_PART_REGEXP = /^[a-zA-Z0-9._%+-]+$/;

const CreateEditUser = ({
	user = {},
	handleCancel = () => {},
	defaultDomain,
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const isCreate = !user._id;
	const { errorAlert } = useAlerts();
	const [relogin, setRelogin] = useState(false);
	const [showDomain, setShowDomain] = useState(true);
	const [isResetPasswordLoading, setIsResetPasswordLoading] = useState(false);
	const [newPassword, setNewPassword] = useState(null);
	const { register, handleSubmit, formState, watch, control } = useForm({ mode: 'all' });

	const onFormSubmit = (data) => {
		const userToSubmit = {
			...user,
			...data,
			relogin,
		};

		if (!userToSubmit.email.includes('@')) {
			userToSubmit.email = userToSubmit.email + defaultDomain;
		}

		onSubmit(userToSubmit);
	};

	const resetPassword = async() => {
		const userToUpdate = {
			...user,
			resetPassword: true,
			relogin: true,
		};

		setIsResetPasswordLoading(true);
		const responses = await UsersService.updateUsers([userToUpdate]);
		if (responses[0].success) {
			setNewPassword(responses[0].payload.newPassword);
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to Reset User's password ${user.email} - ${errorMsg}`);
		}
		setIsResetPasswordLoading(false);
	};

	return (
		<>
			<div className="modal-body">
				<FormControl name="email"
				             label="Email"
				             errorMessage={formState.errors?.email?.message}>
					<Input name="email"
					       className="form-control"
					       disabled={!isCreate}
					       placeholder="Enter Email"
					       {...register('email', {
						       value: user.email,
						       required: 'Email is required',
						       onChange: (e) => {
							       if (e.target.value.includes('@')) {
								       setShowDomain(false);
							       } else {
								       setShowDomain(true);
							       }
						       },
						       validate: (value) => {
							       if (value.includes('@')) {
								       if (!EMAIL_REGEXP.test(value)) return 'Email is not valid';
							       } else {
								       if (!FIRST_EMAIL_PART_REGEXP.test(value)) return 'Email is not valid';
							       }
						       },
					       })}
					       autoFocus
					/>
					{isCreate && showDomain && <span className="atdomain">{defaultDomain}</span>}

				</FormControl>

				{isCreate && <FormControl name="password"
				                          label="Password"
				                          errorMessage={formState.errors?.password?.message}>
					<Input name="password"
					       type="password"
					       className="form-control"
					       placeholder="Choose Password"
					       {...register('password', {
						       value: user.password,
						       required: 'Password is required',
						       maxLength: { value: 32, message: 'exceed maximum length of 32' }
					       })}
					/>
				</FormControl>}

				{isCreate && <FormControl name="confirmationPassword"
				                          label="Re-type password"
				                          errorMessage={formState.errors?.confirmationPassword?.message}>
					<Input name="confirmationPassword"
					       type="password"
					       className="form-control"
					       {...register('confirmationPassword', {
						       required: 'Password is required',
						       validate: (val) => {
							       if (watch('password') !== val) {
								       return 'Password entries do no match';
							       }
						       },
					       })}
					/>
				</FormControl>}

				<FormControl name="role"
				             label="Role"
				             errorMessage={formState.errors?.role?.message}>
					<Controller
						control={control}
						name="role"
						defaultValue={user.role}
						rules={{
							required: 'Role is required'
						}}
						render={({ field: { onChange, value } }) => (
							<Select
								id="role"
								placeholder="Choose a role"
								value={value}
								onChange={value => {
									if (!isCreate && value !== user.role) {
										setRelogin(true);
									}
									onChange(value);
								}}
								disabled={user.email === consts.ADMIN_USER}
								options={[
									{ text: consts.userRoles.ADMIN, value: consts.userRoles.ADMIN },
									{ text: consts.userRoles.OBSERVER, value: consts.userRoles.OBSERVER }
								]}
							/>
						)}
					/>

				</FormControl>

				<FormControl name="notificationLevel"
				             label="Email Notifications Level"
				             errorMessage={formState.errors?.notificationLevel?.message}>
					<Controller
						control={control}
						name="notificationLevel"
						defaultValue={user.notificationLevel}
						rules={{
							required: 'Email Notifications Level is required'
						}}
						render={({ field: { onChange, value } }) => (
							<Select id="notificationLevel"
							        placeholder="Choose Notification Level"
							        value={value}
							        onChange={onChange}
							        options={[
								        { text: 'None', value: 'NONE' },
								        { text: 'Warning', value: 'WARNING' },
								        { text: 'Error', value: 'ERROR' }
							        ]}
							/>
						)}
					/>
				</FormControl>

				{user.email !== consts.ADMIN_USER && !isCreate && <>
					<button className="btn btn-danger mr-10"
					        disabled={isResetPasswordLoading}
					        onClick={() => resetPassword()}>
						Reset Password
					</button>
					{newPassword && <>
						<span>{'User\'s new password: '}</span>
						<strong>{newPassword}</strong>
					</>}
				</>}

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

const CreateEditUserModal = ({
	isOpen,
	user = {},
	handleCancel = () => {},
	defaultDomain,
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const isCreate = !user?._id;

	return (
		<Modal
			isOpen={isOpen}
			disableBackdropClose
			onClose={() => handleCancel()}
			title={`${isCreate ? 'Create' : 'Edit'} User`}>
			{user && <CreateEditUser
				user={user}
				handleCancel={handleCancel}
				defaultDomain={defaultDomain}
				onSubmit={onSubmit}/>}
		</Modal>
	);
};

export default CreateEditUserModal;