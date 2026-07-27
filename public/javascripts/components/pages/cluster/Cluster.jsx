/* global React */

import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import { useAlerts } from '../../core/Alert.jsx';
import { extractErrorMsg } from '../../utils.js';
import ManagementService from '../../services/api/management.service.js';

const Cluster = () => {
	const [confirm] = useConfirmationDialog();
	const { successAlert, errorAlert } = useAlerts();

	const resetVolumeStatuses = async() => {
		const confirmed = await confirm('Warning: This operation is irreversible.', true);
		if (!confirmed) return;

		const response = await ManagementService.resetVolumeStatuses();
		if (response.success) {
			successAlert('Volume statuses reset successfully');
		} else {
			const errorMsg = extractErrorMsg(response.error);
			errorAlert(`Failed to reset volume statuses - ${errorMsg}`);
		}
	};

	return (
		<div className="page-content">
			<h1>Cluster Control</h1>

			<div className="row">
				<div className="col-md-4">
					<button
						title="Reset volume statuses"
						className="btn btn-warning icon-action-btn mr-5"
						onClick={resetVolumeStatuses}
						autoFocus
					>
						<i className="ion-refresh" />
					</button>
					<label>Reset volume statuses</label>
				</div>
			</div>
		</div>
	);
};

export default Cluster;