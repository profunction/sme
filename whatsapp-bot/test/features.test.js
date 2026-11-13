import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULTS, load, merge, prepare, profilePaths, readJson, validate } from "../src/config.js";
import { decide, findCustomer, matchRule, search, tierOf, tokens } from "../src/engine.js";
import { Store } from "../src/store.js";
import { createHandler } from "../src/handler.js";
import { systemPrompt } from "../src/ai.js";
import { buildState, startDashboard } from "../src/dashboard.js";
import { startDemo } from "../src/demo.js";
import { buildConfig, parseArgs } from "../src/setup.js";
import { checkKnowledge } from "../scripts/check-knowledge.js";

const OPEN_TIME = Date.UTC(2026, 10, 10, 2, 30); // Tuesday 10:30 in Singapore
const CLOSED_TIME = Date.UTC(2026, 10, 10, 14, 0); // Tuesday 22:00
const seen = (extra = {}) => ({ lastInboundAt: OPEN_TIME - 1000, ...extra });

const kb = [
  { id: "led-wall", title: { zh: "LED 屏花屏", en: "LED wall garbled" }, match: ["led", "花屏"], reply: { zh: "重启发送卡", en: "Restart the sending card" }, explain: { zh: "模组问题", en: "Module issue" } },
  { id: "no-signal", title: { zh: "没信号", en: "No signal" }, match: ["no signal", "hdmi", "没信号"], reply: { zh: "检查线", en: "Check the cable" }, explain: { zh: "线路", en: "Cabling" } },
  { id: "hdcp", title: { zh: "HDCP 错误", en: "HDCP error with Apple TV" }, match: ["hdcp error", "apple tv black", "hdcp 错误"], reply: { zh: "换接口", en: "Use another port" }, explain: { zh: "版权保护握手失败", en: "Copy protection handshake failed" } },
];
const base = merge(DEFAULTS, {
  phone_number: "6512345678",
  timezone: "Asia/Singapore",
  languages: ["zh", "en"],
  business: { company: "ACME AV", email: "help@acme.test" },
  texts: { escalate: { zh: "不行请 email {email} 或在群组留言", en: "Still stuck? Email {email} or post in the group" } },
  menu: [
    { keys: ["1"], mode: "fix", reply: { zh: "说现象", en: "Describe it" } },
    { keys: ["2"], mode: "explain", reply: { zh: "说现象我解释", en: "Describe it and I explain" } },
    { keys: ["3"], mode: "visit", reply: { zh: "发地址", en: "Send the address" } },
  ],
  faq: kb,
  tiers: {
    vip: { label: { zh: "VIP", en: "VIP" }, priority: true, ignore_hours: true, texts: { greeting: { zh: "{name} 您好，贵宾专线", en: "Hello {name}, priority line" } } },
    human_only: { label: { en: "Human only" }, bot: "off" },
  },
  customers: [{ phones: ["+65 9000 1111"], name: "Mr Tan", tier: "vip" }],
});

test("english keywords need word boundaries; chinese keywords match inside text", () => {
  assert.equal(matchRule(kb, "the update failed again"), null, "'led' must not fire inside 'failed'");
  assert.equal(matchRule(kb, "our LED wall is garbled").id, "led-wall");
  assert.equal(matchRule(kb, "led屏花屏了").id, "led-wall");
  assert.equal(matchRule(kb, "LED."), kb[0]);
});

test("the most specific entry wins over a generic keyword", () => {
  assert.equal(matchRule(kb, "hdmi shows hdcp error on the tv").id, "hdcp");
  assert.equal(matchRule(kb, "hdmi not detected").id, "no-signal");
});

test("search ranks related entries and feeds A/B/C suggestions", () => {
  assert.deepEqual(tokens("Apple TV 版权保护"), ["apple", "版权", "权保", "保护"]);
  assert.equal(search(kb, "apple tv copy protection handshake")[0].id, "hdcp");
  assert.deepEqual(search(kb, "ok thanks"), []);
  const offer = decide(base, { text: "apple tv copy protection problem", contact: seen(), now: OPEN_TIME });
  assert.equal(offer.reason, "suggest");
  assert.match(offer.text, /A\) HDCP error with Apple TV/);
  assert.deepEqual(offer.pending, ["hdcp"]);
  const chosen = decide(base, { text: "A", contact: seen({ pending: offer.pending }), now: OPEN_TIME });
  assert.equal(chosen.reason, "suggestion_chosen");
  assert.equal(chosen.text, "Use another port\n\nStill stuck? Email help@acme.test or post in the group");
  const stale = decide(base, { text: "a", contact: seen({ pending: null }), now: OPEN_TIME });
  assert.notEqual(stale.reason, "suggestion_chosen");
});

test("every knowledge answer carries the email-or-group footer, in each mode", () => {
  for (const mode of [null, "fix", "explain"]) {
    const d = decide(base, { text: "没信号", contact: seen({ mode }), now: OPEN_TIME });
    assert.match(d.text, /不行请 email help@acme\.test 或在群组留言$/, `mode ${mode}`);
    assert.ok(d.text.startsWith(mode === "explain" ? "线路" : "检查线"));
  }
  const menu = decide(base, { text: "1", contact: seen(), now: OPEN_TIME });
  assert.equal(menu.text, "说现象");
});

test("visit mode acknowledges once, then stays quiet while details arrive", () => {
  const first = decide(base, { text: "公司在 12 Jalan Example，投影机没信号", contact: seen({ mode: "visit" }), lastBotReason: "rule", now: OPEN_TIME });
  assert.equal(first.reason, "visit_details");
  const second = decide(base, { text: "[image]", contact: seen({ mode: "visit", lastBotOutboundAt: OPEN_TIME - 60_000 }), lastBotReason: "visit_details", now: OPEN_TIME });
  assert.deepEqual([second.action, second.reason], ["silent", "visit_collecting"]);
  const later = decide(base, { text: "还有一件事", contact: seen({ mode: "visit", lastBotOutboundAt: OPEN_TIME - 11 * 60_000 }), lastBotReason: "visit_details", now: OPEN_TIME });
  assert.equal(later.reason, "visit_details");
  const backToMenu = decide(base, { text: "1", contact: seen({ mode: "visit" }), now: OPEN_TIME });
  assert.equal(backToMenu.setMode, "fix");
});

test("customer tiers: lookup, precedence, VIP wording and human-only", () => {
  assert.equal(findCustomer(base, "6590001111").name, "Mr Tan");
  assert.equal(findCustomer(base, null, "6590001111@s.whatsapp.net").name, "Mr Tan");
  assert.equal(findCustomer(base, "6599999999"), null);
  assert.equal(tierOf(base, { tier: null }, "6590001111"), "vip");
  assert.equal(tierOf(base, { tier: "none" }, "6590001111"), null, "dashboard can demote a configured VIP");
  assert.equal(tierOf(base, { tier: "human_only" }, "6599999999"), "human_only");
  assert.equal(tierOf(base, { tier: "deleted-tier" }, "6599999999"), null);

  const vip = decide(base, { text: "hello", name: "Mr Tan", tier: "vip", contact: {}, now: CLOSED_TIME });
  assert.ok(vip.text.startsWith("Hello Mr Tan, priority line"));
  assert.ok(!vip.text.includes(base.texts.after_hours.en), "VIPs do not get the after-hours notice");
  const standard = decide(base, { text: "hello", contact: {}, now: CLOSED_TIME });
  assert.ok(standard.text.includes(base.texts.after_hours.en));
  const humanOnly = decide(base, { text: "没信号", tier: "human_only", contact: seen(), now: OPEN_TIME });
  assert.deepEqual([humanOnly.action, humanOnly.reason], ["silent", "tier_bot_off"]);
});

test("handler applies tiers, remembers suggestions and gives the AI its knowledge context", async () => {
  const store = new Store(":memory:");
  const sent = [];
  const aiCalls = [];
  const config = merge(base, { min_seconds_between_replies_per_contact: 0 });
  const make = (cfg) =>
    createHandler({ config: cfg, store, instant: true, log: () => {}, send: async (jid, text) => (sent.push(text), `id${sent.length}`), ai: async (_ai, input) => (aiCalls.push(input), "AI answer") });
  const handler = make(config);

  await handler({ jid: "6590001111@s.whatsapp.net", phone: "6590001111", text: "hi", name: "tan88", id: "a", fromMe: false });
  assert.ok(sent.at(-1).startsWith("Hello Mr Tan, priority line"), "configured customer name and tier are used");

  const jid = "6591112222@s.whatsapp.net";
  store.recordInbound(jid, "earlier", "Ali", Date.now() - 3600_000);
  await handler({ jid, text: "apple tv copy protection problem", id: "b", fromMe: false });
  assert.deepEqual(store.contact(jid).pending, ["hdcp"]);
  await handler({ jid, text: "a", id: "c", fromMe: false });
  assert.ok(sent.at(-1).startsWith("Use another port"));
  assert.equal(store.contact(jid).pending, null, "suggestions are cleared after use");

  store.setTier(jid, "human_only");
  const before = sent.length;
  const quiet = await handler({ jid, text: "no signal", id: "d", fromMe: false });
  assert.equal(quiet.reply, null);
  assert.equal(sent.length, before);
  assert.equal(store.waitingForHuman().some((w) => w.jid === jid), true);

  store.setTier(jid, null);
  const withAi = make(merge(config, { ai: { enabled: true } }));
  await handler({ jid, text: "2", id: "e", fromMe: false });
  await withAi({ jid, text: "apple tv copy protection problem", id: "f", fromMe: false });
  assert.equal(aiCalls.length, 1);
  assert.deepEqual(aiCalls[0].context.map((e) => e.id), ["hdcp"]);
  assert.equal(aiCalls[0].mode, "explain");
  assert.equal(sent.at(-1), "AI answer\n\nStill stuck? Email help@acme.test or post in the group");
  store.close();
});

test("AI system prompt includes facts, mode style and knowledge entries in the right language", () => {
  const prompt = systemPrompt(
    { system_prompt: "You support {company}.", facts: "Email {email}." },
    { language: "zh", context: [kb[2]], mode: "fix", variables: { company: "ACME AV", email: "help@acme.test" } }
  );
  assert.match(prompt, /You support ACME AV\./);
  assert.match(prompt, /Reply in Chinese\./);
  assert.match(prompt, /in a hurry/);
  assert.match(prompt, /Email help@acme\.test\./);
  assert.match(prompt, /### HDCP 错误\nQuick steps:\n换接口\nBackground:\n版权保护握手失败/);
  assert.match(systemPrompt({ system_prompt: "x", facts: "" }, { language: "en" }), /No knowledge base entry matched/);
});

test("config helpers: BOM, knowledge folders, profiles", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-config-"));
  fs.mkdirSync(path.join(dir, "kb"));
  fs.writeFileSync(path.join(dir, "kb", "b.json"), JSON.stringify([{ id: "two", title: { en: "Two" }, match: ["two things"], reply: { en: "2" } }]));
  fs.writeFileSync(path.join(dir, "kb", "a.json"), "﻿" + JSON.stringify([{ id: "one", title: { en: "One" }, match: ["one thing"], reply: { en: "1" } }]));
  fs.writeFileSync(path.join(dir, "config.json"), "﻿" + JSON.stringify({ phone_number: "6512345678", knowledge: ["kb"], faq: [{ match: ["own"], reply: { en: "own" } }] }));
  assert.equal(readJson(path.join(dir, "config.json")).phone_number, "6512345678");
  const config = load(path.join(dir, "config.json"));
  assert.deepEqual(config.faq.map((e) => e.id), [undefined, "one", "two"]);
  assert.throws(() => prepare({ knowledge: ["missing"] }, dir), /knowledge path not found/);
  fs.writeFileSync(path.join(dir, "kb", "c.json"), JSON.stringify([{ id: "one", title: { en: "dup" }, match: ["dup thing"], reply: { en: "x" } }]));
  assert.throws(() => load(path.join(dir, "config.json")), /duplicate knowledge id one/);

  assert.deepEqual(profilePaths("/r"), { profile: "", config: path.join("/r", "config.json"), auth: path.join("/r", "auth"), db: path.join("/r", "data", "bot.sqlite3") });
  assert.deepEqual(profilePaths("/r", "second"), { profile: "second", config: path.join("/r", "config.second.json"), auth: path.join("/r", "auth-second"), db: path.join("/r", "data", "second.sqlite3") });
  assert.throws(() => profilePaths("/r", "../evil"), /profile name/);
  const bad = merge(DEFAULTS, { phone_number: "6512345678", tiers: { x: { bot: "maybe" } }, customers: [{ phones: [], tier: "nope" }] });
  const problems = validate(bad);
  assert.ok(problems.some((p) => p.includes("tiers.x.bot")));
  assert.ok(problems.some((p) => p.includes("needs phones")));
  assert.ok(problems.some((p) => p.includes("unknown tier nope")));
});

test("setup builds a valid AV config from answers", () => {
  assert.deepEqual(parseArgs(["second", "--number", "6591234567", "--yes"]), { profile: "second", flags: { number: "6591234567", yes: true } });
  const config = buildConfig("av", { number: "+65 9123 4567", company: "ACME AV", email: "help@acme.test" });
  assert.equal(config.phone_number, "6591234567");
  assert.equal(config.timezone, "Asia/Singapore");
  assert.equal(config.business.company, "ACME AV");
  const full = prepare(config);
  assert.deepEqual(validate(full), []);
  assert.ok(full.faq.length >= 26);
  assert.equal(buildConfig("basic", { number: "60123456789" }).timezone, "Asia/Kuala_Lumpur");
});

test("shipped knowledge base passes its checks and answers real questions", () => {
  const { total, problems } = checkKnowledge();
  assert.deepEqual(problems, []);
  assert.ok(total >= 26);
  const config = prepare(buildConfig("av", { number: "6591234567", company: "ACME AV", email: "help@acme.test" }));
  const ask = (text, mode = "fix") => decide(config, { text, contact: seen({ mode }), now: OPEN_TIME });
  assert.equal(ask("投影机没画面").entry, "core-projector-no-image");
  assert.equal(ask("HDMI no signal").entry, "core-no-signal");
  assert.equal(ask("麦克风一直啸叫").entry, "core-mic-feedback");
  assert.equal(ask("zoom room 连不上").entry, "core-vc-not-connecting");
  const explained = ask("no sound in the meeting room", "explain");
  assert.equal(explained.entry, "core-no-sound");
  assert.match(explained.text, /^Sound travels/);
  assert.match(explained.text, /email us at help@acme\.test or post in the group/);
  assert.match(ask("你好", null).text, /1 来不及了/);
  assert.equal(ask("3").setMode, "visit");
});

test("dashboard state, message API and tier writes", async () => {
  const store = new Store(":memory:");
  const now = Date.now();
  store.recordInbound("6590001111@s.whatsapp.net", "vip waiting", "tan88", now - 5000, "6590001111");
  store.recordInbound("111@lid", "standard waiting", "Ali", now - 1000);
  store.recordInbound("6593334444@s.whatsapp.net", "answered", "Bo", now - 3000, "6593334444");
  store.recordHumanReply("6593334444@s.whatsapp.net", "done", now - 2000);
  const status = { connection: "open", phone: "6512345678" };
  const state = buildState({ status, store, config: base });
  assert.deepEqual(state.conversations.map((c) => [c.name, c.display, c.tier, c.waiting]), [
    ["Mr Tan", "+6590001111", "vip", true],
    ["Ali", "ID 111", null, true],
    ["Bo", "+6593334444", null, false],
  ]);
  assert.equal(state.knowledgeCount, 3);
  assert.deepEqual(state.tiers.map((t) => t.id), ["vip", "human_only"]);

  const server = startDashboard({ port: 18941, status, store, config: base, log: () => {} });
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${status.dashboardPort}`;
  try {
    const page = await fetch(url + "/");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /WhatsApp back office/);
    const messages = await (await fetch(url + "/api/messages?jid=111%40lid")).json();
    assert.deepEqual(messages.messages.map((m) => [m.direction, m.text]), [["in", "standard waiting"]]);
    const post = (body, headers = {}) => fetch(url + "/api/contact", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    assert.equal((await post({ jid: "111@lid", tier: "vip" }, { origin: "https://evil.example" })).status, 403);
    assert.equal((await fetch(url + "/api/contact", { method: "POST", body: "{}" })).status, 403, "form-style posts are refused");
    assert.equal((await post({ jid: "111@lid", tier: "nope" })).status, 400);
    assert.equal((await post({ jid: "111@lid", tier: "vip" }, { origin: url })).status, 200);
    assert.equal(store.contact("111@lid").tier, "vip");
  } finally {
    server.close();
    store.close();
  }
});

test("demo mode answers through HTTP with the shipped AV config", async () => {
  const demo = await startDemo({ port: 18951 });
  await new Promise((resolve) => demo.server.once("listening", resolve));
  const url = `http://127.0.0.1:${demo.status.dashboardPort}`;
  const send = async (text) => (await fetch(url + "/demo/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jid: "6590000101@s.whatsapp.net", text }) })).json();
  try {
    const hello = await send("你好");
    assert.equal(hello.decision.reason, "menu");
    assert.match(hello.reply, /1 来不及了/);
    assert.equal((await send("1")).decision.reason, "menu_choice");
    const fix = await send("投影机没画面");
    assert.match(fix.reply, /^投影机没画面，按顺序做/);
    assert.match(fix.reply, /欢迎 email 我们/);
    const state = await (await fetch(url + "/api/state")).json();
    assert.equal(state.demo, true);
    assert.equal(state.conversations[0].mode, "fix");
  } finally {
    demo.server.close();
    demo.store.close();
  }
});
