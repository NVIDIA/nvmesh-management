/* global consts */

export const AllocationService = {
	calcRequiredMirrorsByECSeparation(separation, dataBlocks, parityBlocks) {
		if (separation === consts.ecSeparationTypes.FULL) {
			return dataBlocks + parityBlocks;
		} else if (separation === consts.ecSeparationTypes.MINIMAL) {
			return Math.ceil((dataBlocks + parityBlocks) / parityBlocks);
		}

		return 1;
	},

	calcHasEnoughMirrors(volume, availableMirrors) {
		if (volume.RAIDLevel === consts.RAIDLevel.ERASURE_CODING || volume.RAIDLevel === consts.RAIDLevel.STRIPED_ERASURE_CODING) {
			const requiredTargets = AllocationService.calcRequiredMirrorsByECSeparation(volume.protectionLevel, volume.dataBlocks, volume.parityBlocks);

			return availableMirrors >= requiredTargets - 1;
		} else if (volume.RAIDLevel === consts.RAIDLevel.MIRRORED_RAID_1 || volume.RAIDLevel === consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10) {
			return volume.ignoreNodeSeparation === 'ignore' || (availableMirrors >= volume.numberOfMirrors);
		}

		return true;
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