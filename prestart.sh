#!/bin/bash

cp consts.js ./public/javascripts/
if which scss; then
	scss ./public/stylesheets/site.scss ./public/stylesheets/site.css
	scss ./public/stylesheets/site_login.scss ./public/stylesheets/site_login.css
else
	echo "WARNING: Can not compile scss file, styling might not work"
fi


if [ -x /usr/bin/eslint ] ; then
	lintCommand=/usr/bin/eslint
else 
	if [ -e node_modules/eslint/bin/eslint.js ] ; then
		lintCommand=node_modules/eslint/bin/eslint.js
	fi
fi

if [ ! -z "$lintCommand" ] ; then 
	echo "Going to run: $lintCommand -c .eslintrc.json --ignore-path .eslintignore ."
	$lintCommand -c .eslintrc.json --ignore-path .eslintignore .
else
	echo "Couldn't find eslint, not validating the code formatting"
fi


	
