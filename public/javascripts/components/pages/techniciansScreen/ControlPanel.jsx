/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

const { useRef, useState } = React;


const ControlPanel = ({ tablesData, reloadRecordableTables }) => {
	const [timeToRecord, setTimeToRecord] = useState('');
	const [isRecording, setIsRecording] = useState(false);
	const [timeDisplay, setTimeDisplay] = useState('00:00');

	const isInputInvalid = timeToRecord.trim() === '';
	const timerIntervalRef = useRef(null);

	const startTimer = (durationInSeconds) => {
		let timer = durationInSeconds;

		timerIntervalRef.current = setInterval(() => {
			if (timer < 0) {
				clearInterval(timerIntervalRef.current);
				setTimeDisplay('00:00');
				return;
			}

			const minutes = String(Math.floor(timer / 60)).padStart(2, '0');
			const seconds = String(timer % 60).padStart(2, '0');

			setTimeDisplay(`${minutes}:${seconds}`);
			timer--;
		}, 1000);
	};

	const startRecording = () => {
		if (isInputInvalid) return;

		setIsRecording(true);
		reloadRecordableTables(true);

		const timeInSecs = timeToRecord * 60;
		const timeInMs = timeInSecs * 1000;

		startTimer(timeInSecs);
		setTimeout(() => {
			reloadRecordableTables(false);
			setIsRecording(false);
		}, timeInMs);
	};

	const getStatus = () => {
		const status = tablesData;
		const json = JSON.stringify(status, null, 2);
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);

		const downloader = document.createElement('a');
		downloader.href = url;
		downloader.download = 'techniciansScreenStatus.json';
		document.body.appendChild(downloader);
		downloader.click();
		document.body.removeChild(downloader);

		URL.revokeObjectURL(url);
	};

	return (
		<div className="row">
			<div className="col-md-12">
				<h2>Control</h2>
				<form
					className="pull-left recording-form"
					title="Reset Timed Intervals counters, and record for the specified amount of time."
					onSubmit={(e) => {
						e.preventDefault();
						startRecording();
					}}
				>
					<div className={`mr-10 pull-left ${isInputInvalid ? 'has-error' : ''}`}>
						<input
							name="timeToRecord"
							id="timeToRecord"
							type="text"
							className="form-control"
							autoFocus
							disabled={isRecording}
							value={timeToRecord}
							onChange={(e) => setTimeToRecord(e.target.value)}
							placeholder="# of minutes to record"
							required
						/>
					</div>

					<button
						type="submit"
						className="btn btn-success pull-left mr-10"
						disabled={isInputInvalid || isRecording}
					>
						<i className="fa fa-bar-chart"></i> Record
					</button>

					<div className="pull-left">{timeDisplay}</div>
				</form>

				<button
					className="btn btn-info mgmt-btn-info pull-right"
					onClick={getStatus}
				>
					Download Status
				</button>
			</div>

			<hr />
		</div>
	);
};

export default ControlPanel;