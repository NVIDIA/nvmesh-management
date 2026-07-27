/* global React */
import LoginForm from './LoginForm.jsx';
import ChangePasswordForm from './ChangePasswordForm.jsx';

const Login = () => {
	const currentPath = window.location.pathname;

	return (
		<div className="background">
			<div className="logo-container">
				<img id="exceleroLogo" src="/images/exceleroLogoLogin.svg" alt="Excelero Logo"/>
			</div>

			<div className="container">
				{currentPath === '/login' && <LoginForm />}
				{currentPath === '/login/changePassword' && <ChangePasswordForm />}
			</div>

			<div className="excelero-bar">
				<div>
					<span>With joint innovation from</span>
					<span>
						<img src="../images/excelero-logo.png" alt="Excelero"/>
					</span>
				</div>
			</div>
		</div>
	);
};

export default Login;