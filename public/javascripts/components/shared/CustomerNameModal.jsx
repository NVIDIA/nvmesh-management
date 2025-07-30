/* global React */

import Modal from '../core/Modal.jsx';
import FormControl from '../core/FormControl.jsx';
import Input from '../core/Input.jsx';

const { useState } = React;

const CustomerName = ({
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const [customerName, setCustomerName] = useState('');

	return (
		<>
			<div className="modal-body">
				<h4 className="text-center" style={{ marginBottom: '20px' }}>This is used for logging purposes</h4>
				<FormControl label="Customer Name"
				             name="customerName">
					<Input id="customerName"
					       className="form-control"
					       autoFocus
					       required
					       maxLength={32}
					       type="text"
					       placeholder="Name"
					       onChange={e => setCustomerName(e.target.value)}
					/>
				</FormControl>
			</div>
			<div className="modal-footer">
				<button className="btn btn-primary mgmt-btn-primary"
				        onClick={(() => onSubmit(customerName))}
				        disabled={!customerName?.length}>
					Confirm
				</button>
			</div>
		</>
	);
};

const CustomerNameModal = ({
	isOpen,
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {

	return (
		<Modal isOpen={isOpen}
		       disableBackdropClose
		       onClose={() => handleCancel()}
		       title="Insert Customer Name">
			<CustomerName onSubmit={onSubmit}/>
		</Modal>
	);
};

export default CustomerNameModal;
