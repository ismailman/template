/*jslint node: true */
'use strict';

var _ = require('lodash');
var gulp = require('gulp');
var browserify = require('browserify');
var watchify = require('watchify');
var source = require('vinyl-source-stream');
var mold = require('mold-source-map');
var streamify = require('gulp-streamify');
var gulpif = require('gulp-if');
var uglify = require('gulp-uglify');
var sourcemaps = require('gulp-sourcemaps');
var stdio = require('stdio');
var gutil = require('gulp-util');
var rename = require("gulp-rename");
var rimraf = require('rimraf');
var Bacon = require('baconjs');
var RSVP = require('rsvp');
var globp = RSVP.denodeify(require('glob'));
var envify = require('envify/custom');
var exec = require('./src/build/exec');
var fs = require('fs');
var dir = require('node-dir');
var sys = require('sys');
var execSync = require('exec-sync');

var compiledFilename = 'app.js';

var args = stdio.getopt({
  'watch': {key: 'w', description: 'Automatic rebuild'},
  'minify': {key: 'm', description: 'Minify build'},
  'production': {key: 'p', description: 'Production build'}
});

// Don't let production be built without minification.
// Could just make the production flag imply the minify flag, but that seems
// like it would harm discoverability.
if (args.production && !args.minify) {
  throw new Error("--production requires --minify");
}

// --watch causes Browserify to use full paths in module references. We don't
// want those visible in production.
if (args.production && (args.watch)) {
  throw new Error("--production can not be used with --watch or --single");
}


function browserifyTask(name, deps, entry, destname) {
  gulp.task(name, deps, function() {
    var bundler = browserify({
      entries: entry,
      debug: true,
      cache: {}, packageCache: {}, fullPaths: args.watch
    });

    function buildBundle() {
      var bundle = bundler.bundle();
      var result = bundle
        .pipe(mold.transformSourcesRelativeTo('.'))
        .pipe(source(destname))
        .pipe(streamify(sourcemaps.init({loadMaps: true})))
        .pipe(gulpif(args.minify, streamify(uglify({
          preserveComments: 'some'
        }))))
        .pipe(streamify(sourcemaps.write(args.production ? '.' : null, {
          // don't include sourcemap comment in the inboxsdk-x.js file that we
          // distribute to developers since it'd always be broken.
          addComment: !args.production
        })))
        .pipe(gulp.dest('./dist/'));

      return new RSVP.Promise(function(resolve, reject) {
        var errCb = _.once(function(err) {
          reject(err);
          result.end();
        });
        bundle.on('error', errCb);
        result.on('error', errCb);
        result.on('end', resolve);
      });
    }

    if (args.watch) {
      var rebuilding = new Bacon.Bus();
      bundler = watchify(bundler);
      Bacon
        .fromEventTarget(bundler, 'update')
        .holdWhen(rebuilding)
        .throttle(10)
        .onValue(function() {
          rebuilding.push(true);
          gutil.log("Rebuilding '"+gutil.colors.cyan(name)+"'");
          buildBundle().then(function() {
            gutil.log("Finished rebuild of '"+gutil.colors.cyan(name)+"'");
            rebuilding.push(false);
          }, function(err) {
            gutil.log(
              gutil.colors.red("Error")+" rebuilding '"+
              gutil.colors.cyan(name)+"':", err.message
            );
            rebuilding.push(false);
          });
        });
    }

    return buildBundle();
  });
}

gulp.task('default', ['main']);
browserifyTask('main', [], './src/main.js', compiledFilename);

gulp.task('clean', function(cb) {
  rimraf('./dist/', cb);
});



