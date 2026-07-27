/* global consts */
import { APIService } from './api.service.js';

const API_BASE_URL = '/configurationProfiles';

const apiService = new APIService(API_BASE_URL);


export const ConfigurationProfilesService = {
	async get(filter, sort, currentPage, count) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},
	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},
	async getAll(projection) {
		return await apiService.get('/all/0/0', { projection });
	},
	async apply(profileName, profileUUID, nodeIDs) {
		return await apiService.post('/apply', { name: profileName, uuid: profileUUID, nodeIDs: nodeIDs });
	},
	async getNodesConfigs(filter, sort, currentPage = 0, count = 0) {
		return await apiService.get(`/nodeConfig/${currentPage}/${count}`, { filter, sort });
	},
	async getNodesConfigsTotal(filter) {
		let projection = { _id: 1 };
		let res = await apiService.get('/nodeConfig/0/0', { filter, projection });
		return res.length;
	},
	async create(profile) {
		return await apiService.post('/save', profile);
	},
	async update(profile) {
		return await apiService.post('/update', profile);
	},
	async delete(profile) {
		return await apiService.post('/delete', profile);
	},
	async getNVMeshDefaultProfile() {
		let filterNVMeshDefault = { _id: consts.configurationProfile.defaults.NVMESH_DEFAULT };
		let profileList = await this.get(filterNVMeshDefault);
		if (!profileList.length)
			throw new Error(`Could not find profile ${consts.configurationProfile.defaults.NVMESH_DEFAULT}`);

		return profileList[0];
	}
};
