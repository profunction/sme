import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, merge, validate } from "../src/config.js";
import { decide } from "../src/engine.js";
import { Store } from "../src/store.js";
import { createGroupRecorder, createHandler } from "../src/handler.js";
import { createBroadcaster, messageFor } from "../src/broadcast.js";
import { listContacts } from "../src/dashboard.js";
import { startDemo } from "../src/demo.js";

const config = merge(DEFAULTS, {
  phone_number: "6512345678",
  languages: ["zh", "en"],
  min_seconds_between_replies_per_contact: 0,
  tiers: { vip: { label: { en: "VIP" }, priority: true } },
});
const A = "6591110001@s.whatsapp.net";
const B = "6591110002@s.whatsapp.net";
const G = "120363000000000001@g.us";

test("directory import lists existing chats and groups without marking them as waiting", () => {
  const store = new Store(":memory:");
  const count = store.importDirectory([
    { jid: A, name: "Aisha", at: 2000 },
    { jid: G, name: "ABC Support", at: 1000 },
    { jid: "status@broadcast", name: "status" },
    { jid: "12345@newsletter", name: "channel" },
    { jid: "", name: "empty" },
  ]);
  assert.equal(count, 2);
  store.recordInbound(A, "hi", "aisha_pushname", 3000);
  store.importDirectory([{ jid: A, name: "Other name", at: 500 }, { jid: G, name: "ABC Support (renamed)", at: 900 }]);
  assert.equal(store.contact(A).name, "Aisha", "a person keeps the first known name");
  assert.equal(store.contact(G).name, "ABC Support (renamed)", "a group follows its current subject");

  const withMessages = listContacts({ store, config });
  assert.deepEqual(withMessages.map((c) => c.jid), [A], "the chats page only shows chats the bot has seen");
  const all = listContacts({ store, config, all: true });
  assert.deepEqual(all.map((c) => [c.jid, c.group, c.waiting]), [[A, false, true], [G, true, false]]);
  assert.equal(store.stats().contacts, 1, "groups are not counted as customers");
  store.close();
});

test("group chats are recorded with senders and never answered", async () => {
  const store = new Store(":memory:");
  const record = createGroupRecorder({ store, log: () => {} });
  await record({ jid: G, groupName: "ABC Support", sender: "Sarah", text: "LED wall is dark", fromMe: false, id: "g1" });
  await record({ jid: G, groupName: "ABC Support", sender: "Daniel", text: "mic too", fromMe: false, id: "g2" });
  let row = listContacts({ store, config })[0];
  assert.deepEqual([row.group, row.name, row.last_sender, row.waiting], [true, "ABC Support", "Daniel", true]);
  await record({ jid: G, groupName: "ABC Support", text: "On it", fromMe: true, id: "g3" });
  row = listContacts({ store, config })[0];
  assert.equal(row.waiting, false, "our own reply in the group clears the waiting flag");
  assert.deepEqual(store.messages(G).map((m) => [m.direction, m.sender, m.text]), [["in", "Sarah", "LED wall is dark"], ["in", "Daniel", "mic too"], ["human", null, "On it"]]);
  store.rememberSent("bc-echo");
  await record({ jid: G, groupName: "ABC Support", text: "broadcast echo", fromMe: true, id: "bc-echo" });
  assert.equal(store.messages(G).length, 3, "an echo of our own broadcast is not recorded twice");
  assert.equal(store.waitingForHuman().length, 0);
  store.close();
});

test("STOP unsubscribes, START resubscribes, in the customer's language", async () => {
  const stop = decide(config, { text: " Stop ", contact: { lastInboundAt: Date.now() - 1000 } });
  assert.deepEqual([stop.reason, stop.optOut, stop.text], ["opt_out", true, config.texts.opt_out.en]);
  assert.equal(decide(config, { text: "退订", contact: {} }).text, config.texts.opt_out.zh);
  assert.notEqual(decide(config, { text: "start", contact: { optedOut: false } }).reason, "opt_in", "START only matters after a STOP");
  assert.equal(decide(config, { text: "please stop the projector fan noise", contact: {} }).reason === "opt_out", false);

  const store = new Store(":memory:");
  const sent = [];
  const handler = createHandler({ config, store, instant: true, log: () => {}, send: async (jid, text) => (sent.push(text), `id${sent.length}`) });
  await handler({ jid: A, text: "STOP", id: "1", fromMe: false });
  assert.equal(store.contact(A).optedOut, true);
  await handler({ jid: A, text: "订阅", id: "2", fromMe: false });
  assert.equal(store.contact(A).optedOut, false);
  assert.equal(sent.at(-1), config.texts.opt_in.zh);
  store.close();
});

test("broadcast queue: paced one at a time, footer for individuals only, opt-outs skipped", async () => {
  const store = new Store(":memory:");
  store.importDirectory([{ jid: A, name: "Aisha" }, { jid: B, name: "Marcus" }, { jid: G, name: "ABC Support" }]);
  store.setOptOut(B, true);
  const sent = [];
  const broadcaster = createBroadcaster({ config, store, log: () => {}, send: async (jid, text) => (sent.push([jid, text]), `out-${sent.length}`) });

  assert.equal(await broadcaster.tick(), 5000, "nothing queued: idle poll");
  const id = store.createBroadcast("November offer: free AV check", [G, A, B, A]);
  assert.equal(store.broadcasts()[0].total, 3, "duplicate recipients collapse");

  const gap = await broadcaster.tick();
  assert.ok(gap >= 20_000 && gap <= 45_000, `human-like gap, got ${gap}`);
  assert.deepEqual(sent[0], [G, "November offer: free AV check"], "groups get the plain text");
  await broadcaster.tick();
  assert.deepEqual(sent[1], [A, `November offer: free AV check\n\n${config.broadcast.footer.zh}`]);
  assert.equal(await broadcaster.tick(), 50, "opted-out recipient is skipped without sending");
  assert.equal(sent.length, 2);

  const done = store.broadcasts()[0];
  assert.deepEqual([done.status, done.sent, done.skipped, done.failed, done.pending], ["done", 2, 1, 0, 0]);
  assert.equal(store.wasSentByBot("out-1"), true);
  assert.deepEqual(store.messages(A).map((m) => [m.direction, m.reason]), [["bot", "broadcast"]]);
  assert.equal(store.lastBotReason(A), null, "a broadcast is not a bot answer");
  assert.equal(store.contact(A).lastBotOutboundAt, null, "and does not trip the reply rate limit");
  assert.equal(messageFor(config, { jid: A, language: "en" }, "Hi"), `Hi\n\n${config.broadcast.footer.en}`);
  assert.equal(id, 1);
  store.close();
});

test("broadcast queue: daily cap, offline retry, failures, pause and cancel", async () => {
  const store = new Store(":memory:");
  const jids = [1, 2, 3, 4].map((n) => `659111000${n}@s.whatsapp.net`);
  store.importDirectory(jids.map((jid) => ({ jid })));
  let mode = "ok";
  const sent = [];
  const send = async (jid) => {
    if (mode === "offline") throw new Error("WhatsApp is not connected right now");
    if (mode === "boom") throw new Error("rate-overlimit");
    sent.push(jid);
    return `x${sent.length}`;
  };
  const capped = merge(config, { broadcast: { max_per_day: 2 } });
  const broadcaster = createBroadcaster({ config: capped, store, log: () => {}, send });
  const id = store.createBroadcast("hello", jids);

  mode = "offline";
  assert.equal(await broadcaster.tick(), 15_000);
  assert.equal(broadcaster.state.blocked, "offline");
  assert.equal(store.broadcasts()[0].pending, 4, "nothing is lost while offline");

  mode = "boom";
  await broadcaster.tick();
  assert.deepEqual([store.broadcasts()[0].failed, store.broadcasts()[0].pending], [1, 3]);

  mode = "ok";
  assert.equal(store.setBroadcastStatus(id, "paused"), true);
  assert.equal(await broadcaster.tick(), 5000, "paused broadcasts are not sent");
  assert.equal(store.setBroadcastStatus(id, "done"), false, "only pause, resume and cancel are allowed");
  assert.equal(store.setBroadcastStatus(id, "sending"), true);
  await broadcaster.tick();
  await broadcaster.tick();
  assert.equal(sent.length, 2);
  assert.equal(await broadcaster.tick(), 10 * 60 * 1000, "daily cap reached: wait, keep the rest queued");
  assert.equal(broadcaster.state.blocked, "daily_cap");
  assert.equal(store.broadcasts()[0].pending, 1);

  assert.equal(store.setBroadcastStatus(id, "cancelled"), true);
  const end = store.broadcasts()[0];
  assert.deepEqual([end.status, end.sent, end.failed, end.skipped, end.pending], ["cancelled", 2, 1, 1, 0]);
  assert.equal(store.setBroadcastStatus(id, "sending"), false, "a cancelled broadcast cannot be restarted");
  store.close();
});

test("config rejects reckless broadcast pacing", () => {
  const problems = validate(merge(config, { broadcast: { delay_seconds: { min: 1, max: 2 }, max_per_day: 0 }, groups: "reply" }));
  assert.ok(problems.some((p) => p.includes("delay_seconds")));
  assert.ok(problems.some((p) => p.includes("max_per_day")));
  assert.ok(problems.some((p) => p.includes("groups must be")));
});

test("back office API: audience, broadcast, knowledge and try-a-question", async () => {
  const demo = await startDemo({ port: 18961 });
  await new Promise((resolve) => demo.server.once("listening", resolve));
  const url = `http://127.0.0.1:${demo.status.dashboardPort}`;
  const get = async (path) => (await fetch(url + path)).json();
  const post = async (path, body, headers = {}) => {
    const r = await fetch(url + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  try {
    const audience = await get("/api/audience");
    assert.equal(audience.contacts.filter((c) => c.group).length, 3, "demo seeds sample groups");
    assert.equal(audience.contacts.filter((c) => !c.group).length, 4);
    assert.equal((await get("/api/state")).conversations.length, 0, "imported chats stay off the chats page until they talk");

    assert.equal((await post("/api/contact", { jid: B, optedOut: true })).status, 200);
    assert.equal((await post("/api/broadcast", { text: "", jids: [A] })).status, 400);
    assert.equal((await post("/api/broadcast", { text: "hi", jids: ["6599999999@s.whatsapp.net"] })).status, 400, "unknown numbers are refused");
    assert.equal((await post("/api/broadcast", { text: "hi", jids: [A] }, { origin: "https://evil.example" })).status, 403);
    const queued = await post("/api/broadcast", { text: "本月优惠：免费检查一次", jids: [A, B, G] });
    assert.deepEqual([queued.status, queued.body.recipients], [200, 2], "opted-out customer dropped at queue time");

    for (let i = 0; i < 40 && (await get("/api/broadcasts")).broadcasts[0].status !== "done"; i += 1) await new Promise((r) => setTimeout(r, 100));
    const history = await get("/api/broadcasts");
    assert.deepEqual([history.broadcasts[0].status, history.broadcasts[0].sent, history.sentToday], ["done", 2, 2]);
    const chat = await get("/api/messages?jid=" + encodeURIComponent(A));
    assert.match(chat.messages[0].text, /^本月优惠：免费检查一次\n\n回复「退订」/);
    assert.equal((await get("/api/messages?jid=" + encodeURIComponent(G))).messages[0].text, "本月优惠：免费检查一次");
    assert.equal((await post("/api/broadcast/status", { id: history.broadcasts[0].id, status: "paused" })).status, 400, "finished broadcasts cannot be paused");

    const index = await get("/api/knowledge");
    assert.ok(index.entries.length >= 150, `knowledge base has ${index.entries.length} entries`);
    const entry = await get("/api/knowledge/entry?id=core-no-sound");
    assert.match(entry.reply.en, /^No sound/);
    const tried = await post("/api/try", { text: "麦克风一直啸叫", mode: "explain" });
    assert.equal(tried.body.entry, "core-mic-feedback");
    assert.match(tried.body.reply, /^啸叫是麦克风收到喇叭的声音/);
    assert.equal((await get("/api/messages?jid=x")).messages.length, 0);
  } finally {
    demo.server.close();
    demo.store.close();
  }
});
