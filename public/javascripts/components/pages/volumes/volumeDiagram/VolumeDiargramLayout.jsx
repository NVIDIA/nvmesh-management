/* global React, consts */

import { AccordionPanel, Panel } from '../../../core/AccordionPanel.jsx';
import { AppContext } from '../../App.jsx';
import CapacityService from '../../../services/capacity.service.js';
import { statusToCaption, statusToHealth } from '../Volumes.jsx';
import VolumeDiagramSegment from './VolumeDiargramSegment.jsx';

const { useContext } = React;

const PRaid = ({
	pRaid
}) => {
	return (
		<div className="pRaid">
			<div className="pRaidStatus">
				<h5 className={statusToHealth(pRaid.status)}>{statusToCaption(pRaid.status)}</h5>
			</div>
			<div className="tilesContainer">
				{pRaid.diskSegments.map((diskSegment, index) => <VolumeDiagramSegment key={index} diskSegment={diskSegment}/>)}
			</div>
		</div>
	);
};

const VolumeDiagramLayout = ({
	layout
}) => {
	const { unitType } = useContext(AppContext);

	return (
		<Panel style={{ marginBottom: '200px' }}>
			{layout.chunks.map((chunk) => {
				const name = 'Virtual LBA: ' + chunk.vlbs + ' - ' + chunk.vlbe;
				const capacity = (consts.BLOCK_SIZE / consts.GB) * ((chunk.vlbe - chunk.vlbs));

				return (
					<AccordionPanel key={name}
					                title={`${name} (${CapacityService.toBiggestUnit(capacity, unitType)})`}
					                open>
						<div className="flex flex-row">
							{chunk.pRaids.map((pRaid, index) => <PRaid key={index} pRaid={pRaid}/>)}
						</div>
					</AccordionPanel>
				);
			})}
		</Panel>
	);
};


export default VolumeDiagramLayout;