module.exports = {
	plugins: [
		['module-resolver', {
			extensions: ['.jsx'],
			resolvePath(sourcePath, currentFile, opts) {
				return sourcePath.replace('.jsx', '.js');
			}
		},]
	]
};