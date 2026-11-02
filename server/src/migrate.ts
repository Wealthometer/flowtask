import { loadConfig } from "./config.ts";
import { createPool, migrate } from "./db.ts";

const config = loadConfig();
const db = createPool(config.databaseUrl, 2);
const applied = await migrate(db);
console.log(applied.length ? `Applied ${applied.join(", ")}` : "Database is up to date");
await db.end();
