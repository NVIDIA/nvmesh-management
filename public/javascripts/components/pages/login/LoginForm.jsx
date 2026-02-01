/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */
import useQueryParams from '../../useQueryParams.hook.js';
import Input from '../../core/Input.jsx';

const { useState, useEffect } = React;

const LoginForm = () => {
	const { getQueryParam } = useQueryParams();
	const [username, setUsername] = useState('');
	const [error, setError] = useState('');

	useEffect(() => {
		const errParam = getQueryParam('err');
		const usernameParam = getQueryParam('username');

		if (errParam) setError('Wrong Credentials');
		if (usernameParam) setUsername(usernameParam);
	}, []);

	return (
		<form action="/login" method="post" role="form">
			<img id="nvmeshLogo" src="/images/NVMeshLogoLogin.png" alt="NVMesh Logo"/>
			<div className="form-group">
				<i className="icon fa fa-user placeholder-icon"></i>
				<Input placeholder="Username"
				       type="text"
				       className="form-control"
				       name="username"
				       autoFocus
				       value={username}
				       onChange={(e) => setUsername(e.target.value)}
				/>
			</div>
			<div className="form-group">
				<i className="icon password-icon placeholder-icon"></i>
				<Input placeholder="Password"
				       type="password"
				       className="form-control"
				       name="password"
				/>
			</div>

			{(() => {

				// Add redirectTo from url params to the body of the form
				const redirectTo = (() => {
					const params = new URLSearchParams(window.location.search);
					return params.get('redirectTo');
				})();
				return redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null;
			})()}
			<button type="submit" className="btn btn-primary submit-btn">Sign In</button>
			{error && <div className="has-error"><label id="error-label">{error}</label></div>}
		</form>
	);
};

export default LoginForm;