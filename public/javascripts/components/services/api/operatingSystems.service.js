import { APIService } from './api.service.js';

const apiService = new APIService('/operatingSystems');

export const OperatingSystemsService = {
	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async loadOperatingSystems(filter, sort, currentPage, count) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},

	async create(operatingSystems) {
		return await apiService.post('/save', operatingSystems);
	},

	async update(operatingSystems) {
		return await apiService.post('/update', operatingSystems);
	},

	async delete(operatingSystems) {
		return await apiService.post('/delete', operatingSystems);
	},

	async getDistributionTypes(filter, sort) {
		return await apiService.get('/distributionTypes', { filter, sort });
	}
};