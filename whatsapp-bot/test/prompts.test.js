import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { proto } from "@whiskeysockets/baileys";
import { DEFAULTS, merge, prepare, validate } from "../src/config.js";
import { decide, optionIndex, parseSteps, renderPrompt } from "../src/engine.js";
import { Store } from "../src/store.js";
import { createHandler } from "../src/handler.js";
import { readPollVote } from "../src/whatsapp.js";
import { buildConfig } from "../src/setup.js";
import { startDemo } from "../src/demo.js";

const NOW = Date.UTC(2026, 10, 10, 2, 30);
const av = prepare(buildConfig("av", { number: "6591234567", company: "ACME AV", email: "help@acme.test", notify: "+65 9000 1234, 6591234567" }));
const fast = { ...av, min_seconds_between_replies_per_contact: 0 };

test("typed numbers and letters map onto the last prompt; 0 never does", () => {
  assert.equal(optionIndex("2", 5), 1);
  assert.equal(optionIndex(" 2) ", 5), 1);
  assert.equal(optionIndex("B", 5), 1);
  assert.equal(optionIndex("11", 11), 10);
  assert.equal(optionIndex("6", 5), -1);
  assert.equal(optionIndex("0", 5), -1);
  assert.equal(optionIndex("ab", 5), -1);
  assert.equal(optionIndex("投影机", 5), -1);
  assert.equal(renderPrompt({ question: "Q?", options: [{ label: "x" }, { label: "y" }] }), "Q?\n1) x\n2) y");
});

test("AV template: staff number parsed, bot's own number dropped, config valid", () => {
  assert.deepEqual(av.notify.numbers, ["6590001234"]);
  assert.deepEqual(validate(av), []);
  assert.equal(av.menu_style, "poll");
  assert.equal(av.categories.length, 7);
  assert.equal(av.guided_steps, true);
  for (const entry of av.faq.filter((e) => e.id && e.guided !== false)) {
    for (const lang of ["zh", "en"]) assert.ok(parseSteps(entry.reply[lang]).length >= 3, `${entry.id} ${lang} has numbered steps`);
    assert.equal(parseSteps(entry.reply.zh).length, parseSteps(entry.reply.en).length, `${entry.id} has the same steps in both languages`);
  }
  const problems = validate({ ...av, categories: [{ id: "x", title: { en: "X" }, entries: ["no-such-entry"] }], menu_style: "buttons", notify: { numbers: ["12"] } });
  assert.ok(problems.some((p) => p.includes("unknown knowledge id no-such-entry")));
  assert.ok(problems.some((p) => p.includes("menu_style")));
  assert.ok(problems.some((p) => p.includes("notify.numbers")));
});

test("guided path: device menu, problem list, then one step at a time", () => {
  const menu = decide(av, { text: "hi there", contact: {}, now: NOW });
  assert.equal(menu.reason, "menu");
  assert.equal(menu.lead, "Hello, this is ACME AV technical support.");
  assert.equal(menu.prompt.question, "What can we help you with today? Tap an option, or just type what is happening.");
  assert.deepEqual(menu.pending.slice(0, 3), ["pick:cat:projector", "pick:cat:display", "pick:cat:audio"]);
  assert.deepEqual(menu.pending.slice(-3), ["pick:visit", "pick:other", "0"]);
  assert.ok(menu.prompt.options.length <= 12, "fits in one WhatsApp poll");

  const contact = { lastInboundAt: NOW - 1000, language: "en" };
  const problems = decide(av, { text: "3", contact: { ...contact, pending: menu.pending }, now: NOW });
  assert.deepEqual([problems.reason, problems.lead], ["category", ""]);
  assert.equal(problems.prompt.options[1].label, "Microphone feedback or echo");
  assert.deepEqual(problems.pending.slice(-2), ["pick:describe", "0"]);
  assert.equal(problems.prompt.options.at(-1).label, "Have a technician contact me");
  assert.equal(problems.prompt.options.length, 12, "ten problems, none of these, and a technician: exactly what one poll holds");
  for (const prompt of [menu.prompt, problems.prompt]) assert.equal(prompt.options.at(-1).label, "Have a technician contact me", "a person is one tap away from the first screen on");
  const person = decide(av, { text: "12", contact: { ...contact, pending: problems.pending }, now: NOW });
  assert.equal(person.handoff, true);

  const first = decide(av, { text: "2", contact: { ...contact, pending: problems.pending }, now: NOW });
  assert.deepEqual([first.reason, first.entry, first.step], ["option_chosen", "core-mic-feedback", 1]);
  assert.equal(first.lead, "OK, let's take this one step at a time, starting with the most common cause. There are 6 steps.\n\nStep 1 of 6\nLower the mic or master volume a little; feedback stops immediately.");
  assert.equal(first.prompt.question, "How did that go?");
  assert.deepEqual(first.prompt.options.map((o) => o.label), ["That fixed it", "Not yet, next step", "Why does this happen?", "Have a technician contact me"]);
  assert.deepEqual(first.pending, ["pick:solved:core-mic-feedback:1", "pick:step:core-mic-feedback:2", "pick:why:core-mic-feedback:1", "pick:tech:core-mic-feedback:1"]);
  assert.ok(!first.lead.includes("email us"), "no contact footer between steps");

  const second = decide(av, { text: "2", contact: { ...contact, pending: first.pending }, now: NOW });
  assert.deepEqual([second.reason, second.step], ["step", 2]);
  assert.match(second.lead, /^Step 2 of 6\nKeep the mic pointing away/);
  assert.equal(second.prompt.question, "Any change after that step?", "the question is worded differently each time");

  const why = decide(av, { text: "3", contact: { ...contact, pending: second.pending }, now: NOW });
  assert.equal(why.reason, "why");
  assert.match(why.lead, /^Feedback is the mic picking up the speakers/);
  assert.equal(why.prompt.question, "Shall we carry on?");
  assert.deepEqual(why.pending, ["pick:solved:core-mic-feedback:2", "pick:step:core-mic-feedback:3", "pick:tech:core-mic-feedback:2"]);

  const solved = decide(av, { text: "1", contact: { ...contact, pending: second.pending }, now: NOW });
  assert.deepEqual([solved.reason, solved.pending, solved.text], ["solved", null, av.texts.solved.en]);

  const last = decide(av, { text: "pick:step:core-mic-feedback:6", contact, selected: true, now: NOW });
  assert.equal(last.prompt.options[1].label, "Still not working");
  const exhausted = decide(av, { text: "2", contact: { ...contact, pending: last.pending }, now: NOW });
  assert.deepEqual([exhausted.reason, exhausted.handoff, exhausted.report, exhausted.pending], ["steps_exhausted", true, true, null]);
  assert.match(exhausted.text, /^You have tried every step and it is still not working, so this is not something you did wrong/);
  assert.match(exhausted.text, /You can also email us at help@acme\.test or post in the group at any time\.$/);
  assert.equal(exhausted.note, "麦克风啸叫或回音\n已试 6 / 6 步 · tried 6 of 6 steps");

  const tech = decide(av, { text: "4", contact: { ...contact, pending: second.pending }, now: NOW });
  assert.deepEqual([tech.reason, tech.handoff], ["tech_requested", true]);
  assert.match(tech.note, /tried 2 of 6 steps/);
});

test("typing a problem starts the same guided steps; guides and safety notices are sent whole", () => {
  const contact = { lastInboundAt: NOW - 1000, language: "zh" };
  const typed = decide(av, { text: "投影机没画面", contact: { ...contact, pending: ["pick:cat:audio"] }, now: NOW });
  assert.deepEqual([typed.entry, typed.step], ["core-projector-no-image", 1]);
  assert.match(typed.lead, /^好的，我们一步一步来，从最常见的原因开始，一共 6 步。\n\n第 1 步（共 6 步）\n/);

  const safety = decide(av, { text: "投影机有烧焦味", contact, now: NOW });
  assert.equal(safety.entry, "proj-burning-smell-smoke");
  assert.equal(safety.step, undefined, "a safety notice is never drip-fed");
  assert.match(safety.lead, /欢迎 email 我们（help@acme\.test），或在群组里留言/);
  assert.equal(safety.prompt.question, "这样解决了吗？");
  assert.equal(safety.pending[1], "pick:tech:proj-burning-smell-smoke:0");
  const person = decide(av, { text: "2", contact: { ...contact, pending: safety.pending }, now: NOW });
  assert.deepEqual([person.reason, person.handoff], ["tech_requested", true]);
  assert.equal(person.note, "投影机有烧焦味或冒烟");

  const unknown = decide(av, { text: "我们办公室的咖啡机坏了你们能不能顺便看一下", contact, now: NOW });
  assert.deepEqual([unknown.reason, unknown.report], ["fallback", true], "an unanswerable message goes to a person, not back to the menu");
  assert.match(unknown.text, /^收到。这个情况我先转给同事看一下/);
});

test("a number keeps the customer's language; a new conversation ignores stale options", () => {
  const pending = ["pick:cat:projector", "pick:cat:display"];
  const zh = decide(av, { text: "1", contact: { lastInboundAt: NOW - 1000, language: "zh", pending }, now: NOW });
  assert.equal(zh.language, "zh");
  assert.equal(zh.prompt.question, "明白。是下面哪一种情况？");
  const en = decide(av, { text: "1", contact: { lastInboundAt: NOW - 1000, language: "en", pending }, now: NOW });
  assert.equal(en.prompt.options[0].label, "Projector shows no image");
  const stale = decide(av, { text: "1", contact: { lastInboundAt: NOW - 30 * 3600_000, language: "en", pending: ["pick:solved:core-no-sound:2"] }, now: NOW });
  assert.equal(stale.reason, "menu", "after the cooldown an old prompt's numbers mean nothing");
  assert.equal(decide(av, { text: "上门", contact: { lastInboundAt: NOW - 1000 }, now: NOW }).setMode, "visit");
  assert.equal(decide(av, { text: "pick:visit", contact: { lastInboundAt: NOW - 1000, language: "en" }, selected: true, now: NOW }).reason, "visit_prompt");
});

test("Other: asks what happened, takes the report once, then stays quiet", () => {
  const contact = { lastInboundAt: NOW - 1000, language: "zh" };
  const ask = decide(av, { text: "pick:other", contact, selected: true, now: NOW });
  assert.deepEqual([ask.reason, ask.setMode, ask.pending], ["other_prompt", "other", null]);
  assert.equal(decide(av, { text: "其他", contact: { ...contact, pending: null }, now: NOW }).setMode, "other", "typing the word works too");
  const report = decide(av, { text: "投影机没画面，而且大堂的灯也一起坏了", contact: { ...contact, mode: "other" }, lastBotReason: "other_prompt", now: NOW });
  assert.deepEqual([report.reason, report.report], ["other_report", true], "no self-help once they chose Other");
  assert.equal(report.text, av.texts.other_received.zh);
  const more = decide(av, { text: "[image]", contact: { ...contact, mode: "other", lastBotOutboundAt: NOW - 30_000 }, lastBotReason: "other_report", now: NOW });
  assert.deepEqual([more.action, more.reason], ["silent", "other_collecting"]);
});

function harness(config = fast) {
  const store = new Store(":memory:");
  const out = [];
  let n = 0;
  const handler = createHandler({
    config,
    store,
    instant: true,
    log: () => {},
    send: async (jid, text) => (out.push({ type: "text", jid, text }), `t${++n}`),
    sendPoll: async (jid, question, labels) => (out.push({ type: "poll", jid, question, labels }), { id: `p${++n}`, secret: "c2VjcmV0" }),
  });
  return { store, out, handler };
}
const C = "6591112222@s.whatsapp.net";
const STAFF = "6590001234@s.whatsapp.net";

test("handler sends prompts as polls, walks the steps by taps, and alerts staff", async () => {
  const { store, out, handler } = harness();
  await handler({ jid: C, phone: "6591112222", text: "hello", name: "Sarah", id: "m1", fromMe: false });
  assert.deepEqual(out.map((m) => m.type), ["text", "poll"]);
  assert.equal(out[0].text, "Hello, this is ACME AV technical support.");
  assert.equal(out[1].labels.length, 10);
  const menuPoll = store.poll("p2");
  assert.deepEqual([menuPoll.jid, menuPoll.sends[8], menuPoll.secret], [C, "pick:other", "c2VjcmV0"]);
  assert.equal(store.wasSentByBot("p2"), true);
  assert.deepEqual(store.messages(C).at(-1).options, out[1].labels, "the dashboard can draw the same choices");

  out.length = 0;
  const tapped = await handler.select({ jid: C, phone: "6591112222", name: "Sarah", pollId: "p2", index: 2 });
  assert.equal(tapped.decision.reason, "category");
  assert.deepEqual(out.map((m) => m.type), ["poll"], "no extra text when there is nothing to say before the choices");
  assert.equal(out[0].labels[0], "No sound");
  assert.equal(store.messages(C).at(-2).text, "Sound, microphones or speakers", "history shows the label, not an internal code");

  out.length = 0;
  await handler.select({ jid: C, phone: "6591112222", pollId: "p3", index: 0 });
  assert.deepEqual(out.map((m) => m.type), ["text", "poll"]);
  assert.match(out[0].text, /one step at a time.*There are 6 steps\.\n\nStep 1 of 6\nAmplifier \/ mixer \/ speakers powered on\?/s);
  assert.equal(out[1].question, "How did that go?");

  out.length = 0;
  await handler.select({ jid: C, phone: "6591112222", pollId: "p5", index: 1 });
  assert.match(out[0].text, /^Step 2 of 6\n/);
  out.length = 0;
  await handler.select({ jid: C, phone: "6591112222", name: "Sarah", pollId: "p7", index: 3 });
  assert.deepEqual(out.map((m) => m.jid), [C, STAFF]);
  assert.match(out[0].text, /^Sure, I will have a technician contact you directly/);
  assert.equal(out[1].text, "【排查中途要求技术员 / Asked for a technician】\nSarah +6591112222\nhttps://wa.me/6591112222\n\n没声音\n已试 2 / 6 步 · tried 2 of 6 steps\nHave a technician contact me");
  assert.ok(store.contact(C).mutedUntil > Date.now(), "the bot steps back once a technician is on the way");

  assert.equal(await handler.select({ jid: "6590000000@s.whatsapp.net", pollId: "p2", index: 0 }), null, "a tap from another chat is ignored");
  assert.equal(await handler.select({ jid: C, pollId: "unknown", index: 0 }), null);
  store.close();
});

test("Other report and unanswerable messages reach staff; staff replies never trigger the bot", async () => {
  const { store, out, handler } = harness();
  await handler({ jid: C, phone: "6591112222", text: "hi", name: "Sarah", id: "m1", fromMe: false });
  out.length = 0;
  await handler.select({ jid: C, phone: "6591112222", name: "Sarah", pollId: "p2", index: 8 });
  assert.equal(store.contact(C).mode, "other");
  assert.equal(out.length, 1);
  out.length = 0;
  await handler({ jid: C, phone: "6591112222", text: "The stage lights and the mixer both died after the storm", name: "Sarah", id: "m9", fromMe: false });
  assert.deepEqual(out.map((m) => m.jid), [C, STAFF]);
  assert.match(out[1].text, /^【其他问题 \/ Other issue】\nSarah \+6591112222\nhttps:\/\/wa\.me\/6591112222\n\nThe stage lights and the mixer both died/);

  out.length = 0;
  const staff = await handler({ jid: STAFF, phone: "6590001234", text: "ok I will call her", name: "Tech", id: "s1", fromMe: false });
  assert.equal(staff.decision.reason, "staff");
  assert.equal(out.length, 0);

  const D = "6593334444@s.whatsapp.net";
  store.recordInbound(D, "earlier", "Bo", Date.now() - 3600_000, "6593334444");
  out.length = 0;
  await handler({ jid: D, phone: "6593334444", text: "can you also check why our coffee machine keeps tripping", name: "Bo", id: "h1", fromMe: false });
  assert.match(out[0].text, /^Got it\. I am passing this to a colleague/);
  assert.match(out[1].text, /^【机器人未能解答 \/ Bot could not answer】\nBo \+6593334444/);
  out.length = 0;
  await handler({ jid: D, phone: "6593334444", text: "0", name: "Bo", id: "h2", fromMe: false });
  assert.match(out.at(-1).text, /^【要求人工 \/ Wants a person】\nBo \+6593334444/);
  store.close();
});

test("an unreadable tap falls back to numbers, and numbers then work", async () => {
  const { store, out, handler } = harness();
  await handler({ jid: C, phone: "6591112222", text: "hi", name: "Sarah", id: "m1", fromMe: false });
  out.length = 0;
  const fallback = await handler.select({ jid: C, pollId: "p2", index: null });
  assert.equal(fallback.decision.reason, "prompt_fallback");
  assert.match(out[0].text, /^Please reply with the number:\n1\) Projector\n/);
  assert.equal(store.contact(C).pending.length, 10);
  out.length = 0;
  await handler({ jid: C, phone: "6591112222", text: "8", name: "Sarah", id: "m2", fromMe: false });
  assert.equal(store.contact(C).mode, "visit");
  assert.match(out[0].text, /^Sure, let me arrange that/);
  store.close();
});

test("text style and missing poll support both send one numbered message", async () => {
  const { store, out, handler } = harness({ ...fast, menu_style: "text" });
  await handler({ jid: C, phone: "6591112222", text: "hello", name: "Sarah", id: "m1", fromMe: false });
  assert.deepEqual(out.map((m) => m.type), ["text"]);
  assert.match(out[0].text, /technical support\.\n\nWhat can we help you with today\?.*\n1\) Projector\n/);
  await handler({ jid: C, phone: "6591112222", text: "9", name: "Sarah", id: "m2", fromMe: false });
  assert.equal(store.contact(C).mode, "other");
  store.close();

  const broken = new Store(":memory:");
  const sent = [];
  const handler2 = createHandler({
    config: fast,
    store: broken,
    instant: true,
    log: () => {},
    send: async (jid, text) => (sent.push(text), "t"),
    sendPoll: async () => {
      throw new Error("poll not supported");
    },
  });
  await handler2({ jid: C, text: "hello", id: "m1", fromMe: false });
  assert.match(sent.at(-1), /1\) Projector\n2\) TV, display or LED wall/, "falls back to the numbered list when a poll cannot be sent");
  broken.close();
});

// Encrypt a vote the way WhatsApp clients do, so reading it can be tested end to end.
function encryptVote({ pollId, creator, voter, secret, chosen }) {
  const sign = Buffer.concat([Buffer.from(pollId), Buffer.from(creator), Buffer.from(voter), Buffer.from("Poll Vote"), new Uint8Array([1])]);
  const key0 = createHmac("sha256", new Uint8Array(32)).update(secret).digest();
  const key = createHmac("sha256", key0).update(sign).digest();
  const encIv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, encIv);
  cipher.setAAD(Buffer.from(`${pollId}\u0000${voter}`));
  const plain = proto.Message.PollVoteMessage.encode({ selectedOptions: chosen.map((label) => createHash("sha256").update(Buffer.from(label)).digest()) }).finish();
  return { encPayload: Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]), encIv };
}

test("poll votes decrypt whichever id form WhatsApp used for creator and voter", () => {
  const secret = randomBytes(32);
  const labels = ["来不及了，我要现在自己解决", "I want to understand", "Other (tell us what happened)"];
  const base = { pollId: "3EB0ABCDEF", secret: secret.toString("base64"), labels };
  const me = ["6588626302@s.whatsapp.net", "111222333@lid"];
  const them = ["84121917329565@lid", "6591234567@s.whatsapp.net"];
  for (const creator of me) {
    for (const voter of them) {
      const vote = encryptVote({ pollId: base.pollId, creator, voter, secret, chosen: [labels[2]] });
      assert.equal(readPollVote({ ...base, vote, creators: me, voters: them }), 2, `${creator} / ${voter}`);
    }
  }
  const first = encryptVote({ pollId: base.pollId, creator: me[0], voter: them[0], secret, chosen: [labels[0]] });
  assert.equal(readPollVote({ ...base, vote: first, creators: me, voters: them }), 0, "non-ASCII labels hash correctly");
  const withdrawn = encryptVote({ pollId: base.pollId, creator: me[0], voter: them[0], secret, chosen: [] });
  assert.equal(readPollVote({ ...base, vote: withdrawn, creators: me, voters: them }), -1);
  const stranger = encryptVote({ pollId: base.pollId, creator: me[0], voter: "999@lid", secret, chosen: [labels[1]] });
  assert.equal(readPollVote({ ...base, vote: stranger, creators: me, voters: them }), null, "unknown voter id cannot be read");
  assert.equal(readPollVote({ ...base, vote: first, secret: randomBytes(32).toString("base64"), creators: me, voters: them }), null);
  assert.equal(readPollVote({ ...base, vote: first, secret: null, creators: me, voters: them }), null);
  const unknown = encryptVote({ pollId: base.pollId, creator: me[0], voter: them[0], secret, chosen: ["not an option"] });
  assert.equal(readPollVote({ ...base, vote: unknown, creators: me, voters: them }), null);
});

test("demo phone buttons walk a whole conversation through the API", async () => {
  const demo = await startDemo({ port: 18971, seed: false });
  await new Promise((resolve) => demo.server.once("listening", resolve));
  const url = `http://127.0.0.1:${demo.status.dashboardPort}`;
  const send = async (body) => (await fetch(url + "/demo/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jid: C, ...body }) })).json();
  try {
    assert.equal((await send({ text: "你好" })).decision.reason, "menu");
    assert.equal((await send({ option: 2 })).decision.reason, "category");
    const first = await send({ option: 0 });
    assert.equal(first.decision.reason, "option_chosen");
    assert.match(first.reply, /第 1 步（共 6 步）\n功放 \/ 混音台 \/ 音响电源开了吗/);
    assert.equal((await send({ option: 1 })).decision.reason, "step");
    assert.equal((await send({ option: 0 })).decision.reason, "solved");
    const messages = (await (await fetch(url + "/api/messages?jid=" + encodeURIComponent(C))).json()).messages;
    assert.deepEqual(messages.filter((m) => m.direction === "in").map((m) => m.text), ["你好", "声音、麦克风或喇叭", "没声音", "还不行，下一步", "好了，解决了"]);
    assert.equal(messages.at(-1).options, null);
    assert.equal((await send({ option: 9 })).decision, null, "an option that does not exist is ignored");
  } finally {
    demo.server.close();
    demo.store.close();
  }
});
