import { useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import { randomUUID } from "expo-crypto";
import { ApiError, liveUrl, OfflineError, request } from "./api.ts";
import { applyPull, emptyWorkspace, view, type Mutation, type MutationArgs, type MutationName } from "./model.ts";
import { secrets, storage } from "./storage";
import type { Notification, PullResult, Role, Swatch, User, WorkspaceData, WorkspaceSummary } from "./types.ts";

// ── State ───────────────────────────────────────────────────────────────────

export type Net = "online" | "syncing" | "offline";
type Pending = Mutation & { sent?: boolean };

export type State = {
  ready: boolean;
  /** True once the list of workspaces is known (from the cache or the server). */
  workspacesKnown: boolean;
  server: string;
  user: User | null;
  token: string | null;
  workspaces: WorkspaceSummary[];
  currentId: string | null;
  bases: Record<string, WorkspaceData>;
  outbox: Pending[];
  notifications: Notification[];
  unread: number;
  net: Net;
  toast: { id: number; text: string; tone: "error" | "ok" } | null;
};

const DEFAULT_SERVER = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
const KEY = "flowtask:v1";
const TOKEN_KEY = "flowtask.token";

let state: State = {
  ready: false, workspacesKnown: false, server: DEFAULT_SERVER, user: null, token: null, workspaces: [], currentId: null, bases: {}, outbox: [],
  notifications: [], unread: 0, net: "online", toast: null,
};
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
  if (state.ready) schedulePersist();
}

export function getState() {
  return state;
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => selector(state),
    () => selector(state),
  );
}

// The current workspace as the person sees it, recomputed only when its inputs change.
let viewCache: { base?: WorkspaceData; outbox?: Pending[]; me?: string; value: WorkspaceData | null } = { value: null };
export function currentView(s: State = state): WorkspaceData | null {
  const base = s.currentId ? s.bases[s.currentId] : undefined;
  if (!base || !s.user) return null;
  if (viewCache.base === base && viewCache.outbox === s.outbox && viewCache.me === s.user.id) return viewCache.value;
  viewCache = { base, outbox: s.outbox, me: s.user.id, value: view(base, s.outbox, s.user.id) };
  return viewCache.value;
}

export function useWorkspace(): WorkspaceData | null {
  return useStore(currentView);
}

let toastId = 0;
export function toast(text: string, tone: "error" | "ok" = "error") {
  set({ toast: { id: ++toastId, text, tone } });
}

// ── Persistence ─────────────────────────────────────────────────────────────

// Every change is written straight away, batched so several updates in one tick make one write.
let persistQueued = false;
function schedulePersist() {
  if (persistQueued) return;
  persistQueued = true;
  void Promise.resolve().then(() => {
    persistQueued = false;
    void persist();
  });
}

async function persist() {
  const { server, user, workspaces, currentId, bases, outbox, notifications, unread } = state;
  await storage.set(KEY, JSON.stringify({ server, user, workspaces, currentId, bases, outbox, notifications, unread })).catch(() => {});
}

export async function boot() {
  if (state.ready) return;
  try {
    const raw = await storage.get(KEY);
    const token = await secrets.get(TOKEN_KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<State>) : {};
    state = { ...state, ...saved, token: token ?? null, user: token ? (saved.user ?? null) : null, net: "online", toast: null, workspacesKnown: !!saved.workspaces?.length };
  } catch {
    // A damaged cache is just a cold start; the server has the data.
  }
  set({ ready: true });
  if (state.token) {
    void refreshWorkspaces().catch(() => {});
    void syncNow();
    connectLive();
  }
  AppState.addEventListener("change", (s) => {
    if (s === "active" && state.token) {
      void syncNow();
      connectLive();
    }
  });
  setInterval(() => {
    if (state.token && AppState.currentState === "active") void syncNow();
  }, 30_000);
}

// ── Talking to the server ───────────────────────────────────────────────────

async function call<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  try {
    return await request<T>(state.server, path, { ...opts, token: state.token });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && state.token) {
      await clearSession();
      toast("Your session ended. Log in again.");
    }
    throw e;
  }
}

export async function setServer(url: string) {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s]+$/.test(trimmed)) throw new ApiError(400, "invalid", "Enter an address like https://flowtask.example.com", "server");
  await request(trimmed, "/health", { timeoutMs: 8000 });
  set({ server: trimmed });
}

async function startSession(r: { token: string; user: User }) {
  await secrets.set(TOKEN_KEY, r.token);
  set({ token: r.token, user: r.user, workspaces: [], workspacesKnown: false, currentId: null, bases: {}, outbox: [], notifications: [], unread: 0 });
  await refreshWorkspaces();
  connectLive();
  void registerForPush();
}

export async function signUp(input: { name: string; email: string; password: string }) {
  await startSession(await request<{ token: string; user: User }>(state.server, "/auth/signup", { method: "POST", body: input }));
}

export async function logIn(input: { email: string; password: string }) {
  await startSession(await request<{ token: string; user: User }>(state.server, "/auth/login", { method: "POST", body: input }));
}

async function clearSession() {
  await secrets.remove(TOKEN_KEY).catch(() => {});
  closeLive();
  set({ token: null, user: null, workspaces: [], workspacesKnown: false, currentId: null, bases: {}, outbox: [], notifications: [], unread: 0 });
}

export async function logOut() {
  if (state.outbox.some((m) => !m.sent) && state.net === "offline") {
    // Caller confirms first; changes that never reached the server are lost.
  }
  await call("/auth/logout", { method: "POST" }).catch(() => {});
  await clearSession();
}

export async function refreshWorkspaces() {
  const { workspaces } = await call<{ workspaces: WorkspaceSummary[] }>("/workspaces");
  const currentId = workspaces.some((w) => w.id === state.currentId) ? state.currentId : (workspaces[0]?.id ?? null);
  const bases = Object.fromEntries(Object.entries(state.bases).filter(([id]) => workspaces.some((w) => w.id === id)));
  set({ workspaces, currentId, bases, workspacesKnown: true });
  subscribeLive();
  if (currentId && !bases[currentId]) await pullWorkspace(currentId);
}

export async function switchWorkspace(id: string) {
  set({ currentId: id });
  if (!state.bases[id]) await pullWorkspace(id).catch(() => {});
  void syncNow();
}

export async function createWorkspace(name: string) {
  const { workspace } = await call<{ workspace: WorkspaceSummary }>("/workspaces", { method: "POST", body: { name } });
  set({ workspaces: [...state.workspaces, workspace], currentId: workspace.id });
  subscribeLive();
  await pullWorkspace(workspace.id);
  return workspace;
}

export const previewInvite = (code: string) =>
  call<{ workspace: { id: string; name: string; members: number }; invitedBy: string; role: Role; alreadyMember: boolean }>(`/invites/${encodeURIComponent(code.trim())}`);

export async function acceptInvite(code: string) {
  const r = await call<{ workspaceId: string }>(`/invites/${encodeURIComponent(code.trim())}/accept`, { method: "POST" });
  await refreshWorkspaces();
  await switchWorkspace(r.workspaceId);
  return r.workspaceId;
}

export const createInvite = (workspaceId: string, role: "member" | "admin" = "member") =>
  call<{ invite: { code: string; expires_at: string } }>(`/workspaces/${workspaceId}/invites`, { method: "POST", body: { role } });

export const listInvites = (workspaceId: string) =>
  call<{ invites: { code: string; role: Role; expires_at: string; uses: number; max_uses: number; created_by_name: string }[] }>(`/workspaces/${workspaceId}/invites`);

export const revokeInvite = (workspaceId: string, code: string) => call(`/workspaces/${workspaceId}/invites/${code}`, { method: "DELETE" });

export async function renameWorkspace(id: string, name: string) {
  await call(`/workspaces/${id}`, { method: "PATCH", body: { name } });
  await refreshWorkspaces();
  void syncNow();
}

export async function setRole(workspaceId: string, userId: string, role: Role) {
  await call(`/workspaces/${workspaceId}/members/${userId}`, { method: "PATCH", body: { role } });
  await Promise.all([refreshWorkspaces(), syncNow()]);
}

export async function removeMember(workspaceId: string, userId: string) {
  await call(`/workspaces/${workspaceId}/members/${userId}`, { method: "DELETE" });
  if (userId === state.user?.id) {
    const { [workspaceId]: _gone, ...bases } = state.bases;
    set({ bases, outbox: state.outbox.filter((m) => m.workspaceId !== workspaceId) });
  }
  await refreshWorkspaces();
  void syncNow();
}

export async function deleteWorkspace(id: string) {
  await call(`/workspaces/${id}`, { method: "DELETE" });
  const { [id]: _gone, ...bases } = state.bases;
  set({ bases, outbox: state.outbox.filter((m) => m.workspaceId !== id) });
  await refreshWorkspaces();
}

export async function updateProfile(patch: { name?: string; color?: Swatch }) {
  const user = await call<User>("/me", { method: "PATCH", body: patch });
  set({ user });
  void syncNow();
}

export const changePassword = (current: string, next: string) => call("/me/password", { method: "POST", body: { current, next } });

export async function deleteAccount(password: string) {
  await call("/me", { method: "DELETE", body: { password } });
  await clearSession();
}

export async function loadNotifications() {
  const r = await call<{ notifications: Notification[]; unread: number }>("/notifications?limit=60");
  set({ notifications: r.notifications, unread: r.unread });
}

export async function markAllRead() {
  set({ unread: 0, notifications: state.notifications.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })) });
  await call("/notifications/read", { method: "POST", body: {} }).catch(() => {});
}

// ── Changes and sync ────────────────────────────────────────────────────────

let syncTimer: ReturnType<typeof setTimeout> | null = null;

/** Records a change: it shows immediately, is saved on the phone, and syncs as soon as possible. */
export function mutate<N extends MutationName>(name: N, args: MutationArgs[N], workspaceId = state.currentId) {
  if (!workspaceId) return;
  const m: Pending = { id: randomUUID(), name, args, workspaceId, createdAt: new Date().toISOString() };
  set({ outbox: [...state.outbox, m] });
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void syncNow(), 350);
}

export const newId = () => randomUUID();

let running = false;
let again = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;

/** Sends waiting changes, then pulls what changed on the server. Safe to call often. */
export async function syncNow(): Promise<void> {
  if (!state.token) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  if (retryTimer) clearTimeout(retryTimer);
  set({ net: "syncing" });
  try {
    await flush();
    if (state.currentId) await pullWorkspace(state.currentId);
    // Changes the server accepted are now part of what it sent back.
    set({ outbox: state.outbox.filter((m) => !m.sent), net: "online" });
    failures = 0;
  } catch (e) {
    if (e instanceof OfflineError) {
      set({ net: "offline" });
      failures++;
      retryTimer = setTimeout(() => void syncNow(), Math.min(60_000, 2000 * 2 ** Math.min(failures, 5)));
    } else {
      set({ net: "online" });
      if (!(e instanceof ApiError && e.status === 401)) console.warn("sync failed", e);
    }
  } finally {
    running = false;
    if (again) {
      again = false;
      void syncNow();
    }
  }
}

async function flush() {
  for (;;) {
    const batch = state.outbox.filter((m) => !m.sent).slice(0, 100);
    if (!batch.length) return;
    const { results } = await call<{ results: { id: string; ok: boolean; error?: { message: string } }[] }>("/sync/push", {
      method: "POST",
      body: { mutations: batch.map(({ id, name, args }) => ({ id, name, args })) },
    });
    const outcome = new Map(results.map((r) => [r.id, r]));
    const rejected = results.find((r) => !r.ok);
    set({
      outbox: state.outbox
        .filter((m) => outcome.get(m.id)?.ok !== false)
        .map((m) => (outcome.get(m.id)?.ok ? { ...m, sent: true } : m)),
    });
    if (rejected?.error) toast(rejected.error.message);
  }
}

async function pullWorkspace(id: string) {
  const base = state.bases[id] ?? emptyWorkspace(id, state.workspaces.find((w) => w.id === id)?.name);
  try {
    const p = await call<PullResult>(`/workspaces/${id}/sync?since=${base.cursor}`);
    set({ bases: { ...state.bases, [id]: applyPull(base, p) } });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      // Removed from the workspace, or it was deleted.
      const { [id]: _gone, ...bases } = state.bases;
      set({ bases, outbox: state.outbox.filter((m) => m.workspaceId !== id) });
      await refreshWorkspaces().catch(() => {});
      toast("You no longer have access to that workspace");
      return;
    }
    throw e;
  }
}

// ── Live updates ────────────────────────────────────────────────────────────

let socket: WebSocket | null = null;
let liveRetry = 0;
let liveTimer: ReturnType<typeof setTimeout> | null = null;

function connectLive() {
  if (!state.token || (socket && socket.readyState <= 1)) return;
  const ws = new WebSocket(liveUrl(state.server));
  socket = ws;
  ws.onopen = () => {
    liveRetry = 0;
    ws.send(JSON.stringify({ type: "auth", token: state.token }));
  };
  ws.onmessage = (e) => {
    let msg: { type?: string; workspaceId?: string };
    try {
      msg = JSON.parse(String(e.data));
    } catch {
      return;
    }
    if (msg.type === "ready") subscribeLive();
    if (msg.type === "changed") {
      if (msg.workspaceId === state.currentId) {
        if (syncTimer) clearTimeout(syncTimer);
        syncTimer = setTimeout(() => void syncNow(), 150);
      }
      void loadNotifications().catch(() => {});
    }
  };
  ws.onclose = (e) => {
    if (socket === ws) socket = null;
    if (!state.token || e.code === 4001) return;
    liveRetry++;
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = setTimeout(connectLive, Math.min(30_000, 1000 * 2 ** Math.min(liveRetry, 5)));
  };
}

function subscribeLive() {
  if (socket?.readyState === 1) socket.send(JSON.stringify({ type: "subscribe", workspaceIds: state.workspaces.map((w) => w.id) }));
}

function closeLive() {
  if (liveTimer) clearTimeout(liveTimer);
  const s = socket;
  socket = null;
  s?.close();
}

// ── Push notifications ──────────────────────────────────────────────────────

async function registerForPush() {
  if (Platform.OS === "web") return;
  try {
    const { registerPushToken } = await import("../lib/push.ts");
    const token = await registerPushToken();
    if (token) await call("/me/push-tokens", { method: "POST", body: { token, platform: Platform.OS } });
  } catch (e) {
    console.warn("push registration skipped", e);
  }
}

export { registerForPush };
