import { APIService } from './api.service.js';

const apiService = new APIService('/kernels');

export const KernelsService = {
	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async loadKernels(filter, sort, currentPage, count) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},

	async create(kernels) {
		return await apiService.post('/save', kernels);
	},

	async update(kernels) {
		return await apiService.post('/update', kernels);
	},

	async delete(kernels) {
		return await apiService.post('/delete', kernels);
	},
};