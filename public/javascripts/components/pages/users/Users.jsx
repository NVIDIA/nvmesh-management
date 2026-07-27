/* global React, consts  */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { UsersService } from '../../services/api/users.service.js';
import { extractErrorMsg, extractResults } from '../../utils.js';
import { useAlerts } from '../../core/Alert.jsx';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import CreateEditUserModal from './CreateEditUserModal.jsx';
import ChangePasswordModal from './ChangePasswordModal.jsx';
import ConcurrentSessionsModal from './ConcurrentSessionsModal.jsx';
import { useAppContext } from '../App.jsx';
import NewButton from '../../shared/NewButton.jsx';

const { useRef, useState, useEffect } = React;

const UsersCount = ({ icon, title, count }) => {
	return (
		<div className="info-box">
			<span className="info-box-icon">{icon}</span>
			<div className="info-box-content">
				<span>{title}</span>
				<span className="info-box-value">{count}</span>
			</div>
		</div>
	);
};

const Users = () => {
	const tableRef = useRef();
	const { defaultDomain, currUser } = useAppContext();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const [selectedUsers, setSelectedUsers] = useState([]);
	const [user, setUser] = useState(null);
	const [concurrentSessions, setConcurrentSessions] = useState(0);
	const [adminCount, setAdminCount] = useState(0);
	const [observersCount, setObserversCount] = useState(0);
	const [showCreateEditModal, setShowCreateEditModal] = useState(false);
	const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
	const [showConcurrentSessionModal, setShowConcurrentSessionModal] = useState(false);

	useEffect(() => {
		const fetch = async() => {
			const res = await UsersService.getConcurrentSessions();
			setConcurrentSessions(res);
		};

		fetch();
	}, []);

	const columns = [
		{
			name: 'Email',
			field: 'email',
			placeholder: 'Search by Email',
		},
		{
			name: 'Role',
			field: 'role',
			placeholder: 'Search by Role',
		},
		{
			name: 'Notification Level',
			field: 'notificationLevel',
			placeholder: 'Search by Notification Level',
		},
		{
			name: 'Last Modified By',
			field: 'modifiedBy',
			placeholder: 'Search by Last Modifier',
		},
		{
			name: 'Date Created',
			field: 'dateCreated',
			type: 'dateRange',
		},
		{
			name: 'Actions',
			title: '',
			filterable: false,
			sortable: false,
			draggable: false,
			className: 'fixed-size-column action-column',
			value: (user) => (
				<>
					<a className="fa fa-pencil edit-button mr-10"
					   onClick={() => editUser(user)}></a>
					{user.email === currUser.email && <a className="fa fa-refresh edit-button"
					                                        title="Change Password"
					                                        onClick={() => onChangePassword(user)}></a>}
				</>
			),
		},
	];

	const reloadTable = () => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	};

	// eslint-disable-next-line no-unused-vars
	const loadRows = async(filter, sort, currentPage, count) => {
		const users = await UsersService.loadAll(filter, sort);

		setAdminCount(users.filter(user => user.role === consts.userRoles.ADMIN).length);
		setObserversCount(users.filter(user => user.role === consts.userRoles.OBSERVER).length);

		return users;
	};

	const deleteUsers = async(users) => {
		const confirmed = await confirm(`Are you sure you want to delete ${users.length} users?`);
		if (!confirmed) {
			return;
		}

		const responses = await UsersService.deleteUsers(users);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Users deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Failed to delete users ${ids} - ${errorMsg}`);
		});
	};

	const createUser = async(user) => {
		const responses = await UsersService.createUsers([user]);
		if (responses[0].success) {
			successAlert(`${user.email} User created successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to create User ${user.email} - ${errorMsg}`);
		}
	};

	const updateUser = async(user) => {
		const responses = await UsersService.updateUsers([user]);
		if (responses[0].success) {
			successAlert(`${user.email} User updated successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to updated User ${user.email} - ${errorMsg}`);
		}
	};

	const disconnectSession = async(session) => {
		const responses = await UsersService.disconnectUsers([session]);
		if (responses.success) {
			successAlert(`${session.email} User disconnected successfully`);
			const res = await UsersService.getConcurrentSessions();
			setConcurrentSessions(res);
		} else {
			const errorMsg = extractErrorMsg(responses.error);
			errorAlert(`Failed to disconnect User ${session.email} - ${errorMsg}`);
		}
	};

	const onSubmitChangePassword = async(data) => {
		const payload = {
			...user,
			changePassword: data,
			relogin: true
		};

		const responses = await UsersService.updateUsers([payload]);
		if (responses[0].success) {
			window.location.href = '/login';
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to change password - ${errorMsg}`);
		}
	};

	const onSubmitUser = async(user) => {
		const isCreate = !user._id;
		if (isCreate) {
			await createUser(user);
		} else {
			await updateUser(user);
		}
		setShowCreateEditModal(false);
	};

	const newUser = () => {
		setUser({ role: consts.userRoles.OBSERVER, notificationLevel: 'NONE' });
		setShowCreateEditModal(true);
	};

	const editUser = (user) => {
		setUser(user);
		setShowCreateEditModal(true);
	};

	const onCancelCreateEditUser = () => {
		setShowCreateEditModal(false);
	};

	const onChangePassword = (user) => {
		setUser(user);
		setShowChangePasswordModal(true);
	};

	return (
		<div className="page-content">
			<CreateEditUserModal isOpen={showCreateEditModal}
			                     user={user}
			                     handleCancel={() => onCancelCreateEditUser()}
			                     defaultDomain={defaultDomain}
			                     onSubmit={user => onSubmitUser(user)}/>

			<ChangePasswordModal isOpen={showChangePasswordModal}
			                     handleCancel={() => {
				                     setShowChangePasswordModal(false);
			                     }}
			                     onSubmit={data => onSubmitChangePassword(data)}/>

			<ConcurrentSessionsModal isOpen={showConcurrentSessionModal}
			                         concurrentSessions={concurrentSessions}
			                         handleDisconnect={session => disconnectSession(session)}
			                         handleCancel={() => setShowConcurrentSessionModal(false)}/>

			<h1>Users</h1>

			<div className="info-box-container">
				<UsersCount title="Admins"
				            count={adminCount}
				            icon={<i className="ion ion-person"></i>}
				/>
				<UsersCount title="Observers"
				            count={observersCount}
				            icon={<i className="fa fa-binoculars" style={{ fontSize: '50pt' }}></i>}
				/>
				<a onClick={(() => setShowConcurrentSessionModal(true))}>
					<UsersCount title="Concurrent Sessions"
					            count={concurrentSessions.length}
					            icon={<i className="ion ion-android-contacts"></i>}
					/>
				</a>
			</div>

			<div className="action-container">
				<button className="btn btn-info mgmt-btn-info"
				        disabled={!selectedUsers.length || selectedUsers.some(user => user.email === consts.ADMIN_USER)}
				        onClick={() => deleteUsers(selectedUsers)}>
					Delete
				</button>
			</div>

			<FiltSortTable ref={tableRef}
			               tableId="users"
			               columns={columns}
			               loadTotal={UsersService.loadTotal}
			               loadRows={loadRows}
			               paginationDisabled={true}
			               multiselectOptions={{
				               enabled: true,
				               onSelectedRowsChange: selectedRows => {
					               setSelectedUsers(selectedRows);
				               }
			               }}
			/>

			<NewButton onClick={() => newUser()} />
		</div>
	);
};

export default Users;