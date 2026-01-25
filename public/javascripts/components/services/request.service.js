/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export const RequestService = {

	async get(endpoint, queryParams = {}, reqOptions = {}) {
		return this.request(endpoint, 'GET', null, queryParams, reqOptions);
	},

	async post(endpoint, body = null, queryParams = {}) {
		return this.request(endpoint, 'POST', body, queryParams);
	},

	async request(endpoint, method = 'GET', body = null, queryParams = {}, reqOptions = {}) {
		const searchParams = new URLSearchParams();

		Object.keys(queryParams).forEach(key =>
			searchParams.append(key, !reqOptions?.disableParamsAsJSON ? JSON.stringify(queryParams[key]) : queryParams[key])
		);

		const options = {
			method,
			headers: { 'Content-Type': 'application/json' },
		};

		if (body) {
			options.body = JSON.stringify(body);
		}

		const url = endpoint + (searchParams.toString() ? `?${searchParams.toString()}` : '');

		const response = await fetch(url, options);
		if (!response.ok) {
			throw new Error(`Request failed with status: ${response.status}`);
		}

		return await response.json();
	},
};
