import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

// Dates (due dates) stay plain "YYYY-MM-DD" strings instead of becoming JS Dates at midnight UTC.
pg.types.setTypeParser(1082, (v: string) => v);
// Versions are bigints; they stay well inside the safe integer range.
pg.types.setTypeParser(20, (v: string) => Number(v));

export function createPool(url: string, max: number): Db {
  return new pg.Pool({ connectionString: url, max });
}

export async function tx<T>(db: Db, fn: (t: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Serialises writes within one workspace, so versions there become visible in order. */
export async function lockWorkspace(t: Tx, workspaceId: string): Promise<void> {
  await t.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 42))", [workspaceId]);
}

/** Applies migrations from src/migrations in name order, once each, under a lock. */
export async function migrate(db: Db): Promise<string[]> {
  const dir = new URL("./migrations/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  return tx(db, async (t) => {
    await t.query("SELECT pg_advisory_xact_lock(727274)");
    await t.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const done = new Set((await t.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    const applied: string[] = [];
    for (const f of files) {
      if (done.has(f)) continue;
      await t.query(await readFile(new URL(f, dir), "utf8"));
      await t.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
      applied.push(f);
    }
    return applied;
  });
}
