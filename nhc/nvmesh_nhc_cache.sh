#!/usr/bin/env bash
# NHC -- A cache for NVMesh failed checks.

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

export NVMESH_NHC_CACHE_DIR_PATH='/etc/nvmesh/nvmesh_nhc_fails_cache'
export NVMESH_NHC_TRUE=100
export NVMESH_NHC_FALSE=200

[[ -d ${NVMESH_NHC_CACHE_DIR_PATH} ]] || mkdir -p ${NVMESH_NHC_CACHE_DIR_PATH}

# create file on fail report
function write_to_cache() {
    local check_name=$1
    touch ${NVMESH_NHC_CACHE_DIR_PATH}/${check_name}
}

# all caclulations are in seconds
function should_report() {
    local check_name=$1
    local cache=${NVMESH_NHC_CACHE_DIR_PATH}/${check_name}
    local node_uptime=''
    local last_access_time=''
    local now=$( date '+%s' )

    REPORT_SUPRESSION_MAX_TIME=300 # 5 minutes
    read -a UPTIME < /proc/uptime
    node_uptime=${UPTIME[0]/.*/}

    if [[ -f ${cache} ]]; then
        last_access_time=$(( ${now} - $( ls -l --time=atime --time-style='+%s' ${cache} | cut -d" " -f 6) ))
    fi

    # Report only if one of the conditions hold:
    # 1. This check was never reported before.
    # 2. This node was rebooted.
    # 3. It has been more than 5 minutes since this check failed last time.
    if [[ ! -f ${cache} ]] || [[ ${node_uptime} -lt ${last_access_time} ]] || [[ ${last_access_time} -gt ${REPORT_SUPRESSION_MAX_TIME} ]]
    then
        write_to_cache $check_name
        return ${NVMESH_NHC_TRUE}
    else
        return ${NVMESH_NHC_FALSE}
    fi
}
