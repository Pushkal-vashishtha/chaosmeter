import Fastify from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { registry, httpRequestsTotal, httpRequestDuration } from "./metrics.js";

const PORT = Number(process.env.PORT ?? 3002);
const LATENCY_MS = Number(process.env.PAYMENT_LATENCY_MS ?? 50);
const FAILURE_RATE = Number(process.env.PAYMENT_FAILURE_RATE ?? 0);
const app = Fastify({ logger: true });

app.addHook("onResponse", async (req, reply) => {
    const route = req.routeOptions?.url ?? "unknown";
    const labels = {
        method: req.method,
        route,
        status_code: String(reply.statusCode),
    };
    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, reply.elapsedTime / 1000);
});

app.get("/metrics", async (_req, reply) => {
    reply.header("content-type", registry.contentType);
    return registry.metrics();
});

const PaymentRequest = z.object({
    orderId: z.string().uuid(),
    amountCents: z.number().int().positive(),
});


app.get("/healthz", async () => ({ status: "ok" }));


app.post("/payments", async (req, reply) => {
    const parsed = PaymentRequest.safeParse(req.body);
    if (!parsed.success) {
        return reply.code(400).send({
            error: "invalid_request",
            detail: parsed.error.issues
        });
    }
    // Knob 1: artificial latency, applied before any work.
    if (LATENCY_MS > 0) await sleep(LATENCY_MS);
    // Knob 2: synthetic failure.
    if (Math.random() < FAILURE_RATE) {
        req.log.warn({ orderId: parsed.data.orderId }, "synthetic payment failure");
        return reply.code(500).send({ error: "payment_provider_error" });
    }
    return reply.code(201).send({
        paymentRef: `pay_${randomUUID()}`,
        status: "captured",
        amountCents: parsed.data.amountCents,
    });
});


app.listen({ port: PORT, host: "0.0.0.0" })
    .then(() => app.log.info({ LATENCY_MS, FAILURE_RATE }, "payment-svc up"))
    .catch((err) => { app.log.error(err); process.exit(1); });