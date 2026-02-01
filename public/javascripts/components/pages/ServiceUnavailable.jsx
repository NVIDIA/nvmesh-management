/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

const ServiceUnavailable = ({ data }) => {

	return (
		<div className="page-content">
			<div className="service-unavailable-container">
				<i className="fa fa-solid fa-exclamation-triangle"></i>
				<h1>Service Unavailable</h1>
				<div className="service-unavailable-content">{data}</div>
			</div>
		</div>
	);
};

export default ServiceUnavailable;
