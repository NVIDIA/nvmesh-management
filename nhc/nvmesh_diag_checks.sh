#!/usr/bin/env bash
# NHC -- Reports about errors found with nvmesh_diag

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

source /etc/nhc/scripts/nvmesh_nhc_cache.sh

declare NVMESH_DIAG_RUN=0
declare -a NVMESH_DIAG_ERRORS=( )

function nhc_nvmesh_diag_gather_data() {
    local nvmesh_diag=$( which nvmesh_diag )
    local index=0

    if [[ $? -eq 0 ]]; then
        ${nvmesh_diag}  > /dev/null 2>&1

        if [[ $? -eq 0 ]]; then
            NVMESH_DIAG_RUN=1

            while read -a LINE; do
                IFS=$' \t\n'

                if [[ "${LINE[3]}" == "ERROR" ]];then
                    [[ ${LINE[4]} == "" ]] && continue
                    NVMESH_DIAG_ERRORS[$index]=${LINE[@]:4:${#LINE[*]}}
                    ((index++))
                fi
            done < nvmesh_diag.log

            rm -f nvmesh_diag.log
            rm -f *_nvmesh_diag_output.txt
        fi

    fi
}


function check_nvmesh_diag() {
        declare -a reported_errors=( )
        local nvmesh_diag_errors
        local err_hash
        local nvmesh_diag_error
        local is_issue_reported=0
        local index=0

        nhc_nvmesh_diag_gather_data

        if [[ ${NVMESH_DIAG_RUN} -ne 1 ]]; then
            should_report "failed_to_run_nvmesh_diag"
            if [[ $? -eq ${NVMESH_NHC_TRUE} ]]; then
                die 1 "Failed to run nvmesh_diag"
                return 1
            fi
        elif [[ ${#NVMESH_DIAG_ERRORS[*]} -ne 0 ]]; then
            # should_report "nvmesh_diag_errors"
            # if [[ $? -eq ${NVMESH_NHC_TRUE} ]]; then
            #     nvmesh_diag_errors=$( IFS=$'\n'; echo "${NVMESH_DIAG_ERRORS[*]}" )
            #     die 1 "nvmesh_diag errors: ${nvmesh_diag_errors}"
            #     return 1

            # fi
            for ((i=0; i<${#NVMESH_DIAG_ERRORS[*]}; i++)); do
                nvmesh_diag_error=${NVMESH_DIAG_ERRORS[$i]}
                err_hash=$( echo $nvmesh_diag_error | md5sum )
                err_hash=${err_hash/  -/}

                should_report "nvmesh_diag_error_${err_hash}"
                if [[ $? -eq ${NVMESH_NHC_TRUE} ]]; then
                    is_issue_reported=1
                    reported_errors[$index]=${nvmesh_diag_error}
                    ((index++))
                fi
            done

            if [[ ${is_issue_reported} -eq 1 ]]; then
                nvmesh_diag_errors=$( IFS=$'\n'; echo "${reported_errors[*]}" )
                die 1 "nvmesh_diag error: ${nvmesh_diag_errors}"
                return 1
            fi
        fi

        return 0
}
