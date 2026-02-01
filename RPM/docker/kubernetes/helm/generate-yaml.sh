#!/bin/bash

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

DEPLOYMENT_FILE_PATH="./deployment.yaml"
RELEASE_NAME=nvmesh-management
NAMESPACE=nvmesh

args=$@

run_template() {
    helm template $RELEASE_NAME -n $NAMESPACE $@ ../helm/nvmesh-management
}

build_deployment_file() {
    run_template $@ > $DEPLOYMENT_FILE_PATH

    if [ $? -ne 0 ]; then
        echo "Error building deployment.yaml file"
        exit 1
    fi
}

create_partial_yaml_file() {
    from_file=$1
    output=$2
    shift
    shift
    run_template $@ | sed -n -e '/\# Source: nvmesh-management\/templates\/'$from_file'/,/---/ p' > $output
    echo "Created $output"
}

generate_example_files() {

    # MongoDB examples
    create_partial_yaml_file mongo-replicaset.yaml ../examples/mongo/mongo-rs.yaml --set mongo.deploy=true --set mongo.replicas=3

    # Ingress
    create_partial_yaml_file ingress.yaml ../examples/ingress/replica-ingress.yaml --set replicas=3

    create_partial_yaml_file ingress.yaml ../examples/ingress/single-mgmt-ingress.yaml --set replicas=1

    # TLS Secrets example
    create_partial_yaml_file tls-secret.yaml ../examples/ingress/ingress-tls-secret.yaml

    # Services
    create_partial_yaml_file services.yaml ../examples/services/services-single-mgmt.yaml --set replicas=1

    create_partial_yaml_file services.yaml ../examples/services/services-mgmt-replica.yaml --set replicas=3


    # Management StatefulSet
    create_partial_yaml_file statefulset.yaml ../examples/management/default.yaml --set replicas=3

    create_partial_yaml_file statefulset.yaml ../examples/management/shared-bakcups-storage.yaml --set replicas=3 --set backupsVolume.sharedStorage=true

    # Management ConigMap
    create_partial_yaml_file configmap.yaml ../examples/management/configmap-single-mongo.yaml --set mongo.deploy=true --set mongo.replicas=1

    create_partial_yaml_file configmap.yaml ../examples/management/configmap-mongo-replica.yaml --set mongo.deploy=true --set mongo.replicas=3
}

generate_example_files $args
#build_deployment_file $args
