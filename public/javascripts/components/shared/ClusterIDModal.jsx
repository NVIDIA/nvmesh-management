/* global React */

import Modal from '../core/Modal.jsx';
import FormControl from '../core/FormControl.jsx';
import Input from '../core/Input.jsx';

const { useState } = React;

const ClusterID = ({
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const [clusterID, setClusterID] = useState('');

	return (
		<>
			<div className="modal-body">
				<FormControl label="Cluster ID"
				             name="clusterID">
					<Input id="clusterID"
					       className="form-control"
					       autoFocus
					       required
					       maxLength={30}
					       type="text"
					       onChange={e => setClusterID(e.target.value)}
					/>
				</FormControl>
			</div>
			<div className="modal-footer">
				<button className="btn btn-primary mgmt-btn-primary"
				        onClick={(() => onSubmit(clusterID))}
				        disabled={!clusterID}>
					Update
				</button>
				<button className="btn btn-default" onClick={() => handleCancel()}>Cancel</button>
			</div>
		</>
	);
};

const ClusterIDModal = ({
	isOpen,
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {

	return (
		<Modal isOpen={isOpen}
		       disableBackdropClose
		       onClose={() => handleCancel()}
		       title="Insert Cluster ID">
			<ClusterID handleCancel={handleCancel}
			           onSubmit={onSubmit}/>
		</Modal>
	);
};

export default ClusterIDModal;