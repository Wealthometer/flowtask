import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "./config.ts";
import { tx, type Db } from "./db.ts";
import { badRequest, conflict, tooMany, unauthorized } from "./errors.ts";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const N = 16384, R = 8, P = 1, KEYLEN = 64;

export const USER_COLORS = ["tangerine", "grape", "mint", "sky", "lemon", "bubblegum", "tomato", "leaf"] as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(password, Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(key, expected);
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export type AuthUser = { id: string; email: string; name: string; color: string };

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

export function currentUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export async function userForToken(db: Db, token: string): Promise<AuthUser | null> {
  const r = await db.query<AuthUser & { last_seen: Date }>(
    `SELECT u.id, u.email, u.name, u.color, s.last_seen FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const row = r.rows[0];
  if (!row) return null;
  // Touch at most once an hour, so every request isn't a write.
  if (Date.now() - row.last_seen.getTime() > 3_600_000) {
    await db.query("UPDATE sessions SET last_seen = now() WHERE token_hash = $1", [hashToken(token)]);
  }
  return { id: row.id, email: row.email, name: row.name, color: row.color };
}

/** Fixed-window limiter kept in memory. Good for one instance; put a shared limiter in front for more. */
export class RateLimiter {
  private hits = new Map<string, { count: number; reset: number }>();
  check(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.reset < now) {
      this.hits.set(key, { count: 1, reset: now + windowMs });
      if (this.hits.size > 50_000) this.prune(now);
      return;
    }
    entry.count++;
    if (entry.count > limit) throw tooMany();
  }
  private prune(now: number) {
    for (const [k, v] of this.hits) if (v.reset < now) this.hits.delete(k);
  }
}

const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(200);
const password = z.string().min(8, "Use at least 8 characters").max(200);
const name = z.string().trim().min(1, "Enter your name").max(60);

export function authRoutes(app: FastifyInstance, db: Db, config: Config, limiter: RateLimiter) {
  const issue = async (userId: string) => {
    const token = randomBytes(32).toString("base64url");
    await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))", [hashToken(token), userId, config.sessionDays]);
    return token;
  };
  const profile = (u: AuthUser) => ({ id: u.id, email: u.email, name: u.name, color: u.color });

  app.post("/auth/signup", async (req, reply) => {
    limiter.check(`signup:${req.ip}`, config.signupsPerHour, 3_600_000);
    const body = z.object({ email, password, name }).parse(req.body);
    const color = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]!;
    const hash = await hashPassword(body.password);
    const r = await db.query<AuthUser>(
      "INSERT INTO users (email, name, color, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING RETURNING id, email, name, color",
      [body.email, body.name, color, hash],
    );
    const user = r.rows[0];
    if (!user) throw conflict("There's already an account with that email. Log in instead.", "email");
    reply.code(201);
    return { token: await issue(user.id), user: profile(user) };
  });

  app.post("/auth/login", async (req) => {
    const body = z.object({ email, password: z.string().min(1, "Enter your password").max(200) }).parse(req.body);
    limiter.check(`login:ip:${req.ip}`, 30, 900_000);
    limiter.check(`login:email:${body.email}`, 10, 900_000);
    const r = await db.query<AuthUser & { password_hash: string }>("SELECT id, email, name, color, password_hash FROM users WHERE email = $1", [body.email]);
    const user = r.rows[0];
    // Same work whether or not the account exists, so response time doesn't reveal it.
    const ok = await verifyPassword(body.password, user?.password_hash ?? (await dummyHash()));
    if (!user || !ok) throw badRequest("That email and password don't match", "password");
    return { token: await issue(user.id), user: profile(user) };
  });

  app.post("/auth/logout", async (req) => {
    const token = bearer(req);
    if (token) await db.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
    return { ok: true };
  });

  app.get("/me", async (req) => profile(currentUser(req)));

  app.patch("/me", async (req) => {
    const me = currentUser(req);
    const body = z.object({ name: name.optional(), color: z.enum(USER_COLORS).optional() }).parse(req.body);
    const r = await db.query<AuthUser>(
      "UPDATE users SET name = COALESCE($2, name), color = COALESCE($3, color) WHERE id = $1 RETURNING id, email, name, color",
      [me.id, body.name ?? null, body.color ?? null],
    );
    await notifyUserWorkspaces(db, me.id);
    return profile(r.rows[0]!);
  });

  app.post("/me/password", async (req) => {
    const me = currentUser(req);
    limiter.check(`password:${me.id}`, 10, 900_000);
    const body = z.object({ current: z.string().min(1), next: password }).parse(req.body);
    const row = (await db.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [me.id])).rows[0]!;
    if (!(await verifyPassword(body.current, row.password_hash))) throw badRequest("Your current password isn't right", "current");
    await tx(db, async (t) => {
      await t.query("UPDATE users SET password_hash = $2 WHERE id = $1", [me.id, await hashPassword(body.next)]);
      // Sign out every other device.
      await t.query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", [me.id, hashToken(bearer(req)!)]);
    });
    return { ok: true };
  });

  app.post("/me/push-tokens", async (req) => {
    const me = currentUser(req);
    const body = z.object({ token: z.string().min(10).max(300), platform: z.enum(["ios", "android", "web"]) }).parse(req.body);
    await db.query(
      `INSERT INTO push_tokens (token, user_id, platform) VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, updated_at = now()`,
      [body.token, me.id, body.platform],
    );
    return { ok: true };
  });

  app.delete<{ Params: { token: string } }>("/me/push-tokens/:token", async (req) => {
    const me = currentUser(req);
    await db.query("DELETE FROM push_tokens WHERE token = $1 AND user_id = $2", [req.params.token, me.id]);
    return { ok: true };
  });

  /**
   * Deletes the account (both app stores require this). Workspaces where the person is alone are
   * deleted; their tasks and comments in shared workspaces stay, credited to "Deleted user".
   */
  app.delete("/me", async (req) => {
    const me = currentUser(req);
    const body = z.object({ password: z.string().min(1, "Enter your password") }).parse(req.body);
    const row = (await db.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [me.id])).rows[0]!;
    if (!(await verifyPassword(body.password, row.password_hash))) throw badRequest("That password isn't right", "password");
    await tx(db, async (t) => {
      const owned = await t.query<{ id: string; name: string; others: number; owners: number }>(
        `SELECT w.id, w.name,
                (SELECT COUNT(*)::int FROM members m2 WHERE m2.workspace_id = w.id AND m2.deleted_at IS NULL AND m2.user_id <> $1) AS others,
                (SELECT COUNT(*)::int FROM members m3 WHERE m3.workspace_id = w.id AND m3.deleted_at IS NULL AND m3.role = 'owner' AND m3.user_id <> $1) AS owners
           FROM workspaces w JOIN members m ON m.workspace_id = w.id
          WHERE m.user_id = $1 AND m.deleted_at IS NULL AND m.role = 'owner'`,
        [me.id],
      );
      const blocking = owned.rows.find((w) => w.others > 0 && w.owners === 0);
      if (blocking) throw conflict(`Make someone else an owner of ${blocking.name} first, or remove its members.`);
      for (const w of owned.rows.filter((x) => x.others === 0)) await t.query("DELETE FROM workspaces WHERE id = $1", [w.id]);
      await t.query("UPDATE tasks SET assignee_id = NULL, updated_at = now() WHERE assignee_id = $1", [me.id]);
      await t.query("UPDATE members SET deleted_at = now() WHERE user_id = $1 AND deleted_at IS NULL", [me.id]);
      await t.query(
        "UPDATE users SET email = $2, name = 'Deleted user', password_hash = 'deleted' WHERE id = $1",
        [me.id, `deleted+${me.id}@flowtask.invalid`],
      );
      await t.query("DELETE FROM sessions WHERE user_id = $1", [me.id]);
      await t.query("DELETE FROM push_tokens WHERE user_id = $1", [me.id]);
      await t.query("DELETE FROM notifications WHERE user_id = $1", [me.id]);
    });
    return { ok: true };
  });
}

let dummy: Promise<string> | null = null;
function dummyHash() {
  dummy ??= hashPassword("not-a-real-password");
  return dummy;
}

export function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

/** Tells every workspace this person belongs to that something changed (their name or colour). */
export async function notifyUserWorkspaces(db: Db, userId: string) {
  const r = await db.query<{ workspace_id: string }>("SELECT workspace_id FROM members WHERE user_id = $1 AND deleted_at IS NULL", [userId]);
  for (const row of r.rows) {
    // Touch the membership so the next pull carries the new profile.
    await db.query("UPDATE members SET role = role WHERE workspace_id = $1 AND user_id = $2", [row.workspace_id, userId]);
    await db.query("SELECT pg_notify('flowtask_changes', $1)", [row.workspace_id]);
  }
}
