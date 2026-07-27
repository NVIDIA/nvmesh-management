/* global React */

import { AppContext } from '../pages/App.jsx';

const { useContext, useState, useMemo } = React;

const Sidebar = () => {
	const hasMongoClusterManagerRole = false; // TODO: add this to the context
	const [openSubmenus, setOpenSubmenus] = useState(new Set());

	const links = useMemo(() => [{
		url: '/',
		icon: 'fa-dashboard',
		caption: 'Dashboard',
		adminOnly: false
	}, {
		url: '/servers',
		icon: 'fa-bullseye',
		caption: 'Targets',
		adminOnly: false
	}, {
		url: '/clients',
		icon: 'fa-server',
		caption: 'Clients',
		adminOnly: false
	}, {
		url: '/volumes',
		icon: 'fa-bolt',
		caption: 'Volumes',
		adminOnly: false
	}, {
		url: '/disks',
		icon: 'fa-hdd-o filter:invert(1);',
		caption: 'Drives',
		adminOnly: false
	}, {
		icon: 'fa-gear',
		caption: 'Settings',
		adminOnly: true,
		subItems: [{
			url: '/generalSettings',
			icon: 'fa fa-cogs',
			caption: 'General'
		}, {
			url: '/configurationProfiles',
			icon: 'fa fa-sliders',
			caption: 'Configuration Profiles',
		}, {
			url: '/diskClasses',
			icon: 'fa fa-hdd-o',
			caption: 'Drive Classes'
		}, {
			url: '/keys',
			icon: 'fa fa-key',
			caption: 'Key Pairs'
		}, {
			url: '/volumeSecurityGroups',
			icon: 'fa fa-lock',
			caption: 'Volume Security Groups'
		}, {
			url: '/serverClasses',
			icon: 'fa fa-server',
			caption: 'Target Classes',
		}, {
			url: '/volumeProvisioningGroups',
			icon: 'fa-circle-o',
			caption: 'Provisioning Groups'
		}, {
			url: '/users',
			icon: 'fa-users',
			caption: 'Users',
		}]
	}, {
		icon: 'fa-wrench',
		caption: 'Maintenance',
		adminOnly: false,
		subItems: [{
			url: '/cluster',
			icon: 'fa-sitemap',
			caption: 'NVMesh Cluster',
			adminOnly: true,
		}, {
			url: '/logs',
			icon: 'fa-newspaper-o',
			caption: 'Logs',
			adminOnly: false,
		}, {
			url: '/backups',
			icon: 'fa fa-floppy-o',
			caption: 'Backups',
			adminOnly: true
		}, {
			url: '/upgrades',
			icon: 'fa fa-upload',
			caption: 'Upgrades',
			adminOnly: true
		}]
	}, {
		icon: 'fa-arrow-circle-o-up',
		caption: 'InteropDB',
		adminOnly: true,
		subItems: [
			{
				url: '/operatingSystems',
				icon: 'fa fa-linux',
				caption: 'Operating Systems'
			},
			{
				url: '/kernels',
				icon: 'fa fa-cog',
				caption: 'Kernels'
			},
			{
				url: '/ofeds',
				icon: 'fa fa-plug',
				caption: 'Ofeds'
			},
			{
				url: '/artifacts',
				icon: 'fa fa-cubes',
				caption: 'Artifacts',
			},
			{
				url: '/platforms',
				icon: 'fa fa-server',
				caption: 'Platforms',
			},
			{
				url: '/releases',
				icon: 'fa fa-tags',
				caption: 'Releases'
			},
			{
				url: '/components',
				icon: 'fa fa-puzzle-piece',
				caption: 'Components'
			},
			{
				url: '/upgradeScenarios',
				icon: 'fa fa-rocket',
				caption: 'Upgrade Scenarios'
			},
			{
				url: '/upgradeStepsScenarios',
				icon: 'fa fa-level-up',
				caption: 'Upgrade Steps'
			}]
	}, {
		icon: 'fa-area-chart',
		caption: 'Monitoring',
		adminOnly: true,
		subItems: [{
			url: '/managementCluster',
			icon: 'fa fa-desktop',
			caption: 'Management Cluster',
		},
		{
			url: '/mongoDB',
			icon: 'fa fa-database',
			caption: 'MongoDB',
			disabled: !hasMongoClusterManagerRole,
			title: !hasMongoClusterManagerRole ? 'N/A due to missing mongoDB cluster permissions' : null
		},
		{
			url: '/kafka',
			icon: 'fa fa-bar-chart',
			caption: 'Kafka'
		},
		{
			url: '/upgradeAgents',
			icon: 'fa fa-refresh',
			caption: 'Upgrade Agents'
		}]
	}, {
		url: '/about',
		icon: 'fa fa-info',
		caption: 'About',
	}], [hasMongoClusterManagerRole]);

	const toggleSubMenu = (event, link) => {
		if (!link.subItems) return;

		event.preventDefault();

		const isOpen = openSubmenus.has(link.caption);

		setOpenSubmenus(prev => {
			const newSet = new Set(prev);
			if (isOpen) {
				newSet.delete(link.caption);
			} else {
				newSet.add(link.caption);
			}
			return newSet;
		});
	};

	return (
		<aside className="main-sidebar">
			<section className="sidebar">
				<ul className="sidebar-menu">
					{links.map((link) => (
						<MenuLink
							key={link.caption}
							link={link}
							isOpen={openSubmenus.has(link.caption)}
							onToggleSubMenu={toggleSubMenu}/>
					))}
				</ul>
			</section>
		</aside>
	);
};

const MenuLink = ({
	link,
	isOpen,
	onToggleSubMenu
}) => {
	const { currUser } = useContext(AppContext);
	const isCurrentPage = window.location.pathname === link.url;

	return (
		<li key={link.caption} className={isCurrentPage ? 'selected' : ''}>
			{(!link.adminOnly || currUser.isAdmin) && (
				<a onClick={(event) => onToggleSubMenu(event, link)} href={link.url}>
					<i className={`fa ${link.icon}`}></i>
					<span>{link.caption}</span>
					{link.subItems &&
						<i className={`fa pull-right fa-chevron-left sub-menu-arrow ${(isOpen || isCurrentPage) ? 'rotated' : ''}`}></i>}
				</a>
			)}

			{link.subItems && <ul className={(isOpen || isCurrentPage) ? 'open' : ''}>
				{link.subItems.map((subLink) => (
					<li key={subLink.caption} title={subLink.title} disabled={subLink.disabled}>
						{(!subLink.adminOnly || currUser.isAdmin) && (
							<a href={subLink.url} disabled={subLink.disabled}>
								<i className={`fa ${subLink.icon}`}></i>
								<span>{subLink.caption}</span>
							</a>
						)}
					</li>
				))}
			</ul>}
		</li>
	);
};

export default Sidebar;