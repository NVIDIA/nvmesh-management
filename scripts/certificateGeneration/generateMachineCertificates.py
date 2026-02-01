#!/usr/bin/python3

import argparse
import subprocess
import json
import os

parser = argparse.ArgumentParser(description='Util to generate certificates for nvmesh machine, using Hashicorp Vault')

parser.add_argument('--hostname', type=str, help='Machine hostname', required=True)
parser.add_argument('--ips', type=str, help='Comma separated machine IPs', required=True)
parser.add_argument('--zone', type=str, help='The nvmesh zone of the machine', default='1')
parser.add_argument('--components', nargs='+', choices=['TOMA', 'MCS', 'Management', 'Mongo', 'Kafka', 'Zookeeper', 'CLI', 'Monitor', 'Admin', 'Observer', 'UPGRADE_AGENT'], help='Component to create certificate for', required=True)
parser.add_argument('--intermediate-pki-path', type=str, default='pki_int', help='The certificates role\'s path in Vault')

args = parser.parse_args()

DEFAULT_ROLE_SUFFIX='nvmesh-dot-com'

def checkIfRoleExists(rolePath, component):
    results = subprocess.run(["vault", "read", rolePath, "--format=json"], capture_output=True)
    print('checkIfRoleExists return code: {}, stdout:{}'.format(results.returncode, results.stdout))

    return not bool(results.returncode)

def createRoleForComponent(rolePath, component):
    if checkIfRoleExists(rolePath, component):
        return True

    results = subprocess.run(['vault', 'write', rolePath, 'ou={}'.format(component), 'allowed_domains=mtl.labs.mlnx', 'allow_subdomains=true', 'allow_glob_domains=false', 'max_ttl=730d'], capture_output=True)

    print('Create role return code: {}, stdout: {}'.format(results.returncode, results.stdout))

def getRolePath(rolePath, command, component):
    return '{}/{}/{}-{}'.format(rolePath, command, component, DEFAULT_ROLE_SUFFIX)

for component in args.components:
    if component == 'TOMA':
        component = 'zone{}.{}'.format(args.zone, component)

    createRoleForComponent(getRolePath(args.intermediate_pki_path, 'roles', component), component)

    rolePath = getRolePath(args.intermediate_pki_path, 'issue', component)

    results = subprocess.run(["vault", "write","-format=json", rolePath, 'common_name={}'.format(args.hostname), 'ip_sans={}'.format(args.ips), 'ttl=365d'], capture_output=True)
    jsonResults = json.loads(results.stdout)

    if not os.path.exists(args.hostname):
        os.mkdir(args.hostname)

    with open(os.path.join(args.hostname, '{}.crt'.format(component)), 'a') as out:
        out.write(jsonResults['data']['certificate'] + '\n')

    with open(os.path.join(args.hostname, '{}.key'.format(component)), 'a') as out:
        out.write(jsonResults['data']['private_key'] + '\n')

