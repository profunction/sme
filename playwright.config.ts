import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
const database = join(
  mkdtempSync(join(tmpdir(), "nightbrew-e2e-")),
  "chat.sqlite3",
);
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true,
    launchOptions: {
      executablePath: process.env.NIGHTBREW_CHROMIUM || "/usr/bin/chromium",
    },
  },
  webServer: [
    {
      command:
        ".venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765",
      url: "http://127.0.0.1:8765/health",
      reuseExistingServer: false,
      env: {
        NIGHTBREW_SESSION_TOKEN: "nightbrew-e2e-not-production",
        NIGHTBREW_DB: database,
      },
    },
    {
      command: "npm run dev",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
    },
  ],
});
