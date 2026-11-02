const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { configuration, startBackend, stopBackend } = require("./backend.cjs");

test("packaged policy overrides development flags and excludes authority secrets", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nightbrew-policy-"));
  fs.writeFileSync(
    path.join(directory, "release-policy.json"),
    JSON.stringify({
      license_public_key: "public-key",
      license_url: "https://licenses.example",
    }),
  );
  const value = configuration({
    packaged: true,
    resources: directory,
    root: directory,
    dataDir: directory,
    platform: "win32",
    environment: {
      NIGHTBREW_ENFORCE_LICENSE: "0",
      NIGHTBREW_ALLOW_MOCK_LICENSE: "1",
      NIGHTBREW_LICENSE_PRIVATE_KEY: "never-ship",
      NIGHTBREW_STRIPE_SECRET_KEY: "never-ship",
    },
  });
  assert.equal(value.env.NIGHTBREW_ENFORCE_LICENSE, "1");
  assert.equal(value.env.NIGHTBREW_ALLOW_MOCK_LICENSE, "0");
  assert.equal(value.env.NIGHTBREW_LICENSE_PRIVATE_KEY, undefined);
  assert.equal(value.env.NIGHTBREW_STRIPE_SECRET_KEY, undefined);
  assert.ok(value.token.length >= 48);
  assert.ok(value.executable.endsWith("nightbrew-backend.exe"));
  fs.rmSync(directory, { recursive: true });
});

test("managed backend authenticates its own instance and rejects missing tokens", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nightbrew-managed-"),
  );
  const value = await startBackend({
    packaged: false,
    resources: directory,
    root: path.resolve(__dirname, ".."),
    dataDir: directory,
  });
  try {
    assert.equal((await fetch("http://127.0.0.1:8765/session")).status, 401);
    const response = await fetch("http://127.0.0.1:8765/session", {
      headers: { Authorization: `Bearer ${value.token}` },
    });
    assert.equal((await response.json()).instance_id, value.instance);
  } finally {
    stopBackend(value.child);
    await new Promise((resolve) => value.child.once("exit", resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test(
  "native frozen backend starts from packaged resources without project source",
  {
    skip: !fs.existsSync(
      path.resolve(
        "build/backend/nightbrew-backend",
        process.platform === "win32"
          ? "nightbrew-backend.exe"
          : "nightbrew-backend",
      ),
    ),
  },
  async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "nightbrew-frozen-"),
    );
    fs.symlinkSync(
      path.resolve("build/backend/nightbrew-backend"),
      path.join(directory, "backend"),
      process.platform === "win32" ? "junction" : "dir",
    );
    fs.writeFileSync(
      path.join(directory, "release-policy.json"),
      JSON.stringify({
        license_public_key: "",
        license_url: "",
        development_unsigned: true,
      }),
    );
    const value = await startBackend({
      packaged: true,
      resources: directory,
      root: path.join(directory, "nonexistent-app.asar"),
      dataDir: path.join(directory, "data"),
    });
    try {
      const response = await fetch("http://127.0.0.1:8765/license", {
        headers: { Authorization: `Bearer ${value.token}` },
      });
      const status = await response.json();
      assert.equal(status.required, true);
      assert.equal(status.valid, false);
    } finally {
      stopBackend(value.child);
      await new Promise((resolve) => value.child.once("exit", resolve));
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("production release preparation fails closed without signing and authority configuration", () => {
  const { spawnSync } = require("node:child_process");
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nightbrew-release-"),
  );
  const result = spawnSync(
    process.execPath,
    [path.resolve("scripts/prepare-release.cjs")],
    { cwd: directory, env: { PATH: process.env.PATH }, encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.equal(
    fs.existsSync(path.join(directory, "build/release-policy.json")),
    false,
  );
  fs.rmSync(directory, { recursive: true, force: true });
});

test("release config preserves backend resources and installation policy", () => {
  const { spawnSync } = require("node:child_process");
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nightbrew-resource-config-"),
  );
  try {
    const result = spawnSync(
      process.execPath,
      [path.resolve("scripts/prepare-release.cjs"), "--development"],
      { cwd: directory, encoding: "utf8" },
    );
    assert.equal(result.status, 0);
    const config = JSON.parse(
      fs.readFileSync(
        path.join(directory, "build/electron-release.json"),
        "utf8",
      ),
    );
    assert.equal(config.productName, "NightBrew AI Employee");
    assert.ok(config.extraResources.some((entry) => entry.to === "backend"));
    assert.ok(
      config.extraResources.some((entry) => entry.to === "release-policy.json"),
    );
    assert.ok(config.files.includes("desktop/preload.cjs"));
    assert.equal(config.nsis.runAfterFinish, false);
    assert.equal(config.forceCodeSigning, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("macOS packaged backend resolves a native executable inside app resources", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nightbrew-mac-policy-"),
  );
  try {
    fs.writeFileSync(path.join(directory, "release-policy.json"), "{}");
    const value = configuration({
      packaged: true,
      resources: directory,
      root: directory,
      dataDir: directory,
      platform: "darwin",
      environment: {},
    });
    assert.equal(
      value.executable,
      path.join(directory, "backend", "nightbrew-backend"),
    );
    assert.equal(value.env.NIGHTBREW_ENFORCE_LICENSE, "1");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("local preview is explicit, development-only and uses isolated data", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nightbrew-local-config-"),
  );
  try {
    for (const [development, expected] of [
      [false, "1"],
      [true, "0"],
    ]) {
      fs.writeFileSync(
        path.join(directory, "release-policy.json"),
        JSON.stringify({
          development_unsigned: development,
          local_preview: true,
        }),
      );
      const value = configuration({
        packaged: true,
        resources: directory,
        root: directory,
        dataDir: directory,
        environment: {
          NIGHTBREW_ENFORCE_LICENSE: "0",
          NIGHTBREW_LOCAL_PREVIEW: "1",
          NIGHTBREW_ENV: "local-preview",
        },
      });
      assert.equal(value.env.NIGHTBREW_ENFORCE_LICENSE, expected);
      assert.equal(value.env.NIGHTBREW_ALLOW_MOCK_LICENSE, "0");
      if (development)
        assert.ok(
          value.env.NIGHTBREW_DB.includes(
            path.join("local-preview", "chat.sqlite3"),
          ),
        );
      else assert.equal(value.env.NIGHTBREW_LOCAL_PREVIEW, "0");
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Mac local preview uses an explicit development policy and no Apple identity claim", () => {
  const { spawnSync } = require("node:child_process");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nightbrew-mac-preview-"));
  try {
    const result = spawnSync(process.execPath, [path.resolve("scripts/prepare-release.cjs"),
      "--development", "--local-preview", "--mac"], { cwd: directory, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const resources = path.join(directory, "build");
    const config = JSON.parse(fs.readFileSync(path.join(resources, "electron-release.json")));
    assert.equal(config.mac.identity, "-");
    assert.equal(config.mac.notarize, false);
    assert.equal(config.forceCodeSigning, false);
    const packaged = configuration({ packaged: true, resources, root: directory,
      dataDir: directory, platform: "darwin", environment: {} });
    assert.equal(packaged.env.NIGHTBREW_LOCAL_PREVIEW, "1");
    assert.equal(packaged.env.NIGHTBREW_ENFORCE_LICENSE, "0");
    assert.equal(packaged.env.NIGHTBREW_ENV, "local-preview");
    assert.equal(packaged.env.NIGHTBREW_ALLOW_MOCK_LICENSE, "0");
    assert.equal(config.publish, null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("API preview requires its own unsigned policy, isolates data, and cannot be enabled by inherited environment flags", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nightbrew-api-preview-"));
  try {
    const result = spawnSync(process.execPath, [path.resolve("scripts/prepare-release.cjs"), "--development", "--byok-preview", "--mac"], { cwd: directory, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const policy = JSON.parse(fs.readFileSync(path.join(directory, "build/release-policy.json"), "utf8"));
    assert.equal(policy.byok_preview, true);
    assert.equal(policy.local_preview, false);
    for (const development of [true, false]) {
      fs.writeFileSync(path.join(directory, "release-policy.json"), JSON.stringify({ ...policy, development_unsigned: development }));
      const config = configuration({ packaged: true, resources: directory, root: directory, dataDir: directory, environment: { NIGHTBREW_BYOK_PREVIEW: "1", NIGHTBREW_ENV: "byok-preview", NIGHTBREW_ENFORCE_LICENSE: "0" } });
      assert.equal(config.env.NIGHTBREW_BYOK_PREVIEW, development ? "1" : "0");
      assert.equal(config.env.NIGHTBREW_ENFORCE_LICENSE, development ? "0" : "1");
      assert.equal(config.env.NIGHTBREW_ENV, development ? "byok-preview" : "production");
      if (development) assert.ok(config.env.NIGHTBREW_DB.endsWith(path.join("byok-preview", "chat.sqlite3")));
    }
    assert.notEqual(spawnSync(process.execPath, [path.resolve("scripts/prepare-release.cjs"), "--byok-preview"], { cwd: directory }).status, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
