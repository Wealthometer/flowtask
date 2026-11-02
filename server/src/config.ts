/** All configuration comes from the environment. Development defaults are safe to run locally. */
function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a whole number`);
  return n;
}

export type Config = {
  port: number;
  host: string;
  databaseUrl: string;
  dbPool: number;
  sessionDays: number;
  corsOrigins: string[];
  trustProxy: boolean;
  pushEnabled: boolean;
  pushUrl: string;
  pushAccessToken: string;
  workers: boolean;
  logLevel: string;
  /** Sign-ups allowed per IP address per hour. */
  signupsPerHour: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: int(env, "PORT", 4000),
    host: env.HOST ?? "0.0.0.0",
    databaseUrl: env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/flowtask",
    dbPool: int(env, "DATABASE_POOL", 10),
    sessionDays: int(env, "SESSION_DAYS", 60),
    corsOrigins: (env.CORS_ORIGINS ?? "http://localhost:8081,http://localhost:8099").split(",").map((s) => s.trim()).filter(Boolean),
    trustProxy: env.TRUST_PROXY === "true",
    pushEnabled: env.PUSH_ENABLED !== "false",
    pushUrl: env.EXPO_PUSH_URL ?? "https://exp.host/--/api/v2/push/send",
    pushAccessToken: env.EXPO_ACCESS_TOKEN ?? "",
    workers: env.WORKERS !== "false",
    logLevel: env.LOG_LEVEL ?? "info",
    signupsPerHour: int(env, "SIGNUPS_PER_HOUR", 10),
  };
}
