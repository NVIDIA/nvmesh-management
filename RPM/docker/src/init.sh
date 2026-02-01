#!/bin/sh

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0


finish() {
  echo "Shutting Down NVMesh-Management"
  /opt/nvmesh/management/services/nvmeshmgr stop
  echo "NVMesh-Management Stopped"
  exit 0
}

trap finish INT TERM

echo "Started with Config: $CONFIG"

# Update config from environment variables
node ./update_mgmt_config.js

add_customer_id() {
  if [ ! -z "$CUSTOMER_ID" ];then
    node /opt/nvmesh/management/scripts/add_cluster_identification.js "{ \"customerID\": \"$CUSTOMER_ID\" }"
  fi
}

start_management() {
  # Start Management
  /opt/nvmesh/management/services/nvmeshmgr start &
  wait $!
  exit_code=$?
  if [ "$exit_code" -eq 0 ]; then
    echo "NVMesh-Management Started"
  else
    echo "Error Starting Management Server." 1>&2
    echo "Error running /opt/nvmesh/management/services/nvmeshmgr start exit_code=$exit_code" 1>&2

    if [ ! "${DEBUG}"]; then
      exit $exit_code
    fi
  fi

  # print logs to stdout to make the logs available using `docker logs` command
  tail -f /var/log/nvmesh/management.out &
}

add_customer_id
start_management

while true
do
  sleep 60 &
  wait $!
done
