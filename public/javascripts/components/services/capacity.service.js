/* global consts */

/**
 * Service for handling storage capacity conversions and calculations.
 */
const CapacityService = {
	allUnits: {
		[consts.unitType.DECIMAL]: ['B', 'KB', 'MB', 'GB', 'TB', 'PB'],
		[consts.unitType.BINARY]: ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'],
	},

	DECIMAL_UNIT_VALUE: 1000,
	BINARY_UNIT_VALUE: 1024,

	_precisionFloor(number, precision) {
		const factor = Math.pow(10, precision);
		return Math.floor(number * factor) / factor;
	},


	/**
	 * Retrieves the numeric value of a unit type (either decimal or binary).
	 * @param {string} unitType - The unit type (decimal or binary).
	 * @returns {number} - The corresponding multiplier (1000 for decimal, 1024 for binary).
	 */
	getUnitValue(unitType) {
		return unitType === consts.unitType.BINARY ? this.BINARY_UNIT_VALUE : this.DECIMAL_UNIT_VALUE;
	},

	/**
	 * Retrieves the appropriate unit label based on the given multiplier and unit type.
	 * @param {number} multiplier - The exponent for unit conversion.
	 * @param {string} unitType - The unit type (decimal or binary).
	 * @param {boolean} fromBytes - Whether the conversion starts from bytes.
	 * @returns {string} - The corresponding unit label.
	 */
	getUnit(multiplier, unitType, fromBytes = false) {
		let unitList = this.allUnits[unitType];
		if (!fromBytes) {
			unitList = unitList.slice(3); // Exclude B, KB, MB when not from bytes
		}
		const index = Math.min(multiplier, unitList.length - 1);
		return unitList[index];
	},

	/**
	 * Converts a given value to the largest appropriate unit.
	 * @param {number} units - The value to be converted.
	 * @param {string} unitType - The unit type (decimal or binary).
	 * @param {Object} [options={}] - Optional settings.
	 * @param {boolean} [options.fromBytes=false] - Whether the conversion starts from bytes. GB if false.
	 * @param {boolean} [options.trunc=false] - Whether to truncate the result instead of rounding.
	 * @param {number} [options.digits=2] - Number of digits after the decimal point (default 2).
	 * @param {boolean} [options.roundDown=false] - Whether to round down the result instead of rounding.
	 * @returns {string} - The converted value as a string with its unit.
	 */
	toBiggestUnit(units, unitType, { fromBytes = false, trunc = false, digits = 2, roundDown = false } = {}) {
		const unitValue = this.getUnitValue(unitType);

		if (isNaN(units)) return units;

		let counter = 0;
		let someUnits = units;

		while (someUnits / unitValue >= 1) {
			counter++;
			someUnits /= unitValue;
		}

		const division = units / Math.pow(unitValue, counter);
		const firstConversionToDecimalRequired = !fromBytes && unitValue !== this.DECIMAL_UNIT_VALUE;
		const unitsBeforeFormat = division * (firstConversionToDecimalRequired ? consts.DECIMAL_BINARY_G_FACTOR : 1);
		const unit = this.getUnit(counter, unitType, fromBytes);

		let unitsToDisplay;
		if (trunc) {
			unitsToDisplay = Math.trunc(unitsBeforeFormat);
		} else {
			const factor = Math.pow(10, digits);
			unitsToDisplay = (roundDown ? Math.floor(unitsBeforeFormat * factor) : Math.round(unitsBeforeFormat * factor)) / factor;
		}

		return `${unitsToDisplay}${unit}`;
	},

	/**
	 * Converts a value from one unit to another.
	 *
	 * @param {number} value - The numeric value to convert.
	 * @param {string} fromUnit - The original unit (e.g., 'GB', 'GiB').
	 * @param {string} toUnit - The target unit (e.g., 'TB', 'TiB').
	 * @param {string} unitType - The unit type, either 'DECIMAL' (powers of 1000) or 'BINARY' (powers of 1024).
	 * @param {number} [precision=0] - The number of decimal places to round the result to. Defaults to 0 (no rounding).
	 * @returns {number} - The converted value, optionally rounded to the specified precision.
	 * @throws {Error} If either fromUnit or toUnit is invalid.
	 */
	convert(value, fromUnit, toUnit, unitType, precision = 0) {
		const unitList = this.allUnits[unitType];
		const unitValue = this.getUnitValue(unitType);

		const fromIndex = unitList.indexOf(fromUnit);
		const toIndex = unitList.indexOf(toUnit);

		if (fromIndex === -1 || toIndex === -1) {
			throw new Error(`Invalid unit conversion from ${fromUnit} to ${toUnit}`);
		}

		const result = value * Math.pow(unitValue, fromIndex - toIndex);
		if (precision) {
			return this._precisionFloor(result, precision);
		}
		return result;
	},

	/**
	 * Computes the redundancy ratio of a given volume based on its RAID level.
	 * @param {Object} volume - The volume object containing RAID level and redundancy information.
	 * @returns {number} - The redundancy ratio.
	 */
	getRedundancyRatio(volume) {
		switch (volume.RAIDLevel) {
			case consts.RAIDLevel.MIRRORED_RAID_1:
			case consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10:
				return volume.numberOfMirrors;

			case consts.RAIDLevel.STRIPED_ERASURE_CODING:
			case consts.RAIDLevel.ERASURE_CODING:
				return volume.parityBlocks / volume.dataBlocks;

			case consts.RAIDLevel.CONCATENATED:
			case consts.RAIDLevel.STRIPED_RAID_0:
				return 0;
		}
	},

	/**
	 * Calculates the usable storage space after accounting for redundancy.
	 * Usable space means space without redundancy.
	 * @param {number} physicalSpace - The total physical storage space.
	 * @param {number} redundancyRatio - The redundancy ratio (e.g., 1 for RAID-1 mirroring).
	 * @returns {number} - The usable storage space.
	 */
	getUsableSpace(physicalSpace, redundancyRatio) {
		return physicalSpace / (1 + redundancyRatio);
	},

	/**
	 * Computes the required physical storage space based on the desired usable storage.
	 * Physical space means space with redundancy.
	 * @param {number} usableSpace - The amount of usable storage.
	 * @param {number} redundancyRatio - The redundancy ratio.
	 * @returns {number} - The required physical storage.
	 */
	getPhysicalSpace(usableSpace, redundancyRatio) {
		return usableSpace * (redundancyRatio + 1);
	}
};

export default CapacityService;
