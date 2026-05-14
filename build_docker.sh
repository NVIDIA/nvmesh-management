#!/bin/bash

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

########################################################
# Builds NVMesh Management in a docker container on local machine
########################################################
# Dockerfile in docker/


print_help() {
cat << EOF
usage:

-h      --help              	prints this help

-d      --distro            	linux distro (rhel7, rhel8, ...)

-b      --branch            	branch name

-c      --commit-id         	commit id

-g      --change-id         	change id

-d      --git-describe      	git describe string

-l	--leave-running     	leave container running

-p	--rpm-path          	path to copy RPM/DEB to

        --build-dir         	build directory inside container

	--infra-bin	    	path to infra-bin.tgz

-u	--utils       		Build utils RPM/DEB

-m	--mgmt		  	Build management RPM/DEB

-r	--build-rpm-opts 	Extra options to pass to buildrpm script

EOF
}

RSYNC_OPTS="--delete --compress --cvs-exclude --exclude=.git --exclude=*.rpm --exclude=*.deb --ignore-errors -rlpgoDzv --checksum"

LEAVE_RUNNING="false"

BUILD_UTILS="false"

BUILD_MANAGEMENT="true"

while [[ $# -gt 0 ]]
do
key="$1"

case $key in
    -h|--help)
    print_help
    exit 0
    ;;
    -d|--distro)
    DISTRO="$2"
    shift
    ;;
    -b|--branch)
    GIT_BRANCH="$2"
    shift
    ;;
    -c|--commit-id)
    GIT_COMMIT_ID="$2"
    shift
    ;;
    -g|--change-id)
    GIT_CHANGE_ID="$2"
    shift
    ;;
    -d|--git-describe)
    GIT_DESCRIBE="$2"
    shift
    ;;
    -l|--leave-running)
    LEAVE_RUNNING="true"
    ;;
    -p|--rpm-path)
    RPM_PATH="$2"
    shift
    ;;
    --build-dir)
    BUILD_DIR="$2"
    shift
    ;;
    -r|--build-rpm-opts)
    EXTRA_BUILD_RPM_OPTS="$2"
    shift
    ;;
    --infra-bin)
    INFRA_BIN="$2"
    shift
    ;;
    -u|--utils)
    BUILD_UTILS="true"
    BUILD_MANAGEMENT="false"
    ;;
    -m|--mgmt)
    BUILD_UTILS="false"
    BUILD_MANAGEMENT="true"
    ;;
    *)
    # unknown option
    echo "Unknown option $key"
    print_help
    exit 1
    ;;
esac
shift # past argument or value
done

if [ -z $DISTRO ]; then
        DISTRO=rhel8
fi

if [ -z $GIT_COMMIT_ID ] ; then
        GIT_COMMIT_ID=$(git log -n1 --format=%h)
fi

if [ -z $GIT_CHANGE_ID ] ; then
        GIT_CHANGE_ID=$(git log -n1 --format=%b | awk '/^Change-Id: / {print $2}')
fi

if [ -z $GIT_BRANCH ] ; then
        GIT_BRANCH=$(git symbolic-ref --short --quiet HEAD) || GIT_BRANCH=$(git rev-parse HEAD)
fi

if [ -z $GIT_DESCRIBE ] ; then
        GIT_DESCRIBE=$(git describe | cut -c 2-)
fi

if [ -z $BUILD_DIR ]; then
	BUILD_DIR="/management"
fi

if [ -z $RPM_PATH ] ; then
	RPM_PATH=$PWD
fi

# Build docker container
echo "Building nvmesh-management-build-$DISTRO image from docker/"
docker build -t nvmesh-management-build-$DISTRO -f docker/Dockerfile_$DISTRO docker/
# Start docker container
echo "Starting container using nvmesh-management-build-$DISTRO image"
CONT_UUID=`docker run -dit nvmesh-management-build-$DISTRO bash`
echo "UUID: $CONT_UUID"
# Make the build dir
docker exec $CONT_UUID bash -c "mkdir -p $BUILD_DIR"
# Rsync into docker container
echo "Rsync into container $CONT_UUID:/$BUILD_DIR"
rsync -e 'docker exec -i' $RSYNC_OPTS . $CONT_UUID:/$BUILD_DIR
if [ ! -z $INFRA_BIN ]; then
	# Make the dir for the infra binary
	INFRA_DIR="$BUILD_DIR/infrastructure/dist/infra"
	docker exec $CONT_UUID bash -c "mkdir -p $INFRA_DIR"
	echo "Extract infra binary $INFRA_BIN into container $CONT_UUID to path $INFRA_DIR"
	cat $INFRA_BIN | docker exec -i $CONT_UUID tar -zxv --strip-components=2 -C $INFRA_DIR
fi
BUILD_RPM_OPTS="-b $GIT_BRANCH -c $GIT_COMMIT_ID -g $GIT_CHANGE_ID -d $GIT_DESCRIBE"
if [ "$BUILD_MANAGEMENT" == "true" ]; then
	BUILD_RPM_OPTS+=" --management"
	# Run npm install
	echo "Running npm install"
	docker exec -t $CONT_UUID bash -c "cd $BUILD_DIR; npm install"
fi
if [ "$BUILD_UTILS" == "true" ]; then
	BUILD_RPM_OPTS+=" --utils"
fi
BUILD_RPM_OPTS+=" $EXTRA_BUILD_RPM_OPTS"
# Run buildrpm
echo "Running buildrpm $BUILD_RPM_OPTS"
docker exec -t $CONT_UUID bash -c "cd $BUILD_DIR/RPM; ./buildrpm $BUILD_RPM_OPTS"
# Fetch RPM
NVMESH_RPMS=$(docker exec $CONT_UUID bash -c "find /$BUILD_DIR/RPM -type f -maxdepth 1 -name '*.rpm' -o -name '*.deb' | xargs")
echo "Fetching RPM(s) $NVMESH_RPMS to $RPM_PATH"
for i in $NVMESH_RPMS; do
	docker cp $CONT_UUID:$i $RPM_PATH
done
if [ "$LEAVE_RUNNING" = "true" ]; then
	echo "Leaving Container $CONT_UUID Running"
else
	# Stopping Container
        echo "Stopping Container $CONT_UUID"
	docker container stop -t 0 $CONT_UUID
	echo "Removing Container $CONT_UUID"
	# Removing Container
	docker container rm $CONT_UUID
fi
echo "Done!"
