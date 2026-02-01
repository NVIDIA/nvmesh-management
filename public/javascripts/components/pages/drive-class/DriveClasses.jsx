/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { useAlerts } from '../../core/Alert.jsx';
import CreateEditDriveClassModal from './CreateEditDriveClassModal.jsx';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import { DiskClassesService } from '../../services/api/diskClasses.service.js';
import { extractErrorMsg, extractResults } from '../../utils.js';
import useQueryParams from '../../useQueryParams.hook.js';
import NewButton from '../../shared/NewButton.jsx';

const {
	useState,
	useRef,
	Fragment,
	useEffect
} = React;

const DriveClasses = () => {
	const tableRef = useRef();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const { getQueryParam, setQueryParam } = useQueryParams();
	const [selectedDrives, setSelectedDrives] = useState([]);
	const [showCreateEditModal, setShowCreateEditModal] = useState(false);
	const [driveClass, setDriveClass] = useState({});
	const [domains, setDomains] = useState([]);
	const [isEditMode, setIsEditMode] = useState(false);

	useEffect(() => {
		loadDomains();
		const createParam = getQueryParam('create');
		if (createParam) {
			newDriveClass(createParam);
		}
	}, []);

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
			name: 'Tags',
			field: 'tags',
			placeholder: 'Search by Tags',
			value: row => row.tags?.map(tag =>
				<Fragment key={tag}>
					<span className="label label-info">{tag}</span>&nbsp;
				</Fragment>),
		},
		{
			name: '# of Drives',
			field: 'disks',
			rowClassName: 'fixed-size-column sx-column',
			filterable: false,
			sortable: false,
			value: (row) => row.disks.length,
		},
		{
			name: 'Protection Domains',
			field: 'domains',
			customDataFilter: 'domainsTableFilter',
			customDataSortField: 'domains.0.scope',
			placeholder: 'Search by Protection Domains',
			value: (row) => row.domains?.map(d =>
				<Fragment key={d.scope + d.identifier}>
					<span
						className="label bg-green">{d.scope}:{d.identifier}</span>&nbsp;
				</Fragment>),
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
				<a className="fa fa-pencil edit-button" onClick={() => editDriveClass(row)}></a>
			),
		},
	];

	const loadDomains = async() => {
		const domains = await DiskClassesService.getDomains();
		setDomains(domains.map(d => `${d.scope}:${d.identifier}`));
	};

	const reloadTable = () => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	};

	const createDriveClass = async(driveClass) => {
		const responses = await DiskClassesService.create([driveClass]);
		if (responses[0].success) {
			successAlert(`${driveClass._id} Drive class created successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to create Drive class ${driveClass._id} - ${errorMsg}`);
		}
	};

	const updateDriveClass = async(driveClass) => {
		const responses = await DiskClassesService.update([driveClass]);
		if (responses[0].success) {
			successAlert(`${driveClass._id} Drive class updated successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to updated Drive class ${driveClass._id} - ${errorMsg}`);
		}
	};

	const deleteDriveClasses = async() => {
		const confirmed = await confirm(`Are you sure you want to delete ${selectedDrives.length} Drive classes?`);
		if (!confirmed) {
			return;
		}

		const payload = selectedDrives.map(({ _id, uuid }) => ({ _id: _id, uuid }));

		const responses = await DiskClassesService.delete(payload);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Drive classes deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Failed to delete Drive classes ${ids} - ${errorMsg}`);
		});
	};

	const editDriveClass = (driveClass) => {
		setIsEditMode(true);
		setDriveClass(driveClass);
		setShowCreateEditModal(true);
	};

	const newDriveClass = (initialDriveClass = {}) => {
		initialDriveClass.tags = initialDriveClass.tags || [];
		setIsEditMode(false);
		setDriveClass(initialDriveClass);
		setShowCreateEditModal(true);
	};

	const onCancelCreateEditDriveClass = () => {
		setShowCreateEditModal(false);
		setDriveClass({});
		setQueryParam('create', null);
	};

	const onSubmitDriveClass = async(editedDriveClass) => {
		if (isEditMode) {
			await updateDriveClass(editedDriveClass);
		} else {
			await createDriveClass(editedDriveClass);
		}
		setShowCreateEditModal(false);
		setDriveClass({});
		setQueryParam('create', null);
	};

	return (
		<div className="page-content">
			<CreateEditDriveClassModal
				isOpen={showCreateEditModal}
				isEditMode={isEditMode}
				driveClass={driveClass}
				domains={domains}
				handleCancel={() => onCancelCreateEditDriveClass()}
				onSubmit={driveClass => onSubmitDriveClass(driveClass)}/>
			<h1>Drive Classes</h1>

			<div className="action-container">
				<button className="btn btn-info mgmt-btn-info"
				        disabled={selectedDrives.length === 0}
				        onClick={() => deleteDriveClasses()}>
					Delete
				</button>
			</div>

			<FiltSortTable ref={tableRef}
			               tableId="driveClasses"
			               columns={columns}
			               loadTotal={DiskClassesService.loadTotal}
			               loadRows={DiskClassesService.load}
			               multiselectOptions={{
				               enabled: true,
				               onSelectedRowsChange: selectedRows => {
					               setSelectedDrives(selectedRows);
				               }
			               }}
			/>

			<NewButton onClick={() => newDriveClass()} />
		</div>
	);
};

export default DriveClasses;