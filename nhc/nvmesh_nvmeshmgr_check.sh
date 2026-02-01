#!/usr/bin/env bash
# NHC -- nvmeshmgr systemD check

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

source /etc/nhc/scripts/nvmesh_nhc_cache.sh

export NVMESH_IS_NODE_PS_UP=0
export NVMESH_MGR_CMD='/opt/NVMesh/management/app.js'
declare NVMESH_MGR_UNIT_STATUS=''
declare NVMESH_MGR_SERVICE_STATUS=''

function nhc_nvmeshmgr_gather_data() {
        local nvmeshmgr_is_enabled
        local nvmeshmgr_is_active
        IFS=$' \t\n'

        LINES=( $(ps -eo cmd) )
        for line in ${LINES[@]}; do
            if [[ "${line}" == "${NVMESH_MGR_CMD}" ]]; then
                NVMESH_IS_NODE_PS_UP=1
                break
            fi
        done

        if [[ ${NVMESH_IS_NODE_PS_UP} -eq 0 ]]; then
            nvmeshmgr_is_enabled=$( systemctl is-enabled nvmeshmgr.service )
            [[ "${nvmeshmgr_is_enabled}" != "disabled" ]] && NVMESH_MGR_UNIT_STATUS=${nvmeshmgr_is_enabled}
            nvmeshmgr_is_active=$( systemctl is-active nvmeshmgr.service )
            [[ "${nvmeshmgr_is_active}" != "inactive" ]] && NVMESH_MGR_SERVICE_STATUS=${nvmeshmgr_is_active}
        fi
}


function check_nvmesh_nvmeshmgr_service() {
        nhc_nvmeshmgr_gather_data

        if [[ ${NVMESH_IS_NODE_PS_UP} -eq 0 ]] && [[ ${NVMESH_MGR_UNIT_STATUS} != '' ]] && [[ ${NVMESH_MGR_SERVICE_STATUS} != '' ]]; then
            should_report "nvmeshmgr_down"
            if [[ $? -eq ${NVMESH_NHC_TRUE} ]]; then
                die 1 "nvmeshmgr process is not running although the unit status is: ${NVMESH_MGR_UNIT_STATUS}, and the service status is: ${NVMESH_MGR_SERVICE_STATUS}"
                return 1
            fi
        fi

        return 0
}
