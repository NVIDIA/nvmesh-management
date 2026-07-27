/* global React */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { VolumeSecurityGroupsService } from '../../services/api/volumeSecurityGroups.service.js';
import { useAlerts } from '../../core/Alert.jsx';
import { extractErrorMsg, extractResults } from '../../utils.js';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import NewButton from '../../shared/NewButton.jsx';
import CreateEditVolumeSecurityGroupModal from './CreateEditVolumeSecurityGroupModal.jsx';

const { useRef, useState } = React;

const VolumeSecurityGroups = () => {
	const tableRef = useRef();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const [selectedVolumeSecurityGroups, setSelectedVolumeSecurityGroups] = useState([]);
	const [showCreateEditModal, setShowCreateEditModal] = useState(false);
	const [volumeSecurityGroup, setVolumeSecurityGroup] = useState({});

	const columns = [
		{
			name: 'Name',
			field: '_id',
			placeholder: 'Search by Name',
			className: 'fixed-size-column md-column',
		},
		{
			name: 'Description',
			field: 'description',
			placeholder: 'Search by Description',
		},
		{
			name: 'Last Modified By',
			field: 'modifiedBy',
			placeholder: 'Search by Last Modifier',
			className: 'fixed-size-column md-column',
		},
		{
			name: 'Date Modified',
			field: 'dateModified',
			placeholder: 'Search by Date Modified',
			type: 'dateRange',
			className: 'fixed-size-column md-column',
		},
		{
			name: 'Actions',
			title: '',
			filterable: false,
			sortable: false,
			draggable: false,
			className: 'fixed-size-column action-column',
			rowClassName: 'fixed-size-column',
			value: (row) => (
				<a className="fa fa-pencil edit-button" onClick={() => editVolumeSecurityGroup(row)}></a>
			),
		},
	];

	const reloadTable = () => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	};

	const createVolumeSecurityGroup = async(volumeSecurityGroup) => {
		const responses = await VolumeSecurityGroupsService.create([volumeSecurityGroup]);
		if (responses[0].success) {
			successAlert(`${volumeSecurityGroup._id} Volume Security Group created successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to create Volume Security Group ${volumeSecurityGroup._id} - ${errorMsg}`);
		}
	};

	const updateVolumeSecurityGroup = async(volumeSecurityGroup) => {
		const responses = await VolumeSecurityGroupsService.update([volumeSecurityGroup]);
		if (responses[0].success) {
			successAlert(`${volumeSecurityGroup._id} Volume Security Group updated successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to update Volume Security Group ${volumeSecurityGroup._id} - ${errorMsg}`);
		}
	};

	const deleteVolumeSecurityGroups = async() => {
		const confirmed = await confirm(`Are you sure you want to delete ${selectedVolumeSecurityGroups.length} volume security groups?`);
		if (!confirmed) {
			return;
		}

		const payload = selectedVolumeSecurityGroups.map(({ _id, uuid }) => ({ _id, uuid }));

		const responses = await VolumeSecurityGroupsService.delete(payload);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Volume Security Groups deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Failed to delete Volume Security Groups ${ids} - ${errorMsg}`);
		});
	};

	const editVolumeSecurityGroup = (volumeSecurityGroup) => {
		setShowCreateEditModal(true);
		setVolumeSecurityGroup(volumeSecurityGroup);
	};

	const newVolumeSecurityGroup = () => {
		setShowCreateEditModal(true);
		setVolumeSecurityGroup({});
	};

	const onCancelCreateEditVolumeSecurityGroup = () => {
		setShowCreateEditModal(false);
		setVolumeSecurityGroup({});
	};

	const onSubmitVolumeSecurityGroup = async(editedVolumeSecurityGroup) => {
		const isCreate = !editedVolumeSecurityGroup.uuid;
		if (isCreate) {
			await createVolumeSecurityGroup(editedVolumeSecurityGroup);
		} else {
			await updateVolumeSecurityGroup(editedVolumeSecurityGroup);
		}
		setShowCreateEditModal(false);
		setVolumeSecurityGroup({});
	};

	return (
		<div className="page-content">
			<CreateEditVolumeSecurityGroupModal
				isOpen={showCreateEditModal}
				volumeSecurityGroup={volumeSecurityGroup}
				handleCancel={onCancelCreateEditVolumeSecurityGroup}
				onSubmit={onSubmitVolumeSecurityGroup} />

			<h1>Volume Security Groups</h1>

			<div className="action-container">
				<button
					className="btn btn-info mgmt-btn-info"
					disabled={selectedVolumeSecurityGroups.length === 0}
					onClick={deleteVolumeSecurityGroups}
				>
					Delete
				</button>
			</div>

			<FiltSortTable
				ref={tableRef}
				tableId="volumeSecurityGroups"
				columns={columns}
				loadTotal={VolumeSecurityGroupsService.loadTotal}
				loadRows={VolumeSecurityGroupsService.loadVolumeSecurityGroups}
				multiselectOptions={{
					enabled: true,
					onSelectedRowsChange: setSelectedVolumeSecurityGroups
				}}
			/>

			<NewButton onClick={newVolumeSecurityGroup} />
		</div>	
	);
};

export default VolumeSecurityGroups;