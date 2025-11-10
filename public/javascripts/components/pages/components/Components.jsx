/* global React */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import CreateEditComponentModal from './CreateEditComponentModal.jsx';
import { ComponentsService } from '../../services/api/components.service.js';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import { useAlerts } from '../../core/Alert.jsx';
import useQueryParams from '../../useQueryParams.hook.js';
import { extractErrorMsg, extractResults } from '../../utils.js';
import { events, SocketService } from '../../services/socket.service.js';

const { useRef, useState, useEffect } = React;

const Components = () => {
	const tableRef = useRef();
	const [confirm] = useConfirmationDialog();
	const [component, setComponent] = useState({});
	const [selectedComponents, setSelectedComponents] = useState([]);
	const [showCreateEditModal, setShowCreateEditModal] = useState(false);
	const { getQueryParam, setQueryParam } = useQueryParams();
	const { successAlert, errorAlert } = useAlerts();

	useEffect(() => {
		const createParam = getQueryParam('create');
		if (createParam) {
			newComponent(createParam);
		}

		SocketService.addHandler(events.newComponentEvent.name, () => {
			reloadTable();
		});
	}, []);

	const columns = [
		{
			name: 'Type',
			field: 'component.componentType.name',
			placeholder: 'Search by Type',
			className: 'fixed-size-column md-column',
			value: row => <span>{row.component.componentType.name}</span>
		},
		{
			name: 'Component',
			field: 'component.name',
			placeholder: 'Search by Component',
			className: 'fixed-size-column',
			value: row => <span>{row.component.name}</span>
		},
		{
			name: 'Version',
			field: 'version',
			placeholder: 'Search by Version',
			className: 'fixed-size-column md-column',
			rowClassName: 'wrap fixed-size-column',
			value: row => <span>{row.version}</span>
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
				<a className="fa fa-pencil edit-button" onClick={() => editComponent(row)}></a>
			),
		}
	];

	const reloadTable = () => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	};

	const createComponent = async(component) => {
		const responses = await ComponentsService.create([component]);
		if (responses[0].success) {
			successAlert(`${component.version} component created successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to create Component ${component.version} - ${errorMsg}`);
		}
	};

	const updateComponent = async(component) => {
		const responses = await ComponentsService.update([component]);
		if (responses[0].success) {
			successAlert(`${component.version} component updated successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to update Component ${component.version} - ${errorMsg}`);
		}
	};

	const deleteComponents = async() => {
		const confirmed = await confirm(`Are you sure you want to delete ${selectedComponents.length} Components?`);
		if (!confirmed) {
			return;
		}

		const payload = selectedComponents.map((s) => ({ ID: s.ID }));

		const responses = await ComponentsService.delete(payload);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Component(s) deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity.ID).join(', ');
			errorAlert(`Failed to delete component(s) ${ids} - ${errorMsg}`);
		});
	};

	const editComponent = (component) => {
		setComponent(component);
		setShowCreateEditModal(true);
	};

	const newComponent = (initialComponent = {}) => {
		setShowCreateEditModal(true);
		setComponent(initialComponent);
	};

	const onCancelCreateEditComponent = () => {
		setShowCreateEditModal(false);
		setComponent({});
		setQueryParam('create', null);
	};

	const onSubmitComponent = async(editedComponent) => {
		const isCreate = !editedComponent.ID;
		if (isCreate) {
			await createComponent(editedComponent);
		} else {
			await updateComponent(editedComponent);
		}
		setShowCreateEditModal(false);
		setComponent({});
		setQueryParam('create', null);
	};

	const loadRows = async(filter, sort, currentPage, count) => {
		const components = await ComponentsService.loadComponentVersions(filter, sort, currentPage, count);
		components.forEach(component => {
			const componentEventName = SocketService.getComponentID(component.ID) + events.componentChangedEvent.name;
			SocketService.addHandler(componentEventName, ({ payload }) => {
				if (tableRef.current) {
					tableRef.current.updateRow(payload.ID, Object.assign(component, payload));
				}
			});
		});
		return components;
	};

	return (
		<div className="page-content">
			<CreateEditComponentModal isOpen={showCreateEditModal}
				component={component}
				handleCancel={() => onCancelCreateEditComponent()}
				onSubmit={component => onSubmitComponent(component)}/>
			<h1>Components</h1>

			<div className="action-container">
				<button className="btn btn-info mgmt-btn-info"
				        disabled={selectedComponents.length === 0}
				        onClick={() => deleteComponents()}>
					Delete
				</button>
			</div>

			<FiltSortTable ref={tableRef}
				tableId="components"
				columns={columns}
				loadTotal={ComponentsService.loadTotal}
				loadRows={loadRows}
				rowIdentifier="ID"
				multiselectOptions={{
					enabled: true,
					onSelectedRowsChange: selectedRows => {
						setSelectedComponents(selectedRows);
					}
				}}
			/>
			<div className="fab" onClick={() => newComponent()}>
				<i className="fa fa-plus"></i>
			</div>
		</div>
	);
};

export default Components;