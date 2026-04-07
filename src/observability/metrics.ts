// src/observability/metrics.ts
// Prometheus metrics registry using prom-client.
// Exposed at GET /metrics — scraped by Prometheus every 15s.
//
// Metrics:
//   http_requests_total              — HTTP counter by method/route/status
//   http_request_duration_seconds    — HTTP latency histogram
//   http_requests_in_flight          — active requests gauge
//   payment_requests_total           — payment operation counter
//   payment_success_total            — successful payment counter
//   payment_failure_total            — failed payment counter
//   request_duration_seconds         — payment-specific duration histogram
//   order_service_requests_total     — outgoing calls to order-service
//   order_service_request_duration   — order-service call latency

import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from "prom-client";
import { env } from "../config/env";

export const register = new Registry();

// Default Node.js/process metrics (CPU, memory, event loop lag, GC)
collectDefaultMetrics({
  register,
  labels: { service: env.SERVICE_NAME, version: env.SERVICE_VERSION },
});

// ── HTTP Metrics ──────────────────────────────────────────────────────────────

export const httpRequestsTotal = new Counter({
  name:       "http_requests_total",
  help:       "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers:  [register],
});

export const httpRequestDurationSeconds = new Histogram({
  name:       "http_request_duration_seconds",
  help:       "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets:    [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers:  [register],
});

export const httpRequestsInFlight = new Gauge({
  name:       "http_requests_in_flight",
  help:       "Number of HTTP requests currently being processed",
  labelNames: ["method", "route"],
  registers:  [register],
});

// ── Payment Business Metrics ──────────────────────────────────────────────────

export const paymentRequestsTotal = new Counter({
  name:       "payment_requests_total",
  help:       "Total number of payment requests (QR generation)",
  labelNames: ["operation", "status"], // operation: create_qr|confirm|check, status: success|failure
  registers:  [register],
});

export const paymentSuccessTotal = new Counter({
  name:       "payment_success_total",
  help:       "Total number of successful payment confirmations",
  registers:  [register],
});

export const paymentFailureTotal = new Counter({
  name:       "payment_failure_total",
  help:       "Total number of failed payment operations",
  labelNames: ["reason"], // reason: expired|not_found|already_paid|order_validation
  registers:  [register],
});

export const requestDurationSeconds = new Histogram({
  name:       "request_duration_seconds",
  help:       "Payment operation duration in seconds",
  labelNames: ["operation"],
  buckets:    [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers:  [register],
});

export const paymentAmountHistogram = new Histogram({
  name:    "payment_amount_rupiah",
  help:    "Distribution of payment amounts in IDR",
  buckets: [10000, 50000, 100000, 250000, 500000, 1000000, 5000000],
  registers: [register],
});

// ── Inter-Service Metrics (order-service calls) ───────────────────────────────

export const orderServiceRequestsTotal = new Counter({
  name:       "order_service_requests_total",
  help:       "Total number of outgoing HTTP requests to order-service",
  labelNames: ["method", "status", "status_code"],
  registers:  [register],
});

export const orderServiceRequestDurationSeconds = new Histogram({
  name:       "order_service_request_duration_seconds",
  help:       "Duration of outgoing HTTP requests to order-service",
  labelNames: ["method"],
  buckets:    [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers:  [register],
});
