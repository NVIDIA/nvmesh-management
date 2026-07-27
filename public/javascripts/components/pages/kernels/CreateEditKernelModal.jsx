/* global React, ReactHookForm */

import Input from '../../core/Input.jsx';
import FormControl from '../../core/FormControl.jsx';
import Modal from '../../core/Modal.jsx';
import { KernelsService } from '../../services/api/kernels.service.js';
import { debounce, validateVersion } from '../../utils.js';

const { useForm } = ReactHookForm;

const CreateEditKernel = ({
	kernel: kernel = {},
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const isCreate = !kernel.ID;
	const { register, handleSubmit, formState, setError, clearErrors } = useForm({ mode: 'all' });
	const isFormValid = formState.isValid && !formState.errors.versionExists;

	const onFormSubmit = (data) => {
		const editedKernel = {
			...kernel,
			...data
		};
		onSubmit(editedKernel);
	};


	const isVersionExists = async(version) => {
		const filter = { version };
		const count = await KernelsService.loadTotal(filter);
		return count > 0;
	};

	const isVersionExistsDebounced = debounce(async(value) => {
		const exists = await isVersionExists(value);
		return exists;
	}, 500);

	return (
		<>
			<div className="modal-body">
				<FormControl
					name="version"
					label="Version"
					required
					errorMessage={formState.errors?.version?.message || formState.errors?.versionExists?.message}>
					<Input
						name="version"
						className="form-control"
						placeholder="Enter name"
						{...register('version', {
							value: kernel.version,
							validate: validateVersion,
							maxLength: { value: 1024, message: 'exceed maximum length of 1024' }
						})}
						onChange={async(e) => {
							const value = e.target.value;

							const alreadyExists = await isVersionExistsDebounced(value);
							if (alreadyExists) {
								setError('versionExists', { type: 'custom', message: 'Version already exists' });

							} else {
								clearErrors('versionExists');
							}
						}}
						autoFocus
						required
					/>
				</FormControl>
			</div>
			<div className="modal-footer">
				<button
					className="btn btn-primary mgmt-btn-primary"
					onClick={handleSubmit(onFormSubmit)}
					disabled={!isFormValid}>
					{isCreate ? 'Add' : 'Update'}
				</button>
				<button
					className="btn btn-default"
					onClick={() => handleCancel()}>
					Cancel
				</button>
			</div>
		</>
	);
};

const CreateEditKernelModal = ({
	isOpen,
	kernel: kernel = {},
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {

	return (
		<Modal
			isOpen={isOpen}
			disableBackdropClose
			onClose={() => handleCancel()}
			title="Kernel">
			<CreateEditKernel
				kernel={kernel}
				handleCancel={handleCancel}
				onSubmit={onSubmit} />
		</Modal>
	);
};

export default CreateEditKernelModal;