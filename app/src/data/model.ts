import type { Category, ChecklistItem, Comment, Priority, Project, PullResult, Status, Swatch, Task, WorkspaceData } from "./types.ts";

/**
 * The phone's copy of a workspace is: the last state the server sent ("base"), with every change
 * still waiting in the outbox replayed on top. So your edits show instantly, survive restarts and
 * going offline, and the server's answer always wins once it arrives.
 */

// ── Mutations (the same names and arguments the server accepts) ─────────────

export type StatusInput = { id: string; name: string; color: Swatch; category: Category; position: number };

export type MutationArgs = {
  "project.create": { id: string; workspaceId: string; name: string; color: Swatch; icon: string; position?: number; statuses: StatusInput[] };
  "project.update": { id: string; name?: string; color?: Swatch; icon?: string; position?: number; archived?: boolean };
  "project.delete": { id: string };
  "status.upsert": StatusInput & { projectId: string };
  "status.delete": { id: string; moveTo: string };
  "task.create": { id: string; projectId: string; statusId: string; title: string; notes?: string; assigneeId?: string | null; dueOn?: string | null; priority?: Priority; labels?: string[]; position?: number };
  "task.update": { id: string; title?: string; notes?: string; statusId?: string; assigneeId?: string | null; dueOn?: string | null; priority?: Priority; labels?: string[]; position?: number; projectId?: string };
  "task.delete": { id: string };
  "checklist.upsert": { id: string; taskId: string; title: string; done: boolean; position: number };
  "checklist.delete": { id: string };
  "comment.create": { id: string; taskId: string; body: string };
  "comment.update": { id: string; body: string };
  "comment.delete": { id: string };
};

export type MutationName = keyof MutationArgs;
export type Mutation<N extends MutationName = MutationName> = { id: string; name: N; args: MutationArgs[N]; workspaceId: string; createdAt: string };

export function emptyWorkspace(id: string, name = ""): WorkspaceData {
  return { id, name, cursor: 0, members: {}, projects: {}, statuses: {}, tasks: {}, checklist: {}, comments: {}, activity: [] };
}

// ── Merging what the server sent ────────────────────────────────────────────

function merge<T extends { id: string; deleted_at: string | null }>(into: Record<string, T>, rows: T[], full: boolean): Record<string, T> {
  const out: Record<string, T> = full ? {} : { ...into };
  for (const r of rows) {
    if (r.deleted_at) delete out[r.id];
    else out[r.id] = r;
  }
  return out;
}

export function applyPull(ws: WorkspaceData, p: PullResult): WorkspaceData {
  const seen = new Set(ws.activity.map((a) => a.id));
  const activity = p.full ? p.activity : [...p.activity.filter((a) => !seen.has(a.id)), ...ws.activity];
  return {
    ...ws,
    name: p.workspace?.name ?? ws.name,
    cursor: Math.max(p.full ? 0 : ws.cursor, p.cursor),
    members: merge(ws.members, p.members, p.full),
    projects: merge(ws.projects, p.projects, p.full),
    statuses: merge(ws.statuses, p.statuses, p.full),
    tasks: merge(ws.tasks, p.tasks, p.full),
    checklist: merge(ws.checklist, p.checklist, p.full),
    comments: merge(ws.comments, p.comments, p.full),
    activity: activity.sort((a, b) => b.version - a.version).slice(0, 200),
  };
}

// ── Replaying a change locally ──────────────────────────────────────────────

const without = <T,>(rec: Record<string, T>, id: string) => {
  const { [id]: _gone, ...rest } = rec;
  return rest;
};

/**
 * Applies a change the way the server will, so the screen is right before the server answers.
 * Anything the server would refuse is skipped here; its error comes back from the push.
 */
export function applyLocal(ws: WorkspaceData, m: Mutation, me: string, now = new Date().toISOString()): WorkspaceData {
  const a = m.args as Record<string, any>;
  switch (m.name) {
    case "project.create": {
      const x = m.args as MutationArgs["project.create"];
      if (ws.projects[x.id]) return ws;
      const project: Project = {
        id: x.id, name: x.name.trim(), color: x.color, icon: x.icon, position: x.position ?? 0, created_by: me, created_at: now, updated_at: now,
        archived_at: null, deleted_at: null, version: Number.MAX_SAFE_INTEGER,
      };
      const statuses = { ...ws.statuses };
      for (const s of x.statuses) statuses[s.id] = { ...s, project_id: x.id, deleted_at: null, version: 0 };
      return { ...ws, projects: { ...ws.projects, [x.id]: project }, statuses };
    }
    case "project.update": {
      const p = ws.projects[a.id];
      if (!p) return ws;
      const archived_at = a.archived === undefined ? p.archived_at : a.archived ? (p.archived_at ?? now) : null;
      return { ...ws, projects: { ...ws.projects, [p.id]: { ...p, ...pick(a, ["name", "color", "icon", "position"]), archived_at, updated_at: now } } };
    }
    case "project.delete": {
      const tasks = Object.fromEntries(Object.entries(ws.tasks).filter(([, t]) => t.project_id !== a.id));
      const statuses = Object.fromEntries(Object.entries(ws.statuses).filter(([, s]) => s.project_id !== a.id));
      return { ...ws, projects: without(ws.projects, a.id), tasks, statuses };
    }
    case "status.upsert": {
      const x = m.args as MutationArgs["status.upsert"];
      const status: Status = { id: x.id, project_id: x.projectId, name: x.name, color: x.color, category: x.category, position: x.position, deleted_at: null, version: 0 };
      const tasks = { ...ws.tasks };
      for (const t of Object.values(tasks)) {
        if (t.status_id === x.id) tasks[t.id] = { ...t, completed_at: x.category === "done" ? (t.completed_at ?? now) : null };
      }
      return { ...ws, statuses: { ...ws.statuses, [x.id]: status }, tasks };
    }
    case "status.delete": {
      const target = ws.statuses[a.moveTo];
      if (!target || a.moveTo === a.id) return ws;
      const tasks = { ...ws.tasks };
      for (const t of Object.values(tasks)) {
        if (t.status_id === a.id) tasks[t.id] = { ...t, status_id: target.id, completed_at: target.category === "done" ? (t.completed_at ?? now) : null };
      }
      return { ...ws, statuses: without(ws.statuses, a.id), tasks };
    }
    case "task.create": {
      const x = m.args as MutationArgs["task.create"];
      const status = ws.statuses[x.statusId];
      if (ws.tasks[x.id] || !status || !x.title.trim()) return ws;
      const task: Task = {
        id: x.id, project_id: x.projectId, status_id: x.statusId, title: x.title.trim(), notes: x.notes ?? "", assignee_id: x.assigneeId ?? null, due_on: x.dueOn ?? null,
        priority: x.priority ?? "medium", labels: x.labels ?? [], position: x.position ?? 0, created_by: me, created_at: now, updated_at: now,
        completed_at: status.category === "done" ? now : null, deleted_at: null, version: Number.MAX_SAFE_INTEGER,
      };
      return { ...ws, tasks: { ...ws.tasks, [x.id]: task } };
    }
    case "task.update": {
      const t = ws.tasks[a.id];
      if (!t) return ws;
      const next: Task = { ...t, ...pick(a, ["title", "notes", "priority", "labels", "position"]), updated_at: now };
      if (a.projectId) next.project_id = a.projectId;
      if ("assigneeId" in a) next.assignee_id = a.assigneeId;
      if ("dueOn" in a) next.due_on = a.dueOn;
      if (a.statusId) {
        const s = ws.statuses[a.statusId];
        if (!s) return ws;
        next.status_id = s.id;
        next.completed_at = s.category === "done" ? (t.completed_at ?? now) : null;
      }
      return { ...ws, tasks: { ...ws.tasks, [t.id]: next } };
    }
    case "task.delete":
      return { ...ws, tasks: without(ws.tasks, a.id) };
    case "checklist.upsert": {
      const x = m.args as MutationArgs["checklist.upsert"];
      const item: ChecklistItem = { id: x.id, task_id: x.taskId, title: x.title, done: x.done, position: x.position, deleted_at: null, version: 0 };
      return { ...ws, checklist: { ...ws.checklist, [x.id]: item } };
    }
    case "checklist.delete":
      return { ...ws, checklist: without(ws.checklist, a.id) };
    case "comment.create": {
      if (ws.comments[a.id]) return ws;
      const c: Comment = { id: a.id, task_id: a.taskId, author_id: me, body: a.body.trim(), created_at: now, edited_at: null, deleted_at: null, version: Number.MAX_SAFE_INTEGER };
      return { ...ws, comments: { ...ws.comments, [c.id]: c } };
    }
    case "comment.update": {
      const c = ws.comments[a.id];
      if (!c || c.author_id !== me) return ws;
      return { ...ws, comments: { ...ws.comments, [c.id]: { ...c, body: a.body, edited_at: now } } };
    }
    case "comment.delete":
      return { ...ws, comments: without(ws.comments, a.id) };
  }
}

function pick(a: Record<string, unknown>, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (a[k] !== undefined) out[k] = a[k];
  return out;
}

/** The workspace as the person sees it: server state plus their pending changes. */
export function view(base: WorkspaceData, outbox: Mutation[], me: string): WorkspaceData {
  return outbox.filter((m) => m.workspaceId === base.id).reduce((ws, m) => applyLocal(ws, m, me, m.createdAt), base);
}

// ── Queries ─────────────────────────────────────────────────────────────────

export const byPosition = <T extends { position: number; id: string }>(a: T, b: T) => a.position - b.position || a.id.localeCompare(b.id);

export function projectStatuses(ws: WorkspaceData, projectId: string): Status[] {
  return Object.values(ws.statuses).filter((s) => s.project_id === projectId).sort(byPosition);
}

export function projectTasks(ws: WorkspaceData, projectId: string): Task[] {
  return Object.values(ws.tasks).filter((t) => t.project_id === projectId).sort(byPosition);
}

export function progress(ws: WorkspaceData, projectId: string): { done: number; total: number } {
  const tasks = projectTasks(ws, projectId);
  return { done: tasks.filter((t) => t.completed_at).length, total: tasks.length };
}

/** Position for something added at the end of a list. */
export function nextPosition(items: { position: number }[]): number {
  return items.reduce((m, i) => Math.max(m, i.position), -1) + 1;
}

/** Position between two neighbours, used when moving a card up or down. */
export function between(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

export function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return localDate(new Date(y, m - 1, d + n));
}

/** "Today", "Tomorrow", "Yesterday", "Fri", "3 Dec", "3 Dec 2027". */
export function dueLabel(due: string, today = localDate(new Date())): string {
  if (due === today) return "Today";
  if (due === addDays(today, 1)) return "Tomorrow";
  if (due === addDays(today, -1)) return "Yesterday";
  const [y, m, d] = due.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  const diff = (date.getTime() - new Date(today + "T00:00:00").getTime()) / 86_400_000;
  if (diff > 0 && diff < 7) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: y === new Date().getFullYear() ? undefined : "numeric" });
}

export type DueState = "overdue" | "today" | "soon" | "later" | null;
export function dueState(t: Pick<Task, "due_on" | "completed_at">, today = localDate(new Date())): DueState {
  if (!t.due_on || t.completed_at) return null;
  if (t.due_on < today) return "overdue";
  if (t.due_on === today) return "today";
  if (t.due_on <= addDays(today, 3)) return "soon";
  return "later";
}

/** Tasks for the Home screen: mine, open, overdue or due today, plus anything in progress. */
export function myFocus(ws: WorkspaceData, me: string, today = localDate(new Date())): Task[] {
  const doing = new Set(Object.values(ws.statuses).filter((s) => s.category === "doing").map((s) => s.id));
  const live = new Set(Object.values(ws.projects).filter((p) => !p.archived_at).map((p) => p.id));
  return Object.values(ws.tasks)
    .filter((t) => t.assignee_id === me && !t.completed_at && live.has(t.project_id))
    .filter((t) => (t.due_on !== null && t.due_on <= today) || doing.has(t.status_id))
    .sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999") || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
}

export const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export function upcoming(ws: WorkspaceData, me: string, today = localDate(new Date())): Task[] {
  const live = new Set(Object.values(ws.projects).filter((p) => !p.archived_at).map((p) => p.id));
  return Object.values(ws.tasks)
    .filter((t) => t.assignee_id === me && !t.completed_at && live.has(t.project_id) && (t.due_on === null || t.due_on > today))
    .sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999") || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
}

/** Splits text into plain parts and @mentions of members, for highlighting in comments. */
export function mentionParts(body: string, names: string[]): { text: string; mention: boolean }[] {
  if (!names.length) return [{ text: body, mention: false }];
  const alts = names
    .flatMap((n) => [n, n.split(/\s+/)[0]!])
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(^|[^\\w@])(@(?:${alts.join("|")}))(?![\\w])`, "gi");
  const out: { text: string; mention: boolean }[] = [];
  let last = 0;
  for (const m of body.matchAll(re)) {
    const start = m.index! + m[1]!.length;
    if (start > last) out.push({ text: body.slice(last, start), mention: false });
    out.push({ text: m[2]!, mention: true });
    last = start + m[2]!.length;
  }
  if (last < body.length) out.push({ text: body.slice(last), mention: false });
  return out;
}

/** Where a task goes when its checkbox is tapped: the project's first done column, or back to the first open one. */
export function toggleTarget(ws: WorkspaceData, task: Task): string | null {
  const cols = projectStatuses(ws, task.project_id);
  const target = task.completed_at ? cols.find((s) => s.category === "todo") ?? cols.find((s) => s.category !== "done") : cols.find((s) => s.category === "done");
  return target?.id ?? null;
}
