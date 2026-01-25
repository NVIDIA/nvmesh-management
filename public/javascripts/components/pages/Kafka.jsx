/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import FiltSortTable from '../filtsort-table/FiltSortTable.jsx';
import { KafkaService } from '../services/api/kafka.service.js';

const {
	useState,
	useEffect
} = React;

const Kafka = () => {
	const [leaderId, setLeaderId] = useState(null);
	const [rows, setRows] = useState([]);
	const [isLoaded, setIsLoaded] = useState(false);

	const columns = [
		{
			name: 'Node Id',
			field: 'nodeId',
			filterable: false,
			sortable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column'
		},
		{
			name: 'Host',
			field: 'host',
			filterable: false,
			sortable: false,
			className: 'fixed-size-column lg-column',
			value: row => <strong>{row.host}</strong>
		},
		{
			name: 'Port',
			field: 'port',
			filterable: false,
			sortable: false,
			className: 'fixed-size-column lg-column'
		},
		{
			name: 'Leader',
			field: 'isLeader',
			filterable: false,
			sortable: false,
			type: 'boolean',
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: row => row.nodeId === leaderId && <i className="ion-checkmark-round"/>
		},
	];

	useEffect(() => {
		const fetchData = async() => {
			const clusterMetadata = await KafkaService.getClusterMetadata();
			if (clusterMetadata) {
				setLeaderId(clusterMetadata.controller);
				setRows(clusterMetadata.brokers);
			}
			setIsLoaded(true);
		};

		fetchData();
	}, []);

	return (
		<div className="page-content">
			<h1>Kafka</h1>
			{isLoaded && <FiltSortTable tableId="kafka"
			                            columns={columns}
			                            loadTotal={() => rows.length}
			                            loadRows={() => rows}
			                            paginationDisabled={true}
			/>}
		</div>
	);
};

export default Kafka;
