import { Hono } from "hono";

const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true }));

export default { port: Number(process.env.PORT ?? 8787), fetch: app.fetch };
