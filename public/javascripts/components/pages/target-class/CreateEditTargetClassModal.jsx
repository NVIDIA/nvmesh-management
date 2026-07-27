/* global React, ReactHookForm */

import Input from '../../core/Input.jsx';
import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { TargetsService } from '../../services/api/targets.service.js';
import DomainsSelect from '../../shared/DomainsSelect.jsx';
import FormControl from '../../core/FormControl.jsx';
import Modal from '../../core/Modal.jsx';

const { useState } = React;
const { useForm } = ReactHookForm;

const CreateEditTargetClass = ({
	targetClass = {},
	handleCancel = () => {},
	domains = [],
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const isCreate = !targetClass._id;
	const [selectedTargets, setSelectedTargets] = useState(targetClass.targetNodes?.map((targetId) => ({ _id: targetId })) || []);
	const [selectedDomains, setSelectedDomains] = useState(targetClass.domains);
	const { register, handleSubmit, formState } = useForm({ mode: 'all' });

	const columns = [
		{
			name: 'Target ID',
			field: 'node_id',
			placeholder: 'Search by Target ID',
			sort: 'asc',
			value: row => <a href={`/servers/server/${row.node_id}`}> {row.node_id}</a>,
		},
		{
			name: 'Drives',
			field: 'disks',
			filterable: false,
			sortable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: row => row.disks.length,
		},
		{
			name: 'NICs',
			field: 'nics',
			filterable: false,
			sortable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: row => row.nics.length,
		},
		{
			name: 'Version',
			field: 'version',
			placeholder: 'Search by Version',
			className: 'fixed-size-column md-column',
		}
	];

	const onFormSubmit = (data) => {
		const editedTargetClass = {
			...targetClass,
			...data,
			targetNodes: selectedTargets.map(({ _id }) => _id),
			domains: selectedDomains
		};
		onSubmit(editedTargetClass);
	};

	return (
		<>
			<div className="modal-body">
				<FormControl name="name"
				             label="Name"
				             errorMessage={formState.errors?.name?.message}>
					<Input name="name"
					       className="form-control"
					       disabled={!isCreate}
					       placeholder="Enter name"
					       {...register('name', {
						       value: targetClass.name,
						       required: 'Name is required',
						       pattern: { value: /^[\w-]+$/, message: 'Invalid name' },
						       maxLength: { value: 1024, message: 'exceed maximum length of 1024' }
					       })}
					       autoFocus
					       required
					/>
				</FormControl>
				<FormControl name="description"
				             label="Description"
				             errorMessage={formState.description?.name?.message}>
					<Input name="description"
					       className="form-control"
					       placeholder="Enter description"
					       {...register('description', {
						       value: targetClass.description,
						       maxLength: { value: 1024, message: 'exceed maximum length of 1024' }
					       })}
					/>
				</FormControl>

				<DomainsSelect domains={domains}
				               selectedDomains={selectedDomains}
				               onChange={setSelectedDomains}
				/>

				{selectedTargets.length === 0 && <div><span> Select at least 1 target <i className="ion ion-alert-circled red"></i></span></div>}
				<FiltSortTable tableId="targetClassesTargets"
				               columns={columns}
				               loadTotal={TargetsService.loadTotal}
				               loadRows={TargetsService.loadTargets}
				               queryParamsEnabled={false}
				               tableSettingsCache={{
					               enabled: false,
				               }}
				               multiselectOptions={{
					               enabled: true,
					               initiallySelectedRows: selectedTargets,
					               onSelectedRowsChange: setSelectedTargets,
								   isViewSelectedEnabled: true
				               }}
				/>
			</div>
			<div className="modal-footer">
				<button className="btn btn-primary mgmt-btn-primary"
				        onClick={handleSubmit(onFormSubmit)}
				        disabled={!formState.isValid || !selectedTargets.length}>
					{isCreate ? 'Add' : 'Update'}
				</button>
				<button className="btn btn-default" onClick={() => handleCancel()}>Cancel</button>
			</div>
		</>
	);
};

const CreateEditTargetClassModal = ({
	isOpen,
	targetClass = {},
	handleCancel = () => {},
	domains = [],
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {

	return (
		<Modal
			isOpen={isOpen}
			disableBackdropClose
			onClose={() => handleCancel()}
			title="Target Class"
			className="modal-lg">
			<CreateEditTargetClass
				targetClass={targetClass}
				handleCancel={handleCancel}
				domains={domains}
				onSubmit={onSubmit}/>
		</Modal>
	);
};

export default CreateEditTargetClassModal;