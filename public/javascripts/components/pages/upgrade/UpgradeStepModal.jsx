/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, consts */

import Modal from '../../core/Modal.jsx';
import UpgradeStepStatus from './UpgradeStepStatus.jsx';
import Toggle from '../../core/Toggle.jsx';
import { UpgradeStepsService } from '../../services/api/upgradeSteps.service.js';
import CodeBlock from '../../core/CodeBlock.jsx';

const Command = ({ command }) => {
	return (
		<CodeBlock code={`${command?.cmd} ${command?.args?.join(' ') || ''}`}/>
	);
};

const UpgradeStep = ({
	upgradeStep,
	onToggleBreakpoint,
}) => {

	return (
		<>
			<div id="upgradeStepModalBody" className="modal-body">

				<table className="table table-no-border">
					<tbody>
						<tr>
							<th>Upgrade Step ID:</th>
							<td>{upgradeStep._id}</td>
						</tr>
						<tr>
							<th>Hostname:</th>
							<td><span className="label label-info">{upgradeStep.hostname}</span></td>
						</tr>
						<tr>
							<th>Step Index:</th>
							<td>{upgradeStep.stepIndex}</td>
						</tr>
						<tr>
							<th>Status:</th>
							<td>
								<div className="flex-row">
									<UpgradeStepStatus status={upgradeStep.status}/>
									{upgradeStep.status === consts.upgradeStepStatuses.FAILED &&
										<button 
											id="markAsCompletedButton" 
											className="btn btn-primary" 
											onClick={() => UpgradeStepsService.markAsCompleted(upgradeStep._id)}
											disabled={upgradeStep.status !== consts.upgradeStepStatuses.FAILED}>
											Mark as Completed
										</button>
									}
								</div>
							</td>
						</tr>
						<tr>
							<th>Timeout (in seconds):</th>
							<td>{upgradeStep.command?.timeout || 'N/A'}</td>
						</tr>
						<tr>
							<th>Is Volume Affected:</th>
							<td>{upgradeStep.isVolumeAffected ? 'Yes' : 'No'}</td>
						</tr>
						<tr>
							<th>Should Stop:</th>
							<td>{upgradeStep.shouldStop ? 'Yes' : 'No'}</td>
						</tr>
						<tr>
							<th>Start Condition:</th>
							<td>{upgradeStep.startCondition}</td>
						</tr>
						<tr>
							<th>Is Breakpoint Set:</th>
							<td>
								<Toggle
									isChecked={upgradeStep.isBreakpointSet || false}
									disabled={upgradeStep.status !== consts.upgradeStepStatuses.PENDING}
									onChange={(value) => onToggleBreakpoint(value)}
								/>
							</td>
						</tr>
					</tbody>
				</table>

				<div className="section">
					<h1>Command</h1>
					<p><label>Command:</label> <code>{upgradeStep.command?.cmd}</code></p>
					<p><label>Arguments:</label> {upgradeStep.command?.args && <code>{upgradeStep.command?.args.join(', ')}</code>}</p>

					<p><label>Full Command:</label></p>
					<Command command={upgradeStep.command}/>

					{upgradeStep.command?.verificationCommand &&
						<>
							<p><strong>Verification Command:</strong></p>
							<CodeBlock code={upgradeStep.command.verificationCommand}/>
						</>}

				</div>

				{upgradeStep.response && <div className="section">
					<h1>Response</h1>
					
					{upgradeStep.response.verificationCommand?.exitCode === 0 &&
						<>
							<p><strong>Verification Command verified successfully</strong></p>
						</>
					}

					{upgradeStep.response.command?.isTimeout && 
					<p><strong className="text-danger">
						<i className="fa fa-clock-o"></i> Command timed out after {upgradeStep.command?.timeout} seconds
					</strong></p>}
					{upgradeStep.response.command?.exitCode != null && <p><label>Exit code:</label> <code>{upgradeStep.response.command?.exitCode}</code></p>}
					{upgradeStep.response.command?.stdOut && <span><label>Stdout:</label> <CodeBlock code={upgradeStep.response.command?.stdOut}/></span>}
					{upgradeStep.response.command?.stdErr && <span><label>Stderr:</label> <CodeBlock code={upgradeStep.response.command?.stdErr}/></span>}
				</div>}


			</div>
		</>
	);
};

const UpgradeStepModal = ({
	isOpen,
	upgradeStep,
	onToggleBreakpoint = () => {},
	handleCancel = () => {}
}) => {

	return (
		<Modal
			isOpen={isOpen}
			onClose={() => handleCancel()}
			title="Upgrade Step"
			disableBackdropClose
			className="modal-xl">
			{upgradeStep && <UpgradeStep
				onToggleBreakpoint={onToggleBreakpoint}
				upgradeStep={upgradeStep}
			/>}
		</Modal>
	);
};

export default UpgradeStepModal;
