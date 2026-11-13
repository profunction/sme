import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { proto } from "@whiskeysockets/baileys";
import { DEFAULTS, merge, prepare, validate } from "../src/config.js";
import { decide, optionIndex, renderPrompt } from "../src/engine.js";
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
  const problems = validate({ ...av, categories: [{ id: "x", title: { en: "X" }, entries: ["no-such-entry"] }], menu_style: "buttons", notify: { numbers: ["12"] } });
  assert.ok(problems.some((p) => p.includes("unknown knowledge id no-such-entry")));
  assert.ok(problems.some((p) => p.includes("menu_style")));
  assert.ok(problems.some((p) => p.includes("notify.numbers")));
});

test("guided path: main menu, category, problem, answer, follow-up", () => {
  const menu = decide(av, { text: "hi there", contact: {}, now: NOW });
  assert.equal(menu.reason, "menu");
  assert.equal(menu.lead, "Hello, this is ACME AV AV technical support.");
  assert.deepEqual(menu.pending, ["1", "2", "3", "pick:other", "0"]);
  assert.equal(menu.prompt.options[3].label, "Other (tell us what happened)");

  const contact = { lastInboundAt: NOW - 1000, language: "en" };
  const categories = decide(av, { text: "1", contact: { ...contact, pending: menu.pending }, now: NOW });
  assert.deepEqual([categories.reason, categories.setMode, categories.lead], ["menu_choice", "fix", ""]);
  assert.equal(categories.prompt.options.length, 8);
  assert.equal(categories.pending[2], "pick:cat:audio");
  assert.equal(categories.pending.at(-1), "pick:other");

  const problems = decide(av, { text: "3", contact: { ...contact, mode: "fix", pending: categories.pending }, now: NOW });
  assert.equal(problems.reason, "category");
  assert.equal(problems.prompt.options[1].label, "Microphone feedback or echo");
  assert.equal(problems.pending.at(-1), "pick:describe");
  assert.ok(problems.prompt.options.length <= 12, "fits in one WhatsApp poll");

  const answer = decide(av, { text: "2", contact: { ...contact, mode: "fix", pending: problems.pending }, now: NOW });
  assert.deepEqual([answer.reason, answer.entry], ["option_chosen", "core-mic-feedback"]);
  assert.match(answer.lead, /^Microphone feedback or echo:\n1\) Lower the mic/);
  assert.match(answer.lead, /email us at help@acme\.test or post in the group/);
  assert.equal(answer.prompt.question, "Did that solve it?");
  assert.deepEqual(answer.pending, ["pick:solved", "0", "pick:explain:core-mic-feedback", "pick:menu"]);

  const why = decide(av, { text: "3", contact: { ...contact, mode: "fix", pending: answer.pending }, now: NOW });
  assert.equal(why.setMode, "explain");
  assert.match(why.lead, /^Feedback is the mic picking up the speakers/);
  assert.equal(why.pending[2], "pick:fix:core-mic-feedback");
  const solved = decide(av, { text: "1", contact: { ...contact, mode: "fix", pending: answer.pending }, now: NOW });
  assert.deepEqual([solved.reason, solved.pending], ["solved", null]);
  const person = decide(av, { text: "2", contact: { ...contact, mode: "fix", pending: answer.pending }, now: NOW });
  assert.equal(person.handoff, true);
  const back = decide(av, { text: "4", contact: { ...contact, mode: "fix", pending: answer.pending }, now: NOW });
  assert.equal(back.reason, "menu");
  assert.equal(back.lead, "", "no second greeting");
});

test("a number keeps the customer's language; a new conversation ignores stale options", () => {
  const zh = decide(av, { text: "1", contact: { lastInboundAt: NOW - 1000, language: "zh", pending: ["1", "2"] }, now: NOW });
  assert.equal(zh.language, "zh");
  assert.match(zh.prompt.question, /^是哪一类设备/);
  const en = decide(av, { text: "1", contact: { lastInboundAt: NOW - 1000, language: "en", pending: ["1", "2"] }, now: NOW });
  assert.equal(en.prompt.options[0].label, "Projector");
  const stale = decide(av, { text: "3", contact: { lastInboundAt: NOW - 30 * 3600_000, language: "en", pending: ["pick:solved", "0", "pick:menu"] }, now: NOW });
  assert.equal(stale.setMode, "visit", "after the cooldown, 3 means the main menu's option 3 again");
  const typed = decide(av, { text: "projector no image", contact: { lastInboundAt: NOW - 1000, mode: "fix", pending: ["pick:cat:audio"] }, now: NOW });
  assert.equal(typed.entry, "core-projector-no-image", "typing a problem always works, whatever prompt is open");
});

test("Other: asks what happened, takes the report once, then stays quiet", () => {
  const contact = { lastInboundAt: NOW - 1000, language: "zh" };
  const ask = decide(av, { text: "pick:other", contact, selected: true, now: NOW });
  assert.deepEqual([ask.reason, ask.setMode, ask.pending], ["other_prompt", "other", null]);
  assert.equal(decide(av, { text: "4", contact: { ...contact, pending: null }, now: NOW }).setMode, "other", "typing 4 works without an open prompt");
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

test("handler sends prompts as polls, maps taps back, and alerts staff for Other", async () => {
  const { store, out, handler } = harness();
  await handler({ jid: C, phone: "6591112222", text: "hello", name: "Sarah", id: "m1", fromMe: false });
  assert.deepEqual(out.map((m) => m.type), ["text", "poll"]);
  assert.equal(out[0].text, "Hello, this is ACME AV AV technical support.");
  assert.equal(out[1].question, "How can we help? Please choose:");
  assert.equal(out[1].labels.length, 5);
  const menuPoll = store.poll("p2");
  assert.deepEqual([menuPoll.jid, menuPoll.sends[3], menuPoll.secret], [C, "pick:other", "c2VjcmV0"]);
  assert.equal(store.wasSentByBot("p2"), true);
  assert.deepEqual(store.messages(C).at(-1).options, out[1].labels, "the dashboard can draw the same choices");

  out.length = 0;
  const tapped = await handler.select({ jid: C, phone: "6591112222", name: "Sarah", pollId: "p2", index: 0 });
  assert.equal(tapped.decision.reason, "menu_choice");
  assert.deepEqual(out.map((m) => m.type), ["poll"], "no extra text when there is nothing to say before the choices");
  assert.equal(out[0].labels[0], "Projector");
  assert.equal(store.contact(C).mode, "fix");
  assert.equal(store.messages(C).at(-2).text, "No time, I need to fix it myself now", "history shows the label, not an internal code");

  out.length = 0;
  await handler.select({ jid: C, phone: "6591112222", pollId: "p3", index: 2 });
  assert.equal(out[0].question, "Which problem is it?");
  out.length = 0;
  await handler.select({ jid: C, phone: "6591112222", pollId: "p4", index: 0 });
  assert.deepEqual(out.map((m) => m.type), ["text", "poll"]);
  assert.match(out[0].text, /^No sound, check in this order/);
  assert.equal(out[1].question, "Did that solve it?");

  assert.equal(await handler.select({ jid: "6590000000@s.whatsapp.net", pollId: "p2", index: 0 }), null, "a tap from another chat is ignored");
  assert.equal(await handler.select({ jid: C, pollId: "unknown", index: 0 }), null);

  out.length = 0;
  await handler.select({ jid: C, phone: "6591112222", name: "Sarah", pollId: "p2", index: 3 });
  assert.equal(store.contact(C).mode, "other");
  assert.equal(out.length, 1);
  out.length = 0;
  await handler({ jid: C, phone: "6591112222", text: "The stage lights and the mixer both died after the storm", name: "Sarah", id: "m9", fromMe: false });
  assert.deepEqual(out.map((m) => m.jid), [C, "6590001234@s.whatsapp.net"]);
  assert.match(out[1].text, /^【其他问题 \/ Other issue】\nSarah \+6591112222\nhttps:\/\/wa\.me\/6591112222\n\nThe stage lights and the mixer both died/);
  store.close();
});

test("an unreadable tap falls back to numbers; staff replies never trigger the bot", async () => {
  const { store, out, handler } = harness();
  await handler({ jid: C, phone: "6591112222", text: "hi", name: "Sarah", id: "m1", fromMe: false });
  out.length = 0;
  const fallback = await handler.select({ jid: C, pollId: "p2", index: null });
  assert.equal(fallback.decision.reason, "prompt_fallback");
  assert.match(out[0].text, /^Please reply with the number:\n1\) No time, I need to fix it myself now\n/);
  assert.deepEqual(store.contact(C).pending, ["1", "2", "3", "pick:other", "0"]);
  out.length = 0;
  await handler({ jid: C, phone: "6591112222", text: "3", name: "Sarah", id: "m2", fromMe: false });
  assert.equal(store.contact(C).mode, "visit");

  out.length = 0;
  const staff = await handler({ jid: "6590001234@s.whatsapp.net", phone: "6590001234", text: "ok I will call her", name: "Tech", id: "s1", fromMe: false });
  assert.equal(staff.decision.reason, "staff");
  assert.equal(out.length, 0);

  out.length = 0;
  await handler({ jid: "6593334444@s.whatsapp.net", phone: "6593334444", text: "0", name: "Bo", id: "h1", fromMe: false });
  assert.match(out.at(-1).text, /^【要求人工 \/ Wants a person】\nBo \+6593334444/);
  store.close();
});

test("text style and missing poll support both send one numbered message", async () => {
  const { store, out, handler } = harness({ ...fast, menu_style: "text" });
  await handler({ jid: C, phone: "6591112222", text: "hello", name: "Sarah", id: "m1", fromMe: false });
  assert.deepEqual(out.map((m) => m.type), ["text"]);
  assert.match(out[0].text, /technical support\.\n\nHow can we help\? Please choose:\n1\) No time/);
  await handler({ jid: C, phone: "6591112222", text: "4", name: "Sarah", id: "m2", fromMe: false });
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
  assert.match(sent.at(-1), /1\) No time, I need to fix it myself now/, "falls back to the numbered list when a poll cannot be sent");
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

test("demo phone buttons choose options through the API", async () => {
  const demo = await startDemo({ port: 18971, seed: false });
  await new Promise((resolve) => demo.server.once("listening", resolve));
  const url = `http://127.0.0.1:${demo.status.dashboardPort}`;
  const send = async (body) => (await fetch(url + "/demo/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jid: C, ...body }) })).json();
  try {
    assert.equal((await send({ text: "你好" })).decision.reason, "menu");
    assert.equal((await send({ option: 0 })).decision.reason, "menu_choice");
    assert.equal((await send({ option: 2 })).decision.reason, "category");
    const answer = await send({ option: 0 });
    assert.equal(answer.decision.reason, "option_chosen");
    assert.match(answer.reply, /^没声音，按顺序查/);
    const messages = (await (await fetch(url + "/api/messages?jid=" + encodeURIComponent(C))).json()).messages;
    assert.deepEqual(messages.filter((m) => m.direction === "in").map((m) => m.text), ["你好", "来不及了，我要现在自己解决", "声音 / 麦克风 / 喇叭", "没声音"]);
    assert.deepEqual(messages.at(-1).options, ["解决了，谢谢", "还是不行，请技术员联系我", "告诉我是什么原因", "回到主菜单"]);
    assert.equal((await send({ option: 9 })).decision, null, "an option that does not exist is ignored");
  } finally {
    demo.server.close();
    demo.store.close();
  }
});
