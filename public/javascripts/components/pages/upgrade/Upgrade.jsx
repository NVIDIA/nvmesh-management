/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, consts, moment */

import { events, SocketService } from '../../services/socket.service.js';
import { UpgradesService } from '../../services/api/upgrades.service.js';
import { UpgradeStepsService } from '../../services/api/upgradeSteps.service.js';
import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import UpgradeStatus from './UpgradeStatus.jsx';
import UpgradeStepModal from './UpgradeStepModal.jsx';
import UpgradeStepStatus, { statusToLabelMap } from './UpgradeStepStatus.jsx';
import { extractErrorMsg } from '../../utils.js';
import { useAlerts } from '../../core/Alert.jsx';
import ExpandableList from '../../core/ExpandableList.jsx';

const { useEffect, useState, useRef } = React;

const Upgrade = () => {
	const tableRef = useRef(null);
	const upgradeStepRef = useRef(null);
	const { successAlert, errorAlert } = useAlerts();
	const [upgrade, setUpgrade] = useState(null);
	const [isUpgradeStepModalOpen, setIsUpgradeStepModalOpen] = useState(false);
	const [upgradeStep, setUpgradeStep] = useState(null);
	// todo: this needs to be changed to support upgrading machines with different source version
	const sourceVersion = upgrade?.machinesToUpgrade[0]?.upgradeAgentData?.nvmeshVersions[consts.components.CLIENT].split('-')[0];
	const upgradeId = window.location.pathname.match(/upgrades\/upgrade\/([^/]+)/)[1];

	useEffect(() => {
		const fetchUpgrade = async() => {
			const upgrade = await reloadUpgrade();
			registerToEvents(upgrade);

			// reload table again in case we missed events by the time we registered for them
			setTimeout(reloadTable, 1000);
		};

		fetchUpgrade();
	}, []);

	useEffect(() => {
		upgradeStepRef.current = upgradeStep;
	}, [upgradeStep]);

	const reloadTable = () => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	};

	const reloadUpgrade = async() => {
		const upgrade = await UpgradesService.getUpgradeByID(upgradeId);
		const completedSteps = await UpgradeStepsService.loadTotalByUpgrade(upgradeId, {
			status: { $in: consts.completedUpgradeStepStatuses }
		});

		setUpgrade({ ...upgrade, completedSteps });
		return upgrade;
	};

	const registerToEvents = (upgrade) => {
		const getUpgradeEventName = (event) => SocketService.getUpgradeID(upgrade._id) + event.name;

		SocketService.addHandler(getUpgradeEventName(events.upgradeStatusChangedEvent), () => reloadUpgrade());

		SocketService.addHandler(getUpgradeEventName(events.upgradeStepStatusChangedEvent), ({ payload }) => {
			// update completed steps in the upgrade itself
			reloadUpgrade();

			// update upgrade step status in table
			tableRef.current?.updateRow(payload._id, {
				status: payload.status,
				response: payload.response,
				lastExecTryError: payload.lastExecTryError
			});

			const currentStep = upgradeStepRef.current;
			if (currentStep?._id === payload._id) {
				setUpgradeStep(prev => ({
					...prev,
					status: payload.status,
					response: payload.response,
					lastExecTryError: payload.lastExecTryError
				}));
			}
		});
	};

	const editUpgradeStep = (upgradeStep) => {
		setIsUpgradeStepModalOpen(true);
		setUpgradeStep(upgradeStep);
	};

	const onCancelUpgradeStep = () => {
		setIsUpgradeStepModalOpen(false);
		setUpgradeStep(null);
	};

	const skipFailedMachine = async(upgrade) => {
		const responses = await UpgradesService.skipFailedMachine(upgrade);

		if (responses[0].success) {
			successAlert('Failed machine skipped successfully');
			reloadUpgrade();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to Skip failed machine - ${errorMsg}`);
		}
	};

	const resumeUpgrade = async() => {
		const responses = await UpgradesService.resumeUpgrade(upgrade);

		if (responses[0].success) {
			successAlert('Upgrade resumed successfully');
			reloadUpgrade();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to resume Upgrade ${upgrade._id} - ${errorMsg}`);
		}
	};

	const startUpgrade = async() => {
		const responses = await UpgradesService.startUpgrade(upgrade);

		if (responses[0].success) {
			successAlert('Upgrade started successfully');
			reloadUpgrade();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to start Upgrade ${upgrade._id} - ${errorMsg}`);
		}
	};

	const handleToggleBreakpoint = async(isBreakpointSet) => {
		if (upgradeStep.status !== consts.upgradeStepStatuses.PENDING) {
			return;
		}

		const response = await UpgradeStepsService.setBreakpoint(upgradeStep._id, isBreakpointSet);

		if (response.success) {
			tableRef.current?.updateRow(upgradeStep._id, { isBreakpointSet });
			setUpgradeStep(prev => ({ ...prev, isBreakpointSet }));
		} else {
			const errorMsg = extractErrorMsg(response.error);
			errorAlert(`Failed to set breakpoint on upgrade step ${upgradeStep._id} - ${errorMsg}`, { attachToRoot: true });
		}
	};

	const columns = [
		{
			name: 'Hostname',
			field: 'hostname',
			placeholder: 'Search by Hostname',
			className: 'fixed-size-column md-column',
		},
		{
			name: 'Index',
			field: 'stepIndex',
			filterable: false,
			className: 'fixed-size-column sx-column',
			sort: 'asc',
			rowClassName: 'fixed-size-column',
		},
		{
			name: 'Command',
			field: 'command.cmd',
			placeholder: 'Search by Command',
			value: step => <div className="flex align-center">
				{step.isBreakpointSet && <i className="fa fa-circle text-danger mr-5" title="Breakpoint"/>}
				<span>{step.command?.cmd}</span>
			</div>
		},
		{
			name: 'Verification Command',
			field: 'command.verificationCommand.cmd',
			placeholder: 'Search by Verification Command',
			hiddenByDefault: true,
			value: row => row.command?.verificationCommand?.cmd
		},
		{
			name: 'Args',
			field: 'command.args',
			placeholder: 'Search by Args',
			value: row => row.command?.args?.join(', ')
		},
		{
			name: 'Status',
			field: 'status',
			placeholder: 'Search by Status',
			className: 'fixed-size-column md-column',
			rowClassName: 'fixed-size-column',
			type: 'choice',
			choices: Object.values(consts.upgradeStepStatuses).map(status => statusToLabelMap[status]),
			value: row => <UpgradeStepStatus status={row.status}/>
		},
		{
			name: 'Actions',
			title: '',
			filterable: false,
			sortable: false,
			draggable: false,
			className: 'fixed-size-column action-column',
			rowClassName: 'fixed-size-column',
			value: step => <a className="fa fa-pencil edit-button" onClick={() => editUpgradeStep(step)}></a>
		},
	];

	if (!upgrade) {
		return null;
	}

	return (
		<div className="page-content">
			<UpgradeStepModal
				isOpen={isUpgradeStepModalOpen}
				upgradeStep={upgradeStep}
				handleCancel={onCancelUpgradeStep}
				onToggleBreakpoint={handleToggleBreakpoint}
			/>

			<h1>Upgrade <span className="text-muted">{sourceVersion} &rarr; {upgrade.destinationVersion}</span></h1>

			<div className="action-container" style={{ 'marginBottom': '10px' }}>
				<button
					className="btn multi-select-action-btn btn-info mgmt-btn-info"
					disabled={upgrade.status !== consts.upgradeStatuses.PENDING_START}
					onClick={() => startUpgrade()}>
					Start
				</button>
				<button
					className="btn multi-select-action-btn btn-info mgmt-btn-info"
					disabled={upgrade.status !== consts.upgradeStatuses.PAUSED}
					onClick={() => resumeUpgrade()}>
					Resume
				</button>
				<button
					className="btn multi-select-action-btn btn-info mgmt-btn-info"
					disabled={upgrade.status !== consts.upgradeStatuses.FAILED}
					onClick={() => skipFailedMachine(upgrade)}>
					Skip Failed Machine
				</button>
			</div>

			<UpgradeDetails upgrade={upgrade}/>

			<h1>Upgrade Steps</h1>

			<FiltSortTable
				ref={tableRef}
				tableId="upgradeSteps"
				columns={columns}
				loadTotal={filter => UpgradeStepsService.loadTotalByUpgrade(upgrade._id, filter)}
				loadRows={(filter, sort, currentPage, count) => UpgradeStepsService.loadUpgradeSteps(upgrade._id, filter, sort, currentPage, count)}
			/>
		</div>
	);
};


const UpgradeDetails = ({ upgrade }) => (
	<div id="upgradeDetails"className="card">
		<div className="card-body">
			<table className="table table-no-border">
				<tbody>
					<tr>
						<th>Upgrade ID</th>
						<td>{upgrade._id}</td>
					</tr>
					<tr>
						<th>Destination Version</th>
						<td>{upgrade.destinationVersion}</td>
					</tr>
					<tr>
						<th>Upgrade Status</th>
						<td><UpgradeStatus upgrade={upgrade}/></td>
					</tr>
					<tr>
						<th>Min Redundancy Level</th>
						<td>{upgrade.minRedundancyLevel}</td>
					</tr>
					<tr>
						<th>Execution Mode</th>
						<td>{upgrade.executionMode}</td>
					</tr>
					<tr>
						<th>Skip Machines on Failure</th>
						<td>{upgrade.skipMachinesOnFailure
							? <i className="fa fa-check text-success"></i>
							: <i className="fa fa-times text-danger"></i>}
						</td>
					</tr>
					{upgrade.skipMachinesOnFailure && (
						<tr>
							<th>Max Error Threshold</th>
							<td>{upgrade.maxErrorsThreshold}</td>
						</tr>
					)}
					<tr>
						<th>Machines to Upgrade</th>
						<td>
							<ExpandableList
								items={upgrade.machinesToUpgrade}
								renderItem={(node) => <span key={node.hostname} className="label label-info">{node.hostname}</span>}
							/>
						</td>
					</tr>
					<tr>
						<th>Skipped Machines</th>
						<td>
							<ExpandableList
								items={upgrade.skippedMachines}
								renderItem={(node) => <span key={node} className="label bg-gray">{node}</span>}
							/>
						</td>
					</tr>
					<tr>
						<th>Created By</th>
						<td>
							{upgrade.createdBy} <br/>
							<small className="text-muted">{moment(upgrade.dateCreated).format('MM/DD/YYYY [at] H:mm:ss')}</small>
						</td>
					</tr>
					<tr>
						<th>Modified By</th>
						<td>
							{upgrade.modifiedBy} <br/>
							<small className="text-muted">{moment(upgrade.dateModified).format('MM/DD/YYYY [at] H:mm:ss')}</small>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
	</div>
);


export default Upgrade;