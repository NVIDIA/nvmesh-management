/* global globalThis, describe, it, before */

import assert from 'assert';
import consts from '../../consts.js';

globalThis.consts = consts; // Use globalThis for better compatibility in ES modules

let CapacityService;

describe('CapacityService', () => {
	before(async() => {
		const imported = await import('../services/capacity.service.js');
		CapacityService = imported.default;
	});

	describe('getUnitValue', () => {
		it('should return 1000 for DECIMAL unit type', async() => {
			assert.strictEqual(CapacityService.getUnitValue(consts.unitType.DECIMAL), 1000);
		});

		it('should return 1024 for BINARY unit type', async() => {
			assert.strictEqual(CapacityService.getUnitValue(consts.unitType.BINARY), 1024);
		});
	});

	describe('convert', () => {
		it('should convert GB to TB in decimal system', async() => {
			assert.strictEqual(CapacityService.convert(1000, 'GB', 'TB', consts.unitType.DECIMAL), 1);
		});

		it('should convert GiB to TiB in binary system', async() => {
			assert.strictEqual(CapacityService.convert(1024, 'GiB', 'TiB', consts.unitType.BINARY), 1);
		});

		it('should throw an error for invalid units', async() => {
			assert.throws(() => CapacityService.convert(1000, 'GB', 'INVALID', consts.unitType.DECIMAL));
		});

		it('should convert TB to GB in decimal system', async() => {
			// "TB" (index 4) to "GB" (index 3): conversion factor = 1000^(4-3) = 1000.
			// For example, 2 TB should convert to 2000 GB.
			assert.strictEqual(
				CapacityService.convert(2, 'TB', 'GB', consts.unitType.DECIMAL),
				2000
			);
		});

		it('should convert MiB to B in binary system', async() => {
			// For binary units: MiB is at index 2 and B is at index 0.
			// Conversion factor = 1024^(2-0) = 1024^2 = 1048576.
			// For example: 3 MiB should convert to 3 * 1048576 bytes.
			assert.strictEqual(
				CapacityService.convert(3, 'MiB', 'B', consts.unitType.BINARY),
				3 * 1048576
			);
		});

		it('should convert units correctly when the from and to units are the same', async() => {
			// Converting a unit to itself should result in the same value.
			assert.strictEqual(
				CapacityService.convert(123, 'GB', 'GB', consts.unitType.DECIMAL),
				123
			);
		});
	});

	describe('toBiggestUnit', async() => {
		it('should convert 1024 bytes to "1KiB" in binary system when fromBytes is true', async() => {
			// For BINARY, 1024 converts to "1KiB".
			assert.strictEqual(
				CapacityService.toBiggestUnit(1024, consts.unitType.BINARY, { fromBytes: true }),
				'1KiB'
			);
		});

		it('should convert a value in GB (when fromBytes is false) correctly', async() => {
			// When fromBytes is false, the value is already considered to be in GB.
			// For example, 1 should yield "1GB".
			assert.strictEqual(
				CapacityService.toBiggestUnit(1, consts.unitType.DECIMAL),
				'1GB'
			);
		});

		it('should return the original bytes if the value is less than the unit conversion factor', async() => {
			// For DECIMAL, if value is 500 (< 1000), it should remain in bytes.
			assert.strictEqual(
				CapacityService.toBiggestUnit(500, consts.unitType.DECIMAL, { fromBytes: true }),
				'500B'
			);
		});

		it('should handle zero bytes gracefully', async() => {
			// Zero bytes typically returns "0B"
			assert.strictEqual(
				CapacityService.toBiggestUnit(0, consts.unitType.DECIMAL, { fromBytes: true }),
				'0B'
			);
		});

		it('should correctly round large decimal values', async() => {
			// For example, 1500000 bytes in DECIMAL:
			// 1500000 / 1000 = 1500, which is still in KB (if 1500 < 1000, it will be converted).
			// However, if the function climbs units, precision might come into play.
			// Assume the logic promotes to MB when appropriate:
			// 1500000 bytes = 1.5MB so with precision 1, it should be "1.5MB".
			assert.strictEqual(
				CapacityService.toBiggestUnit(1500000, consts.unitType.DECIMAL, { fromBytes: true }),
				'1.5MB'
			);
		});

		it('should handle binary units correctly for values lower than conversion factor', async() => {
			// In BINARY, for value 500 (<1024), unit remains "B"
			assert.strictEqual(
				CapacityService.toBiggestUnit(500, consts.unitType.BINARY, { fromBytes: true }),
				'500B'
			);
		});
	});

	describe('getRedundancyRatio', () => {
		it('should return numberOfMirrors for mirrored RAID', async() => {
			const volume = { RAIDLevel: consts.RAIDLevel.MIRRORED_RAID_1, numberOfMirrors: 2, };
			assert.strictEqual(CapacityService.getRedundancyRatio(volume), 2);
		});

		it('should return the ratio for erasure coding RAID', async() => {
			const volume = {
				RAIDLevel: consts.RAIDLevel.ERASURE_CODING,
				parityBlocks: 2,
				dataBlocks: 4,
			};
			// Ratio: 2/4 = 0.5
			assert.strictEqual(
				CapacityService.getRedundancyRatio(volume),
				0.5
			);
		});

		it('should return 0 for RAID 0 or concatenated RAID', async() => {
			const volume = { RAIDLevel: consts.RAIDLevel.STRIPED_RAID_0 };
			assert.strictEqual(
				CapacityService.getRedundancyRatio(volume),
				0
			);
		});
	});

	describe('getUsableSpace', () => {
		it('should calculate usable space correctly', async() => {
			assert.strictEqual(CapacityService.getUsableSpace(2000, 1), 1000);
		});
	});

	describe('getPhysicalSpace', () => {
		it('should calculate physical space correctly', async() => {
			assert.strictEqual(CapacityService.getPhysicalSpace(1000, 1), 2000);
		});
	});
});
