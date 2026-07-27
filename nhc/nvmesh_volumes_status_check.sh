#!/usr/bin/env bash
# NHC -- Excelero - Ensures that all the volumes which are attached longer than 30 seconds are IO enabled.
# /***************************************************************************
#  * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
#  *
#  * This file is part of Excelero NVMesh software.
#  *
#  * Unauthorized copying of this file, via any medium is strictly prohibited
#  * Proprietary and confidential
#  ****************************************************************************/
source /etc/nhc/scripts/nvmesh_nhc_cache.sh

declare NVMESH_IO_DISABLED_VOLUMES=''

function nhc_volumes_status_gather_data() {
    local nvmesh_volumes_proc='/proc/nvmeibc/volumes/'
    local volumes=$( ls ${nvmesh_volumes_proc} )
    local is_hidden_attach
    local attachment_up_time

    for volume in $volumes; do
        if [[ -d ${nvmesh_volumes_proc}${volume} ]]; then
            is_hidden_attach=0

            IFS=$':'
            while read -a LINE; do
                if [[ "${LINE[0]}" == "\"type\"" ]]; then
                    [[ ! "${LINE[1]}" =~ "\"visible\","* ]] && is_hidden_attach=1
                    break
                fi
            done < ${nvmesh_volumes_proc}${volume}/status.json

            [[ ${is_hidden_attach} -eq 1 ]] && continue

            IFS=$'='
            while read -a LINE; do if [[ "${LINE[0]}" == "up_time" ]]; then attachment_up_time=${LINE[1]}; break; fi; done < ${nvmesh_volumes_proc}${volume}/iostats
            attachment_up_time=${attachment_up_time/.*/}

            if [[ ${attachment_up_time} -gt 30 ]]; then
                IFS=$':'
                while read -a LINE; do
                    if [[ "${LINE[0]}" == "\"status\"" ]]; then
                        [[ "${LINE[1]}" != "\"Live, with IO\"," ]] && NVMESH_IO_DISABLED_VOLUMES+="${volume} "
                        break
                    fi
                done < ${nvmesh_volumes_proc}${volume}/status.json
            fi

            IFS=$' \t\n'
        fi
    done
}


function check_nvmesh_volumes_status() {
        nhc_volumes_status_gather_data

        for volume in $NVMESH_IO_DISABLED_VOLUMES; do
            should_report "volumes_status_volume_${volume}_io_disabled"
            if [[ $? -eq ${NVMESH_NHC_TRUE} ]]; then
                die 1 "Volumes status: NVMesh volume '${volume}' is attached, but IO is disabled."
                return 1
            fi
        done

        return 0
}