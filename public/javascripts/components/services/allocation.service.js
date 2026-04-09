/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global consts */

export const AllocationService = {
	// exact copy from backend utils.js
	getEffectiveProtectionLevel(volume) {
		if (volume.protectionLevel)
			return volume.protectionLevel;

		if (volume.ignoreNodeSeparation && consts.mirroredRaidLevels.includes(volume.RAIDLevel))
			return consts.separationTypes.IGNORE;

		return consts.separationTypes.MINIMAL;
	},

	// exact copy from backend utils.js
	calcRequiredMirrorsBySeparation(separation, totalSegments, redundancy) {
		if (separation === consts.separationTypes.FULL)
			return totalSegments;

		if (separation === consts.separationTypes.MINIMAL)
			return Math.ceil(totalSegments / redundancy);

		return 1;
	},

	// exact copy from backend utils.js
	calcHasEnoughMirrors(volume, availableMirrors) {
		const protectionLevel = AllocationService.getEffectiveProtectionLevel(volume);
		let requiredTargets;

		if (AllocationService.isEC(volume.RAIDLevel))
			requiredTargets = AllocationService.calcRequiredMirrorsBySeparation(protectionLevel, volume.dataBlocks + volume.parityBlocks, volume.parityBlocks);

		else if (AllocationService.isMirrored(volume.RAIDLevel))
			requiredTargets = AllocationService.calcRequiredMirrorsBySeparation(protectionLevel, volume.numberOfMirrors + 1, volume.numberOfMirrors);

		else
			return true;

		return availableMirrors >= requiredTargets - 1;
	},

	isMirrored: (RAIDLevel) => [
		consts.RAIDLevel.MIRRORED_RAID_1,
		consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10
	].includes(RAIDLevel),

	isEC: (RAIDLevel) => [
		consts.RAIDLevel.ERASURE_CODING,
		consts.RAIDLevel.STRIPED_ERASURE_CODING
	].includes(RAIDLevel),

	isStriped: (RAIDLevel) => [
		consts.RAIDLevel.STRIPED_RAID_0,
		consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10,
		consts.RAIDLevel.STRIPED_ERASURE_CODING
	].includes(RAIDLevel),

};