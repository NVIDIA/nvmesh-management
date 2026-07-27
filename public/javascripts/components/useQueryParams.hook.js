/* global React */

const { useCallback } = React;

const useQueryParams = () => {
	const getQueryParam = useCallback((name) => {
		const searchParams = new URLSearchParams(window.location.search);
		const param = searchParams.get(name);
		try {
			return param ? JSON.parse(param) : null;
		} catch {
			return param;
		}
	}, []);

	const setQueryParam = useCallback((name, value) => {
		const searchParams = new URLSearchParams(window.location.search);

		if (!value || (typeof value === 'object' && Object.keys(value).length === 0)) {
			searchParams.delete(name);
		} else {
			searchParams.set(name, JSON.stringify(value));
		}

		const newUrl =
			window.location.pathname +
			(searchParams.toString() ? `?${searchParams.toString()}` : '');
		window.history.replaceState(null, '', newUrl);
	}, []);

	return {
		getQueryParam,
		setQueryParam
	};
};

export default useQueryParams;