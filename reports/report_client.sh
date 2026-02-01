#!/bin/bash

cd "$(dirname "$0")"
f="/tmp/nvmesh_client_management_report.json"
management_server=""
sleep_time=30

if [ $# -gt 0 ] ; then
	management_server=$1
fi

while true
do
	hostname=`hostname`

	lsmod_nvmeibc=`lsmod | grep nvmeibc`

	MANAGEMENT_SERVER=""
	if [[ -n $management_server ]] ; then
		MANAGEMENT_SERVER=$management_server
	else
		if [ -e ../config/nvmesh_management_server.sh ] ; then
			source ../config/nvmesh_management_server.sh
		fi
		if [ -e /etc/nvmesh_management_server.sh ] ; then
			source /etc/nvmesh_management_server.sh
		fi
	fi
	if [[ -z $MANAGEMENT_SERVER ]] ; then
		echo "No management server defined..."
		sleep $sleep_time
		continue
	fi

	if [ -n "$lsmod_nvmeibc" ]; then
		client_status=1
	else
		client_status=2
	fi

	echo "" > $f
	echo "{" >> $f
	echo "	\"client\" : {\"clientID\" : \"$hostname\", \"client_status\" : $client_status," >> $f
	echo "	\"block_devices\" : {" >> $f

	if [ $client_status == 1 ] && [ -e /proc/nvmeibc/volumes ]; then
		for bd in /proc/nvmeibc/volumes/* ; do
			if [ ! -e $bd ]; then
				continue
			fi
			uuid=`grep UUID= $bd | cut -d= -f2`
			timed=`grep time= $bd | cut -d= -f2`
			read_ops=`grep read_ops= $bd | cut -d= -f2`
			read_size=`grep read_size= $bd | cut -d= -f2`
			read_latency=`grep read_latency= $bd | cut -d= -f2`
			write_ops=`grep write_ops= $bd | cut -d= -f2`
			write_size=`grep write_size= $bd | cut -d= -f2`
			write_latency=`grep write_latency= $bd | cut -d= -f2`
			trim_ops=`grep trim_ops= $bd | cut -d= -f2`
			trim_size=`grep trim_size= $bd | cut -d= -f2`
			trim_latency=`grep trim_latency= $bd | cut -d= -f2`
			echo -n "		\"$uuid\" : {
				\"time\" : \"$timed\",
				\"read_ops\" : \"$read_ops\",
				\"read_size\" : \"$read_size\",
				\"read_latency\" : \"$read_latency\",
				\"write_ops\" : \"$write_ops\",
				\"write_size\" : \"$write_size\",
				\"write_latency\" : \"$write_latency\",
				\"trim_ops\" : \"$trim_ops\",
				\"trim_size\" : \"$trim_size\",
				\"trim_latency\" : \"$trim_latency\",
				\"last\" : \"last\"
			}" >> $f
			echo "," >> $f
		done
	fi
	echo "		\"last\" : \"last \" }" >> $f
	echo "	}" >> $f
	echo "}" >> $f

	cat $f

	curl http://10.0.255.240:3001/login --cookie-jar cookie -d "username=tomzan@mail.com&password=1" > /dev/null
        curl --cookie cookie http://10.0.255.240:3001/volumes/report -H 'Content-Type: application/json' -H 'Accept: application/json' -d @"$f"

	echo ""

	sleep $sleep_time
done
