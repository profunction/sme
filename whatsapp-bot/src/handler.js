// Shared inbound-message handler used by the real WhatsApp link and by demo mode.
import { decide, findCustomer, pick, randomDelay, tierOf } from "./engine.js";
import { aiReply } from "./ai.js";

/**
 * @param {object} deps
 * @param {object} deps.config
 * @param {import('./store.js').Store} deps.store
 * @param {(jid: string, text: string, options: {delayMs: number, markRead: any}) => Promise<string|undefined>} deps.send
 * @param {(line: string) => void} deps.log
 * @param {boolean} [deps.instant] skip human-like delays (demo mode)
 * @param {Function} [deps.ai] override for tests
 */
export function createHandler({ config, store, send, log, instant = false, ai = aiReply }) {
  return async function onMessage({ jid, phone = null, text, name, id, fromMe, raw }) {
    const now = Date.now();
    if (fromMe) {
      if (store.wasSentByBot(id)) return null;
      // The owner replied from the phone: stay quiet for a while on this chat.
      store.recordHumanReply(jid, text, now);
      return null;
    }
    const contact = store.contact(jid);
    const knownPhone = phone || contact.phone;
    const customer = findCustomer(config, knownPhone, jid);
    const tier = tierOf(config, contact, knownPhone);
    const displayName = customer?.name || name || contact.name || "";
    const decision = decide(config, {
      text,
      name: displayName,
      tier,
      contact,
      lastBotReason: store.lastBotReason(jid),
      now,
      repliesThisMinute: store.repliesSince(now - 60_000),
    });
    store.recordInbound(jid, text, name, now, phone);
    const who = knownPhone || jid.split("@")[0];
    log(`← ${who}${tier ? ` [${tier}]` : ""} (${decision.language}, ${decision.reason}): ${text.slice(0, 80)}`);
    if (decision.action === "silent") return { decision, reply: null };

    let reply = decision.text;
    if (decision.action === "ai") {
      const fallback = pick(config.texts.fallback, decision.language, config.default_language, config.business);
      let answer = "";
      try {
        answer = await ai(config.ai, {
          history: store.history(jid, config.ai.max_history),
          text,
          language: decision.language,
          context: decision.context,
          mode: decision.mode,
          variables: { ...config.business, name: displayName },
        });
      } catch (error) {
        log(`AI failed (${error.message}); using fallback text`);
      }
      reply = [...decision.parts, answer || fallback, answer ? decision.footer : ""].filter(Boolean).join("\n\n");
    }
    if (!reply) return { decision, reply: null };
    const sentId = await send(jid, reply, {
      delayMs: instant ? 0 : randomDelay(config.reply_delay_ms),
      markRead: config.mark_read ? raw?.key : null,
    });
    if (sentId) store.rememberSent(sentId);
    store.recordBotReply(jid, reply, decision.reason, decision.language);
    if (decision.handoff) store.silence(jid, now + config.handoff_minutes * 60_000);
    if (decision.setMode) store.setMode(jid, decision.setMode);
    if (typeof decision.optOut === "boolean") store.setOptOut(jid, decision.optOut);
    store.setPending(jid, decision.pending || null);
    log(`→ ${who}: ${reply.slice(0, 80).replace(/\n/g, " ")}`);
    return { decision, reply };
  };
}

// Groups are watched, never answered: the team replies there by hand and the
// dashboard shows which groups still have an unanswered message.
export function createGroupRecorder({ store, log }) {
  return async function onGroupMessage({ jid, groupName, sender, text, fromMe, id }) {
    if (fromMe && id && store.wasSentByBot(id)) return; // our own broadcast echoing back
    store.recordGroupMessage(jid, groupName, text, sender, !!fromMe);
    log(`${fromMe ? "→" : "←"} [${groupName || "group"}] ${fromMe ? "" : `${sender || "?"}: `}${text.slice(0, 80).replace(/\n/g, " ")}`);
  };
}
