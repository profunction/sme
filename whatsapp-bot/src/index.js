import path from "node:path";
import { load } from "./config.js";
import { Store } from "./store.js";
import { connect } from "./whatsapp.js";
import { startDashboard } from "./dashboard.js";
import { createHandler } from "./handler.js";

const log = (line) => console.log(`[${new Date().toLocaleTimeString()}] ${line}`);

async function main() {
  const root = process.cwd();
  const config = load(path.join(root, "config.json"));
  const store = new Store(path.join(root, "data", "bot.sqlite3"));
  const status = {
    connection: "starting",
    phone: config.phone_number,
    pairingCode: null,
    connectedAt: null,
    lastError: null,
    aiEnabled: config.ai.enabled,
    aiProvider: config.ai.provider,
  };
  startDashboard({ port: config.dashboard_port, status, store, log });

  let link;
  const onMessage = createHandler({ config, store, log, send: (jid, text, options) => link.sendText(jid, text, options) });
  link = await connect({ config, authDir: path.join(root, "auth"), status, onMessage, log });
  log(`已启动，号码 ${config.phone_number}。AI: ${config.ai.enabled ? config.ai.provider : "关闭 / off"}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
