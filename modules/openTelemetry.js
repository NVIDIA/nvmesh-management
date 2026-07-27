const { NodeSDK } = require('@opentelemetry/sdk-node');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-proto');
const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { BatchSpanProcessor, TraceIdRatioBasedSampler, ParentBasedSampler } = require('@opentelemetry/sdk-trace-base');
const { metrics } = require('@opentelemetry/api');
const config = require('./config.js');
const { versions } = require('./version.js');
const winston = require('winston');
const { OpenTelemetryTransportV3 } = require('@opentelemetry/winston-transport');
const consts = require('../consts.js');

/**
 * openTelemtry module should not require other business logic modules
 * meters should be set up here and this module should be required in other modules to control the meters
 */

const scope = {
	sdk: null,

	// Meters include multiple counters, gauges and histograms
	meters: {},

	// Counters / Gauges / Histograms
	metrics: {},
};

scope.isOpenTelemetryEnabled = config.get('openTelemetry.enabled') || false;
scope.isAutoInstrumentationEnabled = scope.isOpenTelemetryEnabled && config.get('openTelemetry.autoInstrumentation.enabled') || false;
scope.isMetricsEnabled = scope.isOpenTelemetryEnabled && config.get('openTelemetry.metrics.enabled') || false;
scope.isTracesEnabled = scope.isOpenTelemetryEnabled && config.get('openTelemetry.traces.enabled') || false;
scope.isLogsEnabled = false;
scope.otelBooststrapLog = console.log;

function createResource() {
	const resourceAttributes = {
		'service.name': consts.components.MANAGEMENT,
		'service.version': versions.rpmVersion,
		'service.namespace': 'nvmesh',
	};

	const userAttributes = config.get('openTelemetry.resourceAttributes') || {};
	Object.assign(resourceAttributes, userAttributes);
	return resourceFromAttributes(resourceAttributes);
}

scope.startInstrumentation = async() => {
	const resource = createResource();

	// metrics options
	const metricsUrl = config.get('openTelemetry.metrics.endpoint');
	const metricExporter = new OTLPMetricExporter({ url: metricsUrl });
	const metricReader = scope.isMetricsEnabled ? new PeriodicExportingMetricReader({
		exporter: metricExporter,
		exportIntervalMillis: config.get('openTelemetry.metrics.interval')
	}) : null;

	// traces options
	const traceUrl = config.get('openTelemetry.traces.endpoint');
	const traceExporter = scope.isTracesEnabled ? new OTLPTraceExporter({ url: traceUrl }) : null;
	const traceBatchSpanProcessorOptions = config.get('openTelemetry.traces.batchSpanProcessorOptions') || {};
	const traceSampleRatio = config.get('openTelemetry.traces.sampleRatio');

	// ParentBasedSampler is used to filter traces based on the root span
	// This is used so that TraceIdRatioBasedSampler doesn't filter random child spans, but only complete root spans
	const sampler = new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(traceSampleRatio) });
	const spanProcessors = traceExporter ? [new BatchSpanProcessor(traceExporter, traceBatchSpanProcessorOptions)] : [];

	// logs options
	const logUrl = config.get('openTelemetry.logs.endpoint');
	const logExporter = scope.isLogsEnabled ? new OTLPLogExporter({ url: logUrl }) : null;
	const logBatchProcessorOptions = config.get('openTelemetry.logs.batchLogProcessorOptions') || {};
	const logRecordProcesssor = logExporter ? new BatchLogRecordProcessor(logExporter, logBatchProcessorOptions) : null;

	// Auto-Instrumentation options
	const autoInstrumentationsConfig = config.get('openTelemetry.autoInstrumentation.options') || {};
	const instrumentations = [];

	if (scope.isAutoInstrumentationEnabled)
		instrumentations.push(getNodeAutoInstrumentations(autoInstrumentationsConfig));

	scope.sdk = new NodeSDK({
		resource: resource,
		sampler: sampler,
		traceExporter: traceExporter,
		spanProcessors: spanProcessors,
		metricReader: metricReader,
		logRecordProcessor: logRecordProcesssor,
		instrumentations: instrumentations,
	});

	await scope.sdk.start();
	scope.otelBooststrapLog('OpenTelemetry SDK started');
};

scope.stopInstrumentation = async() => {
	if (scope.sdk) {
		try {
			scope.otelBooststrapLog('Stopping OpenTelemetry SDK...');
			await scope.sdk.shutdown();
			scope.otelBooststrapLog('OpenTelemetry SDK stopped');
		} catch (error) {
			scope.otelBooststrapLog(`Error stopping OpenTelemetry SDK: ${error.message}`);
		}
	}
};

scope.setupCustomMetrics = () => {
	if (!scope.isMetricsEnabled)
		return;

	scope.meterProvider = metrics.getMeterProvider();
	scope.createKafkaMetrics();
	scope.createDbLockMetrics();
};

scope.createKafkaMetrics = () => {
	// Register a meter for Kafka metrics
	scope.meters.kafkaMeter = scope.meterProvider.getMeter('kafka-metrics');

	scope.metrics.kafkaMessagesInProcessGauge = scope.meters.kafkaMeter.createObservableGauge('kafka_messages_in_process', {
		description: 'Number of Kafka messages currently being processed'
	});

	scope.metrics.kafkaIsConsumerPausedGauge = scope.meters.kafkaMeter.createObservableGauge('kafka_is_consumer_paused', {
		description: 'Whether the Kafka consumer is paused'
	});
};

scope.createDbLockMetrics = () => {
	// Register a meter for DbLock metrics
	scope.meters.dbLockMeter = scope.meterProvider.getMeter('db-lock-metrics');

	scope.metrics.dbLockQueueSize = scope.meters.dbLockMeter.createObservableGauge('db_lock_queue_size', {
		description: 'Size of the queue waiting for the db lock'
	});
};

function createLogger() {
	const logger = winston.createLogger({
		transports: [
			new OpenTelemetryTransportV3({
				level: config.get('openTelemetry.logs.level') || 'debug',
				endpoint: config.get('openTelemetry.logs.endpoint'),
				interval: config.get('openTelemetry.logs.interval'),
				format: winston.format.combine(
					winston.format.timestamp(),
					winston.format.errors({ stack: true }),
					winston.format.json(),
				),
			}),
		],
	});
	return logger;
}

scope.init = () => {
	if (scope.isOpenTelemetryEnabled) {
		scope.otelBooststrapLog('OpenTelemetry is enabled.');
		scope.otelBooststrapLog('OpenTelemetry features:\n'
			+ `\tTraces: ${scope.isTracesEnabled}\n`
			+ `\tMetrics: ${scope.isMetricsEnabled}\n`
			+ `\tLogs: ${scope.isLogsEnabled}\n`
			+ `\tAuto-instrumentation: ${scope.isAutoInstrumentationEnabled}`);

		scope.startInstrumentation();

		if (scope.isLogsEnabled)
			scope.otelLogger = createLogger();

		if (scope.isMetricsEnabled)
			scope.setupCustomMetrics();
	} else {
		scope.otelBooststrapLog('OpenTelemetry is disabled');
	}
};

module.exports = scope;