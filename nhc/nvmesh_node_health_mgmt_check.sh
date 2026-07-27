#!/usr/bin/env bash
# NHC -- Excelero - Node health check from the management perspective
#
# /***************************************************************************
#  * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
#  *
#  * This file is part of Excelero NVMesh software.
#  *
#  * Unauthorized copying of this file, via any medium is strictly prohibited
#  * Proprietary and confidential
#  ****************************************************************************/
source /etc/nhc/scripts/nvmesh_nhc_cache.sh

export NVMESH_CONF='/etc/opt/NVMesh/nvmesh.conf'
export NVMESH_IS_CONVERGED=1
export NVMESH_CLIENT_HEALTH=''
export NVMESH_TARGET_HEALTH=''
export NVMESH_GOT_HEALTH=0

function nhc_nvmesh_node_health_gather_data_from_mgmt() {
        local protocol
        local mgmt_servers
        local hostname
        local response
        local health_status
        local connect_timeout=1
        local id_field='_id'
        local cookie='/etc/opt/NVMesh/mgmt_cookie'
        local is_cookie_set=0
        local check_name='check_nvmesh_node_health_from_mgmt'

        if [[ ! -f ${NVMESH_CONF} ]]; then
                echo "${check_name}: ${NVMESH_CONF} file is missing."
        else
            read hostname < /proc/sys/kernel/hostname

            IFS=$'='
            while read -a LINE; do
                if [[ "${LINE[0]}" == "MANAGEMENT_PROTOCOL" ]]; then
                    protocol=${LINE[1]}
                    protocol=${protocol//\"/}
                elif [[ "${LINE[0]}" == "MANAGEMENT_SERVERS" ]]; then
                    mgmt_servers=${LINE[1]}
                    mgmt_servers=${mgmt_servers//\"/}
                    mgmt_servers=${mgmt_servers//,/ }
                    mgmt_servers=${mgmt_servers//4001/4000}
                fi
            done < ${NVMESH_CONF}
            IFS=$' \t\n'

            for mgmt_server in $mgmt_servers; do
                [[ ${NVMESH_GOT_HEALTH} -eq 1 ]] && break

                response=$( curl -s -k -X POST -H "Content-type: application/x-www-form-urlencoded" -d "username=admin&password=admin" \
                --cookie-jar ${cookie} --max-time ${connect_timeout} "${protocol}://${mgmt_server}/login" )

                if [[ $? -ne 0 ]]; then
                    echo "${check_name}: Failed to get response from management: ${mgmt_server}"
                    continue
                fi

                if [[ $response =~ (success)\":([^,]*) ]]; then
                    [[ ${BASH_REMATCH[1]} == "success" ]] && [[ ${BASH_REMATCH[2]} == "true" ]] && [[ -f ${cookie} ]] && is_cookie_set=1
                fi

                if [[ ${is_cookie_set} -eq 0 ]]; then
                    echo "${check_name}: Could not set cookie to connect to management: ${mgmt_server}, response: ${response}"
                    continue
                else
                    for entities in clients servers; do
                        [[ "${entities}" == "servers" ]] && id_field='node_id'

                        response=$( curl -s -k -X GET -H "Content-type: application/json" -H "Accept: application/json" \
                        --cookie ${cookie} --max-time ${connect_timeout} \
                        "${protocol}://${mgmt_server}/${entities}/all/0/0?filter=%7B\"${id_field}\":\"${hostname}\"%7D&projection=%7B\"health\":1,\"_id\":0%7D" )

                        if [[ $? -ne 0 ]]; then
                            echo "${check_name}: Failed to get response from management: ${mgmt_server}"
                            continue
                        fi

                        if [[ "${entities}" == "servers" ]] && [[ "${response}" == "[]" ]]; then
                            NVMESH_IS_CONVERGED=0
                        else
                            health_status=${response#[{\"}
                            health_status=${health_status%\"\}]}
                            health_status=${health_status//\"/}

                            if [[ $health_status =~ (health):([^,]*) ]]; then
                                if [[ "${BASH_REMATCH[1]}" != "health" ]]; then
                                    echo "${check_name}: Got unexpected response when querying for ${entities} health, response: ${response}"
                                    continue
                                elif [[ ${entities} == "clients" ]]; then
                                    NVMESH_CLIENT_HEALTH=${BASH_REMATCH[2]}
                                else
                                    NVMESH_TARGET_HEALTH=${BASH_REMATCH[2]}
                                fi
                            fi
                        fi

                        if [[ "${NVMESH_CLIENT_HEALTH}" != '' ]]; then
                            if [[ ${NVMESH_IS_CONVERGED} -eq 0 ]]; then
                                NVMESH_GOT_HEALTH=1
                            else
                                [[ "${NVMESH_TARGET_HEALTH}" != '' ]] && NVMESH_GOT_HEALTH=1
                            fi
                        fi
                    done
                fi
            done

            [[ ${is_cookie_set} -eq 1 ]] && rm -f ${cookie}
        fi
}


function check_nvmesh_node_health_from_mgmt() {
        nhc_nvmesh_node_health_gather_data_from_mgmt

        if [[ ${NVMESH_GOT_HEALTH} -eq 0 ]]; then
            should_report "failed_gather_data_from_mgmt"
            if [[ $? -eq ${NVMESH_NHC_TRUE} ]]; then
                die 1 "Failed to gather data from the management server. Check nhc log for more information."
                return 1
            fi
        else
            if [[ "${NVMESH_CLIENT_HEALTH}" != "healthy" ]]; then
                should_report "mgmt_client_not_healthy"
                if [[ $? -eq ${NVMESH_NHC_TRUE} ]]; then
                    die 1 "The client node is not healthy as reported by NVMesh Management, client health: ${NVMESH_CLIENT_HEALTH}"
                    return 1
                fi
            fi
            if [[ ${NVMESH_IS_CONVERGED} -eq 1 ]] && [[ "${NVMESH_TARGET_HEALTH}" != "healthy" ]]; then
                should_report "mgmt_target_not_healthy"
                if [[ $? -eq ${NVMESH_NHC_TRUE} ]]; then
                    die 1 "The target node is not healthy as reported by NVMesh Management, target health: ${NVMESH_TARGET_HEALTH}"
                    return 1
                fi
            fi
        fi

        return 0
}