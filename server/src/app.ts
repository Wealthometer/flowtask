import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { z } from "zod";
import { authRoutes, bearer, RateLimiter, userForToken } from "./auth.ts";
import type { Config } from "./config.ts";
import { createPool, type Db } from "./db.ts";
import { ApiError } from "./errors.ts";
import { notificationRoutes, sendPushBatch } from "./notify.ts";
import { Realtime, realtimeRoutes } from "./realtime.ts";
import { syncRoutes } from "./sync.ts";
import { workspaceRoutes } from "./workspaces.ts";

const PUBLIC = new Set(["/health", "/auth/signup", "/auth/login", "/live"]);

export async function buildApp(config: Config, opts: { db?: Db; logger?: boolean } = {}): Promise<{ app: FastifyInstance; db: Db }> {
  const db = opts.db ?? createPool(config.databaseUrl, config.dbPool);
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.logLevel, redact: ["req.headers.authorization"] },
    trustProxy: config.trustProxy,
    bodyLimit: 256 * 1024,
  });
  const limiter = new RateLimiter();
  const realtime = new Realtime(config.databaseUrl, app.log);

  await app.register(cors, { origin: config.corsOrigins, methods: ["GET", "POST", "PATCH", "DELETE"] });
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });

  // Accept an empty JSON body as {} (some clients send the header on bodiless POSTs).
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (body === "") return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error("That request body isn't valid JSON"), { statusCode: 400 }), undefined);
    }
  });

  app.decorateRequest("user", null);
  app.addHook("onRequest", async (req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    const token = bearer(req);
    req.user = token ? await userForToken(db, token) : null;
    const path = req.url.split("?")[0]!;
    if (!req.user && !PUBLIC.has(path) && req.method !== "OPTIONS") {
      reply.code(401).send({ error: { code: "unauthorized", message: token ? "Your session has ended. Log in again." : "Sign in to continue" } });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) } });
    }
    if (err instanceof z.ZodError) {
      const issue = err.issues[0];
      return reply.code(400).send({ error: { code: "invalid", message: issue?.message ?? "Check what you entered", field: issue?.path.join(".") || undefined } });
    }
    const e = err as { statusCode?: number; message: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: { code: "invalid", message: e.message } });
    req.log.error(err);
    return reply.code(500).send({ error: { code: "server", message: "Something went wrong on our side. Nothing was lost; try again." } });
  });

  app.get("/health", async () => {
    await db.query("SELECT 1");
    return { ok: true };
  });

  authRoutes(app, db, config, limiter);
  workspaceRoutes(app, db, limiter);
  syncRoutes(app, db);
  notificationRoutes(app, db);
  realtimeRoutes(app, db, realtime);

  let timer: NodeJS.Timeout | null = null;
  app.addHook("onReady", async () => {
    await realtime.start();
    if (config.workers) {
      const tick = async () => {
        try {
          await sendPushBatch(db, config, app.log);
          // Old idempotency records are only needed while a phone might retry.
          await db.query("DELETE FROM applied_mutations WHERE applied_at < now() - interval '30 days'");
          await db.query("DELETE FROM sessions WHERE expires_at < now()");
        } catch (e) {
          app.log.error(e, "background work failed");
        }
        timer = setTimeout(tick, 5000);
      };
      timer = setTimeout(tick, 1000);
    }
  });
  app.addHook("onClose", async () => {
    if (timer) clearTimeout(timer);
    await realtime.stop();
    if (!opts.db) await db.end();
  });

  return { app, db };
}
