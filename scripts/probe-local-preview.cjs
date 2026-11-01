// Frozen local preview integration, using an owned HTTP fixture instead of paid or real-model inference.
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { startBackend, stopBackend } = require("../desktop/backend.cjs");
(async () => {
  const data = fs.mkdtempSync(
    path.join(os.tmpdir(), "nightbrew-local-preview-"),
  );
  const received = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/chat") {
        received.push(JSON.parse(body));
        res.end(
          JSON.stringify({
            message: { content: "Local Ollama fixture connected" },
          }),
        );
      } else if (req.url === "/api/tags")
        res.end(JSON.stringify({ models: [{ name: "fixture:3b" }] }));
      else {
        res.writeHead(404);
        res.end("{}");
      }
    });
  });
  let backend;
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    backend = await startBackend({
      packaged: true,
      resources: path.resolve(process.argv[2]),
      root: data,
      dataDir: data,
      environment: {
        ...process.env,
        NIGHTBREW_OLLAMA_URL: `http://127.0.0.1:${server.address().port}`,
      },
    });
    const api = async (url, method = "GET", body) => {
      const response = await fetch("http://127.0.0.1:8765" + url, {
        method,
        headers: {
          Authorization: "Bearer " + backend.token,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    };
    const license = await api("/license");
    assert.equal(license.body.required, false);
    assert.equal(license.body.claims.environment, "local_preview");
    assert.equal(
      (await api("/settings/models", "PUT", { local_model: "fixture:3b" }))
        .status,
      200,
    );
    const reply = await api("/chat", "POST", {
      message: "Test local connection",
      mode: "LOCAL_ONLY",
    });
    assert.equal(reply.status, 200);
    assert.equal(reply.body.answer, "Local Ollama fixture connected");
    assert.equal(received[0].model, "fixture:3b");
    assert.equal(
      (
        await api("/chat", "POST", {
          message: "Must not leave device",
          mode: "CLOUD_ONLY",
          cloud_consent: true,
        })
      ).status,
      403,
    );
    assert.equal(
      (await api("/settings/ai", "PUT", { cloud_allowed: true })).status,
      403,
    );
    const created = await api("/tasks", "POST", {
      tool: "document.generate",
      payload: {
        company: "Local test",
        customer: "Fixture",
        reference: "LOCAL-001",
        lines: [
          { description: "Test item", quantity: "2", unit_price: "5.00" },
        ],
      },
    });
    assert.equal(created.status, 201);
    let task;
    for (let i = 0; i < 100; i++) {
      task = (await api("/tasks")).body.find((t) => t.id === created.body.id);
      if (["completed", "failed"].includes(task?.status)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(task?.status, "completed");
    assert.equal(task.result.totals.total, "10.00");
    console.log(
      "Frozen local preview: authenticated startup, Ollama HTTP fixture, local document and cloud restrictions passed",
    );
  } finally {
    if (backend) {
      if (backend.child.exitCode === null) {
        const exited = new Promise((r) => backend.child.once("exit", r));
        stopBackend(backend.child);
        await exited;
      }
    }
    await new Promise((r) => server.close(r));
    fs.rmSync(data, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(
    "::error title=Local preview verification::" +
      String(e.message).replace(/\n/g, " "),
  );
  process.exitCode = 1;
});
