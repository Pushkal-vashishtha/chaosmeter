# chaosmeter

A chaos testing platform that runs controlled failure experiments against a
demo service, measures how the system degrades and recovers, and halts an
experiment automatically when it burns too much error budget.

Injection is the easy half. This project is about **measurement and safety**:
every experiment declares a steady-state hypothesis before it runs, is bounded
in blast radius and duration, and produces computed verdicts rather than
screenshots of spiking graphs.

## Status

Week 1 of 8. The target service and observability stack are running. The
control plane begins in week 3.

## Architecture

```
client → order-api → payment-svc
              ↓
         Postgres + Redis
```

| Component | Stack | Role |
| --- | --- | --- |
| `order-api` | Node 24, TypeScript, Fastify | The service under test. Carries the SLO. |
| `payment-svc` | Node 24, TypeScript, Fastify | Dependency with configurable latency and failure rate |
| Postgres 17 | | Order state |
| Redis 7 | | Read cache — failures tolerated |
| Prometheus 3.15.1 | | Metrics (week 2) |
| Grafana 13.2.4 | | Dashboards (week 2) |

## Running it

```bash
docker compose up -d --build
curl -X POST localhost:3000/orders \
  -H 'content-type: application/json' \
  -d '{"userId":"u1","amountCents":1999}'
```

## Service Level Objectives

Target service: `order-api`. These are what the platform measures against.

### SLI 1 — Latency

**Measured:** server-side duration of `POST /orders`, request received to
response sent.
**Source:** `http_request_duration_seconds` histogram (added week 2).
**Objective:** p95 < 150ms over a rolling 30-day window.

### SLI 2 — Availability

**Measured:** proportion of `POST /orders` returning a non-5xx status.
**Objective:** 99% success over a rolling 30-day window.
**Error budget:** 1% — about **7.2 hours** of total unavailability per 30
days, or 1 failed request in every 100.

### Baseline

n=100, sequential, idle host, client-side, 2026-10-27:

| min | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- |
| 57ms | 61ms | 70ms | 86ms | 86ms |

### Why 150ms

Roughly 2× the measured p95, chosen between two failure modes:

- **Too loose** (e.g. 400ms): experiments injecting several hundred ms of
  latency would never breach the objective, so the SLO produces no signal and
  the platform measures nothing.
- **Too tight** (e.g. 80ms): normal variance breaches it constantly, the
  objective gets ignored, and breach detection becomes noise.

To revisit in week 2, when latency is measured server-side via Prometheus
rather than from a PowerShell client, and after concurrent load testing. The
figures above include Docker port-forwarding and client overhead, so they
overstate what the service actually spends.

**Cold start:** the first request after container start measured 297ms, about
4× steady state — connection pool setup and JIT warm-up. This matters for
recovery measurement: a restarted service looks slower than it is for the
first few requests, and naive MTTR calculations will overstate recovery time.

### What the objectives are for

An experiment's steady-state hypothesis is "both SLIs stay within objective
during injection". A run breaching either is a hypothesis violation. Error
budget burn rate becomes the automatic abort condition in week 7.

## First result: latency threshold

Manual experiment, 2026-10-26. Dependency latency varied against a fixed
1000ms client timeout:

| Injected latency | Observed | Result |
| --- | --- | --- |
| 50ms (baseline) | ~300ms (cold) / 61ms (warm) | paid |
| 800ms | 886ms | paid, degraded |
| 1200ms | 1064ms | **failed** (timeout) |
| dependency stopped | 1228ms | **failed** (timeout) |

The service tolerates dependency latency to roughly 900ms and fails beyond it,
bounded by the client timeout rather than by the dependency.

**Stopping the container produces a hang, not a connection refusal.** Docker's
network accepts the connection with nothing listening behind it, so the request
waits for the full timeout. The timeout, not the operating system, is what
bounds that failure — which is precisely why the timeout exists.

## Deliberate choices

- **1000ms payment timeout** via `AbortSignal.timeout`. Node's `fetch` has no
  default timeout; without this, a slow or absent dependency hangs requests
  indefinitely and the service collapses instead of degrading.
- **Postgres pool capped at 10.** Bounded resources make failure legible: a
  slow database produces queueing and rising latency you can measure, rather
  than unbounded connection growth that masks the real signal.
- **Redis failures tolerated, Postgres failures not.** Cache down means slower;
  database down means wrong. `/readyz` reflects this — Postgres down is not
  ready, Redis down is still ready.
- **Order row written before the payment call.** After an experiment, "what
  happened to the in-flight requests?" must be answerable from the database
  rather than inferred.

## Known limitations

- No retry logic
- No circuit breaker
- No idempotency key — a retried request creates a duplicate order
- Insert and status update are not in a single transaction
- Dev-shaped Dockerfiles: no multi-stage build, runs as root, unpinned base
- Latency measured client-side, not server-side (week 2)
- Single-client sequential load only (concurrent testing week 2)

These are the week 6 backlog. Each one is a protection to add, re-run the same
experiment against, and measure the improvement in recovery time.

## Prior art

[Litmus](https://github.com/litmuschaos/litmus) (CNCF), [Chaos
Toolkit](https://chaostoolkit.org), [Netflix Chaos
Monkey](https://github.com/Netflix/chaosmonkey), AWS Fault Injection Service.
Litmus's experiment and result modelling informed the schema design here.
Vocabulary follows [principlesofchaos.org](https://principlesofchaos.org).



## Safety: two layers of limits

| Layer | Where | Can be changed by | Purpose |
| --- | --- | --- | --- |
| Schema ceiling | `ExperimentSpec` field constraints | Code change only | Absolute maximum. 300s duration, 3 targets. No deployment can exceed it. |
| Configured limit | `Settings`, from environment | Deployment config | Per-environment tightening. Currently 120s, 2 targets. |

The configured limit can only be **stricter** than the schema ceiling. A
misconfiguration can make the platform safer, never more dangerous — an
operator cannot set `MAX_EXPERIMENT_DURATION_SECONDS=86400` and run a
day-long experiment.

Verified: `duration_seconds: 200` passes schema validation and is rejected
by the safety layer; `9999` is rejected by the schema first.
### Measurement lesson: quantiles over mixed populations

An unfiltered p95 on `payment-svc` returned 9.8ms against a configured
50ms injected latency. The query was aggregating `/payments` together with
`/healthz`, which fires every 5s and returns in ~1ms. The health checks
outnumbered real traffic and dominated the quantile.

**A quantile computed over mixed route populations is meaningless.** The
measurement layer must filter every SLI query to its specific route.
Otherwise a burst of health-check traffic during an experiment will pull
p95 down and make a genuine SLO breach disappear from the data.