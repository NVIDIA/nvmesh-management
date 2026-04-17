/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, consts */

import StatusGauge from '../../shared/StatusGauge.jsx';
import AllocationChart from './AllocationChart.jsx';
import LargestVolumes from './LargestVolumes.jsx';
import { TargetsService } from '../../services/api/targets.service.js';
import ManagementService from '../../services/api/management.service.js';
import TilesDiagram from './TilesDiagram.jsx';
import AlertsTable from './AlertsTable.jsx';
import { SocketService, events } from '../../services/socket.service.js';
import { VolumesService } from '../../services/api/volumes.service.js';
import { useAppContext } from '../App.jsx';
import { useAlerts } from '../../core/Alert.jsx';
import { getBaseVersion } from '../../utils.js';
import { UpgradesService } from '../../services/api/upgrades.service.js';

const { useState, useEffect } = React;

const Dashboard = () => {
	const { systemInfo } = useAppContext();
	const { infoAlert } = useAlerts();
	const [spaceAllocationData, setSpaceAllocationData] = useState();
	const [largestVolumesData, setLargestVolumesData] = useState([]);
	const [targetAllocationData, setTargetAllocationData] = useState([]);
	const [countersData, setCountersData] = useState();
	const [isLoaded, setIsLoaded] = useState(false);

	useEffect(() => {
		const fetchData = async() => {
			const [spaceAllocationData, largestVolumesData, targetAllocationData, countersData] = await Promise.all([
				ManagementService.getSpaceAllocation(),
				VolumesService.getLargestVolumes(),
				TargetsService.getAllocationByTarget(),
				ManagementService.getCounters()
			]);

			setSpaceAllocationData(spaceAllocationData);
			setLargestVolumesData(largestVolumesData);
			setTargetAllocationData(targetAllocationData);
			setCountersData(countersData);
			setIsLoaded(true);
		};

		fetchData();
		registerToEvents();

		const baseVersion = getBaseVersion(systemInfo.version);
		checkForUpgrades(baseVersion);
	}, []);

	const registerToEvents = () => {
		SocketService.addHandler(events.serversCountChangeEvent.name, ({ payload }) => {
			setCounter('serverCount', payload);
		});

		SocketService.addHandler(events.clientsCountChangeEvent.name, ({ payload }) => {
			setCounter('clientCount', payload);
		});

		SocketService.addHandler(events.disksCountChangeEvent.name, ({ payload }) => {
			setCounter('diskCount', payload);
		});

		SocketService.addHandler(events.volumesCountChangeEvent.name, getVolumeCounters);
		SocketService.addHandler(events.zoneAvailabilityChangeEvent.name, getVolumeCounters);

		SocketService.addHandler(events.largestVolumesChangeEvent.name, (data) => {
			if (!Array.isArray(data?.payload)) {
				return;
			}

			setLargestVolumesData(data.payload);
		});

		SocketService.addHandler(events.allocatedSpaceChangeEvent.name, data => {
			setSpaceAllocationData(data.payload || data || {});
		});
	};

	const checkForUpgrades = async(currentVersion) => {
		const possibleUpgrades = await UpgradesService.getPossibleUpgrade(currentVersion);
		const displayablePossibleUpgrades = [...new Set(possibleUpgrades)].filter(version => version !== currentVersion);
		const versions = displayablePossibleUpgrades.join(', ');
		const nextVersionKey = `upgradeDismissed-${versions}`;

		const isAlertDismissed = localStorage.getItem(nextVersionKey);

		if (displayablePossibleUpgrades.length && !isAlertDismissed) {
			infoAlert(<span>New {displayablePossibleUpgrades.length > 1 ? 'versions' : 'version'} available: {versions}. <a href="/upgrades">
				<strong>Click to upgrade</strong></a>
			</span>, {
				timeout: 0,
				onDismiss: () => localStorage.setItem(nextVersionKey, 'true'),
			});
		}
	};

	async function getVolumeCounters() {
		const { volumeCount, cdvCount, tpvCount } = await ManagementService.getVolumeCounters();
		setCountersData(prev => ({
			...prev,
			volumeCount: { ...prev.volumeCount, ...volumeCount },
			cdvCount: { ...prev.cdvCount, ...cdvCount },
			tpvCount: { ...prev.tpvCount, ...tpvCount },
		}));
	}

	const setCounter = (counterName, data) => {
		const { updateType, ...counterFields } = data;
		if (updateType === consts.updateTypes.FULL) {
			setCountersData(prev => ({ ...prev, [counterName]: { ...prev[counterName], ...counterFields } }));
		} else {
			setCountersData(prev => {
				const newCountersData = { ...prev };
				for (let counterField in counterFields) {
					newCountersData[counterName][counterField] += counterFields[counterField];
				}
				return newCountersData;
			});
		}
	};

	if (!isLoaded) {
		return null;
	}

	return (
		<div className="page-content">
			<div className="section">
				<h1>Dashboard</h1>

				{countersData && (
					<div className="dashboard-gauges-section">
						<div className="dashboard-row-container">
							<div className="dashboard-gauges">
								<StatusGauge
									header="Volumes"
									headerLink="/volumes"
									icon={<i className="fa fa-bolt"></i>}
									topElement={{
										name: 'Healthy',
										value: countersData.volumeCount.total - (countersData.volumeCount.critical + countersData.volumeCount.alarm),
										link: '/volumes?filter={"health": "healthy"}'
									}}
									rightElement={{
										name: 'Critical',
										value: countersData.volumeCount.critical,
										link: '/volumes?filter={"health": "critical"}'
									}}
									leftElement={{
										name: 'Alarm',
										value: countersData.volumeCount.alarm,
										link: '/volumes?filter={"health": "alarm"}'
									}}
								/>
							</div>
							<div className="dashboard-gauges">
								<StatusGauge
									header="TPVs"
									headerLink="/thinProvisioning"
									icon={<i className="fa fa-clone"></i>}
									topElement={{
										name: 'Healthy',
										value: countersData.tpvCount.healthy,
										link: '/thinProvisioning'
									}}
									rightElement={{
										name: 'Critical',
										value: countersData.tpvCount.critical,
										link: '/thinProvisioning'
									}}
									leftElement={{
										name: 'Alarm',
										value: countersData.tpvCount.alarm,
										link: '/thinProvisioning'
									}}
									bottomElement={{
										name: 'Detached',
										value: countersData.tpvCount.detached,
										link: '/thinProvisioning'
									}}
								/>
							</div>
							<div className="dashboard-gauges">
								<StatusGauge
									header="CDVs"
									headerLink="/thinProvisioning/cdv"
									icon={<i className="fa fa-database"></i>}
									topElement={{
										name: 'Healthy',
										value: countersData.cdvCount.total - (countersData.cdvCount.critical + countersData.cdvCount.alarm),
										link: '/thinProvisioning/cdv'
									}}
									rightElement={{
										name: 'Critical',
										value: countersData.cdvCount.critical,
										link: '/thinProvisioning/cdv'
									}}
									leftElement={{
										name: 'Alarm',
										value: countersData.cdvCount.alarm,
										link: '/thinProvisioning/cdv'
									}}
								/>
							</div>
						</div>
						<div className="dashboard-row-container dashboard-row-container--infrastructure">
							<div className="dashboard-gauges">
								<StatusGauge
									header="Targets"
									headerLink="/servers"
									icon={<i className="fa fa-bullseye"></i>}
									topElement={{
										name: 'Healthy',
										value: countersData.serverCount.total - (countersData.serverCount.critical + countersData.serverCount.alarm),
										link: '/servers?filter={"health": "healthy"}'
									}}
									rightElement={{
										name: 'Critical',
										value: countersData.serverCount.critical,
										link: '/servers?filter={"health": "critical"}'
									}}
									leftElement={{
										name: 'Alarm',
										value: countersData.serverCount.alarm,
										link: '/servers?filter={"health": "alarm"}'
									}}
								/>
							</div>
							<div className="dashboard-gauges">
								<StatusGauge
									header="Clients"
									headerLink="/clients"
									icon={<i className="fa fa-desktop"></i>}
									topElement={{
										name: 'Healthy',
										value: countersData.clientCount.total - (countersData.clientCount.critical + countersData.clientCount.alarm),
										link: '/clients?filter={"health": "healthy"}'
									}}
									rightElement={{
										name: 'Critical',
										value: countersData.clientCount.critical,
										link: '/clients?filter={"health": "critical"}'
									}}
									leftElement={{
										name: 'Alarm',
										value: countersData.clientCount.alarm,
										link: '/clients?filter={"health": "alarm"}'
									}}
								/>
							</div>
							<div className="dashboard-gauges">
								<StatusGauge
									header="Drives"
									headerLink="/disks"
									icon={<i className="fa fa-hdd-o"></i>}
									topElement={{
										name: 'Healthy',
										value: countersData.diskCount.total - (countersData.diskCount.critical + countersData.diskCount.alarm),
										link: '/disks?filter={"disks.health": "healthy"}'
									}}
									rightElement={{
										name: 'Critical',
										value: countersData.diskCount.critical,
										link: '/disks?filter={"disks.health": "critical"}'
									}}
									leftElement={{
										name: 'Alarm',
										value: countersData.diskCount.alarm,
										link: '/disks?filter={"disks.health": "alarm"}'
									}}
								/>
							</div>
						</div>
					</div>
				)}
			</div>


			<div className="section">
				<h1>Capacity</h1>

				<div className="row">
					<div className="col-md-6 right-divider" style={{ marginBottom: '25px' }}>
						<h2>Allocation Chart</h2>

						{spaceAllocationData && (
							<AllocationChart
								volumeSpace={spaceAllocationData.data + spaceAllocationData.reservedLeft}
								redundancySpace={spaceAllocationData.redundancy}
								freeSpace={spaceAllocationData.availableSpace}
								totalSpace={spaceAllocationData.totalCapacity}
							/>
						)}
					</div>
					<div className="col-md-6" style={{ padding: '0 40px' }}>
						<h2>Largest Volumes</h2>
						{spaceAllocationData && (
							<LargestVolumes
								volumes={largestVolumesData}
								totalCapacity={spaceAllocationData.totalCapacity}
							/>
						)}
						<h2>Drive Space Allocation Per Target</h2>
						<TilesDiagram targets={targetAllocationData}/>
					</div>
				</div>
			</div>

			<div className="section">
				<h1>Alerts</h1>
				<div className="row">
					<div className="col-md-12">
						<AlertsTable/>
					</div>
				</div>
			</div>

		</div>
	);
};

export default Dashboard;
