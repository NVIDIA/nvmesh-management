import { APIService } from './api.service.js';

const apiService = new APIService('/kafka');

export const KafkaService = {
	async getClusterMetadata() {
		return await apiService.get('/clusterMetadata');
	},
};
