import { defineConfig, devices } from "@playwright/test";

/**
 * Two-person journeys through the real app (its web build) against the real API and PostgreSQL.
 * Build first: `npm run build:e2e`. The API is started from ../server on a fresh database.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:8199", ...devices["Pixel 7"], trace: "retain-on-failure" },
  webServer: [
    { command: "node e2e/start-api.mjs", url: "http://localhost:4100/health", reuseExistingServer: false, timeout: 60_000 },
    { command: "node e2e/serve.mjs", url: "http://localhost:8199", reuseExistingServer: !process.env.CI },
  ],
});
