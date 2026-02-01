#!/bin/bash

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

if [ "$1" == "-h" ] || [ "$1" == "--help" ]; then
	echo "USAGE:"
	echo "./create_dummy_rpm <version> <release>        (if not passed the version and release will be taken from 'git-describe')"
	echo
	echo "EXAMPLE: ./create_dummy_rpm 2.0.0 436"
	exit 0
fi

VERSION="$1"
RELEASE="$2"
NVMESH_PREFIX="NVMesh-"
ARCH=`uname -m`
kind="management"
rpm_build_dir=`readlink -f ~/rpmbuild`

# If not already defined, get branch and commit_id from git
if [ -z "$BRANCH_NAME" ] ; then
        BRANCH_NAME=$(git symbolic-ref --short --quiet HEAD) || BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
	if [ -z "$BRANCH_NAME" ]; then
		BRANCH_NAME=unknown
	fi
fi

if [ -z "$COMMIT_ID" ]; then
	COMMIT_ID=$(git log -n1 --format=%h)
	if [ -z "$COMMIT_ID" ]; then
		COMMIT_ID=unknown
	fi
fi

if [ -z "$VERSION" ] || [ -z "$RELEASE" ]; then
        GIT_DESCRIBE=$(git describe | cut -c 2-)

	IFS='-' read -ra git_describe <<< "$GIT_DESCRIBE"
	VERSION=${git_describe[0]}
	RELEASE=${git_describe[1]}
fi

if [ -z "$CHANGE_ID" ] ; then
        CHANGE_ID=$(git log -n1 --format=%b | awk '/^Change-Id: / {print $2}')
fi

if [ -z "$DISTRIBUTION_INFO" ]; then
	DISTRIBUTION_INFO=`cat /etc/*release`
fi

if [ -z "$VERSION" ]; then
	echo "Version was not specified! using default"
	VERSION=1.0.0
fi

if [ -z "$RELEASE" ]; then
	echo "Release was not specified! using default"
	RELEASE="1"
fi

managementRequires="nodejs >= 1:8.9.4-0, nodejs < 2:9.0.0-0, mongodb-org >= 3.6, mongodb-org < 3.7, python-argparse, nvmesh-management"
managementRequiresUbuntu="nodejs (>= 8.9.4), nodejs (<< 9.0.0), mongodb-org (>= 3.6), mongodb-org (<< 3.7), python-argparse, nvmesh-management"

if test -e /etc/redhat-release; then
	echo "Building RPM on Redhat-based distro. Running rpmdev-setuptree"
	if ! rpm -qa | grep -q rpmdevtools; then
	echo Required package rpmdevtools is not installed.
	echo Installing rpmdevtools once...
	sudo yum -y install rpmdevtools
	fi
	
	rpmdev-setuptree
elif test -e /etc/SuSE-release; then
	# SuSE doesn't have rpmdevtools so we have to create the dirs manually
	echo "Building RPM on SuSE distro. Manually setting up $rpm_build_dir"
	mkdir -p $rpm_build_dir/SPECS
	mkdir -p $rpm_build_dir/BUILD
	mkdir -p $rpm_build_dir/BUILDROOT
	mkdir -p $rpm_build_dir/SOURCES
	mkdir -p $rpm_build_dir/RPMS/$ARCH
	mkdir -p $rpm_build_dir/SRPMS
else	
	echo "Unsupported distro - create_rpm.sh will probably not work"
	mkdir -p $rpm_build_dir/SPECS
	mkdir -p $rpm_build_dir/BUILD
	mkdir -p $rpm_build_dir/BUILDROOT
	mkdir -p $rpm_build_dir/SOURCES
	mkdir -p $rpm_build_dir/RPMS/$ARCH
	mkdir -p $rpm_build_dir/SRPMS
fi

command -v rpmbuild >/dev/null 2>&1 || { echo nvmesh_management rpm creator require rpmbuild but it is not installed.  Aborting. >&2; exit 1; }

rpm_source_path="$rpm_build_dir/SOURCES/$NVMESH_PREFIX$kind"
spec_file="$NVMESH_PREFIX$kind-dummy.spec"

mkdir -p $rpm_source_path/upgrade_scripts
cp -r ../upgradeScripts $rpm_source_path/upgradeScripts
find "$rpm_source_path/upgradeScripts/" -maxdepth 1 ! -name '[1-9]*[0-9]' -type f -exec rm -f {} +
cp install.py $rpm_source_path/

if [ ! -d $rpm_build_dir/SPECS ]; then
	mkdir $rpm_build_dir/SPECS
fi

echo Copying specfile
cp $spec_file $rpm_build_dir/SPECS/

echo Building RPM

rpmbuild --define "branch $BRANCH_NAME" --define "commit_id $COMMIT_ID" --define "change_id $CHANGE_ID" --define "requires_pkgs $managementRequires" -ba --buildroot=$rpm_build_dir/BUILDROOT $rpm_build_dir/SPECS/$spec_file --define "version $VERSION" --define "release $RELEASE" 2>&1


echo Bringing the RPM...
cp $rpm_build_dir/RPMS/${ARCH}/${NVMESH_PREFIX}${kind}* .

if [[ "$DISTRIBUTION_INFO" =~ "Ubuntu" ]] || [ "$DISTRO" == "Ubuntu" ]; then
	ubuntu_dir="ubuntu_deb_build"
	echo "Building Ubuntu deb package..."
	mkdir -p $ubuntu_dir
	cd $ubuntu_dir

	fakeroot alien --generate -k --script ../${NVMESH_PREFIX}${kind}*.rpm

	packDir=${NVMESH_PREFIX}${kind}-$VERSION

	if [ -e $packDir/debian ]; then
		echo "Configuring deb dependencies..."
		sed -i -E "s/^[ ]*Depends:\s.*$/&, $managementRequiresUbuntu/g" $packDir/debian/control
		cd $packDir
               	dpkg-buildpackage -uc -us -d
		cd ..
		fakeroot rm -rf $packDir
		cp *.deb ../
	fi

	cd ..
	rm -rf $ubuntu_dir
	rm -f ${NVMESH_PREFIX}${kind}*.rpm
fi

echo Cleaning up...
rm -rf $rpm_build_dir/SPECS/$spec_file_name $rpm_source_path $rpm_build_dir/BUILD/${NVMESH_PREFIX}${kind}* $rpm_build_dir/BUILDROOT/* $rpm_build_dir/RPMS/${ARCH}/${NVMESH_PREFIX}${kind}*.${ARCH}.rpm
