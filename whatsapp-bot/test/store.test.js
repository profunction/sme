import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { buildMessages } from "../src/ai.js";
import { DEFAULTS, merge, validate } from "../src/config.js";
import { extractText, formatPairingCode, isCustomerChat, phoneNumberOf } from "../src/whatsapp.js";

test("store tracks contacts, replies, handoff and waiting list", () => {
  const store = new Store(":memory:");
  const jid = "60111@s.whatsapp.net";
  store.recordInbound(jid, "hello", "Ali", 1000, "60111");
  assert.equal(store.contact(jid).lastInboundAt, 1000);
  assert.equal(store.contact(jid).phone, "60111");
  assert.equal(store.contact(jid).name, "Ali");
  assert.deepEqual(store.waitingForHuman().map((w) => w.jid), [jid]);

  store.recordBotReply(jid, "menu", "menu", "en", 2000);
  assert.equal(store.repliesSince(1500), 1);
  assert.deepEqual(store.waitingForHuman().map((w) => w.jid), [jid], "bot reply does not clear waiting");

  store.recordHumanReply(jid, "I will call you", 3000);
  assert.equal(store.contact(jid).lastHumanOutboundAt, 3000);
  assert.deepEqual(store.waitingForHuman(), []);

  store.rememberSent("ABC", 4000);
  assert.equal(store.wasSentByBot("ABC"), true);
  assert.equal(store.wasSentByBot("XYZ"), false);

  store.recordInbound(jid, "0", "Ali", 4500);
  store.silence(jid, 9000);
  assert.equal(store.contact(jid).mutedUntil, 9000);
  assert.deepEqual(store.waitingForHuman().map((w) => w.jid), [jid], "handoff keeps the customer on the waiting list");

  assert.deepEqual(
    store.history(jid, 10).map((m) => m.direction),
    ["in", "bot", "human", "in"]
  );
  assert.equal(store.stats().contacts, 1);
  assert.equal(store.recentConversations()[0].last_text, "0");
  store.close();
});

test("ai history collapses turns and ends with the current user message", () => {
  const history = [
    { direction: "bot", text: "welcome" },
    { direction: "in", text: "hi" },
    { direction: "in", text: "price?" },
    { direction: "bot", text: "RM120" },
  ];
  const messages = buildMessages(history, "ok book me");
  assert.deepEqual(messages, [
    { role: "user", content: "hi\nprice?" },
    { role: "assistant", content: "RM120" },
    { role: "user", content: "ok book me" },
  ]);
  assert.deepEqual(buildMessages([], "hello"), [{ role: "user", content: "hello" }]);
});

test("config validation catches common mistakes", () => {
  const ok = merge(DEFAULTS, { phone_number: "60123456789" });
  assert.deepEqual(validate(ok), []);
  const bad = merge(DEFAULTS, {
    phone_number: "+60 12-345 6789",
    hours: { open: "9am", close: "18:00", days: [7] },
    default_language: "fr",
    ai: { enabled: true, provider: "anthropic", api_key_env: "" },
  });
  const problems = validate(bad);
  assert.ok(problems.some((p) => p.includes("phone_number")));
  assert.ok(problems.some((p) => p.includes("HH:MM")));
  assert.ok(problems.some((p) => p.includes("weekday")));
  assert.ok(problems.some((p) => p.includes("default_language")));
  assert.ok(problems.some((p) => p.includes("api_key_env")));
});

test("whatsapp helpers", () => {
  assert.equal(extractText({ conversation: "hi" }), "hi");
  assert.equal(extractText({ extendedTextMessage: { text: "quoted reply" } }), "quoted reply");
  assert.equal(extractText({ imageMessage: { caption: "see this" } }), "see this");
  assert.equal(extractText({ audioMessage: {} }), "[voice]");
  assert.equal(extractText({ ephemeralMessage: { message: { conversation: "secret" } } }), "secret");
  assert.equal(extractText(null), "");
  assert.equal(isCustomerChat("60111@s.whatsapp.net"), true);
  assert.equal(isCustomerChat("123-456@g.us"), false);
  assert.equal(isCustomerChat("status@broadcast"), false);
  assert.equal(isCustomerChat("abc@newsletter"), false);
  assert.equal(formatPairingCode("ABCD1234"), "ABCD-1234");
  assert.equal(phoneNumberOf({ remoteJid: "84121917329565@lid", senderPn: "6591234567:3@s.whatsapp.net" }), "6591234567");
  assert.equal(phoneNumberOf({ remoteJid: "60111@s.whatsapp.net" }), "60111");
  assert.equal(phoneNumberOf({ remoteJid: "84121917329565@lid" }), null);
});
