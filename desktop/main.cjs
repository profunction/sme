const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { startBackend, stopBackend } = require("./backend.cjs");
let backend,
  window,
  updater,
  downloaded = false,
  quitting = false;
if (!app.isPackaged) {
  const profile = process.argv.find((value) =>
    value.startsWith("--user-data-dir="),
  );
  if (profile)
    app.setPath(
      "userData",
      path.resolve(profile.slice("--user-data-dir=".length)),
    );
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      window.restore();
      window.focus();
    }
  });
  app.whenReady().then(async () => {
    try {
      const root = path.join(__dirname, "..");
      backend = await startBackend({
        packaged: app.isPackaged,
        resources: process.resourcesPath,
        root,
        dataDir: app.getPath("userData"),
      });
      if (process.argv.includes("--smoke-test")) {
        stopBackend(backend.child);
        console.log(
          "NightBrew packaged backend authenticated readiness passed",
        );
        app.exit(0);
        return;
      }
      const entry = pathToFileURL(path.join(root, "dist/index.html")).href;
      window = new BrowserWindow({
        width: 1280,
        height: 900,
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      const check = (event) => {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          event.senderFrame.url !== entry
        )
          throw Error("Untrusted IPC sender");
      };
      ipcMain.handle("nightbrew:session", (event) => {
        check(event);
        return { token: backend.token, version: app.getVersion() };
      });
      ipcMain.handle("nightbrew:updates", async (event) => {
        check(event);
        if (
          !app.isPackaged ||
          !backend.policy.update_url ||
          !backend.policy.publisher_name
        )
          return { status: "Updates are not configured for this build" };
        if (!updater) {
          updater = require("electron-updater").autoUpdater;
          updater.autoDownload = false;
          updater.autoInstallOnAppQuit = false;
          updater.setFeedURL({
            provider: "generic",
            url: backend.policy.update_url,
          });
          updater.on("error", () => {});
          updater.on("update-downloaded", () => {
            downloaded = true;
          });
        }
        const result = await updater.checkForUpdates();
        if (
          result?.updateInfo?.version &&
          result.updateInfo.version !== app.getVersion()
        ) {
          await updater.downloadUpdate();
          return {
            status: "Signed update downloaded. Save your work, then install.",
          };
        }
        return { status: "No update available" };
      });
      ipcMain.handle("nightbrew:install-update", (event) => {
        check(event);
        if (!updater || !downloaded) throw Error("No verified update is ready");
        quitting = true;
        stopBackend(backend.child);
        setImmediate(() => updater.quitAndInstall(false, true));
        return { status: "Installing verified update" };
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      window.webContents.session.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      backend.child.once("exit", () => {
        if (!quitting && window && !window.isDestroyed())
          dialog.showErrorBox(
            "NightBrew backend stopped",
            "Restart the application. Logs are in your application data logs directory.",
          );
      });
      await window.loadURL(entry);
    } catch {
      dialog.showErrorBox(
        "NightBrew could not start",
        "The managed backend failed to start. Check the application logs and that port 8765 is free.",
      );
      if (backend) stopBackend(backend.child);
      app.exit(1);
    }
  });
  app.on("before-quit", () => {
    quitting = true;
    if (backend) stopBackend(backend.child);
  });
  app.on("window-all-closed", () => app.quit());
}
