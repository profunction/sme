const { spawn, spawnSync } = require("node:child_process");
const { randomBytes, randomUUID } = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
function configuration({
  packaged,
  resources,
  root,
  dataDir,
  environment = process.env,
  platform = process.platform,
}) {
  const token = randomBytes(48).toString("base64url");
  const instance = randomUUID();
  let policy = {};
  if (packaged)
    policy = JSON.parse(
      fs.readFileSync(path.join(resources, "release-policy.json"), "utf8"),
    );
  const executable = packaged
    ? path.join(
        resources,
        "backend",
        platform === "win32" ? "nightbrew-backend.exe" : "nightbrew-backend",
      )
    : environment.NIGHTBREW_PYTHON ||
      path.join(
        root,
        ".venv",
        platform === "win32" ? "Scripts/python.exe" : "bin/python",
      );
  const env = {
    ...environment,
    NIGHTBREW_SESSION_TOKEN: token,
    NIGHTBREW_INSTANCE_ID: instance,
    NIGHTBREW_DB: path.join(dataDir, "chat.sqlite3"),
    PYTHONUNBUFFERED: "1",
  };
  if (packaged) {
    for (const name of Object.keys(env))
      if (
        /^(NIGHTBREW_(BILLING_|GATEWAY_|STRIPE_|LICENSE_PRIVATE_KEY)|CSC_)/.test(
          name,
        )
      )
        delete env[name];
    env.NIGHTBREW_ENV = "production";
    env.NIGHTBREW_ENFORCE_LICENSE = "1";
    env.NIGHTBREW_ALLOW_MOCK_LICENSE = "0";
    env.NIGHTBREW_LICENSE_PUBLIC_KEY = policy.license_public_key;
    env.NIGHTBREW_LICENSE_URL = policy.license_url;
    delete env.NIGHTBREW_LICENSE_PRIVATE_KEY;
    delete env.NIGHTBREW_BILLING_ADMIN_KEY;
    delete env.NIGHTBREW_STRIPE_SECRET_KEY;
  }
  return {
    executable,
    args: packaged ? [] : ["-m", "backend.entrypoint"],
    env,
    token,
    instance,
    policy,
  };
}
async function startBackend(options) {
  fs.mkdirSync(options.dataDir, { recursive: true, mode: 0o700 });
  const config = configuration(options);
  const child = spawn(config.executable, config.args, {
    cwd: options.packaged ? options.dataDir : options.root,
    env: config.env,
    windowsHide: true,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["ignore", "ignore", "ignore"],
  });
  let failure;
  child.once("error", () => {
    failure = new Error("Backend executable could not be started");
  });
  child.once("exit", (code) => {
    failure = new Error(`Backend exited before readiness (${code})`);
  });
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (failure) throw failure;
    try {
      const response = await fetch("http://127.0.0.1:8765/session", {
        headers: { Authorization: `Bearer ${config.token}` },
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.instance_id === config.instance) return { child, ...config };
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  stopBackend(child);
  throw new Error(
    "Backend did not become ready. Check whether port 8765 is already used.",
  );
}
function stopBackend(child) {
  if (!child || !child.pid || child.exitCode !== null) return;
  if (process.platform === "win32")
    spawnSync(
      path.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "taskkill.exe",
      ),
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true, stdio: "ignore", shell: false },
    );
  else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}
module.exports = { configuration, startBackend, stopBackend };
