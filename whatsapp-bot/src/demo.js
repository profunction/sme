// Demo mode: no phone, no WhatsApp. The dashboard's phone gets a text box so you can
// play the customer; the real reply engine answers. Use it to tune the config or to
// show a customer how the bot behaves.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepare, profilePaths, readJson, validate } from "./config.js";
import { Store } from "./store.js";
import { readBody, startDashboard } from "./dashboard.js";
import { createGroupRecorder, createHandler } from "./handler.js";
import { createBroadcaster } from "./broadcast.js";

const log = (line) => console.log(`[${new Date().toLocaleTimeString()}] ${line}`);
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function startDemo({ configFile, port, store = new Store(":memory:"), ai, seed = true } = {}) {
  const file = configFile ?? [profilePaths(process.cwd()).config, path.join(PACKAGE_ROOT, "config.av-technician.example.json")].find((f) => fs.existsSync(f));
  // Demo replies are instant, so the per-contact spacing guard would hide quick follow-ups.
  const config = { ...prepare(readJson(file), path.dirname(file)), min_seconds_between_replies_per_contact: 0 };
  const problems = validate(config).filter((p) => !p.includes("environment variable"));
  if (problems.length) throw new Error(`${path.basename(file)} problems:\n - ${problems.join("\n - ")}`);
  const status = { connection: "demo", phone: config.phone_number, pairingCode: null, lastError: null, aiEnabled: config.ai.enabled, aiProvider: config.ai.provider };
  let counter = 0;
  const handler = createHandler({ config, store, log, instant: true, send: async () => `demo-${++counter}`, ...(ai ? { ai } : {}) });
  const recordGroup = createGroupRecorder({ store, log });
  // Stand-ins for the chats WhatsApp would report after linking a real account.
  if (seed) {
    const hour = 3600_000;
    store.importDirectory([
      { jid: "6591110001@s.whatsapp.net", name: "Aisha (Bright Dental)", at: Date.now() - 20 * hour },
      { jid: "6591110002@s.whatsapp.net", name: "Marcus Lee", at: Date.now() - 50 * hour },
      { jid: "6591110003@s.whatsapp.net", name: "林太太 (Golden Hall)", at: Date.now() - 70 * hour },
      { jid: "6591110004@s.whatsapp.net", name: "Ravi (Northpoint School)", at: Date.now() - 90 * hour },
      { jid: "120363000000000001@g.us", name: "ABC Pte Ltd × AV Support", at: Date.now() - 30 * hour },
      { jid: "120363000000000002@g.us", name: "XYZ 学院 · AV 支援群", at: Date.now() - 60 * hour },
      { jid: "120363000000000003@g.us", name: "Golden Hall Events Crew", at: Date.now() - 100 * hour },
    ]);
  }
  const broadcaster = createBroadcaster({ config, store, log, instant: true, send: async () => `demo-${++counter}` });
  broadcaster.start();
  const jidOf = (body) => (body.jid && /^[0-9]+@(s\.whatsapp\.net|lid)$/.test(body.jid) ? body.jid : `${String(body.from || "6590000000").replace(/\D/g, "")}@s.whatsapp.net`);

  const server = startDashboard({
    port: port ?? config.dashboard_port,
    status,
    store,
    config,
    log,
    broadcaster,
    extraRoutes: async (req, res, url) => {
      if (req.method !== "POST" || !url.pathname.startsWith("/demo/")) return false;
      const body = await readBody(req);
      const jid = jidOf(body);
      let result = {};
      if (url.pathname === "/demo/group") {
        const groupJid = /^[0-9-]+@g\.us$/.test(String(body.jid)) ? body.jid : "120363000000000001@g.us";
        const text = String(body.text || "").slice(0, 2000);
        if (text) await recordGroup({ jid: groupJid, groupName: body.name ? String(body.name).slice(0, 80) : null, sender: String(body.sender || "Member").slice(0, 40), text, fromMe: !!body.fromMe });
      } else if (url.pathname === "/demo/send") {
        const text = String(body.text || "").slice(0, 2000);
        if (text) result = (await handler({ jid, phone: jid.split("@")[0], text, name: body.name || null, id: `in-${++counter}`, fromMe: false })) || {};
      } else if (url.pathname === "/demo/owner") {
        await handler({ jid, text: String(body.text || "ok"), id: `owner-${++counter}`, fromMe: true });
      } else {
        return false;
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ reply: result.reply ?? null, decision: result.decision ? { reason: result.decision.reason, language: result.decision.language } : null }));
      return true;
    },
  });
  server.on("listening", () => log(`演示页面 / Demo page: http://127.0.0.1:${status.dashboardPort}  (${path.basename(file)}, 知识库 / knowledge: ${config.faq.length})`));
  server.on("close", () => broadcaster.stop());
  return { server, store, config, handler, status, broadcaster };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startDemo({ port: Number(process.env.PORT) || undefined }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
