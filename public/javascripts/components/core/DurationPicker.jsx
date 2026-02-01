/* global React */

import Input from './Input.jsx';

const { useState, useEffect } = React;

const MINUTE = 60;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;

export default function DurationPicker({
	seconds,
	minutes,
	hours,
	days,
	value,
	onChange
}) {
	const [selectedDays, setSelectedDays] = useState(0);
	const [selectedHours, setSelectedHours] = useState(0);
	const [selectedMinutes, setSelectedMinutes] = useState(0);
	const [selectedSeconds, setSelectedSeconds] = useState(0);

	useEffect(() => {
		if (value) {
			setSelectedDays(Math.floor(value / DAY));
			setSelectedHours(hours ? Math.floor((value % DAY) / HOUR) : 0);
			setSelectedMinutes(minutes ? Math.floor((value % HOUR) / MINUTE) : 0);
			setSelectedSeconds(seconds ? value % MINUTE : 0);
		}
	}, [value, seconds, minutes, hours, days]);

	const updateDuration = ({ newSeconds, newMinutes, newHours, newDays }) => {
		if (newSeconds !== undefined) setSelectedSeconds(newSeconds);
		if (newMinutes !== undefined) setSelectedMinutes(newMinutes);
		if (newHours !== undefined) setSelectedHours(newHours);
		if (newDays !== undefined) setSelectedDays(newDays);

		const totalSeconds =
			(days ? (newDays ?? selectedDays) * DAY : 0) +
			(hours ? (newHours ?? selectedHours) * HOUR : 0) +
			(minutes ? (newMinutes ?? selectedMinutes) * MINUTE : 0) +
			(seconds ? (newSeconds ?? selectedSeconds) : 0);
		onChange(totalSeconds);
	};

	return (
		<div>
			{days && (
				<span className="mr-5">
					Days: <Input className="duration-input form-control"
					             type="number"
					             min="0"
					             step="1"
					             value={selectedDays}
					             onChange={(e) => {
						             const newDays = (Math.floor(e.target.value));
						             updateDuration({ newDays });
					             }}/>
				</span>
			)}
			{hours && (
				<span className="mr-5">
					Hours: <Input className="duration-input form-control"
					              type="number"
					              min="0"
					              step="1"
					              value={selectedHours}
					              onChange={(e) => {
						              const newHours = (Math.floor(e.target.value));
						              updateDuration({ newHours });
					              }}/>
				</span>
			)}
			{minutes && (
				<span className="mr-5">
					Minutes: <Input className="duration-input form-control"
					                type="number"
					                min="0"
					                step="1"
					                value={selectedMinutes}
					                onChange={(e) => {
						                const newMinutes = (Math.floor(e.target.value));
						                updateDuration({ newMinutes });
					                }}/>
				</span>
			)}
			{seconds && (
				<span>
					Seconds: <Input className="duration-input form-control"
					                type="number"
					                min="0"
					                step="1"
					                value={selectedSeconds}
					                onChange={(e) => {
						                const newSeconds = (Math.floor(e.target.value));
						                updateDuration({ newSeconds });
					                }}/>
				</span>
			)}
		</div>
	);
}
