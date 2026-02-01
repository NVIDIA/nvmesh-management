/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import ManagementService from '../services/api/management.service.js';

const { useState, useEffect } = React;

const About = () => {
	const unavailable = 'Unavailable';
	const [aboutInfo, setAboutInfo] = useState({});

	const boolToYesNo = (value) => {
		if (value == undefined)
			return unavailable;
		return value ? 'Yes' : 'No';
	};

	useEffect(() => {
		fetchAboutInfo();
	}, []);

	const parseMongoVersion = (data) => {
		return data.hasMongoRootRole ? parseFloat(data.mongoVersion, 10) : 'N/A due to missing mongoDB admin permissions';
	};

	const parseReplicated = (data) => {
		const isReplicated = data.hasMongoClusterManagerRole ? data.isMongoReplicated : 'N/A due to missing mongoDB cluster permissions';
		return boolToYesNo(isReplicated);
	};

	const fetchAboutInfo = async() => {
		const data = await ManagementService.getAboutInfo();
		data.replicated = parseReplicated(data);
		data.mongoVersion = parseMongoVersion(data);
		setAboutInfo(data);
	};

	const SystemInformationPanel = () => {

		return <table style={{ textAlign: 'center' }} id="aboutInfoTable" className="table table-hover table-striped">
			<tbody>
				<tr title="Management version">
					<th>Management Version</th>
					<td>{aboutInfo.managementVersion || unavailable }</td>
				</tr>
				<tr title="Cluster ID">
					<th>Cluster ID</th>
					<td>{ aboutInfo.clusterID || unavailable }</td>
				</tr>
				<tr title="NodeJS version">
					<th>NodeJS Version</th>
					<td>{ aboutInfo.nodeVersion || unavailable }</td>
				</tr>
				<tr title="MongoDB version">
					<th>MongoDB Version</th>
					<td>{ aboutInfo.mongoVersion || unavailable }</td>
				</tr>
				<tr title="Indicates if the database is replicated">
					<th>Replicated</th>
					<td>{ aboutInfo.replicated }</td>
				</tr>
			</tbody>
		</table>;
	};

	return <>
		<h1>About</h1>
		<hr />
		<br />

		<div className="row center">
			<div className="col-lg-4 col-lg-offset-4 text-center">
				<br/>
				<br/>

				<h2>NVIDIA NVMesh Management {aboutInfo.managementVersion}</h2>
				<p>Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.</p>
				<br/>
				<hr />
				<br />
				<h2>System Information</h2>
				<br />
				<div>
					<SystemInformationPanel />
					<div>
						<button className="btn btn-info mgmt-btn-info" onClick={() => window.open('/status')}>Download Status</button>
					</div>
				</div>
			</div>

			<div className="modal fade pdf-modal" id="pdfModal" role="dialog" data-backdrop="static" data-keyboard="false">
				<div className="modal-dialog large-modal">
					<div className="modal-content">
						<div className="modal-header">
							<button type="button" className="close" data-dismiss="modal">&times;</button>
							<img className="text-center" width="162px" src="images/exceleroLogoLogin.svg" />
						</div>
					</div>
				</div>
			</div>
		</div>
	</>;
};

export default About;
