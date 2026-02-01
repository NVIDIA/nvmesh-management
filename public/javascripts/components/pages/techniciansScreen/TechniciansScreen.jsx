/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */
import TreeTable from '../../core/TreeTable/TreeTable.jsx';
import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { TechniciansScreenService } from '../../services/api/techniciansScreen.service.js';
import { FiltSortService } from '../../services/filtSort.service.js';
import { pipe } from '../../utils.js';
import ControlPanel from './ControlPanel.jsx';

const { useRef, useState, useEffect } = React;


const getFilterSortPagePipeline = (filter, sort, currentPage, count) => {
	return [
		FiltSortService.filterData(filter),
		FiltSortService.sortData(sort),
		FiltSortService.pageData(currentPage, count)
	];
};

const flattenCommsStats = data => {
	const flatCommsStats = [];

	for (const machineName in data) {
		const commStat = data[machineName];

		for (const route in commStat.routes) {
			const { registrant, total } = commStat.routes[route];

			flatCommsStats.push({
				host: machineName,
				registrant,
				route,
				total
			});
		}
	}

	return flatCommsStats;
};

const flattenMonitoredEvents = data => Object.entries(data).map(([name, { refCount }]) => ({ name, refCount }));

const traverseAndModifyTimedIntervals = (timedIntervals, modifyingFunc) => {
	const { intervals } = timedIntervals;

	Object.keys(intervals).forEach((key) => {
		const timedInterval = intervals[key];
		modifyingFunc(timedInterval);
		traverseAndModifyTimedIntervals(timedInterval, modifyingFunc);
	});

	return timedIntervals;
};

const filterNotTimed = (timedIntervals) => {
	const { intervals } = timedIntervals;

	Object.keys(intervals).forEach((key) => {
		if (intervals[key].maxTime === -1) {
			delete intervals[key];
		}
	});

	return timedIntervals;
};

const truncateIdToName = (timedIntervals) =>
	traverseAndModifyTimedIntervals(timedIntervals, (timedInterval) => {
		timedInterval.name = timedInterval.id.includes('.')
			? timedInterval.id.split('.').pop()
			: timedInterval.id;
	});

const sumTotalIntervalsCalls = (timedIntervals) =>
	traverseAndModifyTimedIntervals(timedIntervals, (timedInterval) => {
		timedInterval.totalCount = timedInterval.successCount + timedInterval.failCount;
	});

const calcTimedIntervalsAvg = (timedIntervals) =>
	traverseAndModifyTimedIntervals(timedIntervals, (timedInterval) => {
		timedInterval.avgTime = timedInterval.totalTimeSpent / timedInterval.totalCount;
	});

const truncateTimeToFixed = (timedIntervals) => {
	const toFixed = (num) => {
		const places = 3;
		return Number(num).toFixed(places);
	};

	return traverseAndModifyTimedIntervals(timedIntervals, (timedInterval) => {
		['totalTimeSpent', 'minTime', 'maxTime', 'avgTime'].forEach((key) => {
			timedInterval[key] = toFixed(timedInterval[key]);
		});
	});
};

const transformToTreeData = (timedIntervals) => {
	const treeData = [];
	const { intervals } = timedIntervals;

	Object.keys(intervals).forEach((key) => {
		const treeNode = createTreeNode(intervals[key]);
		treeData.push(treeNode);
	});

	return treeData;
};

const createTreeNode = (timedInterval) => {
	const treeNode = {};
	const { intervals = {} } = timedInterval;
	const intervalKeys = Object.keys(intervals);

	if (intervalKeys.length > 0) {
		treeNode.children = [];
	}

	Object.entries(timedInterval).forEach(([key, value]) => {
		if (key !== 'intervals') {
			treeNode[key] = value;
		}
	});

	intervalKeys.forEach((key) => {
		const childNode = createTreeNode(intervals[key]);
		treeNode.children.push(childNode);
	});

	return treeNode;
};

const TechniciansScreen = () => {
	const commsTableRef = useRef();
	const monitoredEventsTableRef = useRef();
	const kafkaMetricsTableRef = useRef();
	const [comms, setComms] = useState({});
	const [monitoredEvents, setMonitoredEvents] = useState({});
	const [kafkaStats, setKafkaStats] = useState({});
	const [timedIntervals, setTimedIntervals] = useState([]);
	const [kafkaStatsResetDisabled, setKafkaStatsResetDisabled] = useState(false);

	const commsColumns = [
		{
			name: 'Host',
			title: 'Host',
			field: 'host',
			placeholder: 'Search by Host ID',
			sort: 'asc',
			filterable: true
		},
		{
			name: 'Registrant',
			title: 'Registrant',
			field: 'registrant',
			placeholder: 'Search by Registrant ID',
			sort: 'asc',
			filterable: true
		},
		{
			name: 'Route',
			title: 'Route',
			field: 'route',
			placeholder: 'Search by Route',
			sort: 'asc',
			filterable: true
		},
		{
			name: 'Total',
			title: 'Total',
			field: 'total',
			placeholder: 'Search by Total',
			sort: 'asc',
			filterable: true
		}
	];
	const monitoredEventsColumns = [
		{
			name: 'Name',
			title: 'Name',
			field: 'name',
			placeholder: 'Search by Name',
			sort: 'asc',
			filterable: true
		},
		{
			name: 'Reference Count',
			title: 'Reference Count',
			field: 'refCount',
			placeholder: 'Search by Reference Count',
			sort: 'asc',
			filterable: true
		}
	];
	const kafkaMetricsColumns = [
		{
			name: 'Topic',
			title: 'Topic',
			field: 'topic',
			placeholder: 'Search by Topic',
			sort: 'asc',
			filterable: true
		},
		{
			name: 'Message Type',
			title: 'Message Type',
			field: 'messageType',
			placeholder: 'Search by Message Type',
			sort: 'asc',
			filterable: true
		},
		{
			name: 'Count',
			title: 'Count',
			field: 'count',
			placeholder: 'Search by Count',
			sort: 'asc',
			filterable: true
		}
	];
	const timedIntervalsColumns = [
		{ key: 'name', title: 'Name' },
		{ key: 'successCount', title: 'Success Count', className: 'fixed-size-column md-column', rowClassName: 'fixed-size-column' },
		{ key: 'failCount', title: 'Fail Count', className: 'fixed-size-column md-column', rowClassName: 'fixed-size-column' },
		{ key: 'totalTimeSpent', title: 'Total Time Spent', className: 'fixed-size-column md-column', rowClassName: 'fixed-size-column' },
		{ key: 'avgTime', title: 'Avg Time', className: 'fixed-size-column md-column', rowClassName: 'fixed-size-column' },
		{ key: 'maxTime', title: 'Max Time', className: 'fixed-size-column md-column', rowClassName: 'fixed-size-column' },
		{ key: 'minTime', title: 'Min Time', className: 'fixed-size-column md-column', rowClassName: 'fixed-size-column' }
	];

	const loadCommsRows = async(filter, sort, currentPage, count) => {
		const rawComms = await TechniciansScreenService.loadComms();
		const filterSortPagePipeline = getFilterSortPagePipeline(filter, sort, currentPage, count);

		const processedComms = pipe(
			[
				flattenCommsStats,
				...filterSortPagePipeline
			]
		)(rawComms);
		setComms(processedComms);

		return processedComms;
	};
	const loadMonitoredEventsRows = async(filter, sort, currentPage, count) => {
		const rawMonitoredEvents = await TechniciansScreenService.loadMonitoredEvents();
		const filterSortPagePipeline = getFilterSortPagePipeline(filter, sort, currentPage, count);

		const processedMonitoredEvents = pipe(
			[
				flattenMonitoredEvents,
				...filterSortPagePipeline
			]
		)(rawMonitoredEvents);
		setMonitoredEvents(processedMonitoredEvents);

		return processedMonitoredEvents;
	};
	const loadKafkaMetricsRows = async(filter, sort, currentPage, count) => {
		const rawKafkaMetrics = await TechniciansScreenService.loadKafkaMetrics();
		setKafkaStats(rawKafkaMetrics);

		const filterSortPagePipeline = getFilterSortPagePipeline(filter, sort, currentPage, count);

		return pipe(
			[
				data => data.metrics,
				...filterSortPagePipeline
			]
		)(rawKafkaMetrics);
	};
	const loadTimedIntervalsRows = async(options) => {
		const rawTimedIntervals = await TechniciansScreenService.loadTimedIntervals(options);

		const processedTimedIntervals = pipe(
			[
				filterNotTimed,
				truncateIdToName,
				sumTotalIntervalsCalls,
				calcTimedIntervalsAvg,
				truncateTimeToFixed,
				transformToTreeData
			]
		)(rawTimedIntervals);
		setTimedIntervals(processedTimedIntervals);

		return processedTimedIntervals;
	};

	useEffect(() => {
		loadTimedIntervalsRows();
	}, []);

	const resetKafkaMetrics = async() => {
		setKafkaStatsResetDisabled(true);
		await TechniciansScreenService.resetKafkaMetrics();

		if (kafkaMetricsTableRef.current) {
			await kafkaMetricsTableRef.current.reloadRows();
			await kafkaMetricsTableRef.current.reloadTotal();
		}

		setKafkaStatsResetDisabled(false);
	};

	const reloadRecordableTables = async(isRecording) => {
		await loadTimedIntervalsRows({ clearCache: isRecording, isTiming: isRecording });
	};

	return (
		<div className="page-content">
			<h1>Technicians Screen</h1>
			<ControlPanel
				tablesData={{
					communications: comms,
					monitoredEvents,
					kafkaStats,
					timedIntervals
				}}
				reloadRecordableTables={reloadRecordableTables}>
			</ControlPanel>
			<hr></hr>
			<h2>Timed Intervals</h2>
			<br></br>
			{timedIntervals.length > 0 && (<TreeTable data={timedIntervals} columns={timedIntervalsColumns} className="table-hover"/>)}
			<hr></hr>
			<h2>WS Communication</h2>
			<FiltSortTable ref={commsTableRef}
			               tableId="comms"
			               columns={commsColumns}
			               loadTotal={TechniciansScreenService.loadTotalComms}
			               loadRows={loadCommsRows}
			               multiselectOptions={{
				               enabled: false
			               }}
			/>
			<hr></hr>
			<h2>Monitored Events</h2>
			<FiltSortTable ref={monitoredEventsTableRef}
			               tableId="monitoredEvents"
			               columns={monitoredEventsColumns}
			               loadTotal={TechniciansScreenService.loadTotalMonitoredEvents}
			               loadRows={loadMonitoredEventsRows}
			               multiselectOptions={{
				               enabled: false
			               }}
			/>
			<hr></hr>
			<h2>Kafka Metrics</h2>
			<div className="row">
				{Array.isArray(kafkaStats.subscribableTopics) && (
					<div className="col-md-10">
						<strong>Subscribable Topics</strong>
						<br></br>
						{kafkaStats.subscribableTopics.map((topic, index) => (
							<span
								key={index}
								className="label label-info kafka-topic-label"
							>
								{topic}
							</span>
						))}
					</div>
				)}
				<div className="col-md-2">
					<button
						type="button"
						className="btn btn-info pull-right"
						disabled={kafkaStatsResetDisabled}
						onClick={resetKafkaMetrics}
					>
						Reset
					</button>
				</div>
			</div>
			<br></br>
			<br></br>
			<div className="row">
				{kafkaStats ? (
					<div className="col-md-10">
						<strong>Stats</strong>
						<br></br>
						{
							[
								'messagesInProcess',
								'isConsumerPaused',
								'totalConsumed',
								'totalSent',
								'totalSentFailed'
							].map((prop) => (
								<div key={prop} className="col-md-2">
									<div>
										<strong>{prop}</strong>
										<div>{kafkaStats?.[prop] ?? '—'}</div>
									</div>
								</div>
							))}
					</div>
				) : (
					<p>Loading stats...</p>
				)}
			</div>
			<br></br>
			<br></br>
			<strong>Messages</strong>
			<FiltSortTable ref={kafkaMetricsTableRef}
			               tableId="kafkaMetrics"
			               columns={kafkaMetricsColumns}
			               loadTotal={TechniciansScreenService.loadTotalKafkaMetrics}
			               loadRows={loadKafkaMetricsRows}
			               multiselectOptions={{
				               enabled: false
			               }}
			/>
		</div>
	);
};

export default TechniciansScreen;