/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import { AccordionPanel, Panel } from '../../../core/AccordionPanel.jsx';
import DiskDisplay from '../../../shared/disk-display/DiskDisplay.jsx';

const { useState } = React;

const VolumeDiagramTargets = ({
	targets
}) => {
	const [expandedTargets, setExpandedTargets] = useState({});

	return (
		<Panel>
			{targets.map((target) => (
				<AccordionPanel key={target._id}
				                header={<div className="panel-heading-content">
					                <h4>{target._id}</h4>
					                <a onClick={(e) => {
						                e.stopPropagation();
						                setExpandedTargets({ ...expandedTargets, [target._id]: !expandedTargets[target._id] });
					                }}>
						                {expandedTargets[target._id] ? 'Collapse All' : 'Expand All'}
					                </a>
				                </div>}
				                open>
					<div className="flex flex-row align-center" style={{ gap: '5px' }}>
						{target.disks.map((disk, index) => (
							<DiskDisplay key={index}
							             disk={disk}
							             target={target}
							             expanded={expandedTargets[target._id]}/>
						))}
					</div>
				</AccordionPanel>
			))}
		</Panel>
	);
};


export default VolumeDiagramTargets;