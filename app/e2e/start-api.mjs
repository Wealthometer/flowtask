// Recreates the e2e database and runs the real API against it.
import { spawn } from "node:child_process";
import pg from "pg";

const admin = process.env.E2E_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const name = process.env.E2E_DATABASE ?? "flowtask_e2e";
const c = new pg.Client({ connectionString: admin });
await c.connect();
await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
await c.query(`CREATE DATABASE ${name}`);
await c.end();

const url = new URL(admin);
url.pathname = `/${name}`;
const child = spawn("npm", ["start"], {
  cwd: new URL("../../server/", import.meta.url).pathname,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url.toString(), PORT: "4100", PUSH_ENABLED: "false", LOG_LEVEL: "warn", CORS_ORIGINS: "http://localhost:8199", SIGNUPS_PER_HOUR: "1000" },
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
