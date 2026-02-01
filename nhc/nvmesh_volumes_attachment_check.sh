#!/usr/bin/env bash
# NHC -- Validates that the passed volumes are attached and IO enabled on this node.

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

source /etc/nhc/scripts/nvmesh_nhc_cache.sh

declare NVMESH_DETACHED_VOLUMES=''
declare NVMESH_IO_DISABLED_VOLUMES=''

function nhc_volumes_attached_gather_data() {
    local volumes="$@"
    local nvmesh_volumes_proc='/proc/nvmeibc/volumes/'

    for volume in $volumes; do
        if [[ ! -d ${nvmesh_volumes_proc}${volume} ]]; then
            NVMESH_DETACHED_VOLUMES+="${volume} "
        else
            IFS=$':'
            while read -a LINE; do
                if [[ "${LINE[0]}" == "\"status\"" ]]; then
                    [[ "${LINE[1]}" != "\"Live, with IO\"," ]] && NVMESH_IO_DISABLED_VOLUMES+="${volume} "
                    break
                fi
            done < ${nvmesh_volumes_proc}${volume}/status.json
            IFS=$' \t\n'
        fi
    done
}


function check_nvmesh_volumes_attached() {
        local volumes="$@"
        nhc_volumes_attached_gather_data $volumes

        for volume in $NVMESH_DETACHED_VOLUMES; do
            should_report "volume_${volume}_detached"
            if [[ $? -eq ${NVMESH_NHC_TRUE} ]]; then
                die 1 "NVMesh volume '${volume}' is detached."
                return 1
            fi
        done

        for volume in $NVMESH_IO_DISABLED_VOLUMES; do
            should_report "volume_${volume}_io_disabled"
            if [[ $? -eq ${NVMESH_NHC_TRUE} ]]; then
                die 1 "NVMesh volume '${volume}' is attached, but IO is disabled."
                return 1
            fi
        done

        return 0
}
