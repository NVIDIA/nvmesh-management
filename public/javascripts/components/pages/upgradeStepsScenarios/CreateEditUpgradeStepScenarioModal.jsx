/* global React, ReactHookForm */

import Input from '../../core/Input.jsx';
import Modal from '../../core/Modal.jsx';
import FormControl from '../../core/FormControl.jsx';
import Toggle from '../../core/Toggle.jsx';

const { useForm, Controller } = ReactHookForm;

const CreateEditUpgradeStepScenario = ({ upgradeStepScenario, handleCancel, onSubmit }) => {
	const isCreate = !upgradeStepScenario.ID;

	const { handleSubmit, formState, register, control } = useForm({ mode: 'all' });

	const onFormSubmit = (data) => {
		const formData = {
			...upgradeStepScenario,
			...data,
		};

		onSubmit(formData);
	};

	return (
		<>
			<div className="modal-body">
				<FormControl label="Name"
				             name="name"
				             errorMessage={formState.errors?.name?.message}>
					<Input name="name"
					       className="form-control"
					       placeholder="Enter upgrade step name"
					       {...register('name', {
						       value: upgradeStepScenario.name,
						       required: 'Name is required',
						       maxLength: { value: 50, message: 'exceed maximum length of 50' }
					       })}
					       autoFocus
					/>
				</FormControl>

				<FormControl label="Command"
				             name="command"
				             errorMessage={formState.errors?.command?.message}>
					<textarea name="command"
					          className="form-control"
					          placeholder="Enter command to be executed"
					          {...register('command', {
						          value: upgradeStepScenario.command,
						          required: 'Command is required'
					          })}
					/>
				</FormControl>

				<FormControl label="Arguments"
				             name="arguments"
				             errorMessage={formState.errors?.arguments?.message}>
					<textarea name="arguments"
					          className="form-control"
					          placeholder="Enter comma-separated arguments"
					          {...register('arguments', {
						          value: upgradeStepScenario.arguments,
						          setValueAs: (v) => (v === '' ? null : v),
						          pattern: {
							          value: /^\["[A-Za-z0-9_-]+"(,"[A-Za-z0-9_-]+")*\]$/,
							          message: 'Arguments must be a valid JSON array (no spaces). For example: ["stop","nvmeshclient"]'
						          }
					          })}
					/>
				</FormControl>

				<FormControl label="Timeout (seconds)"
				             name="timeout"
				             errorMessage={formState.errors?.timeout?.message}>
					<Input name="timeout"
					       className="form-control"
					       placeholder="Enter timeout in seconds"
					       {...register('timeout', {
						       value: upgradeStepScenario.timeout,
						       setValueAs: (v) => (v === '' ? null : parseInt(v, 10)),
						       pattern: { value: /^[0-9]+$/, message: 'Timeout must be a number' }
					       })}
					       type="number"
					/>
				</FormControl>

				<FormControl label="Verification Command"
				             name="verificationCommand"
				             errorMessage={formState.errors?.verificationCommand?.message}>
					<textarea name="verificationCommand"
					       className="form-control"
					       placeholder="Enter verification command"
					       {...register('verificationCommand', {
						       setValueAs: (v) => (v === '' ? null : v),
						       value: upgradeStepScenario.verificationCommand,
					       })}
					/>
				</FormControl>

				<div className="form-group aligned centred inline-form-group">
					<label>Volume Affected</label>
					<Controller
						control={control}
						name="isVolumeAffected"
						defaultValue={upgradeStepScenario.isVolumeAffected}
						render={({ field: { onChange, value } }) => (
							<Toggle isChecked={value}
							        onChange={(value) => onChange(value ? 1 : 0)}/>
						)}
					/>
				</div>

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

const CreateEditUpgradeStepScenarioModal = ({
	isOpen,
	upgradeStepScenario = {},
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const isCreate = !upgradeStepScenario?.ID;

	return (
		<Modal
			isOpen={isOpen}
			disableBackdropClose
			onClose={() => handleCancel()}
			title={isCreate ? 'Add Upgrade Step Scenario' : 'Edit Upgrade Step Scenario'}>
			{upgradeStepScenario && <CreateEditUpgradeStepScenario
				upgradeStepScenario={upgradeStepScenario}
				handleCancel={handleCancel}
				onSubmit={onSubmit}/>}
		</Modal>
	);
};


export default CreateEditUpgradeStepScenarioModal;
