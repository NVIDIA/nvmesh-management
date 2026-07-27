/* global React */
import Input from '../../core/Input.jsx';
import { UsersService } from '../../services/api/users.service.js';

const { useState } = React;

const ChangePasswordForm = () => {
	const [password, setPassword] = useState('');
	const [confirmationPassword, setConfirmationPassword] = useState('');
	const [error, setError] = useState('');

	const handleSubmit = async(e) => {
		e.preventDefault();

		if (password !== confirmationPassword) {
			setError('Passwords do not match');
			return;
		}

		const result = await UsersService.changePassword({ password, confirmationPassword });
		if (result.success) {
			window.location.href = '/';
		} else {
			setError(result.error.message || 'An error occurred while changing the password.');
		}
	};

	return (
		<form id="changePasswordForm" role="form" onSubmit={handleSubmit}>
			<img id="nvmeshLogo" src="/images/NVMeshLogoLogin.png" alt="NVMesh Logo"/>
			<div className="content">Changing initial password is required</div>
			<div className="form-group">
				<i className="icon password-icon placeholder-icon"></i>
				<Input placeholder="Password"
				       type="password"
				       className="form-control"
				       name="password"
				       value={password}
				       onChange={(e) => setPassword(e.target.value)}
				/>
			</div>
			<div className="form-group">
				<i className="icon password-icon placeholder-icon"></i>
				<Input placeholder="Re-type password"
				       type="password"
				       className="form-control"
				       name="confirmationPassword"
				       value={confirmationPassword}
				       onChange={(e) => setConfirmationPassword(e.target.value)}
				/>
			</div>
			<button type="submit" className="btn btn-primary submit-btn">
				Submit
			</button>
			{error && <div className="has-error"><label id="error-label">{error}</label></div>}
		</form>
	);
};

export default ChangePasswordForm;