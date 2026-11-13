// Shared inbound-message handler used by the real WhatsApp link and by demo mode.
import { decide, randomDelay } from "./engine.js";
import { aiReply } from "./ai.js";

/**
 * @param {object} deps
 * @param {object} deps.config
 * @param {import('./store.js').Store} deps.store
 * @param {(jid: string, text: string, options: {delayMs: number, markRead: any}) => Promise<string|undefined>} deps.send
 * @param {(line: string) => void} deps.log
 * @param {boolean} [deps.instant] skip human-like delays (demo mode)
 */
export function createHandler({ config, store, send, log, instant = false }) {
  return async function onMessage({ jid, text, name, id, fromMe, raw }) {
    const now = Date.now();
    if (fromMe) {
      if (store.wasSentByBot(id)) return null;
      // The owner replied from the phone: stay quiet for a while on this chat.
      store.recordHumanReply(jid, text, now);
      return null;
    }
    const contact = store.contact(jid);
    const decision = decide(config, { text, contact, now, repliesThisMinute: store.repliesSince(now - 60_000) });
    store.recordInbound(jid, text, name, now);
    log(`← ${jid.split("@")[0]} (${decision.language}, ${decision.reason}): ${text.slice(0, 80)}`);
    if (decision.action === "silent") return { decision, reply: null };

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
    if (!reply) return { decision, reply: null };
    const sentId = await send(jid, reply, {
      delayMs: instant ? 0 : randomDelay(config.reply_delay_ms),
      markRead: config.mark_read ? raw?.key : null,
    });
    if (sentId) store.rememberSent(sentId);
    store.recordBotReply(jid, reply, decision.reason, decision.language);
    if (decision.handoff) store.silence(jid, now + config.handoff_minutes * 60_000);
    log(`→ ${jid.split("@")[0]}: ${reply.slice(0, 80).replace(/\n/g, " ")}`);
    return { decision, reply };
  };
}
