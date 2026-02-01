/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, consts */

import UpgradeAgentsFiltSort from './UpgradeAgentsFiltSort.jsx';
import { UpgradeAgentsService } from '../../services/api/upgradeAgents.service.js';
import { extractResults } from '../../utils.js';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import { useAlerts } from '../../core/Alert.jsx';

const { useRef, useState } = React;

const UpgradeAgents = () => {
	const tableRef = useRef();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const [selectedUpgradeAgents, setSelectedUpgradeAgents] = useState([]);

	const reloadTable = () => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	};

	const deleteUpgradeAgents = async() => {
		const confirmed = await confirm(`Are you sure you want to delete ${selectedUpgradeAgents.length} Upgrade Agent(s)?`);
		if (!confirmed) {
			return;
		}

		const payload = selectedUpgradeAgents.map(({ _id, uuid }) => ({ _id: _id, uuid }));

		const responses = await UpgradeAgentsService.deleteUpgradeAgents(payload);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} UpgradeAgent(s) deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Failed to delete Upgrade Agents ${ids} - ${errorMsg}`);
		});
	};

	return (
		<div className="page-content">
			<h1>Upgrade Agents</h1>

			<div className="action-container">
				<button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				        disabled={!selectedUpgradeAgents.length ||
					        selectedUpgradeAgents.some(upgradeAgent => upgradeAgent.status !== consts.upgradeAgentStatus.OFFLINE)}
				        onClick={() => deleteUpgradeAgents()}>
					Delete
				</button>
			</div>

			<UpgradeAgentsFiltSort ref={tableRef}
			                       tableId="upgradeAgents"
			                       onSelectedRowsChange={setSelectedUpgradeAgents}
			/>

		</div>
	);
};

export default UpgradeAgents;