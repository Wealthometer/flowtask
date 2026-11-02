import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import WebSocket from "ws";
import { sendPushBatch } from "../src/notify.ts";
import { mentions } from "../src/sync.ts";
import { harness, join, signUp, workspaceWithProject, type Harness } from "./helpers.ts";

let h: Harness;
before(async () => {
  h = await harness();
});
after(async () => {
  await h.close();
});

// ── Accounts ────────────────────────────────────────────────────────────────

test("sign up, log in, log out", async () => {
  const email = `kofi-${randomUUID().slice(0, 6)}@example.com`;
  const signup = await h.app.inject({ method: "POST", url: "/auth/signup", payload: { email: email.toUpperCase(), password: "correct horse", name: "Kofi" } });
  assert.equal(signup.statusCode, 201);
  assert.equal(signup.json().user.email, email, "emails are stored lower-case");

  const dup = await h.app.inject({ method: "POST", url: "/auth/signup", payload: { email, password: "another one", name: "Kofi" } });
  assert.equal(dup.statusCode, 409);
  assert.equal(dup.json().error.field, "email");

  const wrong = await h.app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "nope nope" } });
  assert.equal(wrong.statusCode, 400);
  assert.match(wrong.json().error.message, /don't match/);

  const login = await h.app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "correct horse" } });
  assert.equal(login.statusCode, 200);
  const token = login.json().token;
  const me = await h.app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${token}` } });
  assert.equal(me.json().name, "Kofi");

  await h.app.inject({ method: "POST", url: "/auth/logout", headers: { authorization: `Bearer ${token}` } });
  const after = await h.app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${token}` } });
  assert.equal(after.statusCode, 401);
});

test("short passwords and bad emails are refused with the field named", async () => {
  const r = await h.app.inject({ method: "POST", url: "/auth/signup", payload: { email: "not-an-email", password: "short", name: "X" } });
  assert.equal(r.statusCode, 400);
  assert.equal(r.json().error.field, "email");
  const r2 = await h.app.inject({ method: "POST", url: "/auth/signup", payload: { email: "ok@example.com", password: "short", name: "X" } });
  assert.equal(r2.json().error.field, "password");
});

test("repeated wrong passwords are rate limited", async () => {
  const ada = await signUp(h);
  let last = 0;
  for (let i = 0; i < 12; i++) {
    last = (await h.app.inject({ method: "POST", url: "/auth/login", payload: { email: ada.user.email, password: "wrong wrong" } })).statusCode;
  }
  assert.equal(last, 429);
});

test("changing the password signs out other devices", async () => {
  const ada = await signUp(h);
  const other = (await h.app.inject({ method: "POST", url: "/auth/login", payload: { email: ada.user.email, password: "correct horse" } })).json().token;
  const r = await ada.call("POST", "/me/password", { current: "correct horse", next: "battery staple" });
  assert.equal(r.status, 200);
  assert.equal((await h.app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${other}` } })).statusCode, 401);
  assert.equal((await ada.call("GET", "/me")).status, 200);
});

// ── Workspaces and invites ──────────────────────────────────────────────────

test("a new workspace comes with a starter project", async () => {
  const ada = await signUp(h);
  const ws = (await ada.call("POST", "/workspaces", { name: "Studio" })).body.workspace;
  const data = await ada.sync(ws.id);
  assert.equal(data.projects.length, 1);
  assert.equal(data.statuses.length, 4);
  assert.equal(data.tasks.length, 5);
  assert.ok(data.tasks.every((t: any) => t.assignee_id === ada.user.id));
  assert.equal(data.members[0].role, "owner");
});

test("invites let people join once, and expire when used up", async () => {
  const ada = await signUp(h);
  const { workspaceId } = await workspaceWithProject(ada);
  const invite = (await ada.call("POST", `/workspaces/${workspaceId}/invites`, { maxUses: 1 })).body.invite;
  assert.match(invite.code, /^[A-HJ-NP-Z2-9]{10}$/);

  const tunde = await signUp(h, "Tunde Bello");
  const preview = await tunde.call("GET", `/invites/${invite.code.toLowerCase()}`);
  assert.equal(preview.body.workspace.name, "Studio");
  assert.equal((await tunde.call("POST", `/invites/${invite.code}/accept`)).body.joined, true);
  assert.equal((await tunde.call("POST", `/invites/${invite.code}/accept`)).body.joined, false, "joining twice is harmless");

  const mei = await signUp(h, "Mei Lin");
  const used = await mei.call("POST", `/invites/${invite.code}/accept`);
  assert.equal(used.status, 409);
  assert.match(used.body.error.message, /expired or been used up/);
});

test("people outside a workspace can't see or change it", async () => {
  const ada = await signUp(h);
  const { workspaceId, projectId, todo } = await workspaceWithProject(ada);
  const eve = await signUp(h, "Eve");
  assert.equal((await eve.call("GET", `/workspaces/${workspaceId}/sync`)).status, 404);
  const r = await eve.push("task.create", { id: randomUUID(), projectId, statusId: todo, title: "sneaky" });
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, "not_found");
});

test("roles: members can't promote, the last owner can't leave, removing someone unassigns them", async () => {
  const ada = await signUp(h);
  const { workspaceId, projectId, todo } = await workspaceWithProject(ada);
  const tunde = await join(h, ada, workspaceId, "Tunde Bello");
  assert.equal((await tunde.call("PATCH", `/workspaces/${workspaceId}/members/${tunde.user.id}`, { role: "admin" })).status, 403);
  assert.equal((await ada.call("DELETE", `/workspaces/${workspaceId}/members/${ada.user.id}`)).status, 409);

  const taskId = randomUUID();
  await ada.push("task.create", { id: taskId, projectId, statusId: todo, title: "Write copy", assigneeId: tunde.user.id });
  assert.equal((await ada.call("DELETE", `/workspaces/${workspaceId}/members/${tunde.user.id}`)).status, 200);
  const data = await ada.sync(workspaceId);
  assert.equal(data.tasks.find((t: any) => t.id === taskId).assignee_id, null);
  assert.equal(data.members.length, 1);
  assert.equal((await tunde.call("GET", `/workspaces/${workspaceId}/sync`)).status, 404);

  // Promote then let the original owner leave.
  const mei = await join(h, ada, workspaceId, "Mei Lin");
  assert.equal((await ada.call("PATCH", `/workspaces/${workspaceId}/members/${mei.user.id}`, { role: "owner" })).status, 200);
  assert.equal((await ada.call("DELETE", `/workspaces/${workspaceId}/members/${ada.user.id}`)).status, 200);
});

// ── Sync ────────────────────────────────────────────────────────────────────

test("pull returns only what changed since the cursor, including deletes", async () => {
  const ada = await signUp(h);
  const { workspaceId, projectId, todo, done } = await workspaceWithProject(ada);
  const first = await ada.sync(workspaceId);
  assert.ok(first.cursor > 0);

  const a = randomUUID(), b = randomUUID();
  await ada.push("task.create", { id: a, projectId, statusId: todo, title: "A" });
  await ada.push("task.create", { id: b, projectId, statusId: todo, title: "B" });
  const second = await ada.sync(workspaceId, first.cursor);
  assert.deepEqual(second.tasks.map((t: any) => t.title).sort(), ["A", "B"]);
  assert.equal(second.projects.length, 0, "unchanged rows don't come back");

  await ada.push("task.update", { id: a, statusId: done });
  await ada.push("task.delete", { id: b });
  const third = await ada.sync(workspaceId, second.cursor);
  const byId = Object.fromEntries(third.tasks.map((t: any) => [t.id, t]));
  assert.ok(byId[a].completed_at, "moving into a done column completes the task");
  assert.ok(byId[b].deleted_at, "deletes are sent so phones can drop them");
  assert.equal((await ada.sync(workspaceId, third.cursor)).tasks.length, 0);
  assert.ok(!(await ada.sync(workspaceId)).tasks.some((t: any) => t.id === b), "a full pull leaves deleted rows out");
});

test("a retried push is applied once, and rejections are explained", async () => {
  const ada = await signUp(h);
  const { workspaceId, projectId, todo } = await workspaceWithProject(ada);
  const mutationId = randomUUID();
  const commentTask = randomUUID();
  await ada.push("task.create", { id: commentTask, projectId, statusId: todo, title: "Hi" });
  const args = { id: randomUUID(), taskId: commentTask, body: "First!" };
  assert.equal((await ada.push("comment.create", args, mutationId)).ok, true);
  assert.equal((await ada.push("comment.create", { ...args, id: randomUUID() }, mutationId)).ok, true);
  assert.equal((await ada.sync(workspaceId)).comments.length, 1);

  const bad = await ada.push("task.create", { id: randomUUID(), projectId, statusId: todo, title: "   " });
  assert.equal(bad.ok, false);
  assert.equal(bad.error?.message, "Give the task a title");
  const unknown = await ada.push("task.explode", {});
  assert.match(unknown.error!.message, /Update the app/);
});

test("tasks can't use another project's column or someone outside the team", async () => {
  const ada = await signUp(h);
  const a = await workspaceWithProject(ada);
  const b = await workspaceWithProject(ada);
  const wrongColumn = await ada.push("task.create", { id: randomUUID(), projectId: a.projectId, statusId: b.todo, title: "x" });
  assert.equal(wrongColumn.error?.field, "statusId");
  const stranger = await signUp(h, "Stranger");
  const wrongPerson = await ada.push("task.create", { id: randomUUID(), projectId: a.projectId, statusId: a.todo, title: "x", assigneeId: stranger.user.id });
  assert.equal(wrongPerson.error?.field, "assigneeId");
});

test("deleting a column moves its tasks, and a project keeps a done column", async () => {
  const ada = await signUp(h);
  const { workspaceId, projectId, todo, doing, done } = await workspaceWithProject(ada);
  const t = randomUUID();
  await ada.push("task.create", { id: t, projectId, statusId: doing, title: "Moving" });
  assert.equal((await ada.push("status.delete", { id: doing, moveTo: todo })).ok, true);
  const data = await ada.sync(workspaceId);
  assert.equal(data.tasks.find((x: any) => x.id === t).status_id, todo);
  assert.equal(data.statuses.length, 2);
  const lastDone = await ada.push("status.delete", { id: done, moveTo: todo });
  assert.match(lastDone.error!.message, /column for finished work/);
});

test("comments notify the assignee and creator, and @mentions notify who's named", async () => {
  const ada = await signUp(h);
  const { workspaceId, projectId, todo } = await workspaceWithProject(ada);
  const tunde = await join(h, ada, workspaceId, "Tunde Bello");
  const mei = await join(h, ada, workspaceId, "Mei Lin");
  const taskId = randomUUID();
  await ada.push("task.create", { id: taskId, projectId, statusId: todo, title: "Hero copy", assigneeId: tunde.user.id });

  let inbox = (await tunde.call("GET", "/notifications")).body;
  assert.equal(inbox.unread, 1);
  assert.equal(inbox.notifications[0].text, "Ada assigned you “Hero copy”");

  await tunde.push("comment.create", { id: randomUUID(), taskId, body: "Done a draft. @mei can you check the tone?" });
  const adaInbox = (await ada.call("GET", "/notifications")).body;
  assert.equal(adaInbox.notifications[0].kind, "comment");
  const meiInbox = (await mei.call("GET", "/notifications")).body;
  assert.equal(meiInbox.notifications[0].kind, "mention");
  assert.equal((await tunde.call("GET", "/notifications")).body.unread, 1, "you don't get notified about your own comment");

  await tunde.call("POST", "/notifications/read");
  inbox = (await tunde.call("GET", "/notifications")).body;
  assert.equal(inbox.unread, 0);

  // Finishing someone else's task tells them.
  await tunde.push("task.update", { id: taskId, statusId: (await ada.sync(workspaceId)).statuses.find((s: any) => s.category === "done").id });
  assert.equal((await ada.call("GET", "/notifications")).body.notifications[0].text, "Tunde finished “Hero copy”");
});

test("mentions match first names and full names, not email-like text", () => {
  const people = [{ id: "1", name: "Mei Lin" }, { id: "2", name: "Tunde Bello" }, { id: "3", name: "Ada" }];
  assert.deepEqual(mentions("hey @mei and @Tunde Bello", people).sort(), ["1", "2"]);
  assert.deepEqual(mentions("write to ada@example.com", people), []);
  assert.deepEqual(mentions("@adaeze is new", people), []);
});

test("only authors edit their comments; admins can delete anyone's", async () => {
  const ada = await signUp(h);
  const { workspaceId, projectId, todo } = await workspaceWithProject(ada);
  const tunde = await join(h, ada, workspaceId, "Tunde Bello");
  const taskId = randomUUID();
  await ada.push("task.create", { id: taskId, projectId, statusId: todo, title: "x" });
  const commentId = randomUUID();
  await tunde.push("comment.create", { id: commentId, taskId, body: "mine" });
  assert.equal((await ada.push("comment.update", { id: commentId, body: "hijack" })).ok, false);
  assert.equal((await tunde.push("comment.update", { id: commentId, body: "edited" })).ok, true);
  assert.equal((await ada.push("comment.delete", { id: commentId })).ok, true);
});

test("account deletion keeps shared work but removes the person", async () => {
  const ada = await signUp(h);
  const { workspaceId } = await workspaceWithProject(ada);
  const tunde = await join(h, ada, workspaceId, "Tunde Bello");
  const blocked = await ada.call("DELETE", "/me", { password: "correct horse" });
  assert.equal(blocked.status, 409, "the only owner of a shared workspace must hand it over first");
  assert.equal((await tunde.call("DELETE", "/me", { password: "correct horse" })).status, 200);
  const data = await ada.sync(workspaceId);
  assert.equal(data.members.length, 1);
  assert.equal((await tunde.call("GET", "/me")).status, 401);
});

// ── Push notifications ──────────────────────────────────────────────────────

test("queued pushes go to Expo, and dead tokens are dropped", async () => {
  const received: any[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const msgs = JSON.parse(body);
      received.push(...msgs);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: msgs.map((m: any) => (m.to.includes("dead") ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok" })) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  try {
    const ada = await signUp(h);
    const { workspaceId, projectId, todo } = await workspaceWithProject(ada);
    const tunde = await join(h, ada, workspaceId, "Tunde Bello");
    await tunde.call("POST", "/me/push-tokens", { token: "ExponentPushToken[alive-123456]", platform: "ios" });
    await tunde.call("POST", "/me/push-tokens", { token: "ExponentPushToken[dead-1234567]", platform: "android" });
    await h.db.query("UPDATE push_outbox SET sent_at = now() WHERE sent_at IS NULL");
    await ada.push("task.create", { id: randomUUID(), projectId, statusId: todo, title: "Ship it", assigneeId: tunde.user.id });
    await sendPushBatch(h.db, { ...h.config, pushEnabled: true, pushUrl: `http://localhost:${port}` });
    assert.equal(received.length, 2);
    assert.equal(received[0].body, "Ada assigned you “Ship it”");
    const left = await h.db.query("SELECT token FROM push_tokens WHERE user_id = $1", [tunde.user.id]);
    assert.deepEqual(left.rows.map((r) => r.token), ["ExponentPushToken[alive-123456]"]);
  } finally {
    server.close();
  }
});

// ── Live updates ────────────────────────────────────────────────────────────

test("subscribed sockets hear about changes in their workspace only", async () => {
  await h.app.listen({ port: 0, host: "127.0.0.1" });
  const port = (h.app.server.address() as { port: number }).port;
  const ada = await signUp(h);
  const mine = await workspaceWithProject(ada);
  const other = await workspaceWithProject(ada);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/live`);
  const messages: any[] = [];
  ws.on("message", (m) => messages.push(JSON.parse(String(m))));
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ type: "auth", token: ada.token }));
  await waitFor(() => messages.some((m) => m.type === "ready"));
  ws.send(JSON.stringify({ type: "subscribe", workspaceIds: [mine.workspaceId] }));
  await waitFor(() => messages.some((m) => m.type === "subscribed"));

  await ada.push("task.create", { id: randomUUID(), projectId: other.projectId, statusId: other.todo, title: "elsewhere" });
  await ada.push("task.create", { id: randomUUID(), projectId: mine.projectId, statusId: mine.todo, title: "here" });
  await waitFor(() => messages.some((m) => m.type === "changed"));
  const changed = messages.filter((m) => m.type === "changed");
  assert.ok(changed.every((m) => m.workspaceId === mine.workspaceId));
  ws.close();

  const bad = new WebSocket(`ws://127.0.0.1:${port}/live`);
  await new Promise((r) => bad.on("open", r));
  const closed = new Promise<number>((r) => bad.on("close", (code) => r(code)));
  bad.send(JSON.stringify({ type: "auth", token: "nope" }));
  assert.equal(await closed, 4001);
});

async function waitFor(fn: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}
