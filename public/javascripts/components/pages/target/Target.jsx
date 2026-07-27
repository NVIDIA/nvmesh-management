/* global React, moment, consts */

import StatusGauge from '../../shared/StatusGauge.jsx';
import { TargetsService } from '../../services/api/targets.service.js';
import NicDisplay from './NicDisplay.jsx';
import { extractResults } from '../../utils.js';
import { useAlerts } from '../../core/Alert.jsx';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import { AccordionPanel, Panel } from '../../core/AccordionPanel.jsx';
import { events, SocketService } from '../../services/socket.service.js';
import DiskDisplay from '../../shared/disk-display/DiskDisplay.jsx';

const { useState, useEffect } = React;

const pingToStatus = (dateModified, tomaStatus) => {
	if (tomaStatus === consts.tomaStatuses.DOWN) {
		return { class: 'fa fa-exclamation-circle red', msg: 'Toma is down' };
	}
	if (tomaStatus === consts.tomaStatuses.UNAVAILABLE) {
		return { class: 'fa fa-exclamation-circle red', msg: 'Target status Unavailable' };
	}

	if (dateModified) {
		const now = new Date();
		const deltaInSeconds = (now - new Date(dateModified)) / 1000;

		if (deltaInSeconds > 5 * 60) {
			return { class: 'fa fa-exclamation-circle red', msg: 'More than 5 minutes since last communication' };
		}
		if (deltaInSeconds > 2 * 60) {
			return { class: 'ion-alert-circled yellow', msg: 'More than 2 minutes since last communication' };
		}

		return { class: 'ion-checkmark-circled green' };
	}
};

const calcCounter = (target) => {
	const counters = {
		diskCount: {
			total: target?.disks?.length || 0,
			alarm: 0,
			critical: 0
		},
		nicsCount: {
			total: target?.nics?.length || 0,
			alarm: 0,
			critical: 0
		}
	};

	target.disks.forEach((e) => {
		if (e.health && e.health !== 'healthy') {
			if (e.health !== 'critical') {
				counters.diskCount.alarm++;
			} else {
				counters.diskCount.critical++;
			}
		}
	});

	target.nics.forEach((e) => {
		if (e.health && e.health !== 'healthy') {
			if (e.health !== 'critical') {
				counters.nicsCount.alarm++;
			} else {
				counters.nicsCount.critical++;
			}
		}
	});

	return counters;
};

const calcDisksByType = (disks) => {
	const result = {
		excludedDisks: [],
		notInitializedDisks: [],
		ecOptimizedDisks: [],
		raidOptimizedDisks: []
	};

	if (disks?.length) {
		const handledDisksIds = [];

		result.excludedDisks = disks.filter(disk => disk.isExcluded);
		handledDisksIds.push(...result.excludedDisks.map(disk => disk.uuid));

		result.notInitializedDisks = disks.filter(disk => {
			return !disk.isPendingFormat && (disk.status === consts.diskStatus.NOT_INITIALIZED || disk.status === consts.diskStatus.FORMAT_ERROR)
				&& !handledDisksIds.includes(disk.uuid);
		});
		handledDisksIds.push(...result.notInitializedDisks.map(disk => disk.uuid));

		result.ecOptimizedDisks = disks.filter(disk => {
			return ((disk.formatDetails && disk.formatDetails.formatType === consts.formatTypes.FORMAT_EC) || (disk.metadata_size && !disk.formatDetails))
				&& !handledDisksIds.includes(disk.uuid);
		});
		handledDisksIds.push(...result.ecOptimizedDisks.map(disk => disk.uuid));

		result.raidOptimizedDisks = disks.filter(disk => {
			return ((disk.formatDetails && disk.formatDetails.formatType === consts.formatTypes.FORMAT_RAID) ||
				(!disk.metadata_size && !disk.formatDetails)) && !handledDisksIds.includes(disk.uuid);
		});
	}

	return result;
};


const Target = () => {
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const [target, setTarget] = useState(null);
	const [counters, setCounters] = useState(null);
	const [disksByType, setDisksByType] = useState({});

	useEffect(() => {
		const fetchTarget = async() => {
			const target = await reloadTarget();
			registerToEvents(target);
		};

		fetchTarget();
	}, []);

	const reloadTarget = async() => {
		const targetId = window.location.pathname.match(/servers\/server\/([^/]+)/)[1];
		const target = await TargetsService.getTargetByID(targetId);
		setTarget(target);
		setCounters(calcCounter(target));
		setDisksByType(calcDisksByType(target.disks));

		return target;
	};

	const registerToEvents = (target) => {
		const getTargetEventName = (event) => SocketService.getTargetID(target.node_id) + event.name;

		SocketService.addHandler(getTargetEventName(events.diskFailureEvent), reloadTarget);
		SocketService.addHandler(getTargetEventName(events.diskReappearEvent), reloadTarget);
		SocketService.addHandler(getTargetEventName(events.diskWentOnlineEvent), reloadTarget);
		SocketService.addHandler(getTargetEventName(events.newDiskEvent), reloadTarget);
		SocketService.addHandler(getTargetEventName(events.diskStatusChangeEvent), reloadTarget);
		SocketService.addHandler(getTargetEventName(events.DiskFinishedFormatEvent), reloadTarget);
		SocketService.addHandler(getTargetEventName(events.driveZeroingProgressChangeEvent), reloadTarget);
		SocketService.addHandler(getTargetEventName(events.nicFailureEvent), reloadTarget);
		SocketService.addHandler(getTargetEventName(events.nicReappearEvent), reloadTarget);
		SocketService.addHandler(getTargetEventName(events.nicWentOnlineEvent), reloadTarget);
		SocketService.addHandler(getTargetEventName(events.newNicEvent), reloadTarget);
		SocketService.addHandler(getTargetEventName(events.nicChangeEvent), reloadTarget);
		SocketService.addHandler(getTargetEventName(events.disksCountChangeEvent), reloadTarget);
		SocketService.addHandler(getTargetEventName(events.nicsCountChangeEvent), reloadTarget);
		SocketService.addHandler(getTargetEventName(events.diskRemovedEvent), reloadTarget);
		SocketService.addHandler(getTargetEventName(events.nicRemovedEvent), reloadTarget);
		SocketService.addHandler(getTargetEventName(events.formatDiskEvent), reloadTarget);
	};

	const removeNic = async(nicIP, nic) => {
		const confirmed = await confirm(`You're going to delete NIC: ${nicIP}. Are you sure?`);
		if (!confirmed) {
			return;
		}

		const { nodeID: targetID, nodeUUID: targetUUID, nicID } = nic;
		const responses = await TargetsService.deleteNics([{ targetID, targetUUID, nicID }]);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} NIC(s) deleted successfully`);
			setTarget(prevTarget => ({
				...prevTarget,
				nics: prevTarget.nics.filter(e => e.nicID !== nicID)
			}));
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Failed to delete NICs ${ids} - ${errorMsg}`);
		});
	};


	if (!target) {
		return null;
	}

	const { class: statusClass, msg: statusMsg } = pingToStatus(target.dateModified, target.tomaStatus);

	return (
		<div className="page-content">

			<div className="section">
				<h1>
					Target - {target.node_id}
					<span className="pull-right" title={statusMsg}>
						<span className={`mr-5 ${statusClass}`}></span>
						Last ping <span className="small">{moment(target.dateModified).format('MM/DD/YYYY H:mm:ss')}</span>
					</span>
				</h1>

				{counters && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '30px', justifyContent: 'center' }}>
					<div className="dashboard-gauges">
						<StatusGauge
							header="Drives"
							headerLink={`/disks?filter={"node_id": "${target.node_id}"}`}
							icon={<i className="fa fa-hdd-o"></i>}
							topElement={{
								name: 'Healthy',
								value: counters.diskCount.total - (counters.diskCount.alarm + counters.diskCount.critical),
								link: `/disks?filter={"node_id": "${target.node_id}", "disks.health": "healthy"}`
							}}
							rightElement={{
								name: 'Critical',
								value: counters.diskCount.critical,
								link: `/disks?filter={"node_id": "${target.node_id}", "disks.health": "critical"}`
							}}
							leftElement={{
								name: 'Alarm',
								value: counters.diskCount.alarm,
								link: `/disks?filter={"node_id": "${target.node_id}", "disks.health": "alarm"}`
							}}
						/>
					</div>
					<div className="dashboard-gauges">
						<StatusGauge
							header="NICs"
							icon={<i className="fa fa-signal"></i>}
							topElement={{
								name: 'Healthy',
								value: counters.nicsCount.total - (counters.nicsCount.alarm + counters.nicsCount.critical),
							}}
							rightElement={{
								name: 'Critical',
								value: counters.nicsCount.critical,
							}}
							leftElement={{
								name: 'Alarm',
								value: counters.nicsCount.alarm,
							}}
						/>
					</div>
				</div>}
			</div>


			<div className="section">
				<h1>Drive Pools</h1>

				<Panel>
					<AccordionPanel title={`Parity Ready (${disksByType.ecOptimizedDisks.length})`}
					                open={disksByType.ecOptimizedDisks.length}>
						<TargetDisks disks={disksByType.ecOptimizedDisks}
						             target={target}/>
					</AccordionPanel>
					<AccordionPanel title={`Concatenated, Striped and/or Mirrored (${disksByType.raidOptimizedDisks.length})`}
					                open={disksByType.raidOptimizedDisks.length}>
						<TargetDisks disks={disksByType.raidOptimizedDisks}
						             target={target}/>
					</AccordionPanel>
					<AccordionPanel title={`Not formatted for NVMesh (${disksByType.notInitializedDisks.length})`}
					                open={disksByType.notInitializedDisks.length}>
						<TargetDisks disks={disksByType.notInitializedDisks}
						             target={target}/>
					</AccordionPanel>
					<AccordionPanel title={`Excluded (${disksByType.excludedDisks.length})`}
					                open={disksByType.excludedDisks.length}>
						<TargetDisks disks={disksByType.excludedDisks}
						             target={target}/>
					</AccordionPanel>
				</Panel>

			</div>

			<div className="section">
				<h1>NICs</h1>

				<div className="nics-container">
					{target.nics.map((nic) => (
						<NicDisplay key={nic.nicID}
						            nic={nic}
						            onDelete={removeNic}/>
					))}
				</div>

			</div>

		</div>
	);
};

const TargetDisks = ({ disks, target }) => {
	return (
		<div className="disks-container">
			{disks.map(disk => (
				<DiskDisplay key={disk.uuid}
				             expanded
				             target={target}
				             disk={disk}/>
			))}
		</div>
	);
};

export default Target;
