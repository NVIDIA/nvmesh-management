#!/usr/bin/python3

import argparse
import subprocess
import json
import os

parser = argparse.ArgumentParser(description='Util to generate certificates for nvmesh machine, using Hashicorp Vault')

parser.add_argument('--hostname', type=str, help='Machine hostname', required=True)
parser.add_argument('--ips', type=str, help='Comma separated machine IPs', required=True)
parser.add_argument('--zone', type=str, help='The nvmesh zone of the machine', default='1')
parser.add_argument('--components', nargs='+', choices=['TOMA', 'MCS', 'Management', 'Mongo', 'Kafka', 'Zookeeper', 'CLI', 'Monitor', 'Admin', 'Observer', 'UPGRADE_AGENT', 'CSI'], help='Component to create certificate for', required=True)
parser.add_argument('--intermediate-pki-path', type=str, default='pki_int', help='The certificates role\'s path in Vault')
parser.add_argument('--ttl', type=str, default='365d', help='The TTL for the certificate')
parser.add_argument('--max-ttl', type=str, default='730d', help='The max TTL for the certificate')

args = parser.parse_args()

DEFAULT_ROLE_SUFFIX='nvmesh-dot-com'

def run_command(command):
    print(f'Running command: {" ".join(command)}')
    results = subprocess.run(command, capture_output=True, check=False)
    print(f'run_command return code: {results.returncode}, stdout:{results.stdout}, stderr:{results.stderr}')
    return results

def checkIfRoleExists(rolePath, component):
    results = run_command(["vault", "read", rolePath, "--format=json"])
    print('checkIfRoleExists return code: {}, stdout:{}'.format(results.returncode, results.stdout))

    return not bool(results.returncode)

def createRoleForComponent(rolePath, component):
    if checkIfRoleExists(rolePath, component):
        return True

    subjectOU = component if component != 'CSI' else 'csi@nvidia.com'
    results = run_command(['vault', 'write', rolePath, f'ou={subjectOU}', 'allowed_domains=mec01.nbulabs.nvidia.com', 'allow_subdomains=true', 'allow_glob_domains=false', f'max_ttl={args.max_ttl}'])

    print(f'Create role return code: {results.returncode}, stdout: {results.stdout}')

def getRolePath(rolePath, command, component):
    return '{}/{}/{}-{}'.format(rolePath, command, component, DEFAULT_ROLE_SUFFIX)

for component in args.components:
    if component == 'TOMA':
        component = 'zone{}.{}'.format(args.zone, component)

    createRoleForComponent(getRolePath(args.intermediate_pki_path, 'roles', component), component)

    rolePath = getRolePath(args.intermediate_pki_path, 'issue', component)

    results = run_command(["vault", "write","-format=json", rolePath, f'common_name={args.hostname}', f'ip_sans={args.ips}', f'ttl={args.ttl}'])
    try:
        jsonResults = json.loads(results.stdout)
    except json.JSONDecodeError as e:
        print('Failed to parse JSON: {}'.format(e))
        print('stdout: {}'.format(results.stdout))
        exit(1)

    if not os.path.exists(args.hostname):
        os.mkdir(args.hostname)

    with open(os.path.join(args.hostname, '{}.crt'.format(component)), 'a') as out:
        out.write(jsonResults['data']['certificate'] + '\n')

    with open(os.path.join(args.hostname, '{}.key'.format(component)), 'a') as out:
        out.write(jsonResults['data']['private_key'] + '\n')

