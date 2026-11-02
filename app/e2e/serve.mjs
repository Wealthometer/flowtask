// Serves the exported web build (dist/) with a single-page-app fallback, for the browser tests.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL("../dist/", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 8199);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ttf": "font/ttf", ".ico": "image/x-icon" };

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  for (const candidate of [join(root, path), join(root, "index.html")]) {
    try {
      const body = await readFile(candidate);
      res.writeHead(200, { "content-type": types[extname(candidate)] ?? "application/octet-stream" });
      res.end(body);
      return;
    } catch {
      /* next candidate */
    }
  }
  res.writeHead(404).end();
}).listen(port, () => console.log(`web build on http://localhost:${port}`));
