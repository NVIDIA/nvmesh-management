#!/usr/bin/env python3
import argparse
import subprocess
import os
import tempfile
import re
import shutil
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import sys


def run_cmd(cmd, error_msg, host=None):
    """Run shell command with error handling."""
    try:
        subprocess.run(cmd, shell=True, check=True)
    except subprocess.CalledProcessError as e:
        prefix = f"[{host}] " if host else ""
        print(f"[ERROR] {prefix}{error_msg}: {e}")
        return False
    except Exception as e:
        prefix = f"[{host}] " if host else ""
        print(f"[ERROR] {prefix}Unexpected error: {e}")
        return False
    return True

def build_journalctl_command(since, until, remote_file, grep_pattern):
    journal_cmd = "sudo journalctl"
    if since:
        journal_cmd += f" --since '{since}'"
    if until:
        journal_cmd += f" --until '{until}'"
    if not since and not until:
        journal_cmd += " -n 10000"
    journal_cmd += f" | grep {grep_pattern} > {remote_file}"
    return journal_cmd

def ssh_and_collect(host, remote_file, since, until, grep_pattern, ssh_cmd_template):
    journal_cmd = build_journalctl_command(since, until, remote_file, grep_pattern)
    safe_cmd = journal_cmd.replace('"', '\\"')
    ssh_cmd = ssh_cmd_template.format(cmd=safe_cmd, host=host)
    print(f"[INFO] Collecting logs from {host}...")
    if run_cmd(ssh_cmd, "Failed to collect logs", host=host):
        return host
    return None

def scp_logs(host, remote_file, local_dir, scp_cmd_template):
    local_file = os.path.join(local_dir, f"{host}.log")
    scp_cmd = scp_cmd_template.format(host=host, remote_file=remote_file, local_file=local_file)
    print(f"[INFO] Downloading logs from {host}...")
    if run_cmd(scp_cmd, "Failed to scp logs", host=host):
        return local_file
    return None

def parse_log_time(line):
    match = re.match(r'^([A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}:\d{2})', line)
    if not match:
        return None
    try:
        return datetime.strptime(match.group(1), "%b %d %H:%M:%S")
    except ValueError:
        return None

def merge_and_sort_logs(log_files, output_file):
    all_lines = []
    for file in log_files:
        if not file or not os.path.exists(file):
            print(f"[WARN] Skipping missing log file: {file}")
            continue
        try:
            with open(file, 'r') as f:
                all_lines.extend(f.readlines())
        except Exception as e:
            print(f"[ERROR] Failed to read {file}: {e}")
    if not all_lines:
        print("[ERROR] No logs collected, nothing to merge.")
        return
    try:
        all_lines.sort(key=lambda line: parse_log_time(line) or datetime.min)
        with open(output_file, 'w') as out:
            out.writelines(all_lines)
        print(f"[INFO] Combined logs saved to {output_file}")
    except Exception as e:
        print(f"[ERROR] Failed to merge logs: {e}")

def main():
    parser = argparse.ArgumentParser(description="Collect and merge logs from cluster machines.")
    parser.add_argument("cluster_name", nargs="?", help="Cluster name prefix (ignored if --machines is used)")
    parser.add_argument("num_machines", nargs="?", type=int, default=5, help="Number of machines (default: 5, ignored if --machines is used)")
    parser.add_argument("--machines", help="Comma-separated list of specific machines, e.g., XXX-01,XXX-06")
    parser.add_argument("--since", help="Start time for logs (journalctl format)")
    parser.add_argument("--until", help="End time for logs (journalctl format)")
    parser.add_argument("--grep", default="nvmeshmgr", help="String to grep for in logs (default: nvmeshmgr)")
    parser.add_argument("--output", default="combined_gfn_logs.log", help="Final merged log file")
    parser.add_argument("--no-parallel", action="store_true", help="Disable parallel execution")
    parser.add_argument("--use-ssh", action="store_true", help="Use standard ssh/scp instead of ngnssh/ngnscp")
    parser.add_argument("--separate-logs", action="store_true", help="Save logs separately per machine instead of combining")

    args = parser.parse_args()

    try:
        tmp_dir = tempfile.mkdtemp()
    except Exception as e:
        print(f"[FATAL] Failed to create temporary directory: {e}")
        sys.exit(1)

    remote_tmp_file = "/tmp/tmp_journal.log"

    # Choose SSH/SCP templates
    if args.use_ssh:
        ssh_template = 'ssh {host} "{cmd}"'
        scp_template = 'scp {host}:{remote_file} {local_file}'
    else:
        ssh_template = 'ngnssh -z "{cmd}" {host}'
        scp_template = 'ngnscp {host}:{remote_file} {local_file}'

    # Determine hosts
    if args.machines:
        hosts = [m.strip() for m in args.machines.split(",") if m.strip()]
    else:
        if not args.cluster_name:
            parser.error("Either cluster_name or --machines must be provided")
        hosts = [f"{args.cluster_name}-{i:02d}" for i in range(1, args.num_machines + 1)]

    # Step 1: Collect logs (parallel if allowed)
    collected_hosts = []
    if args.no_parallel:
        print("[INFO] Collecting logs sequentially...")
        for host in hosts:
            if ssh_and_collect(host, remote_tmp_file, args.since, args.until, args.grep, ssh_template):
                collected_hosts.append(host)
    else:
        print("[INFO] Collecting logs in parallel...")
        with ThreadPoolExecutor(max_workers=min(8, len(hosts))) as executor:
            futures = {
                executor.submit(ssh_and_collect, host, remote_tmp_file, args.since, args.until, args.grep, ssh_template): host
                for host in hosts
            }
            for future in as_completed(futures):
                host = futures[future]
                try:
                    if future.result():
                        collected_hosts.append(host)
                except Exception as e:
                    print(f"[ERROR] Unexpected error during log collection from {host}: {e}")

    # Step 2: Download logs
    downloaded_files = []
    if args.no_parallel:
        print("[INFO] Downloading logs sequentially...")
        for host in collected_hosts:
            f = scp_logs(host, remote_tmp_file, tmp_dir, scp_template)
            if f:
                downloaded_files.append(f)
    else:
        print("[INFO] Downloading logs in parallel...")
        with ThreadPoolExecutor(max_workers=min(8, len(collected_hosts))) as executor:
            futures = {
                executor.submit(scp_logs, host, remote_tmp_file, tmp_dir, scp_template): host
                for host in collected_hosts
            }
            for future in as_completed(futures):
                try:
                    f = future.result()
                    if f:
                        downloaded_files.append(f)
                except Exception as e:
                    print(f"[ERROR] Unexpected parallel download error: {e}")

    # Step 3: Save logs
    if args.separate_logs:
        for file in downloaded_files:
            try:
                base = os.path.basename(file).replace(".log", "_logs.log")
                final_path = os.path.join(".", base)
                shutil.move(file, final_path)
                print(f"[INFO] Saved separate log file: {final_path}")
            except Exception as e:
                print(f"[ERROR] Failed to move {file}: {e}")
    else:
        merge_and_sort_logs(downloaded_files, args.output)

    # Step 4: Cleanup temp dir
    try:
        shutil.rmtree(tmp_dir)
    except Exception as e:
        print(f"[WARN] Failed to clean up temp dir {tmp_dir}: {e}")

if __name__ == "__main__":
    main()
