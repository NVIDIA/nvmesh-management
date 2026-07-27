/* global React, ReactHookForm, consts */

import Modal from '../../core/Modal.jsx';
import UpgradeAgentsFiltSort from '../upgradeAgents/UpgradeAgentsFiltSort.jsx';
import Toggle from '../../core/Toggle.jsx';
import { UpgradesService } from '../../services/api/upgrades.service.js';
import RadioInputGroup from '../../core/RadioInputGroup.jsx';
import UpgradeRedundancyLevelsSelect from './UpgradeRedundancyLevelsSelect.jsx';
import FormControl from '../../core/FormControl.jsx';
import Select from '../../core/Select.jsx';
import { compareV, getBaseVersion, groupBy } from '../../utils.js';
import { ReleasesService } from '../../services/api/release.service.js';
import Input from '../../core/Input.jsx';

const { useForm, Controller } = ReactHookForm;
const { useRef, useState, useEffect, useMemo } = React;

const getUpgradeAgentSourceVersions = (upgradeAgent) => {
	const clientVersion = upgradeAgent.upgradeAgentData.nvmeshVersions[consts.components.CLIENT];
	const managementVersion = upgradeAgent.upgradeAgentData.nvmeshVersions[consts.components.MANAGEMENT];

	const sourceVersions = [{ name: consts.components.CLIENT, version: clientVersion }];

	if (managementVersion) {
		sourceVersions.push({ name: consts.components.MANAGEMENT, version: managementVersion });
	}
	return sourceVersions;
};

const getUpgradeAgentsSourceVersions = (upgradeAgents) => {
	// collect all source versions from all upgrade agents, distinct by name and version
	const versions = {};
	upgradeAgents.forEach(upgradeAgent => {
		getUpgradeAgentSourceVersions(upgradeAgent).forEach(sourceVersion => versions[`${sourceVersion.name}-${sourceVersion.version}`] = sourceVersion);
	});
	return Object.values(versions);
};

const parseArtifactName = (artifactName) => {
	// Supports:
	//   nvmesh-base_3.3.0-3000.ubuntu2404.0.0_amd64.deb
	//   nvmesh-client-3.3.0-3000.el8_10.0.0.x86_64.rpm
	const match = artifactName.match(/^([^-_]+(?:-[^-_]+)*?)[_-](\d+\.\d+\.\d+)-(\d+)\./);
	if (!match) return null;
	return {
		packageName: match[1],
		baseVersion: match[2],
		releaseNumber: match[3]
	};
};

const isReleaseMatchMachineDestVersion = (release, machineDestVersions) => {
	return machineDestVersions.every(machineDestVersion => {
		const match = machineDestVersion.version.match(/^(\d+\.\d+\.\d+)-(\d+)/);
		if (!match) return false;
		const baseVersion = match[1];
		const releaseNumber = match[2];
		return release.artifacts.some(artifact => {
			// check the release version is not lower than the machine dest version
			const parsedArtifact = parseArtifactName(artifact.name);

			return parsedArtifact
				&& parsedArtifact.packageName === machineDestVersion.name
				&& parsedArtifact.baseVersion === baseVersion
				&& parseInt(parsedArtifact.releaseNumber, 10) >= parseInt(releaseNumber, 10);
		});
	});
};

const getReleaseByVersion = async(version) => {
	const response = await ReleasesService.loadReleases({ version }, {}, 0, 1);
	if (!response.length) return null;
	return response[0];
};

const extractBaseVersions = (versionsByBaseVersion) => {
	const baseVersions = Object.keys(versionsByBaseVersion);

	if (baseVersions.length === 1) return { sourceBaseVersion: baseVersions[0], targetBaseVersion: null };
	if (baseVersions.length > 2) return { sourceBaseVersion: null, targetBaseVersion: null };

	let source = baseVersions[0];
	let target = baseVersions[1];

	if (compareV(source, target) > 0) {
		[source, target] = [target, source];
	}
	return { sourceBaseVersion: source, targetBaseVersion: target };
};

const isSourceVersionValid = async(machineDestVersions, destinationVersion) => {
	if (!destinationVersion) return false;

	const release = await getReleaseByVersion(destinationVersion);
	if (!release) return false;

	// check every target version is matched the release
	return isReleaseMatchMachineDestVersion(release, machineDestVersions);
};

const CreateUpgrade = ({
	upgrade = {},
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const { handleSubmit, formState, control, watch } = useForm({ mode: 'all' });
	const tableRef = useRef();
	const [selectedUpgradeAgents, setSelectedUpgradeAgents] = useState(upgrade.machinesToUpgrade || []);
	const [versions, setVersions] = useState([]);
	const [isDestVersionValid, setIsDestVersionValid] = useState(false);
	const [skipMachinesOnFailure, setSkipMachinesOnFailure] = useState(upgrade.skipMachinesOnFailure || false);
	const destinationVersion = watch('destinationVersion');

	const versionsByBaseVersion = useMemo(() => {
		const sourceVersions = getUpgradeAgentsSourceVersions(selectedUpgradeAgents);
		return groupBy(sourceVersions, sourceVersion => getBaseVersion(sourceVersion.version));
	}, [selectedUpgradeAgents]);

	const { sourceBaseVersion, targetBaseVersion } = useMemo(() => extractBaseVersions(versionsByBaseVersion), [versionsByBaseVersion]);

	useEffect(() => {
		if (!sourceBaseVersion) {
			setVersions([]);
			return;
		}

		async function fetchPossibleUpgrade() {
			const versions = await UpgradesService.getPossibleUpgrade(sourceBaseVersion);
			setVersions(versions);
		}

		fetchPossibleUpgrade();
	}, [sourceBaseVersion]);

	useEffect(() => {
		if (!targetBaseVersion || !destinationVersion) {
			setIsDestVersionValid(true);
			return;
		}
		// if we have target version, check if upgradeable
		async function checkIfDestVersionIsValid() {
			const isValid = await isSourceVersionValid(versionsByBaseVersion[targetBaseVersion], destinationVersion);
			setIsDestVersionValid(isValid);
		}

		checkIfDestVersionIsValid();
	}, [targetBaseVersion, destinationVersion]);

	const onFormSubmit = (data) => {
		const editedUpgrade = {
			...upgrade,
			...data,
			skipMachinesOnFailure,
			machinesToUpgrade: selectedUpgradeAgents.map(upgradeAgent => upgradeAgent.hostname)
		};
		onSubmit(editedUpgrade);
	};

	return (
		<>
			<div className="modal-body">

				<FormControl name="destinationVersion"
				             label="Destination version"
				             topHint="Select at least one machine to upgrade first"
				             errorMessage={formState.errors?.destinationVersion?.message}>
					<Controller
						control={control}
						name="destinationVersion"
						defaultValue={upgrade.destinationVersion}
						rules={{
							required: 'Destination version is required'
						}}
						render={({ field: { onChange, value, onBlur } }) => (
							<Select
								id="components"
								placeholder="Choose version"
								value={value}
								onChange={onChange}
								onBlur={onBlur}
								disabled={!selectedUpgradeAgents.length}
								options={versions.map((version) => ({ text: version, value: version }))}
							/>
						)}
					/>
				</FormControl>

				<FormControl label="Redundancy level" name="minRedundancyLevel">
					<Controller
						control={control}
						name="minRedundancyLevel"
						defaultValue={upgrade.minRedundancyLevel}
						render={({ field: { onChange, value } }) => (
							<UpgradeRedundancyLevelsSelect
								selectedRedundancyLevel={value}
								onChange={onChange}
							/>
						)}
					/>
				</FormControl>


				<FormControl label="Execution mode" name="executionMode">
					<Controller
						control={control}
						name="executionMode"
						defaultValue={upgrade.executionMode}
						render={({ field: { onChange, value } }) => (
							<RadioInputGroup
								groupID="upgradeExecutionMode"
								options={[{
									label: 'Automatic',
									value: consts.upgradeExecutionModes.AUTOMATIC,
									checked: value === consts.upgradeExecutionModes.AUTOMATIC
								}, {
									label: 'Manual start',
									value: consts.upgradeExecutionModes.MANUAL_START,
									checked: value === consts.upgradeExecutionModes.MANUAL_START
								}, {
									label: 'Manual',
									value: consts.upgradeExecutionModes.MANUAL,
									disabled: true,
									checked: value === consts.upgradeExecutionModes.MANUAL
								}]}
								onChange={(e) => onChange(e.target.value)}
							/>
						)}
					/>
				</FormControl>

				{!isDestVersionValid && destinationVersion && (
					<div className="text-danger">
						<i className="ion ion-alert-circled red"></i>
						Cannot upgrade from version(s): {Object.keys(versionsByBaseVersion).join(', ')}
					</div>
				)}

				<FormControl label="Skip machine on failure" name="skipMachinesOnFailure">
					<Toggle isChecked={skipMachinesOnFailure}
						onChange={value => setSkipMachinesOnFailure(value)}/>
				</FormControl>

				{skipMachinesOnFailure && (
					<FormControl label="Max Error Threshold" name="maxErrorsThreshold"
						 topHint="The amount of machines to skip before stopping the upgrade"
						 errorMessage={formState.errors?.maxErrorsThreshold?.message}>
						<Controller
							control={control}
							name="maxErrorsThreshold"
							defaultValue={upgrade.maxErrorsThreshold || 1}
							rules={{
								required: 'Max errors threshold is required',
								min: { value: 1, message: 'Max errors threshold must be greater than 0' },
								valueAsNumber: true
							}}
							render={({ field: { onChange, value } }) => (
								<Input
									type="number"
									className="form-control"
									placeholder="Max errors threshold"
									onChange={(e) => onChange(parseInt(e.target.value, 10))}
									value={value}
								/>
							)}
						/>
					</FormControl>
				)}

				<FormControl label="Max concurrent clients" name="maxConcurrentClients"
					topHint="The amount of clients that can be upgraded concurrently"
					errorMessage={formState.errors?.maxConcurrentClients?.message}>
					<Controller
						control={control}
						name="maxConcurrentClients"
						defaultValue={upgrade.maxConcurrentClients || 1}
						rules={{
							min: { value: 1, message: 'Max concurrent clients must be greater than 0' },
							valueAsNumber: true,
							max: { value: 100, message: 'Max concurrent clients must be less or equal to 100' }
						}}
						render={({ field: { onChange, value } }) => (
							<Input
								type="number"
								className="form-control"
								placeholder="Max concurrent clients"
								onChange={(e) => onChange(parseInt(e.target.value, 10))} value={value}
							/>
						)}
					/>
				</FormControl>

				<UpgradeAgentsFiltSort
					ref={tableRef}
					tableId="editUpgradeModal"
					rowIdentifier="hostname"
					onSelectedRowsChange={setSelectedUpgradeAgents}
				/>

			</div>
			<div className="modal-footer">
				<button className="btn btn-primary mgmt-btn-primary"
					onClick={handleSubmit(onFormSubmit)}
					disabled={!formState.isValid || !selectedUpgradeAgents.length || !isDestVersionValid}>
					Add
				</button>
				<button className="btn btn-default" onClick={() => handleCancel()}>Cancel</button>
			</div>
		</>
	);
};

const CreateUpgradeModal = ({
	isOpen,
	upgrade = {},
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {

	return (
		<Modal
			isOpen={isOpen}
			onClose={() => handleCancel()}
			title="Create Upgrade"
			disableBackdropClose
			className="modal-xl">
			<CreateUpgrade
				upgrade={upgrade}
				handleCancel={handleCancel}
				onSubmit={onSubmit}
			/>
		</Modal>
	);
};

export default CreateUpgradeModal;
