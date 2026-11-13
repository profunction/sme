// Pure decision logic: no network, no WhatsApp. Everything here is unit-testable.

const MALAY_HINTS = ["saya", "boleh", "harga", "berapa", "nak", "tak", "tidak", "tiada", "ada", "macam", "mana", "bila", "terima", "kasih", "tolong", "hai", "selamat", "pagi", "petang", "malam", "rosak", "bunyi", "gambar", "projektor", "mikrofon", "skrin", "sambung", "bersambung", "kami", "awak", "sila", "sudah", "belum", "lagi", "dengan", "untuk", "bilik", "mesyuarat"];

export function detectLanguage(text, languages, fallback) {
  const candidates = new Set(languages);
  if (candidates.has("zh") && /[㐀-鿿]/.test(text)) return "zh";
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (candidates.has("ms") && words.some((w) => MALAY_HINTS.includes(w))) return "ms";
  if (candidates.has("en") && words.length) return "en";
  return fallback;
}

// Prefer the customer's language, then English as the bridge, then the default language.
export function pick(texts, language, fallback, variables = null) {
  if (!texts) return "";
  const text = texts[language] ?? texts.en ?? texts[fallback] ?? Object.values(texts)[0] ?? "";
  return variables ? render(text, variables) : text;
}

export function render(text, variables) {
  return String(text).replace(/\{(company|email|phone|address|name)\}/g, (_, key) => variables?.[key] ?? "");
}

export function normalize(text) {
  return String(text).trim().toLowerCase().replace(/\s+/g, " ");
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

// ---- keyword matching -------------------------------------------------------

const keywordCache = new Map();

// English keywords must match as whole phrases ("led" must not fire inside "failed");
// Chinese keywords match as substrings and count double because they are denser.
function keywordScore(normalizedText, keyword) {
  let compiled = keywordCache.get(keyword);
  if (!compiled) {
    const k = normalize(keyword);
    const ascii = /^[\x20-\x7e]+$/.test(k);
    compiled = {
      k,
      ascii,
      re: ascii ? new RegExp(`(?<![a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`) : null,
    };
    keywordCache.set(keyword, compiled);
  }
  if (!compiled.k) return 0;
  if (compiled.ascii) return compiled.re.test(normalizedText) ? compiled.k.length : 0;
  return normalizedText.includes(compiled.k) ? compiled.k.length * 2 : 0;
}

// How distinctive each phrase is inside this rule set: a phrase that also appears
// inside many other entries' phrases ("麦克风", "hdmi") is generic and counts for
// little, so "麦克风啸叫" lands on the feedback entry, not on whichever entry lists
// the bare device name.
const rarityCache = new WeakMap();
const GENERIC_HOLDERS = 3; // a phrase found in this many entries or more is a generic word

function rarityFor(rules) {
  let rarity = rarityCache.get(rules);
  if (!rarity) {
    const phrases = rules.map((rule) => (rule.match || []).map(normalize));
    rarity = new Map();
    for (const list of phrases) {
      for (const phrase of list) {
        if (!phrase || rarity.has(phrase)) continue;
        let holders = 0;
        for (const other of phrases) if (other.some((candidate) => candidate.includes(phrase))) holders += 1;
        rarity.set(phrase, { weight: 1 / (1 + Math.log(Math.max(holders, 1))), generic: holders >= GENERIC_HOLDERS });
      }
    }
    rarityCache.set(rules, rarity);
  }
  return rarity;
}

// Exact `keys` win outright (menu choices). Otherwise the entry whose `match`
// phrases cover the most of the message wins, so specific entries beat generic ones.
// `confident` is false when only generic words matched ("麦克风有问题").
export function matchDetailed(rules, text) {
  const normalized = normalize(text);
  for (const rule of rules) {
    if ((rule.keys || []).some((k) => normalize(k) === normalized)) return { rule, confident: true };
  }
  const rarity = rarityFor(rules);
  let best = null;
  let bestScore = 0;
  let bestConfident = false;
  for (const rule of rules) {
    let score = 0;
    let confident = false;
    for (const keyword of rule.match || []) {
      const hit = keywordScore(normalized, keyword);
      if (!hit) continue;
      const info = rarity.get(normalize(keyword));
      score += hit * (info?.weight ?? 1);
      if (!info?.generic) confident = true;
    }
    if (score > bestScore) {
      best = rule;
      bestScore = score;
      bestConfident = confident;
    }
  }
  return { rule: best, confident: bestConfident };
}

export function matchRule(rules, text) {
  return matchDetailed(rules, text).rule;
}

// ---- fuzzy search over the knowledge base -----------------------------------

const STOPWORDS = new Set(["the", "and", "for", "not", "with", "from", "that", "this", "have", "has", "but", "can", "cannot", "cant", "our", "your", "you", "are", "was", "were", "why", "how", "what", "when", "there", "its", "it's", "please", "help", "need", "now", "just", "still", "all", "any", "got", "get", "very", "already", "also", "into", "out", "one", "lah", "leh", "liao", "problem", "issue", "working", "work", "does", "doesn't", "dont", "don't", "will", "won't", "wont"]);

export function tokens(text) {
  const normalized = normalize(text);
  const out = new Set();
  for (const word of normalized.split(/[^a-z0-9-]+/)) {
    if (word.length >= 3 && !STOPWORDS.has(word)) out.add(word);
  }
  for (const run of normalized.match(/[㐀-鿿]+/g) || []) {
    for (let i = 0; i + 1 < run.length; i += 1) out.add(run.slice(i, i + 2));
  }
  return [...out];
}

const indexCache = new WeakMap();

function indexOf(entry) {
  let index = indexCache.get(entry);
  if (!index) {
    const flat = (value) => (value && typeof value === "object" ? Object.values(value).join("\n") : "");
    index = {
      head: normalize([flat(entry.title), ...(entry.match || [])].join("\n")),
      body: normalize([flat(entry.reply), flat(entry.explain)].join("\n")),
    };
    indexCache.set(entry, index);
  }
  return index;
}

// Rank entries by the message's words they contain. Titles and match phrases count
// more than body text, and a word found in many entries ("meeting", "会议") counts
// for little, so the rare words in the message decide. Returns at most `limit` entries.
const frequencyCache = new WeakMap();

export function search(entries, text, limit = 3, minScore = 2) {
  const query = tokens(text);
  if (!query.length) return [];
  let frequency = frequencyCache.get(entries);
  if (!frequency) frequencyCache.set(entries, (frequency = new Map()));
  const candidates = entries.filter((entry) => entry.title && entry.id);
  const weights = query.map((token) => {
    if (!frequency.has(token)) {
      let holders = 0;
      for (const entry of candidates) if (indexOf(entry).head.includes(token)) holders += 1;
      frequency.set(token, 1 / (1 + Math.log(Math.max(holders, 1))));
    }
    return frequency.get(token);
  });
  const scored = [];
  for (const entry of candidates) {
    const index = indexOf(entry);
    let score = 0;
    query.forEach((token, i) => {
      if (index.head.includes(token)) score += 3 * weights[i];
      else if (index.body.includes(token)) score += 0.5 * weights[i];
    });
    if (score >= minScore) scored.push({ entry, score });
  }
  return scored
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((item) => item.entry);
}

// ---- customers and tiers ----------------------------------------------------

const digits = (value) => String(value || "").replace(/\D/g, "");

export function findCustomer(config, phone, jid) {
  const candidates = [digits(phone), digits(String(jid || "").split("@")[0])].filter(Boolean);
  if (!candidates.length) return null;
  return (config.customers || []).find((c) => (c.phones || []).some((p) => candidates.includes(digits(p)))) || null;
}

// A tier set by hand in the dashboard wins over the one written in config.json.
export function tierOf(config, contact, phone) {
  const stored = contact?.tier;
  if (stored === "none") return null;
  if (stored && config.tiers?.[stored]) return stored;
  const customer = findCustomer(config, phone || contact?.phone, contact?.jid);
  return customer?.tier && config.tiers?.[customer.tier] ? customer.tier : null;
}

// ---- the decision -----------------------------------------------------------

export const OPT_OUT_WORDS = ["stop", "unsubscribe", "退订", "取消订阅"];
export const OPT_IN_WORDS = ["start", "subscribe", "订阅", "恢复订阅"];
export const HANDOFF_WORDS = ["0", "人工", "客服", "真人", "技术员", "human", "agent", "person", "staff", "operator", "technician", "manusia"];
const LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
const QUIET_MINUTES = 10;

// Which option of the last prompt a typed "2", "2)" or "B" refers to. Digits are
// 1-based; "0" is never an option because it always means "talk to a person".
export function optionIndex(text, count) {
  const cleaned = normalize(text).replace(/[).。、．]/g, "");
  let index = -1;
  if (/^\d{1,2}$/.test(cleaned)) index = Number(cleaned) - 1;
  else if (cleaned.length === 1) index = LETTERS.indexOf(cleaned);
  return index >= 0 && index < count ? index : -1;
}

// A prompt as plain text, for chats where tappable options are not available.
export function renderPrompt(prompt) {
  return [prompt.question, ...prompt.options.map((option, index) => `${index + 1}) ${option.label}`)].join("\n");
}

/**
 * Decide how to respond to one incoming customer message.
 * @param {object} config
 * @param {object} input { text, name, tier, contact, lastBotReason, now, repliesThisMinute }
 *
 * A decision may carry `prompt` = { question, options: [{ label, send }] }: a set of
 * choices the customer can tap (sent as a poll) or answer with a number. `send` is
 * what the choice means, fed back into decide() as if the customer had typed it.
 */
export function decide(config, input) {
  const now = input.now ?? Date.now();
  const contact = input.contact || {};
  const minute = 60 * 1000;
  const firstContactInWhile =
    !contact.lastInboundAt || now - contact.lastInboundAt > config.greeting_cooldown_hours * 60 * minute;

  // A number or letter answering the last prompt stands for that option.
  let text = input.text;
  let viaOption = false;
  if (!firstContactInWhile && Array.isArray(contact.pending) && contact.pending.length) {
    const index = optionIndex(text, contact.pending.length);
    if (index >= 0) {
      text = contact.pending[index];
      viaOption = true;
    }
  }
  const isPick = text.startsWith("pick:");

  // Language: a tapped option says nothing about language, so keep the customer's last one.
  const language =
    (isPick || viaOption) && contact.language && config.languages.includes(contact.language)
      ? contact.language
      : detectLanguage(input.text, config.languages, contact.language || config.default_language);
  const tier = input.tier ? config.tiers?.[input.tier] : null;
  const texts = tier?.texts ? { ...config.texts, ...tier.texts } : config.texts;
  const vars = { ...(config.business || {}), name: input.name || contact.name || "" };
  const local = (value) => pick(value, language, config.default_language, vars).trim();
  const t = (key) => local(texts[key]);
  const silent = (reason) => ({ action: "silent", language, reason, parts: [] });

  if ((input.repliesThisMinute ?? 0) >= config.max_replies_per_minute) return silent("global_rate_limit");
  if (contact.lastHumanOutboundAt && now - contact.lastHumanOutboundAt < config.handoff_minutes * minute) return silent("human_active");
  if (contact.mutedUntil && contact.mutedUntil > now) return silent("handoff_mute");
  // A tap on an option right after the prompt arrived is not a burst; never drop it.
  if (!input.selected && contact.lastBotOutboundAt && now - contact.lastBotOutboundAt < config.min_seconds_between_replies_per_contact * 1000) {
    return silent("contact_rate_limit");
  }
  // Some customers are handled by people only; the message still lands on the waiting list.
  if (tier?.bot === "off") return silent("tier_bot_off");

  const parts = [];
  if (firstContactInWhile) parts.push(t("greeting"));
  if (firstContactInWhile && !tier?.ignore_hours && !isOpen(config, new Date(now))) parts.push(t("after_hours"));

  const reply = (reason, extra = {}) => {
    const body = parts.filter(Boolean).join("\n\n");
    const prompt = extra.prompt || null;
    return {
      action: "reply",
      // `text` is the complete plain-text form; `lead` is what precedes a tappable prompt.
      text: prompt ? [body, renderPrompt(prompt)].filter(Boolean).join("\n\n") : body,
      lead: body,
      language,
      reason,
      parts,
      pending: prompt ? prompt.options.map((option) => option.send) : null,
      ...extra,
    };
  };

  const normalized = normalize(text);
  // Unsubscribing from announcements must always work, whatever else is going on.
  if (OPT_OUT_WORDS.includes(normalized)) return { action: "reply", text: t("opt_out"), lead: t("opt_out"), language, reason: "opt_out", parts: [], pending: null, optOut: true };
  if (OPT_IN_WORDS.includes(normalized) && contact.optedOut) return { action: "reply", text: t("opt_in"), lead: t("opt_in"), language, reason: "opt_in", parts: [], pending: null, optOut: false };
  if (HANDOFF_WORDS.includes(normalized)) {
    parts.push(t("handoff"));
    return reply("handoff_requested", { handoff: true });
  }

  // Mode is what the customer chose from the menu: "fix" (quick steps), "explain"
  // (what is going on), "visit" (send a technician), "other" (tell us what happened).
  // A new conversation starts clean.
  const mode = firstContactInWhile ? null : contact.mode || null;
  const footer = t("escalate");
  const entryById = (id) => config.faq.find((entry) => entry.id === id);
  const option = (label, send) => ({ label: local(label), send });
  const otherOption = () => option(texts.option_other, "pick:other");

  // The answer, then (when follow_up is on) a short "did that solve it?" prompt so the
  // customer can confirm, ask for a person, or see the other version without typing.
  const answer = (rule, reason, as = mode) => {
    const explaining = as === "explain" && !!rule.explain;
    parts.push(pick(explaining ? rule.explain : rule.reply, language, config.default_language, vars));
    if (footer && rule.escalate !== false) parts.push(footer);
    const extra = { entry: rule.id || null };
    if (config.follow_up && rule.id) {
      const options = [option(texts.option_solved, "pick:solved"), option(texts.option_not_solved, "0")];
      if (explaining) options.push(option(texts.option_show_fix, `pick:fix:${rule.id}`));
      else if (rule.explain) options.push(option(texts.option_show_explain, `pick:explain:${rule.id}`));
      options.push(option(texts.option_menu, "pick:menu"));
      extra.prompt = { question: t("follow_up"), options };
    }
    return reply(reason, extra);
  };
  const mainMenu = () => {
    const menu = config.main_menu;
    if (!menu?.options?.length) {
      parts.push(t("menu"));
      return reply("menu");
    }
    return reply("menu", { prompt: { question: local(menu.question), options: menu.options.map((item) => option(item.label, item.send)) } });
  };
  const categoryPrompt = () => ({
    question: t("choose_category"),
    options: [...config.categories.map((category) => option(category.title, `pick:cat:${category.id}`)), otherOption()],
  });

  // ---- choices made by tapping an option or answering its number ----
  if (isPick) {
    if (text === "pick:other") {
      parts.push(t("other_prompt"));
      return reply("other_prompt", { setMode: "other" });
    }
    if (text === "pick:describe") {
      parts.push(t("describe"));
      return reply("describe");
    }
    if (text === "pick:menu") return mainMenu();
    if (text === "pick:solved") {
      parts.push(t("solved"));
      return reply("solved");
    }
    for (const as of ["explain", "fix"]) {
      if (!text.startsWith(`pick:${as}:`)) continue;
      const entry = entryById(text.slice(as.length + 6));
      if (entry) return { ...answer(entry, "option_chosen", as), setMode: as };
    }
    if (text.startsWith("pick:cat:")) {
      const category = (config.categories || []).find((item) => item.id === text.slice(9));
      const entries = (category?.entries || []).map(entryById).filter(Boolean).slice(0, 10);
      if (entries.length) {
        return reply("category", {
          prompt: {
            question: t("choose_issue"),
            options: [...entries.map((entry) => option(entry.title, `pick:entry:${entry.id}`)), option(texts.option_none, "pick:describe")],
          },
        });
      }
    }
    if (text.startsWith("pick:entry:")) {
      const entry = entryById(text.slice(11));
      if (entry) return answer(entry, viaOption || input.selected ? "option_chosen" : "rule");
    }
    return mainMenu(); // an option that no longer exists
  }

  const menuRule = matchRule(config.menu, text);
  if (menuRule) {
    const lead = pick(menuRule.reply, language, config.default_language, vars);
    if (menuRule.prompt === "categories" && config.categories?.length) {
      return reply("menu_choice", { setMode: menuRule.mode || undefined, prompt: categoryPrompt() });
    }
    parts.push(lead);
    return reply(menuRule.urgent ? "urgent" : "menu_choice", { urgent: !!menuRule.urgent, setMode: menuRule.mode || undefined });
  }

  // Once a visit is requested or the customer is describing "something else", stop
  // sending self-help: acknowledge once, then stay quiet while details arrive.
  if (mode === "visit" || mode === "other") {
    const ack = mode === "visit" ? "visit_details" : "other_report";
    const recentlyAcked = input.lastBotReason === ack && contact.lastBotOutboundAt && now - contact.lastBotOutboundAt < QUIET_MINUTES * minute;
    if (recentlyAcked) return silent(mode === "visit" ? "visit_collecting" : "other_collecting");
    parts.push(t(mode === "visit" ? "visit_received" : "other_received"));
    return reply(ack, { report: true });
  }

  // A confident match answers straight away. When only a generic word matched
  // and the wider search points somewhere else, let the customer choose instead.
  const matched = matchDetailed(config.faq, text);
  let related = search(config.faq, text);
  if (matched.rule) {
    const unsure = !matched.confident && matched.rule.id && related.length && related[0] !== matched.rule;
    if (!unsure) return answer(matched.rule, "rule");
    related = [...related.filter((entry) => entry !== matched.rule).slice(0, 2), matched.rule];
  }
  if (config.ai.enabled) {
    return { action: "ai", language, reason: "ai", parts, mode, footer, context: related, pending: null };
  }
  if (related.length) {
    return reply("suggest", {
      prompt: {
        question: t("suggest"),
        options: [...related.map((entry) => option(entry.title, `pick:entry:${entry.id}`)), option(texts.option_none, "pick:describe")],
      },
    });
  }
  if (firstContactInWhile || normalized.length <= 12) return mainMenu();
  parts.push(t("fallback"));
  return reply("fallback");
}

export function randomDelay(range, random = Math.random) {
  return Math.round(range.min + (range.max - range.min) * random());
}
