/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, consts */

const upgradeStatusToLabel = (upgrade) => {
	const completedStepsLabel = `(${upgrade.completedSteps || 0}/${upgrade.stepsToComplete})`;

	switch (upgrade.status) {
		case consts.upgradeStatuses.PAUSED:
			return `Paused ${completedStepsLabel}`;
		case consts.upgradeStatuses.COMPLETED:
			return 'Completed';
		case consts.upgradeStatuses.FAILED:
			return 'Failed';
		case consts.upgradeStatuses.PENDING_START:
			return 'Pending Start';
		case consts.upgradeStatuses.IN_PROGRESS:
			return `In Progress ${completedStepsLabel}`;
		case consts.upgradeStatuses.PRE_UPGRADE_CHECKS_FAILED:
			return 'Pre-Upgrade Checks Failed';
		default:
			return upgrade.status;
	}
};

const upgradeStatusToClass = (status) => {
	switch (status) {
		case consts.upgradeStatuses.PAUSED:
			return 'bg-primary';
		case consts.upgradeStatuses.COMPLETED:
			return 'bg-green';
		case consts.upgradeStatuses.FAILED:
			return 'bg-red';
		case consts.upgradeStatuses.PENDING_START:
			return 'bg-primary';
		case consts.upgradeStatuses.IN_PROGRESS:
			return 'bg-primary';
		case consts.upgradeStatuses.PRE_UPGRADE_CHECKS_FAILED:
			return 'bg-red';
		default:
			return status;
	}
};

const UpgradeStatus = ({ upgrade }) => {
	return (
		<span className={`label ${upgradeStatusToClass(upgrade.status)}`}>
			{upgrade.status === consts.upgradeStatuses.IN_PROGRESS && <span><i className="fa fa-cog fa-spin"></i>&nbsp;</span>}
			{upgradeStatusToLabel(upgrade)}
		</span>
	);
};

export default UpgradeStatus;
