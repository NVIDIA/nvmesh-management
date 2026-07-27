#!/bin/bash

hostsFile=/etc/hosts

echo '' > ~/.ssh/known_hosts

index=0
percentage=0
numberOfLines=$(cat "$hostsFile" | wc -l)

while IFS='' read -r line || [[ -n "$line" ]]; do
	IFS='	 ' read -r -a hostArray <<< "$line"
	for host in "${hostArray[@]}"
	do
		(timeout 0.2s nc -z "$host" 22 && ssh-keyscan "$host") >> ~/.ssh/known_hosts 2> /dev/null
	done
	index=$(($index+1))
	percentage=$(($index*100/$numberOfLines))
	printf " Scanning hosts file: $index/$numberOfLines($percentage%%)\r"
done < "$hostsFile"
