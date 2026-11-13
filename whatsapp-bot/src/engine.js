// Pure decision logic: no network, no WhatsApp. Everything here is unit-testable.

const MALAY_HINTS = ["saya", "boleh", "harga", "berapa", "nak", "tak", "ada", "macam", "mana", "bila", "terima", "kasih", "tolong", "hai", "selamat", "pagi", "petang", "malam"];

export function detectLanguage(text, languages, fallback) {
  const candidates = new Set(languages);
  if (candidates.has("zh") && /[㐀-鿿]/.test(text)) return "zh";
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (candidates.has("ms") && words.some((w) => MALAY_HINTS.includes(w))) return "ms";
  if (candidates.has("en") && words.length) return "en";
  return fallback;
}

export function pick(texts, language, fallback) {
  if (!texts) return "";
  return texts[language] ?? texts[fallback] ?? Object.values(texts)[0] ?? "";
}

export function normalize(text) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

// Local wall-clock time in the configured timezone.
export function localTime(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = Number(get("hour")) % 24;
  return { day: days[get("weekday")], minutes: hour * 60 + Number(get("minute")) };
}

export function isOpen(config, date = new Date()) {
  const { day, minutes } = localTime(date, config.timezone);
  if (!config.hours.days.includes(day)) return false;
  const toMinutes = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const open = toMinutes(config.hours.open);
  const close = toMinutes(config.hours.close);
  return close > open ? minutes >= open && minutes < close : minutes >= open || minutes < close;
}

export function matchRule(rules, text) {
  const normalized = normalize(text);
  for (const rule of rules) {
    if ((rule.keys || []).some((k) => normalize(k) === normalized)) return rule;
  }
  for (const rule of rules) {
    if ((rule.match || []).some((k) => normalized.includes(normalize(k)))) return rule;
  }
  return null;
}

export const HANDOFF_WORDS = ["0", "人工", "客服", "真人", "human", "agent", "person", "staff", "operator", "manusia"];

/**
 * Decide how to respond to one incoming customer message.
 * @param {object} config
 * @param {object} input { text, contact: { lastInboundAt, lastHumanOutboundAt, lastBotOutboundAt }, now, repliesThisMinute }
 * @returns {{ action: 'reply'|'ai'|'silent', text?: string, language: string, reason: string, parts: string[] }}
 */
export function decide(config, input) {
  const now = input.now ?? Date.now();
  const language = detectLanguage(input.text, config.languages, config.default_language);
  const t = (key) => pick(config.texts[key], language, config.default_language);
  const contact = input.contact || {};
  const minute = 60 * 1000;

  if ((input.repliesThisMinute ?? 0) >= config.max_replies_per_minute) {
    return { action: "silent", language, reason: "global_rate_limit", parts: [] };
  }
  if (contact.lastHumanOutboundAt && now - contact.lastHumanOutboundAt < config.handoff_minutes * minute) {
    return { action: "silent", language, reason: "human_active", parts: [] };
  }
  if (contact.mutedUntil && contact.mutedUntil > now) {
    return { action: "silent", language, reason: "handoff_mute", parts: [] };
  }
  if (contact.lastBotOutboundAt && now - contact.lastBotOutboundAt < config.min_seconds_between_replies_per_contact * 1000) {
    return { action: "silent", language, reason: "contact_rate_limit", parts: [] };
  }

  const parts = [];
  const firstContactInWhile =
    !contact.lastInboundAt || now - contact.lastInboundAt > config.greeting_cooldown_hours * 60 * minute;
  if (firstContactInWhile) parts.push(t("greeting"));

  const open = isOpen(config, new Date(now));
  if (!open && firstContactInWhile) parts.push(t("after_hours"));

  const normalized = normalize(input.text);
  if (HANDOFF_WORDS.includes(normalized)) {
    parts.push(t("handoff"));
    return { action: "reply", text: parts.join("\n\n"), language, reason: "handoff_requested", handoff: true, parts };
  }

  const rule = matchRule([...config.menu, ...config.faq], input.text);
  if (rule) {
    parts.push(pick(rule.reply, language, config.default_language));
    return { action: "reply", text: parts.join("\n\n"), language, reason: "rule", parts };
  }

  if (config.ai.enabled) {
    return { action: "ai", language, reason: "ai", parts };
  }

  if (firstContactInWhile || normalized.length <= 12) {
    parts.push(t("menu"));
    return { action: "reply", text: parts.join("\n\n"), language, reason: "menu", parts };
  }
  parts.push(t("fallback"));
  return { action: "reply", text: parts.join("\n\n"), language, reason: "fallback", parts };
}

export function randomDelay(range, random = Math.random) {
  return Math.round(range.min + (range.max - range.min) * random());
}
