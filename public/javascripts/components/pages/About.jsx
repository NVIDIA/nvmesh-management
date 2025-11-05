
/* global React */

import ManagementService from '../services/api/management.service.js';

const { useState, useEffect } = React;

const unavailable = 'Unavailable';

const SystemInformationPanel = ({ aboutInfo }) => {
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

const About = () => {
	const [aboutInfo, setAboutInfo] = useState({});

	useEffect(() => {
		const fetchAboutInfo = async() => {
			const data = await ManagementService.getAboutInfo();
			data.replicated = parseReplicated(data);
			data.mongoVersion = parseMongoVersion(data);
			setAboutInfo(data);
		};

		fetchAboutInfo();
	}, []);

	const boolToYesNo = (value) => {
		if (value === undefined)
			return unavailable;
		return value ? 'Yes' : 'No';
	};

	const parseMongoVersion = (data) => {
		return data.hasMongoRootRole ? parseFloat(data.mongoVersion, 10) : 'N/A due to missing mongoDB admin permissions';
	};

	const parseReplicated = (data) => {
		const isReplicated = data.hasMongoClusterManagerRole ? data.isMongoReplicated : 'N/A due to missing mongoDB cluster permissions';
		return boolToYesNo(isReplicated);
	};

	return <>
		<h1>About</h1>

		<div className="row center">
			<div className="col-lg-4 col-lg-offset-4 text-center">
				<img src="images/exceleroLogoLogin.png" />
				<br/>
				<br/>

				<h2>Excelero NVMesh Management {aboutInfo.managementVersion}</h2>
				<p>© Copyright 2015-2020 Excelero, Inc. All rights reserved. </p>
				<br/>
				<p>This document contains the confidential and proprietary information of Excelero, Inc.
                    Do not reproduce or distribute without the prior written consent of Excelero.</p>
				<br/>
				<br /><br />
				<hr />
				<br />
				<h2>System Information</h2>
				<br />
				<div>
					<SystemInformationPanel aboutInfo={aboutInfo}/>
					<div>
						<button className="btn btn-info mgmt-btn-info" onClick={() => window.open('/status')}>Download Status</button>
					</div>
				</div>
			</div>

		</div>
	</>;
};

export default About;