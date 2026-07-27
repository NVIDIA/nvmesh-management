/* global React */

import CreateEditPlatformModal from './CreateEditPlatformModal.jsx';
import PlatformsFiltSort from './PlatformsFiltSort.jsx';
import { PlatformsService } from '../../services/api/platforms.service.js';
import { useAlerts } from '../../core/Alert.jsx';
import useQueryParams from '../../useQueryParams.hook.js';
import { extractErrorMsg, extractResults } from '../../utils.js';
import { events, SocketService } from '../../services/socket.service.js';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';

const { useRef, useState, useEffect } = React;

const Platforms = () => {
	const tableRef = useRef();
	const [platform, setPlatform] = useState({});
	const [selectedPlatforms, setSelectedPlatforms] = useState([]);
	const [showCreateEditModal, setShowCreateEditModal] = useState(false);
	const { getQueryParam, setQueryParam } = useQueryParams();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();

	useEffect(() => {
		const createParam = getQueryParam('create');
		if (createParam) {
			newPlatform(createParam);
		}

		SocketService.addHandler(events.newPlatformEvent.name, () => reloadTable());
	}, []);

	const reloadTable = () => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	};

	const createPlatform = async(platform) => {
		const responses = await PlatformsService.create([platform]);
		if (responses[0].success) {
			successAlert(`${platform.name} Platform created successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to create Platform ${platform.name} - ${errorMsg}`);
		}
	};

	const updatePlatform = async(platform) => {
		const responses = await PlatformsService.update([platform]);
		if (responses[0].success) {
			successAlert(`${platform.name} Platform updated successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to updated Platform ${platform.name} - ${errorMsg}`);
		}
	};

	const deletePlatforms = async() => {
		const confirmed = await confirm(`Are you sure you want to delete ${selectedPlatforms.length} Platform(s)?`);
		if (!confirmed) {
			return;
		}

		const payload = selectedPlatforms.map((s) => ({ ID: s.ID, name: s.name }));

		const responses = await PlatformsService.delete(payload);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Platform(s) deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity.ID).join(', ');
			errorAlert(`Failed to delete Platform(s) ${ids} - ${errorMsg}`);
		});
	};

	const editPlatform = (platform) => {
		setPlatform(platform);
		setShowCreateEditModal(true);
	};

	const newPlatform = (initialPlatform = {}) => {
		setShowCreateEditModal(true);
		setPlatform(initialPlatform);
	};

	const onCancelCreateEditPlatform = () => {
		setShowCreateEditModal(false);
		setPlatform({});
		setQueryParam('create', null);
	};

	const onSubmitPlatform = async(editedPlatform) => {
		const isCreate = !editedPlatform.ID;
		if (isCreate) {
			await createPlatform(editedPlatform);
		} else {
			await updatePlatform(editedPlatform);
		}
		setShowCreateEditModal(false);
		setPlatform({});
		setQueryParam('create', null);
	};

	return (
		<div className="page-content">
			<CreateEditPlatformModal isOpen={showCreateEditModal}
			                         platform={platform}
			                         handleCancel={() => onCancelCreateEditPlatform()}
			                         onSubmit={platform => onSubmitPlatform(platform)}/>
			<h1>Platforms</h1>

			<div className="action-container">
				<button className="btn btn-info mgmt-btn-info"
				        disabled={selectedPlatforms.length === 0}
				        onClick={() => deletePlatforms()}>
					Delete
				</button>
			</div>

			<PlatformsFiltSort
				tableId="platformsPage"
				onSelectedPlatforms={setSelectedPlatforms}
				tableRef={tableRef}
				editPlatform={editPlatform}
				multiselectOptions={{
					enabled: true,
					onSelectedRowsChange: setSelectedPlatforms,
				}}
			/>

			<div className="fab" onClick={() => newPlatform()}>
				<i className="fa fa-plus"></i>
			</div>
		</div>
	);
};

export default Platforms;