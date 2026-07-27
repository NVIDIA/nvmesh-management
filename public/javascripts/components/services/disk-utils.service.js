/* global STATUS_COLORS, consts */

import { VolumesService } from './api/volumes.service.js';

export const DiskUtilsService = {
	SEGMENTS_COLORS: {
		PLACEHOLDER: STATUS_COLORS.PLACEHOLDER,
		NORMAL: STATUS_COLORS.NORMAL,
		DEAD: STATUS_COLORS.ERROR,
		UNDER_RECOVERY: STATUS_COLORS.ACTION,
		IS_RESERVED: STATUS_COLORS.ACTION
	},

	getSegmentColor(segment) {
		if (segment.isPlaceHolder)
			return this.SEGMENTS_COLORS.PLACEHOLDER;
		else if (segment.isDead)
			return this.SEGMENTS_COLORS.DEAD;
		else if (segment.status === consts.diskSegmentStatuses.NORMAL)
			return this.SEGMENTS_COLORS.NORMAL;
		else if (segment.isReserved)
			return this.SEGMENTS_COLORS.IS_RESERVED;
		else
			return this.SEGMENTS_COLORS.UNDER_RECOVERY;
	},

	getAvailableSegments(minValue, maxValue, diskSegments) {
		const segments = [];
		let minVal = minValue;

		if (diskSegments && diskSegments.length) {
			let sortedDiskSegments = diskSegments;
			if (diskSegments.length > 1)
				sortedDiskSegments = diskSegments.sort((a, b) => a.lbs - b.lbs);

			sortedDiskSegments.forEach((ds, i) => {
				const blocksFromLeft = ds.lbs - minVal;
				if (blocksFromLeft > 0) {
					segments.push({
						lbs: minVal,
						lbe: ds.lbs - 1
					});
				}

				minVal = ds.lbe + 1;

				//If last segment check for available blocks in the end of the disk.
				if (diskSegments.length - 1 === i) {
					const totalBlocks = maxValue;
					if (minVal < totalBlocks)
						segments.push({
							lbs: minVal,
							lbe: totalBlocks - 1
						});
				}
			});
		} else {
			segments.push({
				lbs: minValue,
				lbe: maxValue - 1
			});
		}

		return segments;
	},

	getSegments(disk) {
		const arcs = [];
		let placeHolders = [];
		let availableReserved = [];
		let segments = [];

		let firstUsableLba = 32;
		if (disk.GPT && (disk.GPT.firstUsableLba || disk.GPT.firstUsableLba === 0))
			firstUsableLba = disk.GPT.firstUsableLba;

		//Get all the free segments.
		placeHolders = this.getAvailableSegments(firstUsableLba, disk.usableBlocks, (disk.diskSegments || [])
			.filter(e => !e.fromReserved));

		if (disk.diskSegments && disk.diskSegments.length) {
			//Reserved segments
			const reservedSegments = disk.diskSegments.filter(segment => segment.isReserved);
			//Regular segments
			segments = disk.diskSegments.filter(segment => !segment.isReserved && segment.type !== consts.segmentTypes.EXCELERO_METADATA);

			//Check for each reserved the available reserved space.
			reservedSegments.forEach(rs => {
				availableReserved = availableReserved.concat(this.getAvailableSegments(rs.lbs, rs.lbe + 1, segments));
				availableReserved.forEach(e => {
					e.isReserved = true;
					e.volumeName = rs.volumeName;
				});
			});
		}

		placeHolders.forEach(e => { e.placeholder = true; });

		placeHolders.concat(segments, availableReserved).forEach((segment, index) => {
			const blocks = disk.usableBlocks;
			const arc = {
				id: segment._id || 'spacer' + index,
				lbs: segment.lbs,
				lbe: segment.lbe,
				status: segment.isDead ? 'dead' : segment.status,
				isDead: segment.isDead,
				allocationIndex: segment.allocationIndex,
				volumeName: segment.volumeName,
				partitionName: segment.partitionName,
				startPercent: segment.lbs / blocks * 100,
				endPercent: segment.lbe / blocks * 100,
				isPlaceHolder: segment.placeholder,
				isReserved: segment.isReserved,
				fromReserved: segment.fromReserved,
				type: segment.type,
				owner: segment.owner
			};

			arcs.push(arc);
		});

		return arcs.sort((a, b) => a.lbs - b.lbs);
	},

	processDiskSegments(segments, totalSize, segmentsMap) {
		const segmentsForDisplay = [];
		let sum = 0;
		let isMerging = false;
		let subSegments = {};

		for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
			const ds = segments[segmentIndex];

			const segmentSize = (ds.lbe - ds.lbs + 1);
			const percentageOfCurrSegment = (segmentSize / (totalSize - 32) * 100);
			subSegments[ds.id] = ds;

			if (percentageOfCurrSegment < consts.diskDisplay.MINIMAL_SEGMENT_PERCENTAGE &&
				!isMerging) {
				isMerging = true;
			}

			if (isMerging) {
				sum += segmentSize;
			}

			let percentageOfSum = (sum / (totalSize - 32) * 100);

			if (percentageOfSum > consts.diskDisplay.SEGMENTS_MERGING_THRESHOLD_PERCENTAGE) {

				if (ds.isPlaceHolder) {
					percentageOfSum = Math.max(percentageOfSum - percentageOfCurrSegment,
						consts.diskDisplay.MINIMAL_SEGMENT_PERCENTAGE);

					segmentIndex--;
					delete subSegments[ds.id];
				}

				let biggestSegment = null;

				const calcSegmentSize = segment => segment.lbe - segment.lbs + 1;
				for (let id in subSegments) {
					if (!biggestSegment || calcSegmentSize(subSegments[id]) > calcSegmentSize(subSegments[biggestSegment]))
						biggestSegment = id;
				}

				segmentsMap[biggestSegment] = subSegments;

				segmentsForDisplay.push([biggestSegment, percentageOfSum]);
				sum = 0;
				isMerging = false;
				subSegments = {};
			} else if (percentageOfCurrSegment > consts.diskDisplay.MINIMAL_SEGMENT_PERCENTAGE &&
				!isMerging) {
				segmentsForDisplay.push([ds.id, percentageOfCurrSegment]);
				segmentsMap[ds.id] = {};
				segmentsMap[ds.id][ds.id] = ds;
				subSegments = {};
			}
		}

		const data = segmentsForDisplay;
		const colors = {};

		segments.forEach(seg => {
			colors[seg.id] = this.getSegmentColor(seg);
		});

		return { data, colors };
	},

	validateEvictAction: async(disks) => {
		const volumesOnDisks = {};
		let allowEvict = true;
		let shouldShowConfirm = false;
		let msg = '';

		disks.forEach(disk => {
			if (!disk.diskSegments) return;

			disk.diskSegments.forEach(diskSegment => {
				if (diskSegment.volumeName) {
					if (!volumesOnDisks[diskSegment.volumeName]) {
						volumesOnDisks[diskSegment.volumeName] = [];
					}
					volumesOnDisks[diskSegment.volumeName].push(disk);
				}
			});
		});

		const volumesList = Object.keys(volumesOnDisks);

		if (!volumesList.length) {
			return { allowEvict, shouldShowConfirm, msg };
		}

		try {
			const filter = {
				_id: { $in: volumesList }
			};
			const projection = {
				RAIDLevel: 1,
				status: 1,
				action: 1
			};
			const volumes = await VolumesService.getAll(filter, projection);
			const volumesThatForbidEvict = [];
			let redundantVolumesExists = false;

			if (volumes && volumes.length !== 0) {
				volumes.forEach(volume => {
					if ((volume.RAIDLevel === consts.RAIDLevel.CONCATENATED || volume.RAIDLevel === consts.RAIDLevel.STRIPED_RAID_0)
						&& volume.action !== consts.volumeActions.MARKED_FOR_DELETION) {
						volumesThatForbidEvict.push(volume._id);
					}

					if (volume.RAIDLevel !== consts.RAIDLevel.CONCATENATED && volume.RAIDLevel !== consts.RAIDLevel.STRIPED_RAID_0) {
						redundantVolumesExists = true;
					}
				});

				if (volumesThatForbidEvict.length) {
					allowEvict = false;
					shouldShowConfirm = false;

					const drivesThatCannotBeEvicted = new Set();
					volumesThatForbidEvict.forEach(volumeId => {
						if (volumesOnDisks[volumeId]) {
							volumesOnDisks[volumeId].forEach(effectedDisks => {
								drivesThatCannotBeEvicted.add(effectedDisks.diskID);
							});
						}
					});

					msg = `Error: ${disks.length} drive(s) cannot be evicted because ${volumesThatForbidEvict.length} non-redundant
					Volume(s) ${volumesThatForbidEvict.join(', ')} have segments on them.`;
				} else {
					shouldShowConfirm = !!redundantVolumesExists;
					msg = `Warning: You are about to evict ${disks.length} drive(s). All the data on these drive(s) will be rebuilt using other drives.`;
				}
			}

			return { allowEvict, shouldShowConfirm, msg };
		} catch (error) {
			msg = `Warning: You are about to evict ${disks.length} drive(s)`;
			shouldShowConfirm = true;
			return { allowEvict, shouldShowConfirm, msg };
		}
	},


	getDiskHealthClass(disk) {
		if (disk.status === 'Ok' && !disk.isOutOfService) {
			return 'btn-success';
		}
		if (disk.status !== 'Ok' && disk.isOutOfService) {
			return 'btn-warning';
		}
		return 'btn-danger';
	},

	getDiskDisplayIcon(disk) {
		if (disk.isExcluded) return 'fa fa-exclamation-circle';

		if (disk.isOutOfService) {
			return disk.automaticallyEvicted ? 'fa fa-exclamation-circle red' : 'fa fa-exclamation-circle yellow';
		}

		if (disk.isPendingFormat) return 'fa fa-exclamation-circle yellow';

		switch (disk.status) {
			case consts.diskStatus.OK:
				return '';
			case consts.diskStatus.NOT_INITIALIZED:
				return 'fa fa-exclamation-circle';
			case consts.diskStatus.INGESTING:
				return 'fa fa-exclamation-circle red';
			case consts.diskStatus.FORMATTING:
			case consts.diskStatus.FROZEN:
			case consts.diskStatus.INITIALIZING:
				return 'fa fa-cog fa-spin';
			default:
				return 'fa fa-exclamation-circle red';
		}
	},

	hasVolumeSegments(disk) {
		return disk.diskSegments?.some((seg) => seg.type !== consts.segmentTypes.EXCELERO_METADATA);
	},

	getDiskHealthMessage(disk) {
		if (disk.isExcluded) {
			switch (disk.excludeReason) {
				case consts.driveExcludeReasons.SWITCHED_ZONE:
					return 'Drive automatically excluded, zone mismatch between the drive and its current target';
				case consts.driveExcludeReasons.EXPLICIT:
					return 'Drive excluded by user';
				case consts.driveExcludeReasons.IN_USE:
					return 'Drive automatically excluded, as already managed by other software';
				default:
					return 'Drive excluded';
			}
		}

		if (disk.isPendingFormat) {
			return 'Pending Format';
		}

		if (disk.isOutOfService) {
			return disk.automaticallyEvicted
				? `Drive auto evicted.\n${disk.autoEvictReason}.`
				: 'Drive evicted by user';
		}

		return this.diskToStatusMessage(disk);
	},

	diskToStatusMessage(disk) {
		switch (disk.status) {
			case consts.diskStatus.OK:
				return 'Ok';
			case consts.diskStatus.NOT_INITIALIZED:
				return 'Not formatted for NVMesh';
			case consts.diskStatus.INGESTING:
				return 'Ingesting';
			case consts.diskStatus.FORMATTING:
			case consts.diskStatus.FROZEN:
				return 'Formatting';
			case consts.diskStatus.INITIALIZING:
				return 'Initializing';
			case consts.diskStatus.FORMAT_ERROR:
				return 'Format Error';
			default:
				return disk.status;
		}
	},

	isDriveDeletable(target, drive) {
		if (this.hasVolumeSegments(drive) || drive.isExcluded ||
			(target.tomaStatus !== consts.tomaStatuses.UNAVAILABLE &&
				drive.status !== consts.diskStatus.MISSING &&
				!drive.isOutOfService)) {
			return false;
		}
		return true;
	},

	modelToDisplayString(model) {
		return model ? model.replace(/_+$/, '') : '';
	}
};
