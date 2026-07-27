import { APIService } from './api.service.js';

const apiService = new APIService('/nvmeshMetadata');

export const NvmeshMetadataService = {
	async getClusterID() {
		return await apiService.get('/clusterID');
	},

	async updateClusterID(clusterID) {
		return await apiService.post('/updateClusterID', { clusterID });
	},
};
