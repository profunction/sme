import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./web-tests", workers: 1, timeout: 30000,
  use: { baseURL: "http://127.0.0.1:5181", headless: true,
    launchOptions: { executablePath: process.env.NIGHTBREW_CHROMIUM || "/usr/bin/chromium" } },
  webServer: [{ command: "node_modules/.bin/vite --config vite.web.config.ts --host 127.0.0.1 --port 5181 --strictPort", url: "http://127.0.0.1:5181/web-preview.html", reuseExistingServer: false },
    ...(process.env.NIGHTBREW_WEB_BACKEND_TEST === "1" ? [{ command: ".venv/bin/python web-tests/serve_ai_fixture.py", url: "http://127.0.0.1:8789/web-api/status", reuseExistingServer: false, env: { NIGHTBREW_WEB_TEST_DATABASE: join(mkdtempSync(join(tmpdir(), "nightbrew-web-ai-")), "web.sqlite3") } }] : []),
  ],
});
