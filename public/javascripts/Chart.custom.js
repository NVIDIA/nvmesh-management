/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global Chart */

/*
* User Defined LinearBinaryScale
* This Custom Scale is intended to use when we want to display data as Binary Units (Mib, Gib etc..)
* The main change is the NiceNumber Algorithm which was adjusted to distribute nice numbers on a Binary unit axis
* The problem it solves: with the Chart.js Linear scale if we pass in 1000000000, 200000000, .. as  values
* the default niceNumbers Algorithm will find ticks 1GB, 2GB etc, but after formatted to GiB, we will get 0.931GiB
*/
var LinearBinaryScaleDefaults = Chart.scaleService.getScaleDefaults('linear');
var LinearBinaryScale = Chart.scaleService.getScaleConstructor('linear').extend({
	buildTicks: function() {
		var me = this;
		var opts = me.options;
		var tickOpts = opts.ticks;

		// Figure out what the max number of ticks we can support it is based on the size of
		// the axis area. For now, we say that the minimum tick spacing in pixels must be 40
		// We also limit the maximum number of ticks to 11 which gives a nice 10 squares on
		// the graph. Make sure we always have at least 2 ticks
		var maxTicks = me.getTickLimit();
		maxTicks = Math.max(2, maxTicks);

		var numericGeneratorOptions = {
			maxTicks: maxTicks,
			min: tickOpts.min,
			max: tickOpts.max,
			precision: tickOpts.precision,
			stepSize: Chart.helpers.valueOrDefault(tickOpts.fixedStepSize, tickOpts.stepSize),
			niceNum: Chart.helpers.valueOrDefault(tickOpts.niceNum, Chart.helpers.niceNum)
		};
		var ticks = me.ticks = me.generateTicks(numericGeneratorOptions, me);

		me.handleDirectionalChanges();

		// At this point, we need to update our max and min given the tick values since we have expanded the
		// range of the scale
		me.max = Chart.helpers.max(ticks);
		me.min = Chart.helpers.min(ticks);

		if (tickOpts.reverse) {
			ticks.reverse();

			me.start = me.max;
			me.end = me.min;
		} else {
			me.start = me.min;
			me.end = me.max;
		}
	},
	niceNumBinary: function(range, round) {
		var exponent = Math.floor(Math.log2(range));
		var fraction = range / Math.pow(2, exponent);
		var niceFraction;

		if (round) {
			if (fraction < 1.5) {
				niceFraction = 1;
			} else if (fraction < 3) {
				niceFraction = 2;
			} else if (fraction < 7) {
				niceFraction = 5;
			} else {
				niceFraction = 10;
			}
		} else if (fraction <= 1.0) {
			niceFraction = 1;
		} else if (fraction <= 2) {
			niceFraction = 2;
		} else if (fraction <= 5) {
			niceFraction = 5;
		} else {
			niceFraction = 10;
		}

		var nice = niceFraction * Math.pow(2, exponent);
		return nice;
	},
	generateTicks: function(generationOptions, dataRange) {
		var me = this;
		var ticks = [];
		// To get a "nice" value for the tick spacing, we will use the appropriately named
		// "nice number" algorithm. See https://stackoverflow.com/questions/8506881/nice-label-algorithm-for-charts-with-minimum-ticks
		// for details.

		var MIN_SPACING = 1e-14;
		var stepSize = generationOptions.stepSize;
		var unit = stepSize || 1;
		var maxNumSpaces = generationOptions.maxTicks - 1;
		var min = generationOptions.min;
		var max = generationOptions.max;
		var precision = generationOptions.precision;
		var rmin = dataRange.min;
		var rmax = dataRange.max;
		var spacing = me.niceNumBinary((rmax - rmin) / maxNumSpaces / unit) * unit;
		var factor, niceMin, niceMax, numSpaces;

		// Beyond MIN_SPACING floating point numbers being to lose precision
		// such that we can't do the math necessary to generate ticks
		if (spacing < MIN_SPACING && Chart.helpers.isNullOrUndef(min) && Chart.helpers.isNullOrUndef(max)) {
			return [rmin, rmax];
		}

		numSpaces = Math.ceil(rmax / spacing) - Math.floor(rmin / spacing);
		if (numSpaces > maxNumSpaces) {
			// If the calculated num of spaces exceeds maxNumSpaces, recalculate it
			spacing = me.niceNumBinary(numSpaces * spacing / maxNumSpaces / unit) * unit;
		}

		if (stepSize || Chart.helpers.isNullOrUndef(precision)) {
			// If a precision is not specified, calculate factor based on spacing
			factor = Math.pow(10, Chart.helpers._decimalPlaces(spacing));
		} else {
			// If the user specified a precision, round to that number of decimal places
			factor = Math.pow(10, precision);
			spacing = Math.ceil(spacing * factor) / factor;
		}

		niceMin = Math.floor(rmin / spacing) * spacing;
		niceMax = Math.ceil(rmax / spacing) * spacing;

		// If min, max and stepSize is set and they make an evenly spaced scale use it.
		if (stepSize) {
			// If very close to our whole number, use it.
			if (!Chart.helpers.isNullOrUndef(min) && Chart.helpers.almostWhole(min / spacing, spacing / 1000)) {
				niceMin = min;
			}
			if (!Chart.helpers.isNullOrUndef(max) && Chart.helpers.almostWhole(max / spacing, spacing / 1000)) {
				niceMax = max;
			}
		}

		numSpaces = (niceMax - niceMin) / spacing;
		// If very close to our rounded value, use it.
		if (Chart.helpers.almostEquals(numSpaces, Math.round(numSpaces), spacing / 1000)) {
			numSpaces = Math.round(numSpaces);
		} else {
			numSpaces = Math.ceil(numSpaces);
		}

		niceMin = Math.round(niceMin * factor) / factor;
		niceMax = Math.round(niceMax * factor) / factor;
		ticks.push(Chart.helpers.isNullOrUndef(min) ? niceMin : min);
		for (var j = 1; j < numSpaces; ++j) {
			ticks.push(Math.round((niceMin + j * spacing) * factor) / factor);
		}
		ticks.push(Chart.helpers.isNullOrUndef(max) ? niceMax : max);

		return ticks;
	}
});

Chart.helpers._decimalPlaces = function(x) {
	if (!Chart.helpers.isFinite(x)) {
		return;
	}
	var e = 1;
	var p = 0;
	while (Math.round(x * e) / e !== x) {
		e *= 10;
		p++;
	}
	return p;
};

Chart.helpers.isFinite = function(value) {
	return (typeof value === 'number' || value instanceof Number) && isFinite(value);
};

Chart.scaleService.registerScaleType('linear-binary', LinearBinaryScale, LinearBinaryScaleDefaults);
