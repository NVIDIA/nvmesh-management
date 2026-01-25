/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { APIService } from './api.service.js';

const apiService = new APIService('/techniciansScreen');

export const TechniciansScreenService = {
	async loadComms(options = { clearCache: false }) {
		return await apiService.get('/commsStats', { options: options });
	},

	async loadTotalComms() {
		return await apiService.get('/countCommsStats');
	},

	async loadMonitoredEvents() {
		return await apiService.get('/monitoredEvents');
	},

	async loadTotalMonitoredEvents() {
		return await apiService.get('/countMonitoredEvents');
	},

	async loadKafkaMetrics() {
		return await apiService.get('/kafkaMetrics');
	},

	async loadTotalKafkaMetrics() {
		return await apiService.get('/countKafkaMetrics');
	},

	async loadTimedIntervals(options = { clearCache: false, isTiming: false }) {
		return await apiService.get('/timedIntervals', { options: options });
	},

	async loadTotalTimedIntervals() {
		return await apiService.get('/countTimedIntervals');
	},

	async resetKafkaMetrics() {
		return await apiService.post('/kafkaMetrics/reset');
	}
};