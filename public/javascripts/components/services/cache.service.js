export class CacheService {
	constructor(key) {
		this.key = key;
	}

	loadCache() {
		const cache = localStorage.getItem(this.key);
		return cache ? JSON.parse(cache) : {};
	}

	saveCache(cache) {
		localStorage.setItem(this.key, JSON.stringify(cache));
	}
}