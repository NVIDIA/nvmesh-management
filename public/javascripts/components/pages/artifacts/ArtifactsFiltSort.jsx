/* global React */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { events, SocketService } from '../../services/socket.service.js';
import { ArtifactsService } from '../../services/api/artifacts.service.js';
import ExpandableList from '../../core/ExpandableList.jsx';

const ArtifactsFiltSort = ({
	tableRef,
	columns = [],
	...props
}) => {
	const filtSortColumns = [
		{
			name: 'Name',
			field: 'name',
			placeholder: 'Search by Name',
		},
		{
			name: 'Platforms',
			field: 'platforms',
			filterable: false,
			sortable: false,
			value: row => <ExpandableList
				items={row.platforms}
				renderItem={(platform, index) => <span key={index} className="label label-info">{platform.name}</span>}/>,
		},
		...columns
	];

	const reloadTable = () => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	};

	const loadRows = async(filter, sort, currentPage, count) => {
		const artifacts = await ArtifactsService.loadArtifacts(filter, sort, currentPage, count);
		artifacts.forEach(artifact => {
			SocketService.addHandler(SocketService.getArtifactID(artifact.ID) + events.artifactChangedEvent.name, () => reloadTable());
			SocketService.addHandler(SocketService.getArtifactID(artifact.ID) + events.artifactRemovedEvent.name, () => reloadTable());
		});
		return artifacts;
	};

	return (
		<FiltSortTable
			rowIdentifier="ID"
			ref={tableRef}
			columns={filtSortColumns}
			loadTotal={ArtifactsService.loadTotal}
			loadRows={loadRows}
			{...props}
		/>
	);
};

export default ArtifactsFiltSort;