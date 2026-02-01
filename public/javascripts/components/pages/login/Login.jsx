/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */
import LoginForm from './LoginForm.jsx';
import ChangePasswordForm from './ChangePasswordForm.jsx';

const Login = () => {
	const currentPath = window.location.pathname;

	return (
		<div className="background">
			<div className="logo-container">
				<img id="nvmeshLogo" src="/images/exceleroLogoLogin.svg" alt="NVMesh Logo"/>
			</div>

			<div className="container">
				{currentPath === '/login' && <LoginForm />}
				{currentPath === '/login/changePassword' && <ChangePasswordForm />}
			</div>

			<div className="nvmesh-bar">
				<div>
					<span>With joint innovation from</span>
					<span>
						<img src="../images/excelero-logo.png" alt="NVMesh"/>
					</span>
				</div>
			</div>
		</div>
	);
};

export default Login;
