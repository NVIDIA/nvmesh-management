#!/bin/bash

if [ `id -un` != "root" ] ; then
        echo "This script needs to run as root."
        exit 1
fi

cd "$(dirname "$0")"
f="/tmp/nvmesh_server_management_report.json"
management_server=""
sleep_time=30

if [ $# -gt 0 ] ; then
	management_server=$1
fi

last_diskid=0
set_diskid() {
	diskids[$last_diskid]=$1
	serial_numbers[$last_diskid]=$2
	last_diskid=$(($last_diskid + 1))
}

get_diskid() {
	diskid=0
	while [ $diskid -lt $last_diskid ] ; do
		if [ x${diskids[diskid]} ==  x$1 ] ; then
			echo -n ${serial_numbers[diskid]}
			break
		fi
		diskid=$(($diskid + 1))
	done
	echo
}

while true ; do
	declare -a diskids
	declare -a serial_numbers

	hostname=`hostname`

	lsmod_nvmeibs=`lsmod | grep nvmeibs`

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

	if [ -n "$lsmod_nvmeibs" ] ; then
		node_status=1
	else
		node_status=2
	fi

	echo "" > $f
	echo "{" >> $f
	echo "	\"node\" : {\"node_id\" : \"$hostname\", \"node_status\" : $node_status," >> $f
	echo "	\"nics\" : [" >> $f

	files=/proc/nvmeibs/smart*
	for x in $files
	do
		if [ -e "$x" ]; then
			diskid=`grep 'Serial Number' $x | cut -d= -f2`
			if [ -n "$diskid" ]
			then
				set_diskid "$diskid".1 "$x"
			fi
		fi
	done

	info=`cat /proc/nvmeibs/disk_info`
	if [ -n "$info" ]; then
		nic=`echo $info | cut -c1`
		# TODO: sanity check that $nic == 'N'

		nnics=`echo $info | cut -d'|' -f1 | cut -c2-`
		info=`echo $info | cut -d'|' -f2-`
		while [[ $nnics > 0 ]]; do
			nports=`echo $info | cut -d'|' -f1 | cut -c2-`
			info=`echo $info | cut -d'|' -f2-`
			while [[ $nports > 0 ]]; do
				nic_info=`echo $info | cut -d'|' -f1`
				info=`echo $info | cut -d'|' -f2-`

				guid=`echo $nic_info | cut -d, -f1`
				pkey=`echo $nic_info | cut -d, -f3`
				nic_type=`echo $nic_info | cut -d, -f4`
				nic_type_value=2
				if [[ $nic_type == 'I' ]]; then
					nic_type_value=1
				fi
				nic_state=`echo $nic_info | cut -d, -f5`
				nic_state_value=2
				if [[ $nic_state == 'ACTIVE' ]]; then
					nic_state_value=1
				fi
				echo -n "			{\"nicID\": \"$guid\",\"protocol\" : $nic_type_value, \"status\" : $nic_state_value, \"guid\" : \"$guid\", \"pkey\" : \"$pkey\", \"speed\" : 1, \"pci_root\" : 1}" >> $f
				nports=$((nports-1))
				if [[ $nports > 0 ]]; then
					echo -n "," >> $f
				else
					if [[ $nnics > 1 ]]; then
						echo -n "," >> $f
					fi
				fi
				echo "" >> $f
			done
			nnics=$((nnics-1))
		done

		echo "	]," >> $f
		echo "	\"disks\" : [" >> $f

		disk=`echo $info | cut -c1`
		# TODO: sanity check that $disk == 'D'

		ndisks=`echo $info | cut -d'|' -f1 | cut -c2-`
		info=`echo $info | cut -d'|' -f2-`
		while [[ $ndisks > 0 ]]; do
			disk_info=`echo $info | cut -d'|' -f1`
			info=`echo $info | cut -d'|' -f2-`

			disk_id=`echo $disk_info | cut -d, -f1`
			blocks=`echo $disk_info | cut -d, -f2`
			blocksize=`echo $disk_info | cut -d, -f3`
			maxdmablocks=`echo $disk_info | cut -d, -f4`

			status_file=$(get_diskid $disk_id)
			status_items=""
			if [ -n "$status_file" ] && [ -e "$status_file" ]
			then
				for value in `sed 's/ /_/g' $status_file`
				do
					key=`echo $value | cut -d= -f1`
					value=`echo $value | cut -d= -f2`
					if [[ X"$key" != "Serial Number" ]]
					then
						status_items="$status_items, \"$key\" : \"$value\""
					fi
				done
			fi

			echo -n "		{\"diskID\": \"$disk_id\", \"protocol\" : 1, \"blocks\" : $blocks, \"block_size\" : $blocksize, \"max_dma_blocks\" : $maxdmablocks, \"status\" : 1, \"pci_root\" : 1 $status_items}" >> $f
			ndisks=$((ndisks-1))
			if [[ $ndisks > 0 ]]; then
				echo -n "," >> $f
			fi
			echo "" >> $f
		done
	fi
	echo "		]" >> $f
	echo "	}" >> $f
	echo "}" >> $f

	cat $f

	curl http://10.0.255.240:3001/login --cookie-jar cookie -d "username=tomzan@mail.com&password=1" > /dev/null
	curl --cookie cookie http://10.0.255.240:3001/servers/report -H 'Content-Type: application/json' -H 'Accept: application/json' -d @"$f"
	echo ""
	echo $f

	unset DISKIDS[@]

	sleep $sleep_time
done
