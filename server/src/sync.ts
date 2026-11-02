import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser, USER_COLORS } from "./auth.ts";
import { lockWorkspace, tx, type Db, type Tx } from "./db.ts";
import { ApiError, badRequest, forbidden, notFound } from "./errors.ts";
import { notify } from "./notify.ts";
import { announce, requireRole, type Role } from "./workspaces.ts";

// ── Pull ────────────────────────────────────────────────────────────────────

/**
 * Everything in a workspace that changed after `since`. since=0 is a full download (soft-deleted
 * rows left out); otherwise deletes are included so the phone can drop them.
 */
export async function pull(db: Db, workspaceId: string, since: number) {
  const full = since === 0;
  const live = full ? "AND deleted_at IS NULL" : "";
  const q = async <T extends { version: number }>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, [workspaceId, since, ...params])).rows;

  const [workspace, members, projects, statuses, tasks, checklist, comments, activity] = await Promise.all([
    q<{ version: number }>("SELECT id, name, created_at, version FROM workspaces WHERE id = $1 AND (version > $2)"),
    q<{ version: number }>(
      `SELECT m.user_id AS id, u.name, u.email, u.color, m.role, m.joined_at, m.deleted_at, GREATEST(m.version, u.version) AS version
         FROM members m JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = $1 AND (m.version > $2 OR u.version > $2) ${full ? "AND m.deleted_at IS NULL" : ""}`,
    ),
    q(`SELECT id, name, color, icon, position, created_by, created_at, updated_at, archived_at, deleted_at, version FROM projects WHERE workspace_id = $1 AND version > $2 ${live}`),
    q(`SELECT id, project_id, name, color, category, position, deleted_at, version FROM statuses WHERE workspace_id = $1 AND version > $2 ${live}`),
    q(
      `SELECT id, project_id, status_id, title, notes, assignee_id, due_on, priority, labels, position, created_by, created_at, updated_at, completed_at, deleted_at, version
         FROM tasks WHERE workspace_id = $1 AND version > $2 ${live}`,
    ),
    q(`SELECT id, task_id, title, done, position, deleted_at, version FROM checklist_items WHERE workspace_id = $1 AND version > $2 ${live}`),
    q(`SELECT id, task_id, author_id, body, created_at, edited_at, deleted_at, version FROM comments WHERE workspace_id = $1 AND version > $2 ${live}`),
    q(
      `SELECT id, actor_id, kind, project_id, task_id, data, created_at, version FROM activity WHERE workspace_id = $1 AND version > $2
        ORDER BY version DESC LIMIT 200`,
    ),
  ]);
  const all = [workspace, members, projects, statuses, tasks, checklist, comments, activity].flat() as { version: number }[];
  const cursor = all.reduce((m, r) => Math.max(m, r.version), since);
  return { cursor, full, workspace: workspace[0] ?? null, members, projects, statuses, tasks, checklist, comments, activity };
}

// ── Push ────────────────────────────────────────────────────────────────────

const uuid = z.string().uuid();
const color = z.enum(USER_COLORS);
const icon = z.string().min(1).max(40).regex(/^[a-z0-9-]+$/);
const position = z.number().finite();
const dueOn = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-30").nullable();
const priority = z.enum(["urgent", "high", "medium", "low"]);
const labels = z.array(z.string().trim().min(1).max(24)).max(10);
const statusInput = z.object({ id: uuid, name: z.string().trim().min(1).max(40), color, category: z.enum(["todo", "doing", "done"]), position });

export const MUTATIONS = {
  "project.create": z.object({
    id: uuid, workspaceId: uuid, name: z.string().trim().min(1, "Name the project").max(80), color, icon, position: position.default(0),
    statuses: z.array(statusInput).min(1).max(12),
  }),
  "project.update": z.object({ id: uuid, name: z.string().trim().min(1).max(80).optional(), color: color.optional(), icon: icon.optional(), position: position.optional(), archived: z.boolean().optional() }),
  "project.delete": z.object({ id: uuid }),
  "status.upsert": statusInput.extend({ projectId: uuid }),
  "status.delete": z.object({ id: uuid, moveTo: uuid }),
  "task.create": z.object({
    id: uuid, projectId: uuid, statusId: uuid, title: z.string().trim().min(1, "Give the task a title").max(200), notes: z.string().max(10000).default(""),
    assigneeId: uuid.nullable().default(null), dueOn: dueOn.default(null), priority: priority.default("medium"), labels: labels.default([]), position: position.default(0),
  }),
  "task.update": z.object({
    id: uuid, title: z.string().trim().min(1, "Give the task a title").max(200).optional(), notes: z.string().max(10000).optional(), statusId: uuid.optional(),
    assigneeId: uuid.nullable().optional(), dueOn: dueOn.optional(), priority: priority.optional(), labels: labels.optional(), position: position.optional(), projectId: uuid.optional(),
  }),
  "task.delete": z.object({ id: uuid }),
  "checklist.upsert": z.object({ id: uuid, taskId: uuid, title: z.string().trim().min(1).max(200), done: z.boolean(), position }),
  "checklist.delete": z.object({ id: uuid }),
  "comment.create": z.object({ id: uuid, taskId: uuid, body: z.string().trim().min(1, "Write something first").max(4000) }),
  "comment.update": z.object({ id: uuid, body: z.string().trim().min(1).max(4000) }),
  "comment.delete": z.object({ id: uuid }),
} as const;

export type MutationName = keyof typeof MUTATIONS;
type Args<N extends MutationName> = z.infer<(typeof MUTATIONS)[N]>;

type Ctx = { t: Tx; userId: string; userName: string };

/** Finds which workspace a mutation touches, from whatever it refers to. */
async function workspaceOf(t: Tx, name: MutationName, args: Record<string, unknown>): Promise<string> {
  const one = async (sql: string, id: unknown) => {
    const r = await t.query<{ workspace_id: string }>(sql, [id]);
    if (!r.rows[0]) throw notFound();
    return r.rows[0].workspace_id;
  };
  switch (name) {
    case "project.create":
      return args.workspaceId as string;
    case "project.update":
    case "project.delete":
      return one("SELECT workspace_id FROM projects WHERE id = $1", args.id);
    case "status.upsert":
      return one("SELECT workspace_id FROM projects WHERE id = $1", args.projectId);
    case "status.delete":
      return one("SELECT workspace_id FROM statuses WHERE id = $1", args.id);
    case "task.create":
      return one("SELECT workspace_id FROM projects WHERE id = $1", args.projectId);
    case "task.update":
    case "task.delete":
      return one("SELECT workspace_id FROM tasks WHERE id = $1", args.id);
    case "checklist.upsert":
    case "comment.create":
      return one("SELECT workspace_id FROM tasks WHERE id = $1", args.taskId);
    case "checklist.delete":
      return one("SELECT workspace_id FROM checklist_items WHERE id = $1", args.id);
    case "comment.update":
    case "comment.delete":
      return one("SELECT workspace_id FROM comments WHERE id = $1", args.id);
  }
}

async function activity(c: Ctx, ws: string, kind: string, projectId: string | null, taskId: string | null, data: object = {}) {
  await c.t.query("INSERT INTO activity (workspace_id, actor_id, kind, project_id, task_id, data) VALUES ($1, $2, $3, $4, $5, $6)", [ws, c.userId, kind, projectId, taskId, JSON.stringify(data)]);
}

async function assertMember(c: Ctx, ws: string, userId: string | null | undefined) {
  if (!userId) return;
  const r = await c.t.query("SELECT 1 FROM members WHERE workspace_id = $1 AND user_id = $2 AND deleted_at IS NULL", [ws, userId]);
  if (!r.rows[0]) throw badRequest("You can only assign people in this workspace", "assigneeId");
}

async function statusIn(c: Ctx, statusId: string, projectId: string) {
  const r = await c.t.query<{ category: string }>("SELECT category FROM statuses WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL", [statusId, projectId]);
  if (!r.rows[0]) throw badRequest("That column isn't in this project", "statusId");
  return r.rows[0].category;
}

async function liveTask(c: Ctx, id: string) {
  const r = await c.t.query<{ id: string; project_id: string; title: string; assignee_id: string | null; created_by: string; status_id: string; completed_at: Date | null; deleted_at: Date | null }>(
    "SELECT id, project_id, title, assignee_id, created_by, status_id, completed_at, deleted_at FROM tasks WHERE id = $1 FOR UPDATE",
    [id],
  );
  const task = r.rows[0];
  if (!task || task.deleted_at) throw notFound("That task was deleted");
  return task;
}

/** Applies one mutation. Creates are idempotent by id, so replays and retries are harmless. */
async function apply<N extends MutationName>(c: Ctx, ws: string, role: Role, name: N, a: Args<N>): Promise<void> {
  const t = c.t;
  switch (name) {
    case "project.create": {
      const x = a as Args<"project.create">;
      const done = await t.query("INSERT INTO projects (id, workspace_id, name, color, icon, position, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING RETURNING id", [
        x.id, ws, x.name, x.color, x.icon, x.position, c.userId,
      ]);
      if (!done.rows[0]) return;
      if (!x.statuses.some((s) => s.category === "done")) throw badRequest("A project needs a column for finished work", "statuses");
      for (const s of x.statuses) {
        await t.query("INSERT INTO statuses (id, project_id, workspace_id, name, color, category, position) VALUES ($1, $2, $3, $4, $5, $6, $7)", [s.id, x.id, ws, s.name, s.color, s.category, s.position]);
      }
      await activity(c, ws, "project.created", x.id, null, { name: x.name });
      return;
    }
    case "project.update": {
      const x = a as Args<"project.update">;
      await t.query(
        `UPDATE projects SET name = COALESCE($2, name), color = COALESCE($3, color), icon = COALESCE($4, icon), position = COALESCE($5, position),
                archived_at = CASE WHEN $6::boolean IS NULL THEN archived_at WHEN $6 THEN COALESCE(archived_at, now()) ELSE NULL END, updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL`,
        [x.id, x.name ?? null, x.color ?? null, x.icon ?? null, x.position ?? null, x.archived ?? null],
      );
      if (x.archived !== undefined) await activity(c, ws, x.archived ? "project.archived" : "project.restored", x.id, null);
      return;
    }
    case "project.delete": {
      const x = a as Args<"project.delete">;
      const p = (await t.query<{ created_by: string; name: string }>("SELECT created_by, name FROM projects WHERE id = $1", [x.id])).rows[0]!;
      if (p.created_by !== c.userId && role === "member") throw forbidden("Only the person who made this project, or an admin, can delete it");
      await t.query("UPDATE projects SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL", [x.id]);
      await t.query("UPDATE tasks SET deleted_at = now() WHERE project_id = $1 AND deleted_at IS NULL", [x.id]);
      await t.query("UPDATE statuses SET deleted_at = now() WHERE project_id = $1 AND deleted_at IS NULL", [x.id]);
      await activity(c, ws, "project.deleted", x.id, null, { name: p.name });
      return;
    }
    case "status.upsert": {
      const x = a as Args<"status.upsert">;
      const existing = (await t.query<{ project_id: string; category: string }>("SELECT project_id, category FROM statuses WHERE id = $1", [x.id])).rows[0];
      if (existing && existing.project_id !== x.projectId) throw badRequest("That column belongs to another project");
      if (existing?.category === "done" && x.category !== "done") {
        const others = await t.query("SELECT 1 FROM statuses WHERE project_id = $1 AND category = 'done' AND id <> $2 AND deleted_at IS NULL", [x.projectId, x.id]);
        if (!others.rows[0]) throw badRequest("A project needs a column for finished work", "category");
      }
      await t.query(
        `INSERT INTO statuses (id, project_id, workspace_id, name, color, category, position) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, color = excluded.color, category = excluded.category, position = excluded.position, deleted_at = NULL`,
        [x.id, x.projectId, ws, x.name, x.color, x.category, x.position],
      );
      // Tasks follow their column into or out of "done".
      await t.query(
        `UPDATE tasks SET completed_at = CASE WHEN $2 = 'done' THEN COALESCE(completed_at, now()) ELSE NULL END
          WHERE status_id = $1 AND deleted_at IS NULL AND (completed_at IS NULL) = ($2 = 'done')`,
        [x.id, x.category],
      );
      return;
    }
    case "status.delete": {
      const x = a as Args<"status.delete">;
      const s = (await t.query<{ project_id: string; category: string; deleted_at: Date | null }>("SELECT project_id, category, deleted_at FROM statuses WHERE id = $1", [x.id])).rows[0]!;
      if (s.deleted_at) return;
      if (x.moveTo === x.id) throw badRequest("Pick a different column for its tasks", "moveTo");
      const target = await statusIn(c, x.moveTo, s.project_id);
      const remaining = await t.query("SELECT 1 FROM statuses WHERE project_id = $1 AND category = 'done' AND id <> $2 AND deleted_at IS NULL", [s.project_id, x.id]);
      if (s.category === "done" && !remaining.rows[0]) throw badRequest("A project needs a column for finished work");
      await t.query(
        `UPDATE tasks SET status_id = $2, updated_at = now(), completed_at = CASE WHEN $3 = 'done' THEN COALESCE(completed_at, now()) ELSE NULL END
          WHERE status_id = $1 AND deleted_at IS NULL`,
        [x.id, x.moveTo, target],
      );
      await t.query("UPDATE statuses SET deleted_at = now() WHERE id = $1", [x.id]);
      return;
    }
    case "task.create": {
      const x = a as Args<"task.create">;
      const project = (await t.query<{ deleted_at: Date | null; archived_at: Date | null }>("SELECT deleted_at, archived_at FROM projects WHERE id = $1", [x.projectId])).rows[0]!;
      if (project.deleted_at) throw notFound("That project was deleted");
      const category = await statusIn(c, x.statusId, x.projectId);
      await assertMember(c, ws, x.assigneeId);
      const r = await t.query(
        `INSERT INTO tasks (id, project_id, workspace_id, status_id, title, notes, assignee_id, due_on, priority, labels, position, created_by, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CASE WHEN $13 THEN now() END) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [x.id, x.projectId, ws, x.statusId, x.title, x.notes, x.assigneeId, x.dueOn, x.priority, x.labels, x.position, c.userId, category === "done"],
      );
      if (!r.rows[0]) return;
      await activity(c, ws, "task.created", x.projectId, x.id, { title: x.title });
      if (x.assigneeId && x.assigneeId !== c.userId) {
        await notify(t, { userId: x.assigneeId, workspaceId: ws, actorId: c.userId, kind: "assigned", taskId: x.id, text: `${c.userName} assigned you “${x.title}”` });
      }
      return;
    }
    case "task.update": {
      const x = a as Args<"task.update">;
      const before = await liveTask(c, x.id);
      const projectId = x.projectId ?? before.project_id;
      if (x.projectId && x.projectId !== before.project_id) {
        const p = await t.query("SELECT 1 FROM projects WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL", [x.projectId, ws]);
        if (!p.rows[0]) throw badRequest("Pick a project in this workspace", "projectId");
        if (!x.statusId) throw badRequest("Pick a column in the new project", "statusId");
      }
      let completed: boolean | null = null;
      if (x.statusId) completed = (await statusIn(c, x.statusId, projectId)) === "done";
      if (x.assigneeId !== undefined) await assertMember(c, ws, x.assigneeId);
      await t.query(
        `UPDATE tasks SET title = COALESCE($2, title), notes = COALESCE($3, notes), status_id = COALESCE($4, status_id),
                assignee_id = CASE WHEN $5::boolean THEN $6::uuid ELSE assignee_id END,
                due_on = CASE WHEN $7::boolean THEN $8::date ELSE due_on END,
                priority = COALESCE($9, priority), labels = COALESCE($10, labels), position = COALESCE($11, position), project_id = $12,
                completed_at = CASE WHEN $13::boolean IS NULL THEN completed_at WHEN $13 THEN COALESCE(completed_at, now()) ELSE NULL END,
                updated_at = now()
          WHERE id = $1`,
        [
          x.id, x.title ?? null, x.notes ?? null, x.statusId ?? null, x.assigneeId !== undefined, x.assigneeId ?? null, x.dueOn !== undefined, x.dueOn ?? null,
          x.priority ?? null, x.labels ?? null, x.position ?? null, projectId, completed,
        ],
      );
      const title = x.title ?? before.title;
      if (x.statusId && x.statusId !== before.status_id) {
        await activity(c, ws, completed ? "task.completed" : "task.moved", projectId, x.id, { title, statusId: x.statusId });
        if (completed && !before.completed_at && before.created_by !== c.userId) {
          await notify(t, { userId: before.created_by, workspaceId: ws, actorId: c.userId, kind: "completed", taskId: x.id, text: `${c.userName} finished “${title}”` });
        }
      }
      if (x.assigneeId !== undefined && x.assigneeId !== before.assignee_id) {
        await activity(c, ws, "task.assigned", projectId, x.id, { title, assigneeId: x.assigneeId });
        if (x.assigneeId && x.assigneeId !== c.userId) {
          await notify(t, { userId: x.assigneeId, workspaceId: ws, actorId: c.userId, kind: "assigned", taskId: x.id, text: `${c.userName} assigned you “${title}”` });
        }
      }
      return;
    }
    case "task.delete": {
      const x = a as Args<"task.delete">;
      const r = await t.query<{ project_id: string; title: string }>("UPDATE tasks SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING project_id, title", [x.id]);
      if (r.rows[0]) await activity(c, ws, "task.deleted", r.rows[0].project_id, x.id, { title: r.rows[0].title });
      return;
    }
    case "checklist.upsert": {
      const x = a as Args<"checklist.upsert">;
      await liveTask(c, x.taskId);
      const owner = (await t.query<{ task_id: string }>("SELECT task_id FROM checklist_items WHERE id = $1", [x.id])).rows[0];
      if (owner && owner.task_id !== x.taskId) throw badRequest("That item belongs to another task");
      await t.query(
        `INSERT INTO checklist_items (id, task_id, workspace_id, title, done, position) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET title = excluded.title, done = excluded.done, position = excluded.position, deleted_at = NULL`,
        [x.id, x.taskId, ws, x.title, x.done, x.position],
      );
      return;
    }
    case "checklist.delete": {
      await t.query("UPDATE checklist_items SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL", [(a as Args<"checklist.delete">).id]);
      return;
    }
    case "comment.create": {
      const x = a as Args<"comment.create">;
      const task = await liveTask(c, x.taskId);
      const r = await t.query("INSERT INTO comments (id, task_id, workspace_id, author_id, body) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING RETURNING id", [
        x.id, x.taskId, ws, c.userId, x.body,
      ]);
      if (!r.rows[0]) return;
      await activity(c, ws, "comment.created", task.project_id, task.id, { title: task.title });
      // People @mentioned get a mention; the assignee and creator hear about the comment.
      const members = (await t.query<{ id: string; name: string }>("SELECT u.id, u.name FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND m.deleted_at IS NULL", [ws])).rows;
      const mentioned = new Set(mentions(x.body, members).filter((id) => id !== c.userId));
      const preview = x.body.length > 80 ? `${x.body.slice(0, 77)}…` : x.body;
      for (const id of mentioned) {
        await notify(t, { userId: id, workspaceId: ws, actorId: c.userId, kind: "mention", taskId: task.id, text: `${c.userName} mentioned you on “${task.title}”: ${preview}` });
      }
      for (const id of new Set([task.assignee_id, task.created_by])) {
        if (id && id !== c.userId && !mentioned.has(id)) {
          await notify(t, { userId: id, workspaceId: ws, actorId: c.userId, kind: "comment", taskId: task.id, text: `${c.userName} commented on “${task.title}”: ${preview}` });
        }
      }
      return;
    }
    case "comment.update": {
      const x = a as Args<"comment.update">;
      const r = await t.query("UPDATE comments SET body = $2, edited_at = now() WHERE id = $1 AND author_id = $3 AND deleted_at IS NULL RETURNING id", [x.id, x.body, c.userId]);
      if (!r.rows[0]) throw forbidden("You can only edit your own comments");
      return;
    }
    case "comment.delete": {
      const x = a as Args<"comment.delete">;
      const r = await t.query<{ author_id: string }>("SELECT author_id FROM comments WHERE id = $1", [x.id]);
      if (r.rows[0]?.author_id !== c.userId && role === "member") throw forbidden("You can only delete your own comments");
      await t.query("UPDATE comments SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL", [x.id]);
      return;
    }
  }
}

/** Members mentioned as @Firstname or @"Full Name" (case-insensitive). */
export function mentions(body: string, members: { id: string; name: string }[]): string[] {
  const found = new Set<string>();
  const lower = body.toLowerCase();
  for (const m of members) {
    const full = m.name.toLowerCase();
    const first = full.split(/\s+/)[0]!;
    const re = (s: string) => new RegExp(`(^|[^\\w@])@${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "i");
    if (re(full.replace(/\s+/g, "\\s+")).test(lower) || re(first).test(lower) || lower.includes(`@"${full}"`)) found.add(m.id);
  }
  return [...found];
}

export type MutationResult = { id: string; ok: true } | { id: string; ok: false; error: { code: string; message: string; field?: string } };

export async function applyMutations(db: Db, user: { id: string; name: string }, mutations: { id: string; name: string; args: unknown }[]) {
  const results: MutationResult[] = [];
  const touched = new Set<string>();
  for (const m of mutations) {
    const prior = await db.query<{ result: MutationResult }>("SELECT result FROM applied_mutations WHERE id = $1 AND user_id = $2", [m.id, user.id]);
    if (prior.rows[0]) {
      results.push(prior.rows[0].result);
      continue;
    }
    let result: MutationResult;
    try {
      if (!(m.name in MUTATIONS)) throw badRequest(`Unknown change "${m.name}". Update the app.`);
      const name = m.name as MutationName;
      const args = MUTATIONS[name].parse(m.args) as Args<typeof name>;
      result = await tx(db, async (t) => {
        const ws = await workspaceOf(t, name, args as Record<string, unknown>);
        const role = await requireRole(t, ws, user.id);
        await lockWorkspace(t, ws);
        await apply({ t, userId: user.id, userName: user.name.split(/\s+/)[0]!, }, ws, role, name, args);
        await t.query("INSERT INTO applied_mutations (id, user_id, result) VALUES ($1, $2, $3)", [m.id, user.id, JSON.stringify({ id: m.id, ok: true })]);
        await announce(t, ws);
        touched.add(ws);
        return { id: m.id, ok: true as const };
      });
    } catch (e) {
      const err = e instanceof ApiError ? e : e instanceof z.ZodError ? badRequest(e.issues[0]?.message ?? "Invalid change", String(e.issues[0]?.path[0] ?? "")) : null;
      if (!err) throw e;
      result = { id: m.id, ok: false, error: { code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) } };
      // Rejections are remembered too, so a retry gets the same answer instead of a second attempt.
      await db.query("INSERT INTO applied_mutations (id, user_id, result) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING", [m.id, user.id, JSON.stringify(result)]);
    }
    results.push(result);
  }
  return { results, touched: [...touched] };
}

export function syncRoutes(app: FastifyInstance, db: Db) {
  app.get<{ Params: { id: string }; Querystring: { since?: string } }>("/workspaces/:id/sync", async (req) => {
    const me = currentUser(req);
    const since = Math.max(0, Number(req.query.since ?? 0) || 0);
    await requireRole(db, req.params.id, me.id);
    return pull(db, req.params.id, since);
  });

  app.post("/sync/push", { bodyLimit: 2 * 1024 * 1024 }, async (req) => {
    const me = currentUser(req);
    const body = z.object({ mutations: z.array(z.object({ id: uuid, name: z.string().max(40), args: z.unknown() })).max(200) }).parse(req.body);
    const { results } = await applyMutations(db, me, body.mutations);
    return { results };
  });
}
