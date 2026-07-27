#!/bin/bash


if [[ ($# == 0) ||  "$1" =~ ^(-h|--help)$ ]] ; then
        echo -e "The util will restore a db to the management database \n"
        echo -e $"Usage: $0 <db-path>\n"
        echo "Example: './restoreDB.sh dump/management'"
        exit 0
fi


echo "Going to restore $1"

mongosh management clearDB.js ; mongorestore --db management $1 --drop ; mongosh management --eval 'db.managementCluster.deleteMany({})'

