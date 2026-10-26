import Fastify from "fastify";
import { z } from "zod";
import pg from "pg";
import { Redis } from "ioredis";

import { error } from "console";
const PORT = Number(process.env.PORT ?? 3000);
const PAYMENT_URL = process.env.PAYMENT_URL ?? "http://payment-svc:3002";
const PAYMENT_TIMEOUT_MS = Number(process.env.PAYMENT_TIMEOUT_MS ?? 1000);
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS ?? 30);
const app = Fastify({ logger: true });

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 30000,
});

const redis = new Redis(process.env.REDIS_URL ?? "redis://redis:6379", {
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    lazyConnect: false,
});

redis.on("error", (err: { message: any; }) => app.log.warn({ err: err.message }, "redis error"));
const CreateOrder = z.object({
    userId: z.string().min(1),
    amountCents: z.number().int().positive(),
});

// ---- health ----
app.get("/healthz", async () => ({ status: "ok" }));

app.get("/readyz", async (_req, reply) => {
    const checks: Record<string, string> = {};
    try { await pool.query("select 1"); checks.postgres = "ok"; }
    catch { checks.postgres = "down"; }
    try { await redis.ping(); checks.redis = "ok"; }
    catch { checks.redis = "down"; }
    const ready = checks.postgres === "ok";
    return reply.code(ready ? 200 : 503).send({ ready, checks });
});

// ---- orders ----
app.post("/orders", async (req, reply) => {
    const parsed = CreateOrder.safeParse(req.body);
    if (!parsed.success) {
        return reply.code(400).send({
            error: "invalid_request", detail:
                parsed.error.issues
        });
    }
    const { userId, amountCents } = parsed.data;
    const { rows } = await pool.query(
        `insert into orders (user_id, amount_cents, status)
     values ($1, $2, 'pending') returning id`,
        [userId, amountCents]
    );
    const orderId: string = rows[0].id;
    let status = "failed";
    let paymentRef: string | null = null;
    try {
        const res = await fetch(`${PAYMENT_URL}/payments`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ orderId, amountCents }),
            signal: AbortSignal.timeout(PAYMENT_TIMEOUT_MS),
        });
        if (res.ok) {
            const body = (await res.json()) as { paymentRef: string };
            paymentRef = body.paymentRef;
            status = "paid";
        } else {
            req.log.warn({ orderId, httpStatus: res.status }, "payment rejected");
        }
    } catch (err) {
        const name = (err as Error).name;
        req.log.warn({ orderId, name }, name === "TimeoutError" ? "payment timedout" : "payment call failed");

    }
    const updated = await pool.query(
        `update orders set status = $2, payment_ref = $3 where id = $1
     returning id, user_id, amount_cents, status, payment_ref, created_at`,
        [orderId, status, paymentRef]
    );
    return reply.code(status === "paid" ? 201 : 502).send(updated.rows[0]);
});
app.get<{ Params: { id: string } }>("/orders/:id", async (req, reply) => {
    const { id } = req.params;
    const key = `order:${id}`;
    try {
        const cached = await redis.get(key);
        if (cached) return reply.header("x-cache",
            "hit").send(JSON.parse(cached));
    } catch {
        // Cache down is not an outage. Fall through to Postgres.
    }
    const { rows } = await pool.query(
        `select id, user_id, amount_cents, status, payment_ref, created_at
     from orders where id = $1`,
        [id]
    );
    if (rows.length === 0) return reply.code(404).send({ error: "not_found" });
    try { await redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(rows[0])); }
    catch { }
    return reply.header("x-cache", "miss").send(rows[0]);
});
app.listen({ port: PORT, host: "0.0.0.0" })
    .then(() => app.log.info({ PAYMENT_TIMEOUT_MS }, "order-api up"))
    .catch((err) => { app.log.error(err); process.exit(1); });