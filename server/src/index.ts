import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { migrate } from "./db.ts";

const config = loadConfig();
const { app, db } = await buildApp(config);
const applied = await migrate(db);
if (applied.length) app.log.info(`Applied migrations: ${applied.join(", ")}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    app.log.info(`${signal} received, closing`);
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.port, host: config.host });
