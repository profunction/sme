// Sends queued announcements one recipient at a time with human-like gaps.
// The queue lives in the database, so pausing, cancelling and restarts are safe.
// Recipients are always existing chats: people who messaged this number, or groups
// this number is in. There is no way to add numbers that never contacted you.
import { pick, randomDelay } from "./engine.js";

const DAY = 24 * 3600 * 1000;

export function messageFor(config, contact, text) {
  if (contact.jid.endsWith("@g.us")) return text;
  const footer = pick(config.broadcast.footer, contact.language || config.default_language, config.default_language);
  return footer ? `${text}\n\n${footer}` : text;
}

/**
 * @param {object} deps
 * @param {(jid: string, text: string) => Promise<string|undefined>} deps.send throws when WhatsApp is not connected
 * @param {boolean} [deps.instant] demo mode: no pacing
 */
export function createBroadcaster({ config, store, send, log, instant = false }) {
  let timer = null;
  let stopped = false;
  const state = { waitingUntil: 0, blocked: null };

  // Returns the delay before the next tick, in milliseconds.
  async function tick(now = Date.now()) {
    const next = store.nextBroadcastRecipient();
    if (!next) {
      state.blocked = null;
      return instant ? 300 : 5000;
    }
    if (store.broadcastsSentSince(now - DAY) >= config.broadcast.max_per_day) {
      state.blocked = "daily_cap";
      return instant ? 300 : 10 * 60 * 1000;
    }
    const contact = store.contact(next.jid);
    if (contact.optedOut) {
      store.markBroadcastRecipient(next.id, next.jid, "skipped", "opted out");
      return 50;
    }
    try {
      const body = messageFor(config, contact, next.text);
      const sentId = await send(next.jid, body);
      if (sentId) store.rememberSent(sentId);
      store.recordBroadcast(next.jid, body);
      store.markBroadcastRecipient(next.id, next.jid, "sent");
      state.blocked = null;
      log(`群发 / broadcast #${next.id} → ${contact.name || contact.phone || next.jid.split("@")[0]}`);
    } catch (error) {
      if (/not connected/i.test(error.message)) {
        state.blocked = "offline"; // keep it pending and try again shortly
        return instant ? 300 : 15_000;
      }
      store.markBroadcastRecipient(next.id, next.jid, "failed", String(error.message).slice(0, 200));
      log(`群发失败 / broadcast #${next.id} failed for ${next.jid.split("@")[0]}: ${error.message}`);
    }
    return instant ? 50 : randomDelay({ min: config.broadcast.delay_seconds.min * 1000, max: config.broadcast.delay_seconds.max * 1000 });
  }

  function schedule(delay) {
    if (stopped) return;
    state.waitingUntil = Date.now() + delay;
    timer = setTimeout(async () => {
      let nextDelay = 5000;
      try {
        nextDelay = await tick();
      } catch (error) {
        log(`broadcast loop error: ${error.message}`);
      }
      schedule(nextDelay);
    }, delay);
    timer.unref?.();
  }

  return {
    tick,
    state,
    start() {
      stopped = false;
      schedule(instant ? 100 : 3000);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
