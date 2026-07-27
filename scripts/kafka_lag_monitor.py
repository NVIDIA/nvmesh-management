#!/usr/bin/env python3
import subprocess
import time
import json
import sys
import re
import argparse
from collections import defaultdict
from datetime import datetime

REFRESH_INTERVAL = 5
HISTORY_LOG_FILE = "kafka_lag_history.log"
STALE_THRESHOLD_SECONDS = 240
RATE_W = 11

COLORS = [
    "\033[1;31m",  # bold bright red
    "\033[1;32m",  # bold bright green
    "\033[1;33m",  # bold bright yellow
    "\033[1;34m",  # bold bright blue
    "\033[1;35m",  # bold bright magenta
    "\033[1;36m"   # bold bright cyan
]
RESET_COLOR = "\033[0m"
RED_BOLD = "\033[1;31m"

previous_state = {}
consumer_colors = {}
last_full_output = ""
color_index = 0

def strip_ansi_codes(text):
    ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
    return ansi_escape.sub('', text)

def log_history(message):
    with open(HISTORY_LOG_FILE, "a") as f:
        f.write(f"{datetime.now().isoformat()} - {strip_ansi_codes(message)}\n")

def get_consumer_group_info(kafka_command):
    try:
        result = subprocess.run(
            kafka_command.split(),
            capture_output=True,
            text=True,
            check=True,
            timeout=10
        )
        return result.stdout
    except FileNotFoundError:
        print(f"Error: The command '{kafka_command.split()[0]}' was not found.")
        return None
    except subprocess.CalledProcessError as e:
        print(f"Error executing Kafka command: {e}\nStderr: {e.stderr}")
        return None
    except subprocess.TimeoutExpired as e:
        print(f"Error: Kafka command timed out after {e.timeout}s.")
        return None

def parse_output(output):
    parsed_data = []
    lines = output.strip().split('\n')

    def to_int(value):
        try:
            return int(value)
        except (ValueError, TypeError):
            return 0

    for line in lines:
        parts = line.split()

        if len(parts) < 7:
            continue

        try:
            partition_num = int(parts[2])
        except ValueError:
            continue

        parsed_data.append({
            'group': parts[0],
            'topic': parts[1],
            'partition': partition_num,
            'current_offset': to_int(parts[3]),
            'log_end_offset': to_int(parts[4]),
            'lag': to_int(parts[5]),
            'consumer_id': parts[6] if len(parts) > 6 else 'N/A'
        })

    return parsed_data


def compute_column_widths(current_data):
    max_group_w = max([len(str(d['group'])) for d in current_data] + [5])
    max_topic_w = max([len(str(d['topic'])) for d in current_data] + [5])
    max_part_w = max([len(str(d['partition'])) for d in current_data] + [4])
    max_offset_w = max([len(str(d['current_offset'])) for d in current_data] + [14])
    max_log_end_w = max([len(str(d['log_end_offset'])) for d in current_data] + [14])
    max_lag_w = max([len(str(d['lag'])) for d in current_data] + [3])

    return {
        'group': max_group_w,
        'topic': max_topic_w,
        'part': max_part_w,
        'offset': max_offset_w,
        'log_end': max_log_end_w,
        'lag': max_lag_w
    }


def build_header(widths):
    header = (
        f"{'GROUP':<{widths['group']}}  "
        f"{'TOPIC':<{widths['topic']}}  "
        f"{'PART':<{widths['part']}}  "
        f"{'CURRENT-OFFSET':<{widths['offset'] + RATE_W + 1}}  "
        f"{'LOG-END-OFFSET':<{widths['log_end'] + RATE_W + 1}}  "
        f"{'LAG':<{widths['lag'] + RATE_W + 1}}  CONSUMER-ID"
    )
    return header


def compute_row_state(item, prev_item, elapsed_time, current_time):
    current_offset_int = item['current_offset']
    log_end_offset_int = item['log_end_offset']
    lag_int = item['lag']

    is_stagnant = (
        current_offset_int == prev_item.get('current_offset', -1) and
        item['consumer_id'] == prev_item.get('consumer_id') and
        item['consumer_id'] != 'N/A'
    )
    last_updated = prev_item.get('last_updated_time', current_time) if is_stagnant else current_time
    is_stale = is_stagnant and lag_int > 0 and (current_time - last_updated > STALE_THRESHOLD_SECONDS)

    offset_indicator, _ = get_change_indicator(current_offset_int, prev_item.get('current_offset', 0), elapsed_time)
    log_end_indicator, _ = get_change_indicator(log_end_offset_int, prev_item.get('log_end_offset', 0), elapsed_time)
    lag_indicator, _ = get_change_indicator(lag_int, prev_item.get('lag', 0), elapsed_time)

    return {
        'current_offset': current_offset_int,
        'log_end_offset': log_end_offset_int,
        'lag': lag_int,
        'is_stale': is_stale,
        'last_updated_time': last_updated,
        'offset_indicator': offset_indicator,
        'log_end_indicator': log_end_indicator,
        'lag_indicator': lag_indicator
    }


def format_row(item, row_state, widths, consumer_color):
    group_str = f"{str(item['group']):<{widths['group']}}"
    topic_plain = f"{str(item['topic']):<{widths['topic']}}"
    part_plain = f"{str(item['partition']):<{widths['part']}}"

    if row_state['is_stale']:
        topic_str = f"{RED_BOLD}{topic_plain}{RESET_COLOR}"
        part_str = f"{RED_BOLD}{part_plain}{RESET_COLOR}"
    else:
        topic_str = topic_plain
        part_str = part_plain

    current_off_str = f"{str(row_state['current_offset']):>{widths['offset']}} {row_state['offset_indicator']:<{RATE_W}}"
    log_end_off_str = f"{str(row_state['log_end_offset']):>{widths['log_end']}} {row_state['log_end_indicator']:<{RATE_W}}"
    lag_str = f"{str(row_state['lag']):>{widths['lag']}} {row_state['lag_indicator']:<{RATE_W}}"

    line = (
        f"{group_str}  {topic_str}  {part_str}  "
        f"{current_off_str}  {log_end_off_str}  {lag_str}  "
        f"{consumer_color}{item['consumer_id']}{RESET_COLOR}"
    )
    return line


def get_change_indicator(current, previous, elapsed_time):
    if not isinstance(current, (int, float)) or not isinstance(previous, (int, float)) or elapsed_time == 0:
        return "", "stable"
    if current > previous:
        rate = (current - previous) / elapsed_time
        return f"⬆️ {rate:.2f}/s", "up"
    elif current < previous:
        rate = (previous - current) / elapsed_time
        return f"⬇️ {rate:.2f}/s", "down"
    else:
        return "", "stable"

def assign_color(consumer_id):
    global color_index
    if consumer_id not in consumer_colors:
        consumer_colors[consumer_id] = COLORS[color_index % len(COLORS)]
        color_index += 1
    return consumer_colors[consumer_id]

def check_for_rebalance(current_data, previous_data):
    current_assignments = {f"{d['topic']}-{d['partition']}": d['consumer_id'] for d in current_data}
    previous_assignments = {key: value['consumer_id'] for key, value in previous_data.items()}
    return current_assignments != previous_assignments

def parse_args():
    parser = argparse.ArgumentParser(description="Monitor Kafka consumer group lag.")
    parser.add_argument('--bootstrap-server', default="localhost:9092", help="The Kafka bootstrap server(s) to connect to.")
    parser.add_argument('--group', default="managements-group", help="The consumer group to describe.")
    parser.add_argument('--config', help="Path to the consumer group command config file.")
    parser.add_argument('--kafka-path', default="/opt/kafka/bin/", help="Path to the Kafka bin directory.")
    return parser.parse_args()

def build_kafka_command(args):
    kafka_command_parts = [
        f"{args.kafka_path}kafka-consumer-groups.sh",
        "--bootstrap-server", args.bootstrap_server,
        "--describe",
        "--group", args.group
    ]

    if args.config:
        kafka_command_parts.extend(["--command-config", args.config])

    return " ".join(kafka_command_parts)

def main():
    args = parse_args()
    kafka_command = build_kafka_command(args)

    global previous_state, last_full_output
    last_run_time = time.time()

    while True:
        output = get_consumer_group_info(kafka_command)

        if output is None:
            print("\033[H\033[2J", end="")
            print(f"No output from Kafka command. Retrying in {REFRESH_INTERVAL}s...")
            sys.stdout.flush()
            time.sleep(REFRESH_INTERVAL)
            continue

        current_data = parse_output(output)
        current_time = time.time()
        elapsed_time = current_time - last_run_time
        rebalance_detected = False

        if previous_state:
            rebalance_detected = check_for_rebalance(current_data, previous_state)

        if not current_data:
            print("\033[H\033[2J", end="")
            print("No valid data parsed from Kafka output. Retrying...")
            if output.strip():
                preview = "\n".join(output.strip().split("\n")[:5])
                print(f"Kafka output (first lines):\n{preview}")
            sys.stdout.flush()
            time.sleep(REFRESH_INTERVAL)
            continue

        output_lines = [f"--- Kafka Consumer Group Lag Monitor ({datetime.now().strftime('%Y-%m-%d %H:%M:%S')}) ---"]

        widths = compute_column_widths(current_data)
        header = build_header(widths)
        output_lines.append(header)
        output_lines.append("-" * len(header))

        current_state_for_next_iteration = {}
        stale_events_to_log = []

        for item in sorted(current_data, key=lambda x: (x['topic'], x['partition'])):
            partition_key = f"{item['topic']}-{item['partition']}"
            prev_item = previous_state.get(partition_key, {})
            row_state = compute_row_state(item, prev_item, elapsed_time, current_time)

            if row_state['is_stale'] and not prev_item.get('was_stale_in_last_run', False):
                stale_events_to_log.append(f"STALE PARTITION DETECTED: Topic={item['topic']}, Partition={item['partition']}, Lag={row_state['lag']}")

            color = assign_color(item['consumer_id'])
            line = format_row(item, row_state, widths, color)

            output_lines.append(line)

            current_state_for_next_iteration[partition_key] = {
                'current_offset': row_state['current_offset'],
                'log_end_offset': row_state['log_end_offset'],
                'lag': row_state['lag'],
                'consumer_id': item['consumer_id'],
                'last_updated_time': row_state['last_updated_time'],
                'was_stale_in_last_run': row_state['is_stale']
            }

        full_output = "\n".join(output_lines)

        if rebalance_detected:
            log_history("Rebalance detected!")
            log_history("--- Screen Before Rebalance ---\n" + last_full_output)
            log_history("--- Screen After Rebalance ---\n" + full_output)

        if stale_events_to_log:
            for event in stale_events_to_log:
                log_history(event)
            log_history("--- Screen at time of detection ---\n" + full_output)

        print("\033[H\033[2J", end="")
        print(full_output)
        sys.stdout.flush()

        previous_state = current_state_for_next_iteration
        last_run_time = current_time
        last_full_output = full_output

        time.sleep(REFRESH_INTERVAL)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nExiting monitor.")
