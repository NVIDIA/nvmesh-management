#!/bin/bash

managementconffile="/etc/nvmesh/management.js.conf"
MDIR=/opt/nvmesh/management
libraries=$MDIR/libraries
compatiblenode=$libraries/node

# this is a duplicate of the same function in services/nvmeshmgr service file
init_nodeuse() {
	nodetouse=""
	if [ -e "$compatiblenode" ] ; then
		nodetouse=$compatiblenode
	else
		nodetouse=node
	fi
}

# this is a duplicate of the same function in services/nvmeshmgr service file
getFieldFromManagementConfig() {
    val=$(node --eval "var config = require(\"$managementconffile\"); console.log(config.$1)")
    if [ "${val}" == "undefined" ]; then
        val=""
    fi
    echo ${val}
}

# this is a duplicate of the same function in services/nvmeshmgr service file
getMongoShellCommandLineArguments() {
	local confName=$1
	local forMongoDump=$2

	commandLineArguments=$($nodetouse --eval "console.log(require('$MDIR/modules/mongoCMDLineArgsBuilder.js').buildMongoConnectionCommandlineArgsByConnectionName('$confName', '$forMongoDump'))")
}

# this is a duplicate of the same function in services/nvmeshmgr service file
fetch_management_cluster_from_config() {
	if [ -e "$managementconffile" ]; then
		getMongoShellCommandLineArguments "mongoConnection"
		mongoManagementCommandLineArguments=$commandLineArguments

		getMongoShellCommandLineArguments "nvmeshMetadataMongoConnection"
		mongoNVMeshMetadataCommandLineArguments=$commandLineArguments

		getMongoShellCommandLineArguments "mongoConnection" true
		mongoManagementCommandLineArgumentsForMongoDump=$commandLineArguments

		getMongoShellCommandLineArguments "nvmeshMetadataMongoConnection" true
		mongoNVMeshMetadataCommandLineArgumentsForMongoDump=$commandLineArguments
	else
		echo "Could not find $managementconffile file"
		exit 1
	fi
}

alert_on_failed() {
	retval=$?
	if [ $retval -ne 0 ]; then
	        # print error to stderr
        	>&2 echo "Error: error running $SCRIPT_FILENAME on all of $MONGO_SERVERS_STRING"
		exit 1
	fi
}

init_nodeuse
# this call will create the variable mongoManagementCommandLineArguments or exit upon failure
fetch_management_cluster_from_config

# use expmple: runMongoScript path/to/script.js
runMongoScript() {
    SCRIPT_FILENAME=$1

    #running the given upgrade script for the DB
    mongosh $mongoManagementCommandLineArguments $SCRIPT_FILENAME
    alert_on_failed $?

    return 0
}

if [ ! -z "$1" ] && [ "$1" == "getMongoManagementCommandLineArguments" ]; then
	if [ ! -z "$mongoManagementCommandLineArguments" ]; then
		echo -e "\n$mongoManagementCommandLineArguments"
		exit 0
	else
		echo -e "\nError: cannot generate DB command line arguments"
		exit 1
	fi
elif [ ! -z "$1" ] && [ "$1" == "getMongoNVMeshMetadataCommandLineArguments" ]; then
	if [ ! -z "$mongoNVMeshMetadataCommandLineArguments" ]; then
		echo -e "\n$mongoNVMeshMetadataCommandLineArguments"
		exit 0
	else
		echo -e "\nError: cannot generate DB Metadata command line arguments"
		exit 1
	fi
elif [ ! -z "$1" ] && [ "$1" == "getMongoManagementCommandLineArgumentsForMongoDump" ]; then
	if [ ! -z "$mongoManagementCommandLineArgumentsForMongoDump" ]; then
		echo -e "\n$mongoManagementCommandLineArgumentsForMongoDump"
		exit 0
	else
		echo -e "\nError: cannot generate DB command line arguments for mongodump"
		exit 1
	fi
elif [ ! -z "$1" ] && [ "$1" == "getMongoNVMeshMetadataCommandLineArgumentsForMongoDump" ]; then
	if [ ! -z "$mongoNVMeshMetadataCommandLineArgumentsForMongoDump" ]; then
		echo -e "\n$mongoNVMeshMetadataCommandLineArgumentsForMongoDump"
		exit 0
	else
		echo -e "\nError: cannot generate DB Metadata command line arguments for mongodump"
		exit 1
	fi
fi

