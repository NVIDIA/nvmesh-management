#!/bin/bash
set -o pipefail

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

usage() {
	echo "Usage: $0 [--node <version>]"
	echo "Supported versions: ${supported_node_versions[@]}"
	echo "BUILDRPM_FLAGS='' can be used to provide buildrpm script special flags"
	echo "YUM_INSTALL_FLAGS='' can be used to provide yum install special flags"
	exit 1
}

if [ "$EUID" -ne 0 ]; then
	echo "Error: should be run as root"
	exit 1
fi

current_dir="$(pwd)"
dir_name="$(basename "$current_dir")"

if [ "$dir_name" != "RPM" ]; then
	echo "Error: running from is '$current_dir', but should be in 'RPM'."
	exit 1
fi

# initiate the supported_node_versions array with all of the even node major versions in the range of package.json/engine/node
init_supported_node_versions() {
	if [[ ! -f "../package.json" ]]; then
        echo "Error: package.json not found in the parent directory."
        exit 1
    fi

	local range=$(cat ../package.json | grep -A 1 engine | grep node | grep -oE '(>=|>)[0-9]+ (<|<=)[0-9]+')

	if [[ -z "$range" ]]; then
        echo "Error: No valid node version range found in package.json."
        exit 1
    fi

	local min_boundary=$(echo $range | grep -oE '>=|>')
	local max_boundary=$(echo $range | grep -oE '<=|<')
	local min_version=$(echo $range | grep -oE '(>=|>)[0-9]+' | grep -oE '[0-9]+')
	local max_version=$(echo $range | grep -oE '(<|<=)[0-9]+' | grep -oE '[0-9]+')


	if [[ $min_boundary == ">" ]]; then
		((min_version++))
	fi

	if [[ $max_boundary == "<=" ]]; then
  		((max_version++))
	fi

	supported_node_versions=()

	for ((i = min_version; i < max_version; i++)); do
		if (( i % 2 == 0 )); then
		    supported_node_versions+=($i)
		fi
	done
}

log_dir=${LOGD:-$(mktemp -d /tmp/mgmt_build_sh.XXXXXX)}

run_command_with_log() {
	local log_file="${log_dir}/$1"
	shift
	local command="$*"

	echo -n "Executing: $command"
	TIMEFORMAT='%3R'
	time_taken=$({ time bash -c "set -x; $command" 2>&1 | awk '{ print strftime("[%Y-%m-%d %H:%M:%S]"), $0 }' >> "$log_file"; } 2>&1)
	local exit_status=$?
	echo " -- ${time_taken}s"

	if [[ $exit_status -ne 0 ]]; then
		echo "Command failed: $command"
		echo "Check log file: $log_file"
		exit $exit_status
	fi
}

init_supported_node_versions

# By default, the latest version of the supported node versions
NODE_VERSION=${supported_node_versions[${#supported_node_versions[@]}-1]}

while [[ "$#" -gt 0 ]]; do
	case $1 in
		--node)
			if [[ -z $2 ]]; then
				echo "Error: Missing argument for --node"
				usage
			fi

			found=0

			for supported_node_version in "${supported_node_versions[@]}"; do
				if [ "$supported_node_version" -eq "$2" ]; then
					found=1
					break
				fi
			done

			if [ $found -eq 1 ]; then
				NODE_VERSION=$2
			else
				echo "Error: Invalid node version. Only ${supported_node_version[@]} are allowed."
				exit 1
			fi
			shift 2
			;;
		*)
			echo "Error: Invalid argument $1"
			usage
			;;
	esac
done


run_command_with_log "installBuildRpmDependencies.log"	./installBuildRpmDependencies.sh
run_command_with_log "ensureNodeInstalled.log"			./ensureNodeInstalled.sh $NODE_VERSION
run_command_with_log "npm_install.log"					npm install --unsafe-perm
run_command_with_log "npm_install_interop_db.log"		npm install --unsafe-perm --prefix ../../interop-db/
run_command_with_log "npm_run_build.log" 				npm run build
run_command_with_log "npm_prune.log" 					npm prune --omit=dev
run_command_with_log "buildrpm.log" 					./buildrpm $BUILDRPM_FLAGS
