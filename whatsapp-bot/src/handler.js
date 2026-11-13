// Shared inbound-message handler used by the real WhatsApp link and by demo mode.
import { decide, findCustomer, pick, randomDelay, renderPrompt, tierOf } from "./engine.js";
import { aiReply } from "./ai.js";

const ALERTS = {
  other_report: "其他问题 / Other issue",
  visit_details: "要求上门 / Visit request",
  urgent: "紧急 / URGENT",
  handoff_requested: "要求人工 / Wants a person",
  tech_requested: "排查中途要求技术员 / Asked for a technician",
  steps_exhausted: "步骤全部试过仍未解决 / All steps tried, not solved",
  fallback: "机器人未能解答 / Bot could not answer",
  waiting_ack: "客户还在等，又发来消息 / Customer is still waiting and wrote again",
};

/**
 * @param {object} deps
 * @param {object} deps.config
 * @param {import('./store.js').Store} deps.store
 * @param {(jid: string, text: string, options: {delayMs: number, markRead: any}) => Promise<string|undefined>} deps.send
 * @param {(jid: string, question: string, labels: string[], options: {delayMs: number}) => Promise<{id: string, secret?: string}>} [deps.sendPoll]
 * @param {(line: string) => void} deps.log
 * @param {boolean} [deps.instant] skip human-like delays (demo mode)
 * @param {Function} [deps.ai] override for tests
 *
 * Returns the message handler. It also has `.select({ jid, pollId, index })` for a
 * tap on a poll option and `.choose({ jid, index })` for the latest prompt.
 */
export function createHandler({ config, store, send, sendPoll = null, log, instant = false, ai = aiReply }) {
  const staff = new Set((config.notify?.numbers || []).map(String));
  // Once a tap could not be read, polls are not trusted again until restart: numbers always work.
  let pollsUnreadable = false;
  const delay = () => (instant ? 0 : randomDelay(config.reply_delay_ms));

  // Tell the team on WhatsApp that a customer needs a person.
  async function alertStaff(reason, { phone, jid, name, text }) {
    if (!staff.size || !ALERTS[reason]) return;
    const who = [name, phone ? `+${phone}` : `ID ${jid.split("@")[0]}`].filter(Boolean).join(" ");
    const body = `【${ALERTS[reason]}】\n${who}\n${phone ? `https://wa.me/${phone}\n` : ""}\n${text}`.slice(0, 1500);
    for (const number of staff) {
      try {
        const id = await send(`${number}@s.whatsapp.net`, body, { delayMs: 0, markRead: null });
        if (id) store.rememberSent(id);
      } catch (error) {
        log(`通知同事失败 / could not alert ${number}: ${error.message}`);
      }
    }
  }

  // A prompt goes out as a tappable poll when possible, otherwise as a numbered list.
  async function deliver(jid, decision, body, raw) {
    const prompt = decision.prompt;
    const markRead = config.mark_read ? raw?.key : null;
    if (prompt && config.menu_style === "poll" && sendPoll && !pollsUnreadable) {
      try {
        if (decision.lead) {
          const leadId = await send(jid, decision.lead, { delayMs: delay(), markRead });
          if (leadId) store.rememberSent(leadId);
        }
        const labels = prompt.options.map((option) => option.label);
        const poll = await sendPoll(jid, prompt.question, labels, { delayMs: decision.lead ? Math.min(delay(), 800) : delay() });
        if (poll?.id) {
          store.rememberSent(poll.id);
          store.savePoll(poll.id, jid, poll.secret, labels, prompt.options.map((option) => option.send));
        }
        return;
      } catch (error) {
        log(`选项发送失败，改用文字 / poll failed, falling back to text: ${error.message}`);
      }
    }
    const sentId = await send(jid, body, { delayMs: delay(), markRead });
    if (sentId) store.rememberSent(sentId);
  }

  async function onMessage({ jid, phone = null, text, name, id, fromMe, raw, selected = null }) {
    const now = Date.now();
    if (fromMe) {
      if (store.wasSentByBot(id)) return null;
      // The owner replied from the phone: stay quiet for a while on this chat.
      store.recordHumanReply(jid, text, now);
      return null;
    }
    const contact = store.contact(jid);
    const knownPhone = phone || contact.phone;
    const shown = selected?.label || text; // what the customer actually saw or typed
    if (knownPhone && staff.has(String(knownPhone))) {
      // Our own team answering an alert must not get the customer menu back.
      store.recordInbound(jid, shown, name, now, phone);
      return { decision: { action: "silent", reason: "staff" }, reply: null };
    }
    const customer = findCustomer(config, knownPhone, jid);
    const tier = tierOf(config, contact, knownPhone);
    const displayName = customer?.name || name || contact.name || "";
    const decision = decide(config, {
      text,
      name: displayName,
      tier,
      contact: selected ? { ...contact, pending: null } : contact,
      selected: !!selected,
      lastBotReason: store.lastBotReason(jid),
      now,
      repliesThisMinute: store.repliesSince(now - 60_000),
    });
    store.recordInbound(jid, shown, name, now, phone);
    const who = knownPhone || jid.split("@")[0];
    log(`← ${who}${tier ? ` [${tier}]` : ""} (${decision.language}, ${decision.reason}): ${shown.slice(0, 80)}`);
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
    await deliver(jid, decision, reply, raw);
    const labels = decision.prompt ? decision.prompt.options.map((option) => option.label) : null;
    const recorded = decision.prompt ? [decision.lead, decision.prompt.question].filter(Boolean).join("\n\n") : reply;
    store.recordBotReply(jid, recorded, decision.reason, decision.language, Date.now(), labels);
    if (decision.handoff) store.silence(jid, now + config.handoff_minutes * 60_000);
    if (decision.unmute) store.silence(jid, null);
    if (decision.setMode) store.setMode(jid, decision.setMode);
    if (typeof decision.optOut === "boolean") store.setOptOut(jid, decision.optOut);
    store.setPending(jid, decision.pending || null);
    log(`→ ${who}: ${reply.slice(0, 80).replace(/\n/g, " ")}`);
    if (decision.report || decision.urgent || decision.handoff) {
      await alertStaff(decision.reason, { phone: knownPhone, jid, name: displayName, text: [decision.note, shown].filter(Boolean).join("\n") });
    }
    return { decision, reply };
  }

  // A tap on one of our polls. `index` is null when the vote could not be read;
  // then the same choices are offered again as a numbered list.
  onMessage.select = async function select({ jid, phone = null, name = null, pollId, index }) {
    const poll = store.poll(pollId);
    if (!poll || (jid && poll.jid !== jid)) return null;
    jid = poll.jid;
    if (index === null || index === undefined || !poll.sends[index]) {
      pollsUnreadable = true;
      const contact = store.contact(jid);
      const language = contact.language || config.default_language;
      const question = pick(
        {
          zh: "不好意思，我这边看不到您点了哪一个。麻烦直接回复选项前面的数字：",
          en: "Sorry, I could not see which option you tapped. Please reply with the number instead:",
          ms: "Maaf, saya tidak nampak pilihan yang anda tekan. Sila balas dengan nombor:",
        },
        language,
        config.default_language
      );
      const body = renderPrompt({ question, options: poll.labels.map((label) => ({ label })) });
      const sentId = await send(jid, body, { delayMs: delay(), markRead: null });
      if (sentId) store.rememberSent(sentId);
      store.recordBotReply(jid, question, "prompt_fallback", language, Date.now(), poll.labels);
      store.setPending(jid, poll.sends);
      log(`无法读取选项，改用数字 / could not read the tap from ${jid.split("@")[0]}; asked for a number`);
      return { decision: { action: "reply", reason: "prompt_fallback" }, reply: body };
    }
    return onMessage({ jid, phone, name, text: poll.sends[index], id: `tap-${pollId}-${index}-${Date.now()}`, fromMe: false, selected: { label: poll.labels[index] } });
  };

  // Pick an option of the latest prompt by position (used by the demo phone's buttons).
  onMessage.choose = async function choose({ jid, phone = null, name = null, index }) {
    const sends = store.contact(jid).pending;
    const labels = store.lastBotOptions(jid);
    if (!Array.isArray(sends) || !sends[index]) return null;
    return onMessage({ jid, phone, name, text: sends[index], id: `tap-${Date.now()}-${index}`, fromMe: false, selected: { label: labels?.[index] || sends[index] } });
  };

  return onMessage;
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
