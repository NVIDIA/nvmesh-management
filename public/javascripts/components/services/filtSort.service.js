/* global $ */


export const FiltSortService = {
	pageData: (page, count) => {
		return data => {
			const isDataArray = Array.isArray(data);
			let pagedData = isDataArray ? [] : {};
			const doSlice = data => data.slice(page * count, page * count + count);

			if (isDataArray)
				pagedData = doSlice(data);
			else
				doSlice(Object.keys(data)).forEach(key => { pagedData[key] = data[key]; });

			return pagedData;
		};
	},
	sortData: sort => data => {
		const doSort = (values, sortDirection) => {
			const sorted = values.sort((a, b) => (a[col] > b[col] ? 1 : b[col] > a[col] ? -1 : 0));
			return sortDirection === -1 ? sorted.reverse() : sorted;
		};

		let col;
		const isDataArray = Array.isArray(data);
		let sortedData = isDataArray ? [] : {};

		if ($.isEmptyObject(sort)) {
			sortedData = data;
		} else {
			col = Object.keys(sort)[0];
			const sortDirection = sort[col];

			if (isDataArray) {
				sortedData = doSort(data, sortDirection);
			} else {
				const sortedKeys = doSort(Object.keys(data), sortDirection);
				sortedKeys.forEach(key => {
					sortedData[key] = data[key];
				});
			}
		}

		return sortedData;
	},
	filterData: filter => data => {
		const filterObjKeys = (obj, filterRegex) =>
			Object.keys(obj).filter(key => filterRegex.test(obj[key][col]));

		let col;
		const isDataArray = Array.isArray(data);
		let filteredData = isDataArray ? [] : {};

		if ($.isEmptyObject(filter)) {
			filteredData = data;
		} else {
			col = Object.keys(filter)[0];
			const regex = new RegExp(filter[col]['$regex'], 'i');

			if (isDataArray) {
				filteredData = data.filter(stat => regex.test(stat[col]));
			} else {
				const filteredKeys = filterObjKeys(data, regex);
				filteredKeys.forEach(key => {
					filteredData[key] = data[key];
				});
			}
		}

		return filteredData;
	}
};