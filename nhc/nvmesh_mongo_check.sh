#!/usr/bin/env bash
# NHC -- MongoDB checks

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

source /etc/nhc/scripts/nvmesh_nhc_cache.sh

declare NVMESH_MONGO_REPLICA_SET_MEMBER_STATE=''
declare NVMESH_IS_MONGO_SERVICE_ACTIVE=0
declare NVMESH_IS_MONGO_SERVICE_ENABLED=0

function nhc_mongodb_gather_data() {
        local index_of_mgmt_db
        local replication_status

        if [[ $( systemctl is-enabled mongod.service ) == "enabled" ]]; then
            NVMESH_IS_MONGO_SERVICE_ENABLED=1

            if [[ $( systemctl is-active mongod.service ) == "active" ]]; then
                NVMESH_IS_MONGO_SERVICE_ACTIVE=1
                index_of_mgmt_db=$( mongosh localhost:27017 --eval 'rs.secondaryOk(); db.getMongo().getDBNames().indexOf("management")' --quiet )
                replication_status=$( mongosh management --eval 'rs.secondaryOk(); rs.status().codeName' --quiet )

                if [[ ${index_of_mgmt_db} -ge 0 ]] && [[ ${replication_status} != "NoReplicationEnabled" ]]; then
                    NVMESH_MONGO_REPLICA_SET_MEMBER_STATE=$( mongosh management --eval 'rs.status().myState' --quiet )
                fi
            fi
        fi
}


function check_nvmesh_mongodb() {
        declare -A NVMESH_MONGO_STATES=( [0]='STARTUP' [1]='PRIMARY' [2]='SECONDARY' [3]='RECOVERING' [5]='STARTUP2' [6]='UNKNOWN' [7]='ARBITER' [8]='DOWN' [9]='ROLLBACK' [10]='REMOVED' )
        local healthy_replica_states="PRIMARY SECONDARY ARBITER"

        nhc_mongodb_gather_data

        if [[ ${NVMESH_IS_MONGO_SERVICE_ENABLED} -eq 1 ]] && [[ ${NVMESH_IS_MONGO_SERVICE_ACTIVE} -eq 0 ]]; then
            should_report "mongo_down"
            if [[ $? -eq ${NVMESH_NHC_TRUE} ]]; then
                die 1 "mongod service is enabled but not active."
                return 1
            fi
        elif [[ ${NVMESH_MONGO_REPLICA_SET_MEMBER_STATE} ]] && [[ ! " $healthy_replica_states "  =~ .*\ "${NVMESH_MONGO_STATES[$NVMESH_MONGO_REPLICA_SET_MEMBER_STATE]}"\ .*  ]]; then
            should_report "mongo_rs_state"
            if [[ $? -eq ${NVMESH_NHC_TRUE} ]]; then
                die 1 "This node is a member of a mongoDB replica set and its state is: ${NVMESH_MONGO_STATES[$NVMESH_MONGO_REPLICA_SET_MEMBER_STATE]}"
                return 1
            fi
        fi

        return 0
}
