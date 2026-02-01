#!/bin/bash

# chown and chmod the directory
mkdir -p ./metrics/
chmod -R 700 ./metrics/
chown -R $(id -u):$(id -g) ./metrics/

# create the files or clear all data from them
echo "" > ./metrics/metrics.json
echo "" > ./metrics/traces.json
echo "" > ./metrics/logs.json


# Get current user ID and group ID
export USER_ID=$(id -u)
export GROUP_ID=$(id -g)

docker compose down && docker compose up -d