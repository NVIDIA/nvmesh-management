/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, consts */

import ToggleButtonGroup from '../core/ToggleButtonGroup.jsx';
import Toggle from '../core/Toggle.jsx';
import FormControl from '../core/FormControl.jsx';
import Input from '../core/Input.jsx';
import Select from '../core/Select.jsx';
import { Panel, AccordionPanel } from '../core/AccordionPanel.jsx';
import DurationPicker from '../core/DurationPicker.jsx';
import { extractErrorMsg, setProperty } from '../utils.js';
import { useAlerts } from '../core/Alert.jsx';
import { GeneralSettingsService } from '../services/api/general-settings.service.js';
import { NvmeshMetadataService } from '../services/api/nvmesh-metadata.service.js';
import { UsersService } from '../services/api/users.service.js';
import { useAppContext } from '../App.jsx';

const {
	useState,
	useEffect
} = React;

const debugComponentsTitles = {
	lock: 'Lock',
	events: 'Events',
	counters: 'Counters',
	client: 'Client',
	diskSegments: 'Disk Segments',
	updatePRaidStatus: 'PRAID Status',
	zoneRanking: 'Zone Ranking',
	HA: 'HA',
	kafka: 'Kafka'
};

const originTypesTitles = {
	TOMA: 'TOMA',
	TOMA_LEADER: 'TOMA Leader',
	CLIENT: 'Client',
	MANAGEMENT_AGENT: 'Management Agent',
	UPGRADE_AGENT: 'Upgrade Agent'
};

const UNIT_TYPE_CACHE_KEY = 'unitType';

const GeneralSettings = () => {
	const [clusterID, setClusterID] = useState('');
	const { successAlert, errorAlert } = useAlerts();
	const { generalSettings, setUnitType, loadSystemInfo, loadGeneralSettings } = useAppContext();
	const [phoneHomeUser, setPhoneHomeUser] = useState();
	const [customerName, setCustomerName] = useState('');
	const [userUnitType, setUserUnitType] = useState(localStorage.getItem(UNIT_TYPE_CACHE_KEY) || 'default');
	const [settings, setSettings] = useState({ ...generalSettings });
	const [isDirty, setIsDirty] = useState(false);

	useEffect(() => {
		async function fetch() {
			const [clusterID, phoneHomeRes] = await Promise.all([
				NvmeshMetadataService.getClusterID(),
				UsersService.getPhoneHomeUser()
			]);

			setClusterID(clusterID.id || '');
			setPhoneHomeUser(phoneHomeRes);
			setCustomerName(phoneHomeRes.email.split('@')[0].split('+')[1]);
		}

		fetch();
	}, []);

	const save = async() => {
		const email = consts.defaultEmail.replace(RegExp('\\+.*@'), '+' + customerName + '@');

		const [clusterIDRes, settingsRes, phoneHomeRes] = await Promise.all([
			NvmeshMetadataService.updateClusterID(clusterID),
			GeneralSettingsService.update(settings),
			UsersService.updateUsers([{ ...phoneHomeUser, email }])
		]);

		if (settingsRes[0].success) {
			successAlert('General Settings updated successfully');
			loadSystemInfo();
			loadGeneralSettings();
		} else {
			const errorMsg = extractErrorMsg(settingsRes[0].error);
			errorAlert(`Failed to update General Settings - ${errorMsg}`);
		}

		if (!clusterIDRes.success) {
			const errorMsg = extractErrorMsg(clusterIDRes.error);
			errorAlert(`Failed to update Cluster ID - ${errorMsg}`);
		}
		if (!phoneHomeRes[0].success) {
			const errorMsg = extractErrorMsg(phoneHomeRes[0].error);
			errorAlert(`Failed to update phone home user - ${errorMsg}`);
		}

		setUnitType(userUnitType);
		setIsDirty(false);
	};

	const handleSettingsChange = (key, value) => {
		setSettings(prev => {
			const newSettings = { ...prev };
			setProperty(newSettings, key, value);
			return newSettings;
		});
		setIsDirty(true);
	};

	if (!settings || !phoneHomeUser) return null;

	return (
		<div className="page-content">
			<h1>General Settings</h1>

			<div className="action-container" style={{ marginBottom: '20px' }}>
				<button className="btn btn-info mgmt-btn-info"
				        disabled={!isDirty}
				        onClick={() => save()}>
					Save
				</button>
			</div>

			<Panel>
				<AccordionPanel title="General" open>
					<div className="form-control-md">
						<FormControl name="clusterID"
						             label="Cluster ID">
							<Input className="form-control"
							       name="clusterID"
							       maxLength={30}
							       value={clusterID}
							       onChange={(e) => {
								       setClusterID(e.target.value);
								       setIsDirty(true);
							       }}
							       placeholder="Enter The Cluster ID"
							/>
						</FormControl>

						<FormControl label="Default Unit Type">
							<ToggleButtonGroup
								value={settings.defaultUnitType}
								options={[
									{ label: 'Decimal', value: 'decimal' },
									{ label: 'Binary', value: 'binary' }
								]}
								onChange={value => handleSettingsChange('defaultUnitType', value)}/>
						</FormControl>

						<FormControl label="User Unit Type">
							<ToggleButtonGroup
								value={userUnitType}
								options={[
									{ label: 'Decimal', value: 'decimal' },
									{ label: 'Binary', value: 'binary' },
									{ label: 'Default', value: 'default' }
								]}
								onChange={value => {
									setUserUnitType(value);
									setIsDirty(true);
								}}/>
						</FormControl>

						<FormControl name="defaultDomain"
						             label="Default Domain">
							<Input className="form-control"
							       name="defaultDomain"
							       value={settings.domain}
							       onChange={e => handleSettingsChange('domain', e.target.value)}
							       placeholder="Enter Default Domain"
							/>
						</FormControl>

						<FormControl name="customerName"
						             label="Customer Name">
							<Input className="form-control"
							       name="customerName"
							       value={customerName}
							       onChange={(e) => {
								       setCustomerName(e.target.value);
								       setIsDirty(true);
							       }}
							       placeholder="Enter Customer Name"
							/>
						</FormControl>

						<div className="form-group">
							<label>Send data to your home</label>
							<div>
								<div className="form-group row">
									<span className="col-md-4">Send logs</span>
									<div className="col-md-8">
										<Select
											value={phoneHomeUser.notificationLevel}
											options={[
												{ text: 'None', value: 'NONE' },
												{ text: 'Warning', value: 'WARNING' },
												{ text: 'Error', value: 'ERROR' }
											]}
											onChange={(value) => {
												setPhoneHomeUser(prev => ({ ...prev, notificationLevel: value }));
												setIsDirty(true);
											}}/>
									</div>
								</div>
								<div className="form-group row">
									<span className="col-md-4">Send statistics</span>
									<div className="col-md-8">
										<Toggle isChecked={phoneHomeUser?.sendStats}
										        onChange={(value) => {
											        setPhoneHomeUser(prev => ({ ...prev, sendStats: value }));
											        setIsDirty(true);
										        }}/>
									</div>

								</div>
							</div>
						</div>
					</div>
				</AccordionPanel>
				<AccordionPanel title="Advanced">
					<div className="form-group row">
						<div className="col-lg-4">
							<label>Automatic Log Out Threshold</label>
							<p><small className="text-muted">The timeout of the GUI and API access. After the timeout expires the GUI and API will
								automatically logout all logged in users.</small></p>
						</div>
						<div className="col-lg-8">
							<DurationPicker value={settings.autoLogOutThreshold}
							                seconds minutes hours days
							                onChange={value => handleSettingsChange('autoLogOutThreshold', value)}></DurationPicker>
						</div>
					</div>
					<div className="form-group row">
						<div className="col-lg-4">
							<label style={{ display: 'inline-block' }}>Fix On Sanity and Recover</label>
							<p><small className="text-muted">Enable or disable the fixing of the DB when performing the sanity and recover flow.</small>
							</p>
						</div>
					</div>
					<div className="form-group">
						<div className="col-lg-4">Available Blocks</div>
						<div className="col-lg-8">
							<Toggle isChecked={settings.fixInSanityAndRecover.availableBlocks}
							        onChange={value => handleSettingsChange('fixInSanityAndRecover.availableBlocks', value)}/>
						</div>
					</div>
					<div className="form-group row">
						<div className="col-lg-4">
							<label>Default Downstream Debouncer Minimum Wait</label>
							<p><small className="text-muted">The default minimum time to wait before sending the same type of message downstream.
								This value is valid only for messages that uses the Debouncer mechanism.</small></p>
						</div>
						<div className="col-lg-8">
							<DurationPicker value={settings.defaultDownstreamDebouncerMinimumWait || consts.DEFAULT_DEBOUNCER_MINIMUM_WAIT / 1000}
							                seconds minutes hours days
							                onChange={value => handleSettingsChange('defaultDownstreamDebouncerMinimumWait', value)}></DurationPicker>
						</div>
					</div>
					<div className="form-group row">
						<div className="col-lg-4">
							<label>&#34;Keep Alive&#34; Intervals</label>
							<p><small className="text-muted">The time frame between each keep alive message sent from every component to the
								management.</small></p>
						</div>
					</div>
					<div className="col-lg-12">
						{Object.keys(settings.keepaliveIntervals).map((key) => (
							<div className="form-group row" key={key}>
								<div className="col-lg-4"><label>{originTypesTitles[key]}</label></div>
								<div className="col-lg-8">
									<DurationPicker value={settings.keepaliveIntervals[key]}
									                seconds minutes hours
									                onChange={value => handleSettingsChange(`keepaliveIntervals.${key}`, value)}></DurationPicker>
								</div>
							</div>
						))}
					</div>

					<div className="form-group row">
						<div className="col-lg-4">
							<label>Maximum JSON Size</label>
							<p><small className="text-muted">The size of the largest JSON message supported by the Management
								Server.<br/><span className="red">Do not modify this setting unless explicitly authorized by an SRE.</span></small>
							</p>
						</div>
						<div className="col-lg-8">
							<Input type="number"
							       value={settings.MAX_JSON_SIZE}
							       onChange={e => handleSettingsChange('MAX_JSON_SIZE', parseFloat(e.target.value))}
							       className="form-control inline sm-input"
							       min="0"
							       step="1"
							       max="1024"/> MB
						</div>
					</div>
					<div className="form-group row">
						<div className="col-lg-4">
							<label>Reserved Blocks</label>
							<p><small className="text-muted">The percentage of reserved blocks at the start of a managed NVMe
								device. <br/><span className="red">Do not modify this setting unless explicitly authorized by an SRE.</span></small>
							</p>
						</div>
						<div className="col-lg-8">
							<Input type="number"
							       className="form-control sm-input"
							       value={settings.RESERVED_BLOCKS}
							       onChange={e => handleSettingsChange('RESERVED_BLOCKS', parseFloat(e.target.value))}
							       min="0"
							       max="1"
							       step="0.1"/>
						</div>
					</div>
					<div className="form-group row">
						<div className="col-lg-4">
							<label>Compatibility Mode</label>
							<p><small className="text-muted">Use the NVMesh version of dynamic libraries instead of the operating system versions to
								avoid compatibility issues.</small></p>
						</div>
						<div className="col-lg-8">
							<Toggle isChecked={settings.compatibilityMode}
							        onChange={value => handleSettingsChange('compatibilityMode', value)}/>
						</div>
					</div>
					<div className="form-group row">
						<div className="col-lg-4">
							<label>Enable Legacy Formatting</label>
							<p><small className="text-muted">Determines whether to allow legacy formatting on metadata supported drives via the RESTful
								API.</small></p>
						</div>
						<div className="col-lg-8">
							<Toggle isChecked={settings.enableLegacyFormatting}
							        onChange={value => handleSettingsChange('enableLegacyFormatting', value)}/>
						</div>
					</div>
					<div className="form-group row">
						<div className="col-lg-4">
							<label>Enable Volumes Access Via NVMf - System Default</label>
							<p><small className="text-muted">The default value used for new volumes.<br/>Enables access to NVMesh volumes using the NVMf
								protocol.</small></p>
						</div>
						<div className="col-lg-8">
							<Toggle isChecked={settings.enableNVMf}
							        onChange={value => handleSettingsChange('enableNVMf', value)}/>
						</div>
					</div>
					<div className="form-group row">
						<div className="col-lg-4">
							<label>Enable Erasure Coded Volume Creation</label>
							<p><small className="text-muted">This option only affects the creation of EC volumes via the GUI, it does not affect
								creating EC volumes via RESTful API. This option will not hide existing EC volumes.</small></p>
						</div>
						<div className="col-lg-8">
							<Toggle isChecked={settings.enableDistributedRAID}
							        onChange={value => handleSettingsChange('enableDistributedRAID', value)}/>
						</div>
					</div>
					<div className="form-group row">
						<div className="col-lg-4">
							<label>Disable Old Managements when in Upgrade Mode</label>
							<p><small className="text-muted">When in upgrade mode, old managements will not accept new requests.
								<br/><span className="red">Must be true unless explicitly authorized by an SRE.</span></small></p>
						</div>
						<div className="col-lg-8">
							<Toggle isChecked={settings.disableOldManagements || false}
								    disabled={settings.disableOldManagements}
							        onChange={value => handleSettingsChange('disableOldManagements', value)}/>
						</div>
					</div>
					<div className="form-group row">
						<div className="col-lg-4">
							<label>NDU - Force Upgrade on Up To Date Components</label>
							<p><small className="text-muted">Force to run NDU on components even if they are already in destination version</small></p>
						</div>
						<div className="col-lg-8">
							<Toggle isChecked={settings.forceUpgradeUpToDateComponents || false}
							        onChange={value => handleSettingsChange('forceUpgradeUpToDateComponents', value)}/>
						</div>
					</div>
				</AccordionPanel>
				<AccordionPanel title="Zones">
					<div className="form-group row">
						<div className="col-lg-4">
							<label>Enable</label>
						</div>
						<div className="col-lg-8">
							<Toggle isChecked={settings.enableZones}
							        onChange={value => handleSettingsChange('enableZones', value)}/>
						</div>
					</div>

					{settings.enableZones && <>
						<div className="form-group row">
							<div className="col-lg-12">
								<label>Parameters for Zone Selection for Storage Space Allocation</label>

								<div className="form-group">
									<div className="col-lg-4">
										<label>Randomness</label>
									</div>
									<div className="col-lg-8">
										<Input type="number"
										       className="form-control sm-input"
										       min="0"
										       max="100"
										       value={settings.zoneRanking.fuzziness}
										       onChange={e => handleSettingsChange('zoneRanking.fuzziness', parseInt(e.target.value))}/>
									</div>
								</div>
							</div>
						</div>

						<div className="form-group row">
							<div className="col-lg-12">
								<label>Selection Weights</label>

								<div className="col-lg-12">
									<div className="form-group row">
										<div className="col-lg-4">
											<label>Number of Segments in Zone</label>
											<p><small className="text-muted">Default: 150</small></p>
										</div>
										<div className="col-lg-8">
											<Input type="number"
											       className="form-control sm-input"
											       min="0"
											       value={settings.zoneRanking.criterias.segmentsInZone}
											       onChange={e => handleSettingsChange('zoneRanking.criterias.segmentsInZone', parseInt(e.target.value))}/>
										</div>
									</div>

									<div className="form-group row">
										<div className="col-lg-4">
											<label>Number of Targets in Zone</label>
											<p><small className="text-muted">Default: 120</small></p>
										</div>
										<div className="col-lg-8">
											<Input type="number"
											       className="form-control sm-input"
											       min="0"
											       value={settings.zoneRanking.criterias.targetsInZone}
											       onChange={e => handleSettingsChange('zoneRanking.criterias.targetsInZone', parseInt(e.target.value))}/>
										</div>
									</div>

									<div className="form-group row">
										<div className="col-lg-4">
											<label>Available Space</label>
											<p><small className="text-muted">Default: 100</small></p>
										</div>
										<div className="col-lg-8">
											<Input type="number"
											       className="form-control sm-input"
											       min="0"
											       value={settings.zoneRanking.criterias.availableSpace}
											       onChange={e => handleSettingsChange('zoneRanking.criterias.availableSpace', parseInt(e.target.value))}/>
										</div>
									</div>

									<div className="form-group row">
										<div className="col-lg-4">
											<label>Average Time in Zone Allocation Queue</label>
											<p><small className="text-muted">Default: 50</small></p>
										</div>
										<div className="col-lg-8">
											<Input type="number"
											       className="form-control sm-input"
											       min="0"
											       value={settings.zoneRanking.criterias.avgTimeSpentWaitingForLock}
											       onChange={e => handleSettingsChange('zoneRanking.criterias.avgTimeSpentWaitingForLock',
												       parseInt(e.target.value))}/>
										</div>
									</div>
								</div>
							</div>
						</div>

					</>}
				</AccordionPanel>

				<AccordionPanel title="Logging">

					<div className="form-group row">
						<div className="col-lg-4">
							<label>Logging Level</label>
							<p><small className="text-muted">The logging level of the Management Server.</small></p>
						</div>
						<div className="col-lg-8">
							<Select value={settings.loggingLevel}
							        className="form-control-md"
							        options={Object.values(consts.loggingLevel).map((level) => ({ text: level, value: level }))}
							        onChange={value => handleSettingsChange('loggingLevel', value)}>
							</Select>
						</div>
					</div>
					{settings.loggingLevel === consts.loggingLevel.VERBOSE && (
						<>
							<div className="form-group row">
								<div className="col-lg-12">
									<label>Debug Components</label>
									<p><small className="text-muted">Enable or disable the debug logging of each component of the Management Server.</small>
									</p>
								</div>
							</div>
							{Object.keys(debugComponentsTitles).map((component) => (
								<div className="form-group" key={component}>
									<div className="col-lg-4">
										<label>{debugComponentsTitles[component]}</label>
									</div>
									<div className="col-lg-8">
										<Toggle isChecked={settings.debugComponents[component]}
										        onChange={value => handleSettingsChange(`debugComponents.${component}`, value)}/>
									</div>
								</div>
							))}
						</>
					)}
				</AccordionPanel>

			</Panel>

		</div>
	);
};

export default GeneralSettings;
