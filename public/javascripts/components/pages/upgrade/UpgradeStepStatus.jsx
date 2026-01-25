/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, consts */

export const statusToLabelMap = {
	[consts.upgradeStepStatuses.COMPLETED]: 'Completed',
	[consts.upgradeStepStatuses.FAILED]: 'Failed',
	[consts.upgradeStepStatuses.PENDING]: 'Pending Start',
	[consts.upgradeStepStatuses.IN_PROGRESS]: 'In Progress',
	[consts.upgradeStepStatuses.PENDING_SEND]: 'Pending Send',
	[consts.upgradeStepStatuses.MANUALLY_COMPLETED]: 'Manually Completed',
	[consts.upgradeStepStatuses.SKIPPED]: 'Skipped'
};

const statusToClass = (status) => {
	const statusToClassMap = {
		[consts.upgradeStepStatuses.COMPLETED]: 'bg-green',
		[consts.upgradeStepStatuses.FAILED]: 'bg-red',
		[consts.upgradeStepStatuses.PENDING]: 'bg-primary',
		[consts.upgradeStepStatuses.IN_PROGRESS]: 'bg-primary',
		[consts.upgradeStepStatuses.PENDING_SEND]: 'bg-primary',
		[consts.upgradeStepStatuses.MANUALLY_COMPLETED]: 'bg-green',
		[consts.upgradeStepStatuses.SKIPPED]: 'bg-gray'
	};

	return statusToClassMap[status] || status;
};

const statusToLabel = (upgrade) => {
	return statusToLabelMap[upgrade.status] || upgrade.status;
};

const UpgradeStepStatus = ({ status }) => (
	<span className={`label ${statusToClass(status)}`}>
		{status === consts.upgradeStepStatuses.IN_PROGRESS && <span><i className="fa fa-cog fa-spin"></i>&nbsp;</span>}
		{statusToLabel({ status })}
	</span>
);

export default UpgradeStepStatus; 