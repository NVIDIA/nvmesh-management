# OpenTelemetry Collector Test Setup

This directory contains a Docker Compose setup for testing OpenTelemetry data collection.

## Components

- **otel-collector-contrib**: Receives OTLP data via HTTP/protobuf and exports to JSON files

## Usage

### Start the collector:
```bash
./run_collector.sh
```

This script will:
- Create the metrics directory and set proper permissions
- Initialize the output JSON files
- Start the collector container

### View logs:
```bash
docker compose logs -f
```

### Stop the collector:
```bash
docker compose down
```

## Configuration

- **OTLP HTTP Receiver**: Port 4318 (http://localhost:4318)
- **Output Directory**: `./metrics/` (mounted to `/output` in container)

## Output Files

The collector will write telemetry data to:
- `./metrics/metrics.json` - Metrics data
- `./metrics/traces.json` - Traces data
- `./metrics/logs.json` - Logs data

## Testing

Send OTLP data to `http://localhost:4318/v1/traces`, `http://localhost:4318/v1/metrics`, or `http://localhost:4318/v1/logs` to test the collector.

