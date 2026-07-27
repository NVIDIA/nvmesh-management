/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

module.exports = {
	plugins: [
		['module-resolver', {
			extensions: ['.jsx'],
			resolvePath(sourcePath, currentFile, opts) {
				return sourcePath.replace('.jsx', '.js');
			}
		},]
	]
};