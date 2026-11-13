import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, merge } from "../src/config.js";
import { decide, detectLanguage, isOpen, matchRule, randomDelay } from "../src/engine.js";

const base = merge(DEFAULTS, {
  phone_number: "60123456789",
  menu: [{ keys: ["1", "price", "价格", "harga"], reply: { zh: "价格表", en: "Price list", ms: "Senarai harga" } }],
  faq: [{ match: ["online", "网课"], reply: { zh: "有网课", en: "We have online classes" } }],
});

// Tuesday 10:30 in Kuala Lumpur (UTC+8) = 02:30 UTC
const OPEN_TIME = Date.UTC(2026, 10, 10, 2, 30);
// Tuesday 22:00 KL = 14:00 UTC
const CLOSED_TIME = Date.UTC(2026, 10, 10, 14, 0);
// Sunday 10:30 KL
const SUNDAY = Date.UTC(2026, 10, 8, 2, 30);

test("language detection", () => {
  assert.equal(detectLanguage("请问价格", ["zh", "en", "ms"], "zh"), "zh");
  assert.equal(detectLanguage("berapa harga?", ["zh", "en", "ms"], "zh"), "ms");
  assert.equal(detectLanguage("how much is it", ["zh", "en", "ms"], "zh"), "en");
  assert.equal(detectLanguage("1", ["zh", "en", "ms"], "zh"), "zh");
  assert.equal(detectLanguage("how much", ["zh"], "zh"), "zh");
});

test("business hours respect timezone, days and overnight ranges", () => {
  assert.equal(isOpen(base, new Date(OPEN_TIME)), true);
  assert.equal(isOpen(base, new Date(CLOSED_TIME)), false);
  assert.equal(isOpen(base, new Date(SUNDAY)), false);
  const night = merge(base, { hours: { open: "20:00", close: "02:00", days: [0, 1, 2, 3, 4, 5, 6] } });
  assert.equal(isOpen(night, new Date(CLOSED_TIME)), true);
});

test("exact keys win over contains matches", () => {
  assert.equal(matchRule([...base.menu, ...base.faq], " PRICE ").reply.en, "Price list");
  assert.equal(matchRule([...base.menu, ...base.faq], "do you have online class?").reply.en, "We have online classes");
  assert.equal(matchRule([...base.menu, ...base.faq], "hello"), null);
});

test("first contact gets greeting plus menu, in the customer's language", () => {
  const d = decide(base, { text: "hello", contact: {}, now: OPEN_TIME });
  assert.equal(d.action, "reply");
  assert.equal(d.language, "en");
  assert.ok(d.text.startsWith(base.texts.greeting.en));
  assert.ok(d.text.includes(base.texts.menu.en));
  assert.ok(!d.text.includes(base.texts.after_hours.en));
});

test("after hours notice only on first contact", () => {
  const first = decide(base, { text: "你好", contact: {}, now: CLOSED_TIME });
  assert.ok(first.text.includes(base.texts.after_hours.zh));
  const again = decide(base, { text: "1", contact: { lastInboundAt: CLOSED_TIME - 60_000 }, now: CLOSED_TIME });
  assert.equal(again.text, "价格表");
});

test("menu keys and faq answer directly", () => {
  const d = decide(base, { text: "1", contact: { lastInboundAt: OPEN_TIME - 1000 }, now: OPEN_TIME });
  assert.equal(d.reason, "rule");
  assert.equal(d.text, "价格表");
  const ms = decide(base, { text: "harga", contact: { lastInboundAt: OPEN_TIME - 1000 }, now: OPEN_TIME });
  assert.equal(ms.text, "Senarai harga");
});

test("handoff words silence the bot afterwards", () => {
  const d = decide(base, { text: "人工", contact: { lastInboundAt: OPEN_TIME - 1000 }, now: OPEN_TIME });
  assert.equal(d.handoff, true);
  assert.equal(d.text, base.texts.handoff.zh);
});

test("stays silent while the owner is replying", () => {
  const d = decide(base, {
    text: "anything",
    contact: { lastInboundAt: OPEN_TIME - 1000, lastHumanOutboundAt: OPEN_TIME - 5 * 60_000 },
    now: OPEN_TIME,
  });
  assert.deepEqual([d.action, d.reason], ["silent", "human_active"]);
  const later = decide(base, {
    text: "anything",
    contact: { lastInboundAt: OPEN_TIME - 1000, lastHumanOutboundAt: OPEN_TIME - 31 * 60_000 },
    now: OPEN_TIME,
  });
  assert.equal(later.action, "reply");
});

test("rate limits per contact and globally", () => {
  const burst = decide(base, {
    text: "hi",
    contact: { lastInboundAt: OPEN_TIME - 1000, lastBotOutboundAt: OPEN_TIME - 1000 },
    now: OPEN_TIME,
  });
  assert.equal(burst.reason, "contact_rate_limit");
  const flood = decide(base, { text: "hi", contact: {}, now: OPEN_TIME, repliesThisMinute: 20 });
  assert.equal(flood.reason, "global_rate_limit");
});

test("unknown long message falls back; ai mode defers", () => {
  const long = decide(base, { text: "I want to ask about something very specific please", contact: { lastInboundAt: OPEN_TIME - 1000 }, now: OPEN_TIME });
  assert.equal(long.reason, "fallback");
  const ai = decide(merge(base, { ai: { enabled: true } }), { text: "tell me more", contact: { lastInboundAt: OPEN_TIME - 1000 }, now: OPEN_TIME });
  assert.equal(ai.action, "ai");
  assert.deepEqual(ai.parts, []);
});

test("random delay stays within range", () => {
  assert.equal(randomDelay({ min: 1000, max: 3000 }, () => 0), 1000);
  assert.equal(randomDelay({ min: 1000, max: 3000 }, () => 1), 3000);
});
