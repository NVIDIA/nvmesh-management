/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Promise based delay in Miliseconds
exports.delay = (duration, value) => {
	return new Promise(resolve => {
		setTimeout(resolve.bind(null, value), duration);
	});
};
