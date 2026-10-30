const { _electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
(async () => {
  const profile = fs.mkdtempSync(
    path.join(os.tmpdir(), "nightbrew-electron-ui-"),
  );
  let application;
  try {
    application = await _electron.launch({
      args: [
        ".",
        `--user-data-dir=${profile}`,
        ...(process.env.NIGHTBREW_ELECTRON_HEADLESS === "1"
          ? ["--ozone-platform=headless", "--no-sandbox", "--disable-gpu"]
          : []),
      ],
      cwd: path.resolve(__dirname, ".."),
      timeout: 60000,
      env: {
        ...process.env,
        XDG_CONFIG_HOME: profile,
        XDG_CACHE_HOME: profile,
      },
    });
    const window = await application.firstWindow();
    await window.waitForFunction(
      () => {
        const input = document.querySelector("input[type=password]");
        return Boolean(input && input.value.length >= 32);
      },
      undefined,
      { timeout: 15000 },
    );
    const subscription = window.getByRole("button", {
      name: "Subscription",
      exact: true,
    });
    if (process.env.NIGHTBREW_ELECTRON_HEADLESS === "1")
      await subscription.dispatchEvent("click");
    else await subscription.click();
    await window.waitForFunction(() =>
      document.querySelector("pre")?.textContent.includes("development"),
    );
    assert.equal(
      await window
        .getByRole("button", { name: "Check & download signed update" })
        .isEnabled(),
      true,
    );
    console.log(
      "Electron renderer received its managed session through restricted IPC; authenticated API and update bridge passed",
    );
  } finally {
    if (application) await application.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(
    "Electron integration smoke test failed: " +
      String(error.message).split("\n")[0],
  );
  process.exitCode = 1;
});
