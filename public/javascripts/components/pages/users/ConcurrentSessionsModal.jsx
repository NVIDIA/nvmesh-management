/* global React */

import Modal from '../../core/Modal.jsx';

const ConcurrentSession = ({
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	handleDisconnect = _ => {},
	concurrentSessions
}) => {

	return (
		<>
			<div className="modal-body">
				<table className="table table-striped table-hover">
					<thead>
						<tr>
							<th>Email</th>
							<th>Host IP</th>
							<th>Session ID</th>
							<th>Last Active Date</th>
							<th>Action</th>
						</tr>
					</thead>
					<tbody>
						{concurrentSessions.map((session, index) => (
							<tr key={index}>
								<td>{session.email}</td>
								<td>{session.remoteIp}</td>
								<td>{session.sessionID} <b>{session.me && '(Me)'}</b></td>
								<td>{session.lastActiveDate}</td>
								<td>
									<button
										className="btn btn-danger"
										disabled={session.me}
										onClick={() => handleDisconnect(session)}>
										Disconnect
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>

			</div>
			<div className="modal-footer">
				<button className="btn btn-default" onClick={() => handleCancel()}>Cancel</button>
			</div>
		</>
	);
};

const ConcurrentSessionsModal = ({
	isOpen,
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	handleDisconnect = _ => {},
	concurrentSessions
}) => {
	return (
		<Modal isOpen={isOpen}
		       disableBackdropClose
		       onClose={() => handleCancel()}
		       className="modal-lg"
		       title="Concurrent Sessions">
			<ConcurrentSession handleCancel={handleCancel}
			                   handleDisconnect={handleDisconnect}
			                   concurrentSessions={concurrentSessions}/>
		</Modal>
	);
};

export default ConcurrentSessionsModal;