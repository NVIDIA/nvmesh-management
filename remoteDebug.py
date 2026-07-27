#!/usr/bin/env python3

"""
===============================================================================
Remote Debug Script for NVMesh Management

Description: Remotely debug NVMesh management service by finding the process,
             sending debug signal, and creating SSH tunnel for debugging

Usage: ./remoteDebug.py [--gfn] <hostname>
  --gfn    Use ngnssh instead of ssh (for GFN environments)

Exit codes:
  0 - Success
  1 - Invalid arguments
  2 - Management service not found
  3 - SSH command failed
  4 - Debug signal failed
===============================================================================
"""

import sys
import os
import argparse
import subprocess
import re
import signal
import shutil
from typing import Optional, List

SCRIPT_NAME = os.path.basename(__file__)
DEBUG_PORT_LOCAL = 9221
DEBUG_PORT_REMOTE = 9229
MANAGEMENT_PROCESS_PATH = "/opt/nvmesh/management/app.js"
SSH_OPTIONS = ["-o", "StrictHostKeyChecking=no"]

ssh_cmd = "ssh"
use_gfn = False


def print_usage():
    usage_text = f"""Usage: {SCRIPT_NAME} [OPTIONS] <hostname>

Remote debug NVMesh management service on specified host.

OPTIONS:
    --gfn           Use ngnssh instead of ssh (for GFN environments)
    -h, --help      Show this help message

ARGUMENTS:
    hostname        Target hostname or IP address

EXAMPLES:
    {SCRIPT_NAME} server1.example.com
    {SCRIPT_NAME} --gfn gfn-node-01

EXIT CODES:
    0   Success
    1   Invalid arguments
    2   Management service not found
    3   SSH command failed
    4   Debug signal failed
"""
    print(usage_text)


def execute_remote_command(command: str, host: str) -> subprocess.CompletedProcess:
    """Execute remote command based on SSH type"""
    if use_gfn:
        cmd = [ssh_cmd, "-z", command, host]
    else:
        cmd = [ssh_cmd, host] + SSH_OPTIONS + [command]

    return subprocess.run(cmd, capture_output=True, text=True)


def get_management_pid(host: str) -> Optional[str]:
    """Get PID of management process on remote host"""
    pid_command = f"ps -ef | grep -v grep | grep {MANAGEMENT_PROCESS_PATH} | tr -s ' ' | cut -d' ' -f 2"

    print(f"Searching for management process on {host}...")

    try:
        result = execute_remote_command(pid_command, host)
        if result.returncode != 0:
            print(f"ERROR: Failed to execute remote command to find process", file=sys.stderr)
            sys.exit(3)

        pid = result.stdout.strip()

        # Validate PID (should be numeric and not empty)
        if not pid:
            print(f"ERROR: Management process not found on {host}", file=sys.stderr)
            sys.exit(2)
        elif not re.match(r'^\d+$', pid):
            print(f"ERROR: Invalid PID returned: '{pid}'", file=sys.stderr)
            sys.exit(2)

        return pid

    except Exception as e:
        print(f"ERROR: Failed to execute remote command: {e}", file=sys.stderr)
        sys.exit(3)


def send_debug_signal(pid: str, host: str) -> None:
    """Send debug signal to management process"""
    print(f"Sending USR1 signal to PID {pid} to enable debugging...")

    try:
        result = execute_remote_command(f"sudo kill -USR1 {pid}", host)
        if result.returncode != 0:
            print(f"ERROR: Failed to send debug signal to process {pid}", file=sys.stderr)
            print(f"Command output: {result.stderr}", file=sys.stderr)
            sys.exit(4)

        print("Debug signal sent successfully")

    except Exception as e:
        print(f"ERROR: Failed to send debug signal: {e}", file=sys.stderr)
        sys.exit(4)


def create_debug_tunnel(host: str) -> None:
    """Create SSH tunnel for debugging"""
    print(f"Creating SSH tunnel: localhost:{DEBUG_PORT_LOCAL} -> {host}:{DEBUG_PORT_REMOTE}")
    print(f"You can now connect your debugger to localhost:{DEBUG_PORT_LOCAL}")
    print("Press Ctrl+C to stop the tunnel")

    try:
        if use_gfn:
            cmd = [ssh_cmd, host, "-L", f"{DEBUG_PORT_LOCAL}:localhost:{DEBUG_PORT_REMOTE}"]
        else:
            cmd = [ssh_cmd, "-L", f"{DEBUG_PORT_LOCAL}:localhost:{DEBUG_PORT_REMOTE}", host]

        # This blocks until interrupted
        subprocess.run(cmd, check=True)

    except subprocess.CalledProcessError as e:
        if e.returncode != 130:
            print(f"ERROR: SSH tunnel failed with exit code {e.returncode}", file=sys.stderr)
        sys.exit(e.returncode)
    except KeyboardInterrupt:
        print("\nSSH tunnel stopped by user")
        sys.exit(0)
    except Exception as e:
        print(f"ERROR: Failed to create SSH tunnel: {e}", file=sys.stderr)
        sys.exit(3)


def parse_arguments() -> str:
    """Parse command line arguments"""
    global ssh_cmd, use_gfn

    parser = argparse.ArgumentParser(
        description="Remote debug NVMesh management service on specified host.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"""
EXAMPLES:
    {SCRIPT_NAME} server1.example.com
    {SCRIPT_NAME} --gfn gfn-node-01

EXIT CODES:
    0   Success
    1   Invalid arguments
    2   Management service not found
    3   SSH command failed
    4   Debug signal failed
"""
    )

    parser.add_argument(
        "--gfn",
        action="store_true",
        help="Use ngnssh instead of ssh (for GFN environments)"
    )

    parser.add_argument(
        "hostname",
        help="Target hostname or IP address"
    )

    try:
        args = parser.parse_args()
    except SystemExit as e:
        # argparse calls sys.exit() on error, catch it to use our exit code
        sys.exit(1)

    if args.gfn:
        ssh_cmd = "ngnssh"
        use_gfn = True

    # Basic hostname validation
    hostname = args.hostname.strip()
    if not hostname:
        print("ERROR: Hostname cannot be empty", file=sys.stderr)
        sys.exit(1)

    return hostname


def verify_ssh_command() -> None:
    """Verify SSH command is available"""
    if not shutil.which(ssh_cmd):
        print(f"ERROR: SSH command '{ssh_cmd}' not found in PATH", file=sys.stderr)
        if use_gfn:
            print("ERROR: Please ensure ngnssh is installed and accessible", file=sys.stderr)
        sys.exit(1)


def signal_handler(signum, frame):
    """Handle interrupt signals gracefully"""
    print("\nReceived interrupt signal, cleaning up...")
    sys.exit(0)


def main():
    """Main execution function"""
    # Set up signal handlers for graceful exit
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Parse command line arguments
    host = parse_arguments()

    # Verify SSH command exists
    verify_ssh_command()

    print("Starting remote debug session")
    print(f"Target host: {host}")
    print(f"SSH command: {ssh_cmd}")

    # Get management process PID
    pid = get_management_pid(host)
    print(f"Found management process with PID: {pid}")

    # Send debug signal
    send_debug_signal(pid, host)

    # Create SSH tunnel (this blocks until interrupted)
    create_debug_tunnel(host)


if __name__ == "__main__":
    main()
