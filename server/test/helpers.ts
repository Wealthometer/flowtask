import { randomUUID } from "node:crypto";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { loadConfig, type Config } from "../src/config.ts";
import { createPool, migrate, type Db } from "../src/db.ts";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const TEST_DB = process.env.TEST_DATABASE ?? "flowtask_test";

let ready: Promise<void> | null = null;

/** Recreates the test database once per test file and applies migrations. */
async function freshDatabase() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();
  const db = createPool(testUrl(), 2);
  await migrate(db);
  await db.end();
}

export function testUrl() {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${TEST_DB}`;
  return u.toString();
}

export type Harness = { app: FastifyInstance; db: Db; config: Config; close: () => Promise<void> };

export async function harness(overrides: Partial<Config> = {}): Promise<Harness> {
  ready ??= freshDatabase();
  await ready;
  const config = { ...loadConfig({}), databaseUrl: testUrl(), workers: false, pushEnabled: false, signupsPerHour: 10_000, ...overrides };
  const { app, db } = await buildApp(config, { logger: false });
  await app.ready();
  return { app, db, config, close: () => app.close() };
}

export type Client = {
  token: string;
  user: { id: string; name: string; email: string; color: string };
  call: <T = any>(method: string, url: string, body?: unknown) => Promise<{ status: number; body: T }>;
  push: (name: string, args: Record<string, unknown>, id?: string) => Promise<{ ok: boolean; error?: { code: string; message: string; field?: string } }>;
  sync: (workspaceId: string, since?: number) => Promise<any>;
};

let n = 0;
export async function signUp(h: Harness, name = "Ada Obi"): Promise<Client> {
  n++;
  const email = `${name.split(" ")[0]!.toLowerCase()}${n}-${randomUUID().slice(0, 6)}@example.com`;
  const res = await h.app.inject({ method: "POST", url: "/auth/signup", payload: { email, password: "correct horse", name } });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.body}`);
  const { token, user } = res.json();
  return client(h, token, user);
}

export function client(h: Harness, token: string, user: Client["user"]): Client {
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await h.app.inject({ method: method as "GET", url, payload: body as object, headers: { authorization: `Bearer ${token}` } });
    return { status: res.statusCode, body: res.body ? res.json() : null };
  };
  return {
    token,
    user,
    call,
    push: async (name, args, id = randomUUID()) => {
      const r = await call("POST", "/sync/push", { mutations: [{ id, name, args }] });
      if (r.status !== 200) throw new Error(`push failed ${r.status}: ${JSON.stringify(r.body)}`);
      return r.body.results[0];
    },
    sync: async (workspaceId, since = 0) => {
      const r = await call("GET", `/workspaces/${workspaceId}/sync?since=${since}`);
      if (r.status !== 200) throw Object.assign(new Error(`sync ${r.status}`), { status: r.status });
      return r.body;
    },
  };
}

/** A workspace without the starter project, plus one project with the default four columns. */
export async function workspaceWithProject(c: Client) {
  const ws = (await c.call("POST", "/workspaces", { name: "Studio", starter: false })).body.workspace;
  const projectId = randomUUID();
  const statuses = ["To do", "Doing", "Done"].map((name, i) => ({ id: randomUUID(), name, color: "lemon", category: i === 2 ? "done" : i === 1 ? "doing" : "todo", position: i }));
  const r = await c.push("project.create", { id: projectId, workspaceId: ws.id, name: "Launch", color: "tangerine", icon: "rocket-launch", statuses });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return { workspaceId: ws.id as string, projectId, todo: statuses[0]!.id, doing: statuses[1]!.id, done: statuses[2]!.id };
}

export async function join(h: Harness, owner: Client, workspaceId: string, name: string, role: "member" | "admin" = "member") {
  const invite = (await owner.call("POST", `/workspaces/${workspaceId}/invites`, { role })).body.invite;
  const person = await signUp(h, name);
  const r = await person.call("POST", `/invites/${invite.code}/accept`);
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  return person;
}
