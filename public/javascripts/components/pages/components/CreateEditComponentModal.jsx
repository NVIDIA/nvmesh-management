/* global React, ReactHookForm */

import Input from '../../core/Input.jsx';
import FormControl from '../../core/FormControl.jsx';
import Modal from '../../core/Modal.jsx';

import { ComponentsService } from '../../services/api/components.service.js';
import ComponentTypesSelect from './ComponentTypesSelect.jsx';
import { Tabs, Tab } from '../../core/Tabs.jsx';
import ComponentsSelect from './ComponentsSelect.jsx';
import PlatformsFiltSort from '../platforms/PlatformsFiltSort.jsx';
import RequirementsFiltSort from './RequirementsFiltSort.jsx';
import CompatibilitiesFiltSort from './CompatibilitiesFiltSort.jsx';

const { useState, useEffect, useRef } = React;
const { useForm } = ReactHookForm;

const CreateEditComponent = ({
	component = {},
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const isCreate = !component.ID;
	const sortTableRef = useRef();
	const requirementsTableRef = useRef();
	const compatibiltiesTableRef = useRef();
	const [selectedPlatforms, setSelectedPlatforms] = useState(component.platforms || []);
	const [selectedRequirements, setSelectedRequirements] = useState(component.requirements || []);
	const [selectedCompatibilities, setSelectedCompatibilities] = useState(component.compatibilities || []);
	const [isLoaded, setIsLoaded] = useState(false);
	const [componentTypes, setComponentTypes] = useState([]);
	const [selectedComponentType, setSelectedComponentType] = useState(component.component?.componentType);
	const [components, setComponents] = useState([]);
	const [selectedComponent, setSelectedComponent] = useState(component.component);

	const { register, handleSubmit, formState } = useForm({ mode: 'all' });

	useEffect(() => {
		Promise.all([
			ComponentsService.getAllComponentTypes(),
			ComponentsService.loadComponents()
		]).then(([componentTypes, components]) => {
			setComponentTypes(componentTypes);
			setComponents(components);
			setIsLoaded(true);
		});
	}, []);

	const onFormSubmit = (data) => {
		const editedComponent = {
			...component,
			...data,
			platforms: selectedPlatforms,
			requirements: selectedRequirements,
			compatibilities: selectedCompatibilities,
			componentID: selectedComponent.ID,
			componentTypeID: selectedComponentType.ID
		};

		onSubmit(editedComponent);
	};

	return isLoaded && (
		<>
			<div className="modal-body">
				<ComponentTypesSelect
					componentTypes={componentTypes}
					selectedComponentType={selectedComponentType}
					onChange={(componentType) => {
						setSelectedComponentType(componentType);

						ComponentsService.getComponentsByTypeID(componentType.ID).then((results) => {
							setComponents(results);

							if (component.component)
								setSelectedComponent(component.component);
						});

					}}
				/>

				<ComponentsSelect
					components={components}
					selectedComponent={selectedComponent}
					onChange={setSelectedComponent}
				/>

				<FormControl
					name="version"
					label="Version"
					errorMessage={formState.errors?.version?.message}>
					<Input name="version"
					       className="form-control"
					       disabled={!isCreate}
					       placeholder="Enter version"
					       {...register('version', {
						       value: component.version,
						       required: 'Version is required',
						       pattern: { value: /[.*]/, message: 'Invalid version' },
						       maxLength: { value: 1024, message: 'exceed maximum length of 1024' }
					       })}
					       autoFocus
					/>
				</FormControl>

				<Tabs>
					<Tab header="Compatible Platforms">
						<PlatformsFiltSort
							tableRef={sortTableRef}
							tableId="platformsModal"
							rowIdentifier="ID"
							queryParamsEnabled={false}
							tableSettingsCache={{
								enabled: false
							}}
							multiselectOptions={{
								enabled: true,
								initiallySelectedRows: selectedPlatforms,
								onSelectedRowsChange: setSelectedPlatforms,
								isViewSelectedEnabled: true
							}}
						/>
					</Tab>
					<Tab header="Requirements">
						<RequirementsFiltSort
							tableRef={requirementsTableRef}
							tableId="requirementsModal"
							rowIdentifier="ID"
							queryParamsEnabled={false}
							tableSettingCache={{
								enabled: false
							}}
							multiselectOptions={{
								enabled: true,
								initiallySelectedRows: selectedRequirements,
								onSelectedRowsChange: setSelectedRequirements,
								isViewSelectedEnabled: true

							}}
						/>
					</Tab>
					<Tab header="Compatibilities">
						<CompatibilitiesFiltSort
							tableRef={compatibiltiesTableRef}
							tableId="compatibilitiesModal"
							rowIdentifier="ID"
							queryParamsEnabled={false}
							tableSettingCache={{
								enabled: false
							}}
							multiselectOptions={{
								enabled: true,
								initiallySelectedRows: selectedCompatibilities,
								onSelectedRowsChange: setSelectedCompatibilities,
								isViewSelectedEnabled: true
							}}
						/>
					</Tab>
				</Tabs>
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

const CreateEditComponentModal = ({
	isOpen,
	component = {},
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {

	return (
		<Modal
			isOpen={isOpen}
			disableBackdropClose
			onClose={() => handleCancel()}
			title="Component"
			className="large-modal">
			<CreateEditComponent component={component}
			                   handleCancel={handleCancel}
			                   onSubmit={onSubmit}/>
		</Modal>
	);
};

export default CreateEditComponentModal;