const gulp = require('gulp');
const sass = require('gulp-sass')(require('sass'));
const eslint = require('gulp-eslint');
const plumber = require('gulp-plumber');
const notify = require('gulp-notify');
const apidoc = require('gulp-apidoc');
const babel = require('gulp-babel');
const sourcemaps = require('gulp-sourcemaps');
const fs = require('fs');
const path = require('path');

const stylesheetsDest = './public/stylesheets/';
const stylesheetsSrc = stylesheetsDest + 'site*.scss';
const publicJs = './public/javascripts';
const eslintSrc = ['**/*.js', '**/*.jsx', '!node_modules/**', '!gitIgnore/**', '!interop-db/**'];

const componentsSrc = `${publicJs}/components`;
const jsxSrc = `${componentsSrc}/**/*.jsx`;
const componentsDest = `${publicJs}/components_js`;

function cleanFolder(folderPath) {
	if (fs.existsSync(folderPath)) {
		fs.readdirSync(folderPath).forEach(file => {
			const currentPath = path.join(folderPath, file);
			if (fs.lstatSync(currentPath).isDirectory()) {
				cleanFolder(currentPath); // Recursively delete folders
				fs.rmdirSync(currentPath);
			} else {
				fs.unlinkSync(currentPath); // Delete files
			}
		});
	}
}

gulp.task('copyConsts', function (done) {
	gulp.src('./consts.js')
		.pipe(gulp.dest(publicJs));
	done();
});

gulp.task('copyConfigurationProfileScheme', function (done) {
	gulp.src('./modules/profileScheme.js')
		.pipe(gulp.dest(publicJs));
	done();
});

gulp.task('compileSass', function () {
	return gulp.src(stylesheetsSrc)
		.pipe(plumber(plumber({ errorHandler: function(err) {
			notify.onError({
				title: 'Gulp error in ' + err.plugin,
				message:  err.toString()
			})(err);
			this.emit('end');
		} })))
		.pipe(sass())
		.on('end', () => {console.log('sass done!!');})
		.pipe(gulp.dest(stylesheetsDest));
});

gulp.task('eslint', function() {
	return gulp.src(eslintSrc)
		.pipe(eslint('.eslintrc.json'))
		.pipe(eslint.format());
});

gulp.task('sass:watch', function(done) {
	gulp.watch(stylesheetsDest + '*.scss', gulp.series('compileSass'));
	done();
});

gulp.task('eslint:watch', function (done) {
	gulp.watch(eslintSrc, gulp.series('eslint'));
	done();
});
gulp.task('copyConst:watch', function(done) {
	gulp.watch('./consts.js', gulp.series('copyConsts'));
	done();
});

gulp.task('copyConfigurationProfileScheme:watch', function(done) {
	gulp.watch('./modules/profileScheme.js', gulp.series('copyConfigurationProfileScheme'));
	done();
});

gulp.task('buildComponents:watch', function(done) {
	gulp.watch(
		`${componentsSrc}/**/*`,
		{
			events: ['add', 'change', 'unlink'],
			usePolling: true,
			interval: 1000
		},
		gulp.series('buildComponents')
	);
	done();
});

gulp.task('cleanComponents', function(done) {
	cleanFolder(componentsDest);
	done();
});

gulp.task('compileJsx', function() {
	return gulp
		.src(jsxSrc)
		.pipe(sourcemaps.init())
		.pipe(
			babel({
				presets: ['@babel/preset-react'],
				plugins: [
					[
						'module-resolver',
						{
							extensions: ['.jsx'],
							resolvePath(sourcePath, currentFile, opts) {
								return sourcePath.replace('.jsx', '.js');
							}
						},
					],
				],
			})
		)
		.pipe(sourcemaps.write('.'))
		.pipe(gulp.dest(componentsDest));
});

gulp.task('copyNonJsx', () => {
	return gulp
		.src([`${componentsSrc}/**/*`, `!${jsxSrc}`])
		.pipe(gulp.dest(componentsDest));
});

gulp.task('buildComponents', gulp.series('cleanComponents', gulp.parallel('compileJsx', 'copyNonJsx')));

// requires `npm install apidoc -g`
gulp.task('apidoc', function(done) {
          apidoc({
            src: './routes',
			dest: './public/docs',
            single: true
          }, done);
});

gulp.task('apidoc:watch', function(done) {
	gulp.watch('./routes/*.js', gulp.series('apidoc'));
	done();
});

gulp.task('build', gulp.parallel('copyConsts', 'compileSass', 'eslint', 'copyConfigurationProfileScheme', 'apidoc', 'buildComponents'));
gulp.task('watch', gulp.parallel('sass:watch', 'eslint:watch', 'copyConst:watch', 'copyConfigurationProfileScheme:watch', 'apidoc:watch', 'buildComponents:watch'));
gulp.task('default', gulp.series('build'));
gulp.task('dev', gulp.series('build', 'watch'));
