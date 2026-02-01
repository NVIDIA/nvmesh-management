/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */
import { DiskUtilsService } from '../../services/disk-utils.service.js';


const DriveEvictedIcon = ({ drive }) => {
	if (!drive.isOutOfService)
		return null;
	else
		return (<div className="servers-health">
			<span className="mr-5"><i className="ion-checkmark-round checkmark"></i></span>
			<i className="fa fa-info-circle blue" title={DiskUtilsService.getDiskHealthMessage(drive)}></i>
		</div>);
};


export default DriveEvictedIcon;
