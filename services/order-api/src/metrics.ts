import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpRequestsTotal = new Counter({
    name: "http_requests_total",
    help: "Total HTTP requests",
    labelNames: ["method", "route", "status_code"] as const,
    registers: [registry],
});

export const httpRequestDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status_code"] as const,
    // Boundary at 0.15 is the SLO threshold, so breach detection is exact
    // rather than interpolated. Measured baseline p95 is 70ms.
    buckets: [0.005, 0.01, 0.015, 0.02, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.5, 0.8, 1.0, 1.5, 2.0, 5.0],
    registers: [registry],
});

export const dependencyRequestsTotal = new Counter({
    name: "dependency_requests_total",
    help: "Calls to downstream dependencies by outcome",
    labelNames: ["dependency", "outcome"] as const,
    registers: [registry],
});

export const dependencyDuration = new Histogram({
    name: "dependency_request_duration_seconds",
    help: "Downstream dependency call duration in seconds",
    labelNames: ["dependency"] as const,
    buckets: [0.025, 0.05, 0.1, 0.2, 0.5, 0.8, 1.0, 1.2, 2.0],
    registers: [registry],
});