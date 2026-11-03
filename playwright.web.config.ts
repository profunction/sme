import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./web-tests", workers: 1, timeout: 30000,
  use: { baseURL: "http://127.0.0.1:5181", headless: true,
    launchOptions: { executablePath: process.env.NIGHTBREW_CHROMIUM || "/usr/bin/chromium" } },
  webServer: { command: "node_modules/.bin/vite --config vite.web.config.ts --host 127.0.0.1 --port 5181 --strictPort", url: "http://127.0.0.1:5181/web-preview.html", reuseExistingServer: false },
});
