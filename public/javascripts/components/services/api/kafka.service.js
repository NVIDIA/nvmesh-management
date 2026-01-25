/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { APIService } from './api.service.js';

const apiService = new APIService('/kafka');

export const KafkaService = {
	async getClusterMetadata() {
		return await apiService.get('/clusterMetadata');
	},
};
