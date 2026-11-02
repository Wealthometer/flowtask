import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser } from "./auth.ts";
import type { Config } from "./config.ts";
import type { Db, Tx } from "./db.ts";

export type NewNotification = { userId: string; workspaceId: string; actorId: string; kind: "assigned" | "comment" | "mention" | "completed"; taskId: string; text: string };

/** Records an in-app notification and queues a push to the person's phones (same transaction). */
export async function notify(t: Tx, n: NewNotification) {
  await t.query("INSERT INTO notifications (user_id, workspace_id, actor_id, kind, task_id, text) VALUES ($1, $2, $3, $4, $5, $6)", [
    n.userId, n.workspaceId, n.actorId, n.kind, n.taskId, n.text,
  ]);
  const titles = { assigned: "New task for you", comment: "New comment", mention: "You were mentioned", completed: "Task finished" };
  await t.query("INSERT INTO push_outbox (user_id, title, body, data) VALUES ($1, $2, $3, $4)", [
    n.userId, titles[n.kind], n.text, JSON.stringify({ workspaceId: n.workspaceId, taskId: n.taskId }),
  ]);
}

export function notificationRoutes(app: FastifyInstance, db: Db) {
  app.get<{ Querystring: { limit?: string } }>("/notifications", async (req) => {
    const me = currentUser(req);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50) || 50));
    const rows = await db.query(
      `SELECT n.id, n.workspace_id, n.kind, n.task_id, n.text, n.read_at, n.created_at, n.actor_id, u.name AS actor_name, u.color AS actor_color,
              t.project_id, (t.deleted_at IS NOT NULL) AS task_deleted
         FROM notifications n JOIN users u ON u.id = n.actor_id LEFT JOIN tasks t ON t.id = n.task_id
        WHERE n.user_id = $1 AND EXISTS (SELECT 1 FROM members m WHERE m.workspace_id = n.workspace_id AND m.user_id = $1 AND m.deleted_at IS NULL)
        ORDER BY n.created_at DESC LIMIT $2`,
      [me.id, limit],
    );
    const unread = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL", [me.id]);
    return { notifications: rows.rows, unread: unread.rows[0]!.n };
  });

  app.post("/notifications/read", async (req) => {
    const me = currentUser(req);
    const body = z.object({ ids: z.array(z.string().uuid()).max(200).optional() }).parse(req.body ?? {});
    if (body.ids) await db.query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2) AND read_at IS NULL", [me.id, body.ids]);
    else await db.query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [me.id]);
    return { ok: true };
  });
}

/**
 * Sends queued pushes through Expo's push service. Rows are claimed with SKIP LOCKED so several
 * servers can run this; failures retry with backoff, and tokens Expo says are dead are removed.
 */
export async function sendPushBatch(db: Db, config: Config, log: Pick<FastifyBaseLogger, "warn"> = { warn: (o: unknown, m?: string) => console.warn(m, o) } as Pick<FastifyBaseLogger, "warn">): Promise<number> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const due = await client.query<{ id: number; user_id: string; title: string; body: string; data: object; attempts: number }>(
      "SELECT id, user_id, title, body, data, attempts FROM push_outbox WHERE sent_at IS NULL AND next_at <= now() ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED",
    );
    if (!due.rows.length) {
      await client.query("COMMIT");
      return 0;
    }
    const tokens = await client.query<{ token: string; user_id: string }>("SELECT token, user_id FROM push_tokens WHERE user_id = ANY($1)", [due.rows.map((r) => r.user_id)]);
    const messages: { to: string; title: string; body: string; data: object; sound: string; row: number }[] = [];
    for (const row of due.rows) {
      for (const t of tokens.rows.filter((x) => x.user_id === row.user_id)) messages.push({ to: t.token, title: row.title, body: row.body, data: row.data, sound: "default", row: row.id });
    }
    const failed = new Set<number>();
    let error = "";
    if (messages.length && config.pushEnabled) {
      try {
        const res = await fetch(config.pushUrl, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", ...(config.pushAccessToken ? { authorization: `Bearer ${config.pushAccessToken}` } : {}) },
          body: JSON.stringify(messages.map(({ row: _row, ...m }) => m)),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`push service answered ${res.status}`);
        const json = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
        for (const [i, ticket] of (json.data ?? []).entries()) {
          if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
            await client.query("DELETE FROM push_tokens WHERE token = $1", [messages[i]!.to]);
          }
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        for (const m of messages) failed.add(m.row);
      }
    }
    for (const row of due.rows) {
      if (failed.has(row.id) && row.attempts < 5) {
        await client.query("UPDATE push_outbox SET attempts = attempts + 1, last_error = $2, next_at = now() + make_interval(secs => $3) WHERE id = $1", [row.id, error, 30 * 2 ** row.attempts]);
      } else {
        await client.query("UPDATE push_outbox SET sent_at = now(), attempts = attempts + 1, last_error = $2 WHERE id = $1", [row.id, failed.has(row.id) ? error : null]);
      }
    }
    await client.query("COMMIT");
    if (error) log.warn({ error }, "push delivery failed");
    return due.rows.length;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
