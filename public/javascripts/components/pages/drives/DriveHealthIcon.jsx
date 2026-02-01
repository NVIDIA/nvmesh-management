/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, consts */
import { DiskUtilsService } from '../../services/disk-utils.service.js';

function getDiskDisplayIcon(disk) {
	if (disk.isExcluded) return 'fa fa-exclamation-circle';

	if (disk.isOutOfService) {
		return disk.automaticallyEvicted ? 'fa fa-exclamation-circle red' : 'fa fa-exclamation-circle yellow';
	}

	if (disk.isPendingFormat) return 'fa fa-exclamation-circle yellow';

	switch (disk.status) {
		case consts.diskStatus.OK:
			return 'ion-checkmark-circled green table-icon';
		case consts.diskStatus.NOT_INITIALIZED:
			return 'fa fa-exclamation-circle yellow';
		case consts.diskStatus.INGESTING:
			return 'fa fa-exclamation-circle red';
		case consts.diskStatus.FORMATTING:
		case consts.diskStatus.FROZEN:
		case consts.diskStatus.INITIALIZING:
			return 'fa fa-cog fa-spin';
		default:
			return 'fa fa-exclamation-circle red';
	}
}


const DriveHealthIcon = ({ drive }) => {
	return (
		<i className={getDiskDisplayIcon(drive)} title={DiskUtilsService.getDiskHealthMessage(drive)}/>
	);
};


export default DriveHealthIcon;