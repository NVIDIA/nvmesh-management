/* global React, consts */

import { AppContext } from '../App.jsx';

const { useContext } = React;

const TopNavbar = ({ onToggleSidebar }) => {
	const { currUser } = useContext(AppContext);
	const userInitials = currUser.email.substring(0, 1).toUpperCase();
	const { systemInfo } = useContext(AppContext);

	return (
		<header className="main-header">
			<a href="/" className="logo">
				<span className="logo-lg">
					<img width="130px" src="/images/NVMesh-white.svg"/>
				</span>
				<span className="logo-mini">
					<img src="/images/logo_w_small.svg"/>
				</span>
			</a>
			<nav className="navbar navbar-static-top flex" role="navigation">
				<a className="sidebar-toggle" onClick={() => onToggleSidebar()} role="button">
					<span className="sr-only">Toggle Navigation</span>
				</a>
				<div className="top-navbar-main">
					<span className="cluster-name">{systemInfo.clusterID}</span>
				</div>
				<div className="navbar-custom-menu">
					<ul className="nav navbar-nav">
						<li>
							<a href="mailto:support-nvmesh@nvidia.com?subject=NVMesh Support Request&body=Please describe your issue below:">
								Support
							</a>
						</li>
						<li>
							<a href="#" className="dropdown-toggle" data-toggle="dropdown" role="button" aria-haspopup="true" aria-expanded="true">
								Docs
								<span className="caret"></span>
							</a>
							<ul className="dropdown-menu nav">
								<li>
									<a target="_blank" href={consts.userManualURL} data-pjax="false" rel="noreferrer">User Guide</a>
								</li>
								<li>
									<a target="_blank" href={consts.restAPIURL} data-pjax="false" rel="noreferrer">REST API</a>
								</li>
								<li>
									<a target="_blank" href="https://www.excelero.com/release-notes" data-pjax="false" rel="noreferrer">Release Notes</a>
								</li>
							</ul>
						</li>
						<li className="user user-menu">
							<a href="#" className="username">
								<span className="user-avatar mr-5">{userInitials}</span>
								<span className="user-email">{currUser.email}</span>
							</a>
						</li>
						<li>
							<a href="/login/logout" data-pjax="false">Logout</a>
						</li>
					</ul>
				</div>
			</nav>
		</header>
	);
};

export default TopNavbar;