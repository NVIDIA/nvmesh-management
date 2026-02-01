#!/usr/bin/python3

import argparse
import os
import csv
import subprocess

parser = argparse.ArgumentParser(description='Util to generate certificates for nvmesh machines, using Hashicorp Vault')

parser.add_argument('--csv', type=str, help='Machines CSV file', required=True)

args = parser.parse_args()

with open(args.csv, newline='') as csvFile:
    reader = csv.reader(csvFile, delimiter=',')

    next(reader, None)

    for row in reader:
        if len(row) < 4:
            print ("Following row is missing information, expecting 4 columns and received {}. row: {}".format(len(row), row))

        hostname = row[0]
        ips = row[1].split(';')
        zone = row[2]
        components = row[3].split(';')

        print ("Creating certificates for hostname: {} with IPs: {}, in zone: {} for components: {}".format(hostname, ips, zone, components))

        try:
            commandArray = ['./generateMachineCertificates.py', '--hostname', hostname, '--ips', ','.join(ips), '--components']
            commandArray += components

            print('Command: {}'.format(' '.join(commandArray)))

            result = subprocess.run(commandArray, capture_output=True)

            print ('results: {}'.format(result))
        except Exception as e:
            print ('Failed to execute command. EX: {}'.format(e))




