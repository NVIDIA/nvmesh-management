#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

###
# This Script Assumes the nvmesh-management .deb package is available in the same directory as this script
###

SHORT_VERSION_TAG=false

usage() {
  echo -e "Usage: $(basename $0) [options]\n"
  echo -e "options:"
  echo -e "\t[-h|--help] this help"
  echo -e "\t[-t|--tag] define custom image tag. if not set, the version of the package will be parsed"
  echo -e "\t[--short-version-tag] if set the tag will include version but not build build e.g :2.0.2 instead of :2.0.2-324"
  echo -e "\t[-m|--mgmt] nvmesh-management*.deb package file name. this file must be present in the directory of this script"
  echo -e "\t[-u|--utils] nvmesh-utils*.deb package file name. this file must be present in the directory of this script"
}

while [ $# -gt 0 ]; do
  case $1 in
    -h|--help) usage; exit 0 ;;
    -t|--tag) TAG=$2; shift ;;
    --short-version-tag) SHORT_VERSION_TAG=true ;;
    -m|--mgmt) MGMT_PKG_FILE_NAME=$2; shift ;;
    -u|--utils) UTILS_PKG_FILE_NAME=$2; shift ;;
    -f|--file) PKG_FILE_NAME=$2; shift ;;

    (-*) echo "$0: error - unrecognized option $1" 1>&2; usage; exit 0;;
    (*) break ;;
  esac
  shift
done

if [ -z "$UTILS_PKG_FILE_NAME" ] ; then
    UTILS_PKG_FILE_NAME=$(find nvmesh-utils*.rpm)

    if [ -z "$UTILS_PKG_FILE_NAME" ] ; then
        echo "Could not find any nvmesh-utils*.rpm package in the current directory"
        exit 1
    fi
fi

if [ -z "$MGMT_PKG_FILE_NAME" ] ; then
    MGMT_PKG_FILE_NAME=$(find nvmesh-management*.rpm)

    if [ -z "$MGMT_PKG_FILE_NAME" ] ; then
        echo "Could not find any nvmesh-management*.rpm package in the current directory"
        exit 1
    fi
fi

VERSION=$(echo $MGMT_PKG_FILE_NAME | cut -d '-' -f 3)
BUILD=$(echo $MGMT_PKG_FILE_NAME |  cut -d '-' -f 4 | cut -d '.' -f 1)

VERSION_AND_BUILD="$VERSION-$BUILD"

echo "UTILS_PKG_FILE_NAME=$UTILS_PKG_FILE_NAME"
echo "MGMT_PKG_FILE_NAME=$MGMT_PKG_FILE_NAME"
echo "VERSION_AND_BUILD=$VERSION_AND_BUILD"
echo "VERSION=$VERSION"

if [ -z  $TAG ]; then
    if [ "$SHORT_VERSION_TAG" == true ]; then
        TAG=$VERSION
    else
        TAG=$VERSION_AND_BUILD
    fi
fi

echo "Pulling latest base image"
docker pull registry.access.redhat.com/ubi7:latest

echo "Building Docker image excelero/nvmesh-management:$TAG"
mkdir ./licenses
cp ../../../LICENSE ./licenses
echo "running: docker build --build-arg MGMT_PKG_FILE_NAME=$MGMT_PKG_FILE_NAME --build-arg UTILS_PKG_FILE_NAME=$UTILS_PKG_FILE_NAME --build-arg VERSION=$VERSION --build-arg BUILD=$BUILD . --tag registry.excelero.com/nvmesh-management:$TAG"
docker build --build-arg MGMT_PKG_FILE_NAME=$MGMT_PKG_FILE_NAME --build-arg UTILS_PKG_FILE_NAME=$UTILS_PKG_FILE_NAME --build-arg VERSION=$VERSION --build-arg BUILD=$BUILD . --tag registry.excelero.com/nvmesh-management:$TAG
result=$?

rm -rf ./licenses

if [ $result -ne 0 ]; then
    echo "Docker image build failed"
    exit $result
fi
