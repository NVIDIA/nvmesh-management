/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import Modal from '../core/Modal.jsx';
import Input from '../core/Input.jsx';
import { useAppContext } from '../pages/App.jsx';
const { useState, createContext, useContext } = React;

const ConfirmationDialogModal = ({
	show,
	content,
	onClose,
	confirmWithEmail = false,
	confirmText = 'Confirm',
	cancelText = 'Cancel'
}) => {
	const [email, setEmail] = useState('');
	const { currUser } = useAppContext();

	const handleConfirm = () => {
		onClose(true);
		setEmail('');
	};

	const handleCancel = () => {
		onClose(false);
		setEmail('');
	};

	return (
		<Modal isOpen={show}
		       title="Confirm Operation"
		       modalClassName="confirmation-dialog"
		       backdropClassName="confirmation-dialog"
		       onClose={handleCancel}>
			<div className="modal-body">
				<div>{content}</div>
				{confirmWithEmail && (
					<Input type="email"
					       className="form-control"
					       id="email"
					       placeholder="Enter user email to confirm"
					       autoFocus
					       value={email}
					       onChange={(e) => setEmail(e.target.value)} />
				)}
			</div>
			<div className="modal-footer">
				<button className="btn btn-default" type="button" onClick={handleCancel}>
					{cancelText}
				</button>
				<button className="btn btn-primary"
				        disabled={confirmWithEmail && currUser.email !== email}
				        onClick={handleConfirm}
				        autoFocus>
					{confirmText}
				</button>
			</div>
		</Modal>
	);
};

const ConfirmationDialogContext = createContext();

const ConfirmationDialogsProvider = ({ children }) => {
	const [showDialog, setShowDialog] = useState(false);
	const [question, setQuestion] = useState('');
	const [confirmWithEmail, setConfirmWithEmail] = useState(false);
	const [buttonConfig, setButtonConfig] = useState({});
	const [resolvePromise, setResolvePromise] = useState(null);

	const confirm = (question, confirmWithEmail = false, config = {}) => {
		setQuestion(question);
		setConfirmWithEmail(confirmWithEmail);
		setButtonConfig({
			confirmText: config.confirmText || 'Confirm',
			cancelText: config.cancelText || 'Cancel'
		});
		setShowDialog(true);

		return new Promise((resolve) => {
			setResolvePromise(() => resolve);
		});
	};

	const handleClose = (confirmed) => {
		if (resolvePromise) {
			resolvePromise(confirmed);
		}
		setShowDialog(false);
		setConfirmWithEmail(false);
		setButtonConfig({});
	};

	return (
		<ConfirmationDialogContext.Provider value={{ confirm }}>
			<ConfirmationDialogModal
				show={showDialog}
				content={question}
				onClose={handleClose}
				confirmWithEmail={confirmWithEmail}
				confirmText={buttonConfig.confirmText}
				cancelText={buttonConfig.cancelText}
			/>
			{children}
		</ConfirmationDialogContext.Provider>
	);
};

const useConfirmationDialog = () => {
	const { confirm } = useContext(ConfirmationDialogContext);

	return [confirm];
};

export { ConfirmationDialogsProvider, useConfirmationDialog };
