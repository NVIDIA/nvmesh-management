#!/bin/bash -x

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

NODE_REQUIRED_VERSION=$1
SHOULD_REMOVE_NODE=0

# Validations
if [ -z "$NODE_REQUIRED_VERSION" ]; then
  	echo "Error: Node version parameter is required"
  	echo "Usage: $0 <node_version>"
	exit 1
fi

if [ "$EUID" -ne 0 ]; then
	echo "Error: should be run as root"
	exit 1
fi

if [[ "$NODE_REQUIRED_VERSION" != "17" && "$NODE_REQUIRED_VERSION" != "18" ]]; then
	echo "Error: unsupported required node version. Found: $NODE_REQUIRED_VERSION"
	exit 1
fi

if command -v node &> /dev/null; then
	NODE_CURRENT_VERSION=$(node --version)
	NODE_MAJOR_VERSION=$(echo "$NODE_CURRENT_VERSION" | grep -oE '^v[0-9]+' | cut -c2-)

	if [[ "$NODE_REQUIRED_VERSION" != "$NODE_MAJOR_VERSION" ]]; then
		SHOULD_REMOVE_NODE=1
	else
		echo "Required node version is installed ($NODE_REQUIRED_VERSION)"
		exit 0
	fi
fi


# Installation
set -e

if [ -e /etc/redhat-release ]; then
	if [ $SHOULD_REMOVE_NODE -eq 1 ] ; then
		yum remove -y nodejs
		dnf module reset -y nodejs
	fi

	dnf module install -y nodejs:$NODE_REQUIRED_VERSION

elif [[ "$(cat /etc/os-release 2>/dev/null)" =~ Ubuntu ]]; then
	if [ $SHOULD_REMOVE_NODE -eq 1 ] ; then
		apt remove --purge -y nodejs npm libnode*
	fi

	curl -fsSL https://deb.nodesource.com/setup_$NODE_REQUIRED_VERSION.x | bash -
	# The nodesource setup script adds a high-priority apt repository preference for nodejs,
	# and the npm package is installed as a dependency of nodejs.
	DEBIAN_FRONTEND=noninteractive apt install -y nodejs

else
	echo "Error: Unsupported OS type (neither RedHat nor Ubuntu detected)"
	exit 1
fi

set +e


# Verification
if ! command -v node &> /dev/null; then
	echo "Error: Failed to run node after installation"
	exit 1
fi

NODE_CURRENT_VERSION=$(node --version)
NODE_MAJOR_VERSION=$(echo "$NODE_CURRENT_VERSION" | grep -oE '^v[0-9]+' | cut -c2-)

if [[ "$NODE_REQUIRED_VERSION" != "$NODE_MAJOR_VERSION" ]]; then
	echo "Error: Failed to run the correct node version after installation. Found $NODE_MAJOR_VERSION"
	exit 1
fi

echo "Great Success"
