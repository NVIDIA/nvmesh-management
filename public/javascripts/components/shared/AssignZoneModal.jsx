/* global React */

import Modal from '../core/Modal.jsx';
import FormControl from '../core/FormControl.jsx';
import Input from '../core/Input.jsx';

const { useState } = React;

const AssignZone = ({
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const [zone, setZone] = useState(0);

	return (
		<>
			<div className="modal-body">
				<FormControl label="Zone"
				             name="zone">
					<Input id="zone"
					       className="form-control"
					       autoFocus
					       required
					       step={1}
					       min={1}
					       type="number"
					       onChange={e => {
						       const value = e.target.value;
						       setZone(parseInt(value));
					       }}
					/>
				</FormControl>
			</div>
			<div className="modal-footer">
				<button className="btn btn-primary mgmt-btn-primary"
				        onClick={(() => onSubmit(zone))}
				        disabled={!zone}>
					Update
				</button>
				<button className="btn btn-default" onClick={() => handleCancel()}>Cancel</button>
			</div>
		</>
	);
};

const AssignZoneModal = ({
	isOpen,
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {

	return (
		<Modal isOpen={isOpen}
		       disableBackdropClose
		       onClose={() => handleCancel()}
		       title="Assign Zone">
			<AssignZone handleCancel={handleCancel}
			            onSubmit={onSubmit}/>
		</Modal>
	);
};

export default AssignZoneModal;