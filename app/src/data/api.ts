/** Talks to the FlowTask server. Errors carry a message meant for people and the field to highlight. */
export class ApiError extends Error {
  status: number;
  code: string;
  field: string | undefined;
  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

/** The server couldn't be reached at all (offline, wrong address, server down). */
export class OfflineError extends Error {
  constructor() {
    super("Can't reach the server. Your changes are saved on this phone and will sync when you're back online.");
  }
}

export async function request<T>(server: string, path: string, opts: { method?: string; body?: unknown; token?: string | null; timeoutMs?: number } = {}): Promise<T> {
  let res: Response;
  // AbortSignal.timeout isn't available everywhere React Native runs, so time out by hand.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    res = await fetch(server.replace(/\/+$/, "") + path, {
      method: opts.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new OfflineError();
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  const json = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; field?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? "server", err?.message ?? `The server answered ${res.status}`, err?.field);
  }
  return json as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function liveUrl(server: string): string {
  return server.replace(/\/+$/, "").replace(/^http/, "ws") + "/live";
}
