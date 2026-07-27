import { APIService } from './api.service.js';

const apiService = new APIService('/servers');

export const TargetsService = {
	async loadAll() {
		return await apiService.get('/all/0/0');
	},

	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async loadTargets(filter, sort, currentPage, count) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},

	async getTargetByID(id) {
		return await apiService.get(`/${id}`);
	},

	async create(targets) {
		return await apiService.post('/save', targets);
	},

	async update(targets) {
		return await apiService.post('/update', targets);
	},

	async delete(targets) {
		return await apiService.post('/delete', targets);
	},

	async setZone(zoneID, targetIds) {
		return await apiService.post('/setZone', { zoneID, targets: targetIds });
	},

	async getTotalSpace(body) {
		return await apiService.post('/totalSpace', body);
	},

	async getAllocatedSpace(body) {
		return await apiService.post('/allocatedSpace', body);
	},

	async getAvailableMirrors(capacity, body) {
		return await apiService.post(`/availableMirrors/${capacity}`, body);
	},

	async getAllocationByTarget() {	
		return await apiService.get('/getAllocationByTarget');
	},

	async deleteNics(body) {
		return await apiService.post('/deleteNic', body);
	}
};
