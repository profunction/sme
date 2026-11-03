import { defineConfig } from "vite";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
export default defineConfig({
  base: "./",
  server: { host: "0.0.0.0", port: 5174 },
  build: { outDir: "build/web-preview", rollupOptions: { input: "web-preview.html" } },
  plugins: [{ name: "web-preview-index", apply: "build", closeBundle() { renameSync(resolve("build/web-preview/web-preview.html"), resolve("build/web-preview/index.html"));
    const notices = ["react", "react-dom", "scheduler"].map(name => name + "\n" + readFileSync(resolve("node_modules", name, "LICENSE"), "utf8")).join("\n\n");
    writeFileSync(resolve("build/web-preview/THIRD-PARTY-NOTICES.txt"), notices); } }],
});
