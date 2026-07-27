/* global React, consts */

import Input from '../../core/Input.jsx';
import { useAppContext } from '../App.jsx';
import CapacityService from '../../services/capacity.service.js';
import Select from '../../core/Select.jsx';

const { useState, useEffect, useMemo } = React;

const VolumeCapacityInput = ({
	capacity,
	minCapacity = 0,
	maxCapacity,
	unit,
	precision = 4,
	disabled = false,
	onChange,
	onBlur,
	style,
}) => {
	const { unitType } = useAppContext();
	const units = CapacityService.allUnits[unitType].slice(3);
	const [localUnit, setLocalUnit] = useState(unit || units[0]);

	const convertCapacityFromGBToLocalUnit = (valueInGB) => {
		let valueInBaseUnit = valueInGB;

		// if the unit type is binary, convert GB to GiB first
		if (unitType === consts.unitType.BINARY) {
			valueInBaseUnit = valueInGB * consts.DECIMAL_BINARY_G_FACTOR;
		}

		// convert the value to the local unit
		return CapacityService.convert(valueInBaseUnit, units[0], localUnit, unitType, precision);
	};

	const convertFromLocalUnitToGB = (valueInLocalUnit) => {
		// convert the value to the base unit (GB/GiB) first
		const valueInBaseUnit = CapacityService.convert(valueInLocalUnit, localUnit, units[0], unitType, precision);

		// if the unit type is binary, convert GiB to GB
		if (unitType === consts.unitType.BINARY) {
			return valueInBaseUnit / consts.DECIMAL_BINARY_G_FACTOR;
		}

		return valueInBaseUnit;
	};

	const [localCapacity, setLocalCapacity] = useState(() => convertCapacityFromGBToLocalUnit(capacity));
	const minValue = convertCapacityFromGBToLocalUnit(minCapacity);
	const maxValue = convertCapacityFromGBToLocalUnit(maxCapacity);

	useEffect(() => {
		const capacityInGB = convertFromLocalUnitToGB(localCapacity);
		onChange(capacityInGB);
	}, [localCapacity]);

	const handleCapacityChange = (newValue) => {
		const value = parseFloat(newValue);
		if (isNaN(value)) {
			setLocalCapacity('');
			return;
		}
		setLocalCapacity(value);
	};

	const handleUnitChange = (newUnit) => {
		setLocalUnit(newUnit);
		const capacityInNewUnit = CapacityService.convert(localCapacity, localUnit, newUnit, unitType, precision);
		setLocalCapacity(capacityInNewUnit);
	};

	return (
		<div className="volume-capacity-container" style={style}>
			<Input
				className="form-control volume-capacity-value"
				name="capacity"
				type="number"
				value={localCapacity}
				onChange={e => handleCapacityChange(e.target.value)}
				placeholder="Enter capacity"
				max={maxValue}
				min={minValue}
				step="1"
				disabled={disabled}
				onBlur={onBlur}
			/>
			<Select
				id="volume-capacity-unit"
				className="volume-capacity-unit"
				value={localUnit}
				onChange={handleUnitChange}
				onDelete={() => false}
				disabled={disabled}
				options={useMemo(() => units.map(unit => ({ text: unit, value: unit })), [units])}
			/>

		</div>
	);
};

export default VolumeCapacityInput;