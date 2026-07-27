/* global React, ReactHookForm, consts */

import FormControl from '../../core/FormControl.jsx';
import Modal from '../../core/Modal.jsx';
import { ReleasesService } from '../../services/api/release.service.js';
import { UpgradeScenariosService } from '../../services/api/upgradeScenarios.service.js';
import Select from '../../core/Select.jsx';
import { ComponentsService } from '../../services/api/components.service.js';
import { UpgradeStepsScenariosService } from '../../services/api/upgradeStepsScenarios.service.js';
import { keyBy } from '../../utils.js';

const { useEffect, useState } = React;
const { useForm, Controller } = ReactHookForm;

const getComponentNameByUpgradeType = (upgradeType) => {
	const componentNameByUpgradeType = {
		[consts.upgradeTypes.CLIENT_AND_TARGET]: 'nvmesh-target',
		[consts.upgradeTypes.CLIENT_ONLY]: 'nvmesh-client',
		[consts.upgradeTypes.MANAGEMENT]: 'nvmesh-management',
		[consts.upgradeTypes.UPGRADE_AGENT]: 'nvmesh-upgrade-agent'
	};
	return componentNameByUpgradeType[upgradeType.name];
};

const CreateEditUpgradeScenario = ({
	upgradeScenario = {},
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const isCreate = !upgradeScenario.ID;
	const { handleSubmit, formState, control, watch, setValue } = useForm({ mode: 'all' });
	const [releases, setReleases] = useState([]);
	const [upgradeTypes, setUpgradeTypes] = useState([]);
	const [sourceVersions, setSourceVersions] = useState([]);
	const [upgradeSteps, setUpgradeSteps] = useState([]);
	const [upgradeStepsByID, setUpgradeStepsByID] = useState({});
	const upgradeType = watch('upgradeType');

	useEffect(() => {
		const fetchData = async() => {
			const [releasesRes, upgradeTypesRes, upgradeStepsRes] = await Promise.all([
				ReleasesService.loadAll(),
				UpgradeScenariosService.getAllUpgradeTypes(),
				UpgradeStepsScenariosService.loadAll()
			]);
			setReleases(releasesRes);
			setUpgradeTypes(upgradeTypesRes);
			setUpgradeSteps(upgradeStepsRes);
			setUpgradeStepsByID(keyBy(upgradeStepsRes, step => step.ID));
		};

		fetchData();
	}, [upgradeScenario]);

	useEffect(() => {
		const fetchSourceVersions = async() => {
			const componentName = getComponentNameByUpgradeType(upgradeType);
			const componentsRes = await ComponentsService.loadComponentVersions({ 'component.name': componentName }, {}, 0, 0);
			setSourceVersions(componentsRes);
		};

		if (upgradeType) {
			fetchSourceVersions();
		}
	}, [upgradeType]);

	const onFormSubmit = (data) => {
		if (!isCreate) {
			data.steps = data.steps.map(stepID => upgradeStepsByID[stepID]);
		}

		const editedUpgrade = {
			...upgradeScenario,
			...data,
			upgradeTypeID: data.upgradeType.ID,
		};

		onSubmit(editedUpgrade);
	};

	return (
		<>
			<div className="modal-body">

				<FormControl label="Upgrade Type" name="upgradeType">
					<Controller
						control={control}
						name="upgradeType"
						defaultValue={upgradeScenario.upgradeType}
						rules={{
							required: 'Upgrade Type is required'
						}}
						render={({ field: { onChange, value } }) => (
							<Select id="upgradeType"
							        placeholder="Choose upgrade type"
							        value={value}
							        onChange={value => {
								        setValue('sourceVersionID', null);
								        onChange(value);
							        }}
							        onDelete={() => false}
							        valueAsObject
							        valueField="ID"
							        labelField="name"
							        searchField="name"
							        options={upgradeTypes}
							/>
						)}
					/>
				</FormControl>
				<FormControl label="Source Version"
				             name="sourceVersionID"
				             errorMessage={formState.errors?.sourceVersionID?.message}>
					<Controller
						control={control}
						name="sourceVersionID"
						defaultValue={upgradeScenario.sourceVersionID}
						rules={{
							required: 'Source Version is required'
						}}
						render={({ field: { onChange, value } }) => (
							<Select id="sourceVersionID"
							        placeholder="Choose source version"
							        value={value}
							        onChange={value => onChange(parseInt(value, 10))}
							        disabled={!upgradeType}
							        valueField="ID"
							        searchField="version"
							        options={sourceVersions}
							        render={{
								        option: (item, escape) => `<div>${escape(item.component.name)} - ${escape(item.version)}</div>`,
								        item: (item, escape) => `<div>${escape(item.component.name)} - ${escape(item.version)}</div>`
							        }}
							/>
						)}
					/>
				</FormControl>

				<FormControl label="Destination Release"
				             name="destinationReleaseID"
				             errorMessage={formState.errors?.destinationReleaseID?.message}>
					<Controller
						control={control}
						name="destinationReleaseID"
						defaultValue={upgradeScenario.destinationReleaseID}
						rules={{
							required: 'Destination Release is required',
						}}
						render={({ field: { onChange, value } }) => (
							<Select id="destinationReleaseID"
							        placeholder="Choose destination release"
							        value={value}
							        onChange={value => onChange(parseInt(value, 10))}
							        valueField="ID"
							        labelField="version"
							        searchField="version"
							        options={releases}
							/>
						)}
					/>
				</FormControl>

				{ !isCreate && <FormControl label="Upgrade Steps"
				             name="steps"
				             style={{ marginBottom: '70px' }}>
					<Controller
						control={control}
						name="steps"
						defaultValue={upgradeScenario.steps.map(step => step.ID)}
						render={({ field: { onChange, value } }) => (
							<Select id="steps"
							        placeholder="Choose upgrade steps"
							        value={value}
							        onChange={onChange}
							        valueField="ID"
							        labelField="name"
							        searchField="name"
							        multiple
							        reorder
							        options={upgradeSteps}
							/>
						)}
					/>
				</FormControl> }

			</div>
			<div className="modal-footer">
				<button className="btn btn-primary mgmt-btn-primary"
				        onClick={handleSubmit(onFormSubmit)}
				        disabled={!formState.isValid}>
					{isCreate ? 'Add' : 'Update'}
				</button>
				<button className="btn btn-default" onClick={() => handleCancel()}>Cancel</button>
			</div>
		</>
	);
};

const CreateEditUpgradeScenarioModal = ({
	isOpen,
	upgradeScenario = {},
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const isCreate = !upgradeScenario?.ID;

	return (
		<Modal
			isOpen={isOpen}
			disableBackdropClose
			onClose={() => handleCancel()}
			title={isCreate ? 'Add Upgrade Scenario' : 'Edit Upgrade Scenario'}>
			{upgradeScenario && <CreateEditUpgradeScenario
				upgradeScenario={upgradeScenario}
				handleCancel={handleCancel}
				onSubmit={onSubmit}/>}
		</Modal>
	);
};

export default CreateEditUpgradeScenarioModal;