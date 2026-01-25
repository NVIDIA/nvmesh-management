/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { useAlerts } from '../../core/Alert.jsx';
import CreateEditTargetClassModal from './CreateEditTargetClassModal.jsx';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import { TargetClassesService } from '../../services/api/targetClasses.service.js';
import { extractErrorMsg, extractResults } from '../../utils.js';
import useQueryParams from '../../useQueryParams.hook.js';
import NewButton from '../../shared/NewButton.jsx';

const {
	useState,
	useRef,
	Fragment,
	useEffect
} = React;

const TargetClasses = () => {
	const tableRef = useRef();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const { getQueryParam, setQueryParam } = useQueryParams();
	const [selectedTargets, setSelectedTargets] = useState([]);
	const [showCreateEditModal, setShowCreateEditModal] = useState(false);
	const [targetClass, setTargetClass] = useState({});
	const [domains, setDomains] = useState([]);

	useEffect(() => {
		loadDomains();
		const createParam = getQueryParam('create');
		if (createParam) {
			newTargetClass(createParam);
		}
	}, []);

	const columns = [
		{
			name: 'Name',
			field: 'name',
			placeholder: 'Search by Name',
			className: 'fixed-size-column md-column',
		},
		{
			name: 'Description',
			field: 'description',
			placeholder: 'Search by Description',
		},
		{
			name: 'Targets',
			field: 'targetNodes',
			placeholder: 'Search by Targets',
			value: row => <small>{row.targetNodes.join(', ')}</small>,
		},
		{
			name: 'Protection Domains',
			field: 'domains',
			placeholder: 'Search by Protection Domains',
			customDataFilter: 'domainsTableFilter',
			customDataSortField: 'domains.0.scope',
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
				<a className="fa fa-pencil edit-button" onClick={() => editTargetClass(row)}></a>
			),
		},
	];

	const loadDomains = async() => {
		const domains = await TargetClassesService.getDomains();
		setDomains(domains.map(d => `${d.scope}:${d.identifier}`));
	};

	const reloadTable = () => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	};

	const createTargetClass = async(targetClass) => {
		const responses = await TargetClassesService.create([targetClass]);
		if (responses[0].success) {
			successAlert(`${targetClass.name} Target class created successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to create Target class ${targetClass.name} - ${errorMsg}`);
		}
	};

	const updateTargetClass = async(targetClass) => {
		const responses = await TargetClassesService.update([targetClass]);
		if (responses[0].success) {
			successAlert(`${targetClass.name} Target class updated successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to updated Target class ${targetClass.name} - ${errorMsg}`);
		}
	};

	const deleteTargetClasses = async() => {
		const confirmed = await confirm(`Are you sure you want to delete ${selectedTargets.length} target classes?`);
		if (!confirmed) {
			return;
		}

		const payload = selectedTargets.map(({ _id, uuid }) => ({ _id: _id, uuid }));

		const responses = await TargetClassesService.delete(payload);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Target classes deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Failed to delete Target classes ${ids} - ${errorMsg}`);
		});
	};

	const editTargetClass = (targetClass) => {
		setShowCreateEditModal(true);
		setTargetClass(targetClass);
	};

	const newTargetClass = (initialTargetClass = {}) => {
		setShowCreateEditModal(true);
		setTargetClass(initialTargetClass);
	};

	const onCancelCreateEditTargetClass = () => {
		setShowCreateEditModal(false);
		setTargetClass({});
		setQueryParam('create', null);
	};

	const onSubmitTargetClass = async(editedTargetClass) => {
		const isCreate = !editedTargetClass._id;
		if (isCreate) {
			await createTargetClass(editedTargetClass);
		} else {
			await updateTargetClass(editedTargetClass);
		}
		setShowCreateEditModal(false);
		setTargetClass({});
		setQueryParam('create', null);
	};

	return (
		<div className="page-content">
			<CreateEditTargetClassModal isOpen={showCreateEditModal}
			                            targetClass={targetClass}
			                            domains={domains}
			                            handleCancel={() => onCancelCreateEditTargetClass()}
			                            onSubmit={targetClass => onSubmitTargetClass(targetClass)}/>
			<h1>Target Classes</h1>

			<div className="action-container">
				<button className="btn btn-info mgmt-btn-info"
				        disabled={selectedTargets.length === 0}
				        onClick={() => deleteTargetClasses()}>
					Delete
				</button>
			</div>

			<FiltSortTable ref={tableRef}
			               tableId="targetClasses"
			               columns={columns}
			               loadTotal={TargetClassesService.loadTotal}
			               loadRows={TargetClassesService.loadTargetClasses}
			               multiselectOptions={{
				               enabled: true,
				               onSelectedRowsChange: selectedRows => {
					               setSelectedTargets(selectedRows);
				               }
			               }}
			/>

			<NewButton onClick={() => newTargetClass()} />
		</div>
	);
};

export default TargetClasses;