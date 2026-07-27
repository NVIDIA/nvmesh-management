/* global React, ReactHookForm, consts */

import FormControl from '../../core/FormControl.jsx';
import Input from '../../core/Input.jsx';
import Modal from '../../core/Modal.jsx';
import { passphraseCommandToTitle } from './Volumes.jsx';

const { useForm } = ReactHookForm;

const Passphrase = ({
	handleCancel = () => {},
	commandName,
	passphraseData,
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const { register, handleSubmit, formState } = useForm({ mode: 'all' });

	const onFormSubmit = (data) => {
		onSubmit(data);
	};

	return (
		<>
			<div className="modal-body">
				<FormControl name="currentPassphrase"
				             label="Current Passphrase"
				             errorMessage={formState.errors?.currentPassphrase?.message}>
					<Input name="currentPassphrase"
					       type="text"
					       className="form-control"
					       placeholder="Enter current passphrase"
					       {...register('currentPassphrase', {
						       value: passphraseData.currentPassphrase,
						       required: 'Current Passphrase is required',
						       minLength: { value: 8, message: 'At least 8 characters required' }
					       })}
					       autoFocus
					/>
				</FormControl>

				{commandName !== consts.volumeEncryptionCommands.DELETE_PASSPHRASE && (
					<FormControl name="newPassphrase"
					             label="New Passphrase"
					             errorMessage={formState.errors?.newPassphrase?.message}>
						<Input name="newPassphrase"
						       type="text"
						       className="form-control"
						       placeholder="Enter new passphrase"
						       {...register('newPassphrase', {
							       value: passphraseData.newPassphrase,
							       required: 'New Passphrase is required',
							       minLength: { value: 8, message: 'At least 8 characters required' }
						       })}
						/>
					</FormControl>
				)}

				{commandName !== consts.volumeEncryptionCommands.DELETE_PASSPHRASE && (
					<FormControl name="slot"
					             label="Slot"
					             errorMessage={formState.errors?.slot?.message}>
						<Input name="slot"
						       type="number"
						       className="form-control"
						       placeholder="Enter slot"
						       min={0}
						       max={32}
						       {...register('slot', {
							       required: 'Slot is required',
							       value: passphraseData.slot,
							       valueAsNumber: true,
							       min: { value: 0, message: 'Slot must be greater than 0' },
							       max: { value: 32, message: 'Slot must be less than 32' }
						       })}
						/>
					</FormControl>
				)}
			</div>
			<div className="modal-footer">
				<button className="btn btn-primary mgmt-btn-primary"
				        onClick={handleSubmit(onFormSubmit)}
				        disabled={!formState.isValid}>
					{passphraseCommandToTitle(commandName)}
				</button>
				<button className="btn btn-default" onClick={() => handleCancel()}>Cancel</button>
			</div>
		</>
	);
};

const PassphraseModal = ({
	isOpen,
	handleCancel = () => {},
	commandName,
	passphraseData,
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	return (
		<Modal
			isOpen={isOpen}
			disableBackdropClose
			onClose={() => handleCancel()}
			title={`${passphraseCommandToTitle(commandName)} Passphrase`}>
			<Passphrase
				handleCancel={handleCancel}
				commandName={commandName}
				passphraseData={passphraseData}
				onSubmit={onSubmit}/>
		</Modal>
	);
};

export default PassphraseModal;