/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import Modal from '../../../core/Modal.jsx';
import { VolumesService } from '../../../services/api/volumes.service.js';
import { Tabs, Tab } from '../../../core/Tabs.jsx';
import VolumeDiagramLayout from './VolumeDiargramLayout.jsx';
import VolumeDiagramTargets from './VolumeDiargramTargets.jsx';

const { useEffect, useState } = React;

const VolumeDiagram = ({
	volumeId
}) => {
	const [volumeDiagram, setVolumeDiagram] = useState([]);
	const mainVolumeDiagram = volumeDiagram[0];

	useEffect(() => {
		const fetchVolumeDiagram = async() => {
			const volumeDiagramResponse = await VolumesService.getVolumeDiagram(volumeId);
			setVolumeDiagram(volumeDiagramResponse);
		};

		fetchVolumeDiagram();
	}, []);

	return (
		<div className="modal-body">
			{mainVolumeDiagram?.additionalInfo && <div className="row">
				<div className="col-lg-8">
					<table className="table">
						<tbody>
							{Object.entries(mainVolumeDiagram.additionalInfo).map(([key, value]) => (
								<tr key={key}>
									<th className="col-3">{key}</th>
									<td className="text-muted">{value}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>}

			{mainVolumeDiagram && <Tabs>
				<Tab header="Layout">
					<VolumeDiagramLayout layout={mainVolumeDiagram.layout}/>
				</Tab>
				<Tab header="Targets">
					<VolumeDiagramTargets targets={mainVolumeDiagram.targets}/>
				</Tab>
				{mainVolumeDiagram.metadata && <Tab header="Metadata">
					<table className="table">
						{Object.entries(mainVolumeDiagram.metadata).map(([key, value]) => (
							<tr key={key}>
								<th className="col-3">{key}</th>
								<td className="text-muted">{String(value)}</td>
							</tr>
						))}
					</table>
				</Tab>}
			</Tabs>}

			{volumeDiagram.length > 1 && <Tabs>
				{volumeDiagram.map(diagram => (
					<>
						<Tab header={diagram.title || diagram.volumeID}>
							<div className="form-group">RAID Level: {diagram.layout.RAIDLevel}</div>
						</Tab>
						<Tabs>
							<Tab header="Layout">
								<VolumeDiagramLayout layout={diagram.layout}/>
							</Tab>
							<Tab header="Targets">
								<VolumeDiagramTargets targets={diagram.targets}/>
							</Tab>
						</Tabs>
					</>
				))}
			</Tabs>}

		</div>
	);
};

const VolumeDiagramModal = ({
	isOpen,
	handleCancel = () => { },
	volumeId
}) => {
	return (
		<Modal
			isOpen={isOpen}
			disableBackdropClose
			onClose={() => handleCancel()}
			className="modal-xl"
			title={`Volume Diagram - ${volumeId}`}>
			<VolumeDiagram volumeId={volumeId}/>
		</Modal>
	);
};

export default VolumeDiagramModal;