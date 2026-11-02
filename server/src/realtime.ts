import type { FastifyInstance } from "fastify";
import pg from "pg";
import type { WebSocket } from "ws";
import { userForToken } from "./auth.ts";
import type { Db } from "./db.ts";
import { membership } from "./workspaces.ts";

/**
 * Live updates. A phone opens a WebSocket, signs in with its token, and subscribes to workspaces.
 * Every committed change runs pg_notify('flowtask_changes', workspaceId); each server instance
 * listens and tells its subscribed sockets "changed", and the phone then pulls. Nothing but the
 * workspace id travels over the socket, so permissions stay with the normal sync endpoint.
 */
export class Realtime {
  private sockets = new Map<string, Set<WebSocket>>();
  private listener: pg.Client | null = null;
  private stopped = false;

  private url: string;
  private log: { warn: (o: object, m: string) => void };

  constructor(url: string, log: { warn: (o: object, m: string) => void }) {
    this.url = url;
    this.log = log;
  }

  async start() {
    const client = new pg.Client({ connectionString: this.url });
    client.on("notification", (n) => {
      if (n.channel === "flowtask_changes" && n.payload) this.fanOut(n.payload);
    });
    client.on("error", (e) => {
      this.log.warn({ err: e.message }, "realtime listener lost its connection");
      this.listener = null;
      if (!this.stopped) setTimeout(() => void this.start().catch(() => {}), 2000);
    });
    await client.connect();
    await client.query("LISTEN flowtask_changes");
    this.listener = client;
  }

  async stop() {
    this.stopped = true;
    for (const set of this.sockets.values()) for (const ws of set) ws.close(1001, "server stopping");
    await this.listener?.end().catch(() => {});
  }

  subscribe(workspaceId: string, ws: WebSocket) {
    const set = this.sockets.get(workspaceId) ?? new Set();
    set.add(ws);
    this.sockets.set(workspaceId, set);
  }

  unsubscribeAll(ws: WebSocket) {
    for (const [id, set] of this.sockets) {
      set.delete(ws);
      if (!set.size) this.sockets.delete(id);
    }
  }

  private fanOut(workspaceId: string) {
    const msg = JSON.stringify({ type: "changed", workspaceId });
    for (const ws of this.sockets.get(workspaceId) ?? []) if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

export function realtimeRoutes(app: FastifyInstance, db: Db, rt: Realtime) {
  app.get("/live", { websocket: true }, (socket) => {
    let userId: string | null = null;
    const authTimer = setTimeout(() => socket.close(4001, "sign in first"), 10_000);
    const ping = setInterval(() => socket.readyState === socket.OPEN && socket.ping(), 25_000);

    socket.on("message", async (raw) => {
      let msg: { type?: string; token?: string; workspaceIds?: string[] };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === "auth" && typeof msg.token === "string") {
        const user = await userForToken(db, msg.token).catch(() => null);
        if (!user) return socket.close(4001, "invalid token");
        userId = user.id;
        clearTimeout(authTimer);
        socket.send(JSON.stringify({ type: "ready" }));
        return;
      }
      if (msg.type === "subscribe" && userId && Array.isArray(msg.workspaceIds)) {
        rt.unsubscribeAll(socket);
        for (const id of msg.workspaceIds.slice(0, 50)) {
          if (typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) && (await membership(db, id, userId))) rt.subscribe(id, socket);
        }
        socket.send(JSON.stringify({ type: "subscribed" }));
      }
    });
    socket.on("close", () => {
      clearTimeout(authTimer);
      clearInterval(ping);
      rt.unsubscribeAll(socket);
    });
  });
}
