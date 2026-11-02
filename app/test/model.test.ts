import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays, applyLocal, applyPull, between, dueLabel, dueState, emptyWorkspace, mentionParts, myFocus, nextPosition, progress, projectStatuses, view, type Mutation, type MutationArgs, type MutationName,
} from "../src/data/model.ts";
import type { PullResult, Task } from "../src/data/types.ts";

const ME = "u-ada";
let n = 0;
const m = <N extends MutationName>(name: N, args: MutationArgs[N], workspaceId = "ws"): Mutation<N> => ({ id: `m${++n}`, name, args, workspaceId, createdAt: "2026-11-02T10:00:00.000Z" });

function seeded() {
  let ws = emptyWorkspace("ws", "Studio");
  ws = applyLocal(ws, m("project.create", {
    id: "p1", workspaceId: "ws", name: "Launch", color: "tangerine", icon: "rocket-launch",
    statuses: [
      { id: "todo", name: "To do", color: "lemon", category: "todo", position: 0 },
      { id: "doing", name: "Doing", color: "sky", category: "doing", position: 1 },
      { id: "done", name: "Done", color: "mint", category: "done", position: 2 },
    ],
  }), ME);
  return ws;
}

const pull = (over: Partial<PullResult>): PullResult => ({ cursor: 1, full: false, workspace: null, members: [], projects: [], statuses: [], tasks: [], checklist: [], comments: [], activity: [], ...over });
const task = (over: Partial<Task>): Task => ({
  id: "t", project_id: "p1", status_id: "todo", title: "T", notes: "", assignee_id: null, due_on: null, priority: "medium", labels: [], position: 0, created_by: ME,
  created_at: "", updated_at: "", completed_at: null, deleted_at: null, version: 1, ...over,
});

test("creating a project adds its columns in order", () => {
  const ws = seeded();
  assert.deepEqual(projectStatuses(ws, "p1").map((s) => s.name), ["To do", "Doing", "Done"]);
});

test("moving a task into a done column completes it, and back out reopens it", () => {
  let ws = seeded();
  ws = applyLocal(ws, m("task.create", { id: "t1", projectId: "p1", statusId: "todo", title: "  Write copy  " }), ME);
  assert.equal(ws.tasks.t1!.title, "Write copy");
  ws = applyLocal(ws, m("task.update", { id: "t1", statusId: "done" }), ME, "2026-11-02T11:00:00.000Z");
  assert.equal(ws.tasks.t1!.completed_at, "2026-11-02T11:00:00.000Z");
  assert.deepEqual(progress(ws, "p1"), { done: 1, total: 1 });
  ws = applyLocal(ws, m("task.update", { id: "t1", statusId: "doing" }), ME);
  assert.equal(ws.tasks.t1!.completed_at, null);
});

test("changes to a column carry its tasks", () => {
  let ws = seeded();
  ws = applyLocal(ws, m("task.create", { id: "t1", projectId: "p1", statusId: "doing", title: "x" }), ME);
  ws = applyLocal(ws, m("status.delete", { id: "doing", moveTo: "done" }), ME);
  assert.equal(ws.tasks.t1!.status_id, "done");
  assert.ok(ws.tasks.t1!.completed_at);
  assert.equal(ws.statuses.doing, undefined);
});

test("clearing an assignee or due date is different from leaving it alone", () => {
  let ws = seeded();
  ws = applyLocal(ws, m("task.create", { id: "t1", projectId: "p1", statusId: "todo", title: "x", assigneeId: "u-tunde", dueOn: "2026-11-05" }), ME);
  ws = applyLocal(ws, m("task.update", { id: "t1", title: "y" }), ME);
  assert.equal(ws.tasks.t1!.assignee_id, "u-tunde");
  ws = applyLocal(ws, m("task.update", { id: "t1", assigneeId: null, dueOn: null }), ME);
  assert.equal(ws.tasks.t1!.assignee_id, null);
  assert.equal(ws.tasks.t1!.due_on, null);
});

test("pending changes are replayed on top of what the server sent", () => {
  const base = applyPull(seeded(), pull({ cursor: 10, tasks: [task({ id: "t1", title: "From server" })] }));
  const outbox = [m("task.update", { id: "t1", title: "Edited offline" }), m("task.create", { id: "t2", projectId: "p1", statusId: "todo", title: "New offline" })];
  const v = view(base, outbox, ME);
  assert.equal(v.tasks.t1!.title, "Edited offline");
  assert.ok(v.tasks.t2);
  assert.equal(base.tasks.t1!.title, "From server", "the base itself isn't modified");
  assert.equal(view(base, [m("task.create", { id: "t9", projectId: "p1", statusId: "todo", title: "elsewhere" }, "other-ws")], ME).tasks.t9, undefined);
});

test("a pull merges updates, drops deletes, and a full pull replaces everything", () => {
  let ws = applyPull(seeded(), pull({ cursor: 5, tasks: [task({ id: "a" }), task({ id: "b" })] }));
  ws = applyPull(ws, pull({ cursor: 9, tasks: [task({ id: "a", title: "A2", version: 9 }), task({ id: "b", deleted_at: "now" })] }));
  assert.equal(ws.tasks.a!.title, "A2");
  assert.equal(ws.tasks.b, undefined);
  assert.equal(ws.cursor, 9);
  ws = applyPull(ws, pull({ cursor: 3, full: true, tasks: [task({ id: "c" })] }));
  assert.deepEqual(Object.keys(ws.tasks), ["c"]);
  assert.equal(ws.cursor, 3);
  assert.equal(Object.keys(ws.projects).length, 0);
});

test("activity is de-duplicated and newest first", () => {
  const act = (id: string, version: number) => ({ id, actor_id: ME, kind: "task.created", project_id: null, task_id: null, data: {}, created_at: "", version });
  let ws = applyPull(emptyWorkspace("ws"), pull({ activity: [act("a", 1), act("b", 2)] }));
  ws = applyPull(ws, pull({ cursor: 3, activity: [act("b", 2), act("c", 3)] }));
  assert.deepEqual(ws.activity.map((a) => a.id), ["c", "b", "a"]);
});

test("only the author's own comment edits apply", () => {
  let ws = seeded();
  ws = applyLocal(ws, m("task.create", { id: "t1", projectId: "p1", statusId: "todo", title: "x" }), ME);
  ws = applyLocal(ws, m("comment.create", { id: "c1", taskId: "t1", body: "hi" }), "u-tunde");
  assert.equal(applyLocal(ws, m("comment.update", { id: "c1", body: "edited" }), ME).comments.c1!.body, "hi");
  assert.equal(applyLocal(ws, m("comment.update", { id: "c1", body: "edited" }), "u-tunde").comments.c1!.body, "edited");
});

test("positions slot between neighbours", () => {
  assert.equal(nextPosition([{ position: 0 }, { position: 4 }]), 5);
  assert.equal(nextPosition([]), 0);
  assert.equal(between(1, 2), 1.5);
  assert.equal(between(undefined, 2), 1);
  assert.equal(between(3, undefined), 4);
});

test("due dates read naturally and know when they're late", () => {
  const today = "2026-11-02";
  assert.equal(dueLabel(today, today), "Today");
  assert.equal(dueLabel("2026-11-03", today), "Tomorrow");
  assert.equal(dueLabel("2026-11-01", today), "Yesterday");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(dueState({ due_on: "2026-11-01", completed_at: null }, today), "overdue");
  assert.equal(dueState({ due_on: "2026-11-01", completed_at: "x" }, today), null);
  assert.equal(dueState({ due_on: "2026-11-04", completed_at: null }, today), "soon");
});

test("Home shows my open work that's due, late or in progress", () => {
  let ws = seeded();
  const add = (id: string, args: Partial<MutationArgs["task.create"]>) => {
    ws = applyLocal(ws, m("task.create", { id, projectId: "p1", statusId: "todo", title: id, assigneeId: ME, ...args }), ME);
  };
  add("late", { dueOn: "2026-10-30" });
  add("today", { dueOn: "2026-11-02", priority: "urgent" });
  add("later", { dueOn: "2026-11-20" });
  add("doing", { statusId: "doing" });
  add("theirs", { dueOn: "2026-11-02", assigneeId: "u-tunde" });
  add("finished", { statusId: "done", dueOn: "2026-11-02" });
  assert.deepEqual(myFocus(ws, ME, "2026-11-02").map((t) => t.id), ["late", "today", "doing"]);
});

test("mentions are highlighted by first or full name", () => {
  const parts = mentionParts("Thanks @mei and @Tunde Bello! email ada@x.com", ["Mei Lin", "Tunde Bello", "Ada Obi"]);
  assert.deepEqual(parts.filter((p) => p.mention).map((p) => p.text), ["@mei", "@Tunde Bello"]);
  assert.equal(parts.map((p) => p.text).join(""), "Thanks @mei and @Tunde Bello! email ada@x.com");
});
