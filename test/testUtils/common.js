// Promise based delay in Miliseconds
exports.delay = (duration, value) => {
	return new Promise(resolve => {
		setTimeout(resolve.bind(null, value), duration);
	});
};