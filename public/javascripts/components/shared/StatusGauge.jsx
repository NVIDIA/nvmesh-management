/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, c3, STATUS_COLORS */

const { useEffect, useRef } = React;


const numToKRoundNumber = (num) => {
	let value;
	let appendK;

	if (Math.abs(num) > 999) {
		value = Math.sign(num) * ((Math.abs(num) / 1000).toFixed(1));
		appendK = true;
	} else
		value = Math.sign(num) * Math.abs(num);

	value = value > 0 ? value : 0;
	return appendK ? value + 'K' : value;
};

const StatusGaugeElement = ({
	name,
	value,
	link,
	extraClassName = '',
}) => {
	return (
		<a className={`health-link ${link ? 'health-link-hover' : ''} ${extraClassName}`} href={link} title={value}>
			<span>
				{numToKRoundNumber(value)}
				<span>{name}</span>
			</span>
		</a>
	);
};

const StatusGauge = ({
	header,
	headerLink,
	icon,
	topElement,
	rightElement,
	leftElement,
	fourthElement,
}) => {
	const gaugeRef = useRef(null);
	const chart = useRef(null);

	const columns = [
		[topElement.name, topElement.value],
		[rightElement.name, rightElement.value],
		[leftElement.name, leftElement.value],
		...(fourthElement ? [[fourthElement.name, fourthElement.value]] : []),
	];

	useEffect(() => {
		if (chart.current) {
			chart.current.load({
				columns
			});
		} else {
			initChart();
		}

	}, [topElement.value, rightElement.value, leftElement.value, fourthElement?.value]);


	const initChart = () => {
		chart.current = c3.generate({
			bindto: gaugeRef.current,
			data: {
				columns,
				type: 'donut',
				order: null,
				colors: {
					[topElement.name]: STATUS_COLORS.NORMAL,
					[rightElement.name]: STATUS_COLORS.ERROR,
					[leftElement.name]: STATUS_COLORS.WARNING,
					...(fourthElement ? { [fourthElement.name]: STATUS_COLORS.PLACEHOLDER } : {}),
				}
			},
			size: {
				width: 230,
				height: 210
			},
			donut: {
				width: 5,
				label: {
					show: false
				}
			},
			legend: {
				show: false
			}
		});
	};


	return (
		<div className={`status-gauge-container ${fourthElement ? 'status-gauge-container--with-fourth' : ''}`}>
			<div className="icon">{icon}</div>

			{topElement && (
				<StatusGaugeElement {...topElement} />
			)}
			{rightElement && (
				<StatusGaugeElement {...rightElement} />
			)}
			{leftElement && (
				<StatusGaugeElement {...leftElement} />
			)}
			{fourthElement && (
				<StatusGaugeElement {...fourthElement} extraClassName="health-link--top-right" />
			)}

			<div className="status-gauge" ref={gaugeRef}></div>

			<a className={`main-link ${headerLink ? 'main-link-hover' : ''}`} href={headerLink}><h3>{header}</h3></a>
		</div>
	);
};

export default StatusGauge;
