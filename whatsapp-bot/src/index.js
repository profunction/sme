import path from "node:path";
import { load } from "./config.js";
import { decide, randomDelay } from "./engine.js";
import { Store } from "./store.js";
import { aiReply } from "./ai.js";
import { connect } from "./whatsapp.js";
import { startDashboard } from "./dashboard.js";

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
  const onMessage = async ({ jid, text, name, id, fromMe, raw }) => {
    const now = Date.now();
    if (fromMe) {
      if (store.wasSentByBot(id)) return;
      // The owner replied from the phone: stay quiet for a while on this chat.
      store.recordHumanReply(jid, text, now);
      return;
    }
    const contact = store.contact(jid);
    const decision = decide(config, { text, contact, now, repliesThisMinute: store.repliesSince(now - 60_000) });
    store.recordInbound(jid, text, name, now);
    log(`← ${jid.split("@")[0]} (${decision.language}, ${decision.reason}): ${text.slice(0, 80)}`);
    if (decision.action === "silent") return;

    let reply = decision.text;
    if (decision.action === "ai") {
      const fallback = config.texts.fallback[decision.language] ?? config.texts.fallback[config.default_language];
      try {
        const answer = await aiReply(config.ai, { history: store.history(jid, config.ai.max_history), text, language: decision.language });
        reply = [...decision.parts, answer || fallback].join("\n\n");
      } catch (error) {
        log(`AI failed (${error.message}); using fallback text`);
        reply = [...decision.parts, fallback].join("\n\n");
      }
    }
    if (!reply) return;
    const sentId = await link.sendText(jid, reply, {
      delayMs: randomDelay(config.reply_delay_ms),
      markRead: config.mark_read ? raw.key : null,
    });
    if (sentId) store.rememberSent(sentId);
    store.recordBotReply(jid, reply, decision.reason, decision.language);
    if (decision.handoff) store.silence(jid);
    log(`→ ${jid.split("@")[0]}: ${reply.slice(0, 80).replace(/\n/g, " ")}`);
  };

  link = await connect({ config, authDir: path.join(root, "auth"), status, onMessage, log });
  log(`已启动，号码 ${config.phone_number}。AI: ${config.ai.enabled ? config.ai.provider : "关闭 / off"}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
