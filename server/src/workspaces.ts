import { randomInt, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser, type RateLimiter } from "./auth.ts";
import { lockWorkspace, tx, type Db, type Tx } from "./db.ts";
import { badRequest, conflict, forbidden, notFound } from "./errors.ts";

export type Role = "owner" | "admin" | "member";
const RANK: Record<Role, number> = { member: 1, admin: 2, owner: 3 };

export async function membership(q: Db | Tx, workspaceId: string, userId: string): Promise<Role | null> {
  const r = await q.query<{ role: Role }>("SELECT role FROM members WHERE workspace_id = $1 AND user_id = $2 AND deleted_at IS NULL", [workspaceId, userId]);
  return r.rows[0]?.role ?? null;
}

/** Throws unless the person belongs to the workspace with at least `min` role. */
export async function requireRole(q: Db | Tx, workspaceId: string, userId: string, min: Role = "member"): Promise<Role> {
  const role = await membership(q, workspaceId, userId);
  if (!role) throw notFound("That workspace doesn't exist, or you're not in it");
  if (RANK[role] < RANK[min]) throw forbidden(min === "owner" ? "Only an owner can do that" : "Only owners and admins can do that");
  return role;
}

export async function announce(q: Db | Tx, workspaceId: string) {
  await q.query("SELECT pg_notify('flowtask_changes', $1)", [workspaceId]);
}

// No look-alike characters, so codes can be read out or typed from a screenshot.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function inviteCode() {
  let s = "";
  for (let i = 0; i < 10; i++) s += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return s;
}

export const DEFAULT_STATUSES = [
  { name: "To do", color: "lemon", category: "todo" },
  { name: "Doing", color: "sky", category: "doing" },
  { name: "Review", color: "grape", category: "doing" },
  { name: "Done", color: "mint", category: "done" },
] as const;

/** A first project so a new workspace isn't empty: a short tour written as tasks. */
async function seedStarterProject(t: Tx, workspaceId: string, userId: string) {
  const projectId = randomUUID();
  await t.query("INSERT INTO projects (id, workspace_id, name, color, icon, position, created_by) VALUES ($1, $2, 'Getting started', 'tangerine', 'rocket-launch', 0, $3)", [projectId, workspaceId, userId]);
  const ids: string[] = [];
  for (const [i, s] of DEFAULT_STATUSES.entries()) {
    const id = randomUUID();
    ids.push(id);
    await t.query("INSERT INTO statuses (id, project_id, workspace_id, name, color, category, position) VALUES ($1, $2, $3, $4, $5, $6, $7)", [id, projectId, workspaceId, s.name, s.color, s.category, i]);
  }
  const tasks: [string, number, string, number | null][] = [
    ["Tap the circle to finish a task", 0, "high", 0],
    ["Invite your team from the Me tab", 0, "medium", 1],
    ["Open a task to add a checklist and comments", 1, "medium", null],
    ["Make a project for something real", 0, "low", 3],
    ["Say hello to FlowTask", 3, "low", null],
  ];
  for (const [i, [title, s, priority, dueIn]] of tasks.entries()) {
    await t.query(
      `INSERT INTO tasks (id, project_id, workspace_id, status_id, title, priority, position, created_by, assignee_id, completed_at, due_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, CASE WHEN $9 THEN now() END, CASE WHEN $10::int IS NULL THEN NULL ELSE current_date + $10::int END)`,
      [randomUUID(), projectId, workspaceId, ids[s], title, priority, i, userId, s === 3, dueIn],
    );
  }
}

export function workspaceRoutes(app: FastifyInstance, db: Db, limiter: RateLimiter) {
  const workspaceName = z.string().trim().min(1, "Name your workspace").max(60, "Keep it under 60 characters");

  app.get("/workspaces", async (req) => {
    const me = currentUser(req);
    const r = await db.query(
      `SELECT w.id, w.name, m.role, w.created_at,
              (SELECT COUNT(*)::int FROM members x WHERE x.workspace_id = w.id AND x.deleted_at IS NULL) AS member_count
         FROM workspaces w JOIN members m ON m.workspace_id = w.id AND m.user_id = $1 AND m.deleted_at IS NULL
        ORDER BY m.joined_at`,
      [me.id],
    );
    return { workspaces: r.rows };
  });

  app.post("/workspaces", async (req, reply) => {
    const me = currentUser(req);
    limiter.check(`ws:create:${me.id}`, 20, 3_600_000);
    const body = z.object({ name: workspaceName, starter: z.boolean().default(true) }).parse(req.body);
    const ws = await tx(db, async (t) => {
      const w = (await t.query<{ id: string; name: string }>("INSERT INTO workspaces (name, created_by) VALUES ($1, $2) RETURNING id, name", [body.name, me.id])).rows[0]!;
      await t.query("INSERT INTO members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')", [w.id, me.id]);
      if (body.starter) await seedStarterProject(t, w.id, me.id);
      return w;
    });
    reply.code(201);
    return { workspace: { ...ws, role: "owner", member_count: 1 } };
  });

  app.patch<{ Params: { id: string } }>("/workspaces/:id", async (req) => {
    const me = currentUser(req);
    const body = z.object({ name: workspaceName }).parse(req.body);
    await tx(db, async (t) => {
      await requireRole(t, req.params.id, me.id, "admin");
      await lockWorkspace(t, req.params.id);
      await t.query("UPDATE workspaces SET name = $2 WHERE id = $1", [req.params.id, body.name]);
      await announce(t, req.params.id);
    });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/workspaces/:id", async (req) => {
    const me = currentUser(req);
    await tx(db, async (t) => {
      await requireRole(t, req.params.id, me.id, "owner");
      await t.query("DELETE FROM workspaces WHERE id = $1", [req.params.id]);
    });
    await announce(db, req.params.id);
    return { ok: true };
  });

  // ── Invites ───────────────────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>("/workspaces/:id/invites", async (req, reply) => {
    const me = currentUser(req);
    const body = z
      .object({ role: z.enum(["admin", "member"]).default("member"), days: z.number().int().min(1).max(30).default(7), maxUses: z.number().int().min(1).max(100).default(20) })
      .parse(req.body ?? {});
    await requireRole(db, req.params.id, me.id, body.role === "admin" ? "admin" : "member");
    const code = inviteCode();
    const r = await db.query(
      `INSERT INTO invites (code, workspace_id, role, created_by, expires_at, max_uses) VALUES ($1, $2, $3, $4, now() + make_interval(days => $5), $6)
       RETURNING code, role, expires_at, max_uses, uses`,
      [code, req.params.id, body.role, me.id, body.days, body.maxUses],
    );
    reply.code(201);
    return { invite: r.rows[0] };
  });

  app.get<{ Params: { id: string } }>("/workspaces/:id/invites", async (req) => {
    const me = currentUser(req);
    await requireRole(db, req.params.id, me.id, "admin");
    const r = await db.query(
      `SELECT i.code, i.role, i.expires_at, i.max_uses, i.uses, u.name AS created_by_name FROM invites i JOIN users u ON u.id = i.created_by
        WHERE i.workspace_id = $1 AND i.revoked_at IS NULL AND i.expires_at > now() AND i.uses < i.max_uses ORDER BY i.created_at DESC`,
      [req.params.id],
    );
    return { invites: r.rows };
  });

  app.delete<{ Params: { id: string; code: string } }>("/workspaces/:id/invites/:code", async (req) => {
    const me = currentUser(req);
    await requireRole(db, req.params.id, me.id, "admin");
    await db.query("UPDATE invites SET revoked_at = now() WHERE code = $1 AND workspace_id = $2", [req.params.code.toUpperCase(), req.params.id]);
    return { ok: true };
  });

  const findInvite = async (q: Db | Tx, raw: string, lock = false, usable = true) => {
    const code = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const r = await q.query<{ code: string; workspace_id: string; role: Role; workspace_name: string; inviter: string; members: number; usable: boolean }>(
      `SELECT i.code, i.workspace_id, i.role, w.name AS workspace_name, u.name AS inviter,
              (SELECT COUNT(*)::int FROM members m WHERE m.workspace_id = w.id AND m.deleted_at IS NULL) AS members,
              (i.revoked_at IS NULL AND i.expires_at > now() AND i.uses < i.max_uses) AS usable
         FROM invites i JOIN workspaces w ON w.id = i.workspace_id JOIN users u ON u.id = i.created_by
        WHERE i.code = $1 ${lock ? "FOR UPDATE OF i" : ""}`,
      [code],
    );
    const inv = r.rows[0];
    if (!inv) throw notFound("That invite code doesn't exist. Check it with whoever sent it.");
    if (usable && !inv.usable) throw conflict("That invite has expired or been used up. Ask for a new one.");
    return inv;
  };

  app.get<{ Params: { code: string } }>("/invites/:code", async (req) => {
    const me = currentUser(req);
    limiter.check(`invite:${me.id}`, 30, 600_000);
    const inv = await findInvite(db, req.params.code);
    return { workspace: { id: inv.workspace_id, name: inv.workspace_name, members: inv.members }, invitedBy: inv.inviter, role: inv.role, alreadyMember: !!(await membership(db, inv.workspace_id, me.id)) };
  });

  app.post<{ Params: { code: string } }>("/invites/:code/accept", async (req) => {
    const me = currentUser(req);
    limiter.check(`invite:${me.id}`, 30, 600_000);
    const result = await tx(db, async (t) => {
      const found = await findInvite(t, req.params.code, true, false);
      if (await membership(t, found.workspace_id, me.id)) return { workspaceId: found.workspace_id, joined: false };
      const inv = await findInvite(t, req.params.code, true);
      await lockWorkspace(t, inv.workspace_id);
      await t.query(
        `INSERT INTO members (workspace_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role, deleted_at = NULL, joined_at = now()`,
        [inv.workspace_id, me.id, inv.role],
      );
      await t.query("UPDATE invites SET uses = uses + 1 WHERE code = $1", [inv.code]);
      await t.query("INSERT INTO activity (workspace_id, actor_id, kind) VALUES ($1, $2, 'member.joined')", [inv.workspace_id, me.id]);
      await announce(t, inv.workspace_id);
      return { workspaceId: inv.workspace_id, joined: true };
    });
    return result;
  });

  // ── Members ───────────────────────────────────────────────────────────────

  app.patch<{ Params: { id: string; userId: string } }>("/workspaces/:id/members/:userId", async (req) => {
    const me = currentUser(req);
    const body = z.object({ role: z.enum(["owner", "admin", "member"]) }).parse(req.body);
    await tx(db, async (t) => {
      const myRole = await requireRole(t, req.params.id, me.id, "admin");
      await lockWorkspace(t, req.params.id);
      const theirs = await membership(t, req.params.id, req.params.userId);
      if (!theirs) throw notFound("That person isn't in this workspace");
      if ((theirs === "owner" || body.role === "owner") && myRole !== "owner") throw forbidden("Only an owner can change who's an owner");
      if (theirs === "owner" && body.role !== "owner" && (await ownerCount(t, req.params.id)) === 1) throw conflict("A workspace needs at least one owner");
      await t.query("UPDATE members SET role = $3 WHERE workspace_id = $1 AND user_id = $2", [req.params.id, req.params.userId, body.role]);
      await announce(t, req.params.id);
    });
    return { ok: true };
  });

  /** Removes someone, or leaves when it's yourself. Their open tasks become unassigned. */
  app.delete<{ Params: { id: string; userId: string } }>("/workspaces/:id/members/:userId", async (req) => {
    const me = currentUser(req);
    const self = req.params.userId === me.id;
    await tx(db, async (t) => {
      const myRole = await requireRole(t, req.params.id, me.id, self ? "member" : "admin");
      await lockWorkspace(t, req.params.id);
      const theirs = await membership(t, req.params.id, req.params.userId);
      if (!theirs) throw notFound("That person isn't in this workspace");
      if (!self && theirs === "owner" && myRole !== "owner") throw forbidden("Only an owner can remove an owner");
      if (theirs === "owner" && (await ownerCount(t, req.params.id)) === 1) {
        throw conflict(self ? "You're the only owner. Make someone else an owner before you leave." : "A workspace needs at least one owner");
      }
      await t.query("UPDATE members SET deleted_at = now() WHERE workspace_id = $1 AND user_id = $2", [req.params.id, req.params.userId]);
      await t.query("UPDATE tasks SET assignee_id = NULL, updated_at = now() WHERE workspace_id = $1 AND assignee_id = $2 AND completed_at IS NULL", [req.params.id, req.params.userId]);
      await t.query("INSERT INTO activity (workspace_id, actor_id, kind, data) VALUES ($1, $2, $3, $4)", [
        req.params.id, me.id, self ? "member.left" : "member.removed", JSON.stringify({ userId: req.params.userId }),
      ]);
      await announce(t, req.params.id);
    });
    return { ok: true };
  });
}

async function ownerCount(t: Tx, workspaceId: string): Promise<number> {
  return (await t.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM members WHERE workspace_id = $1 AND role = 'owner' AND deleted_at IS NULL", [workspaceId])).rows[0]!.n;
}

export { badRequest };
