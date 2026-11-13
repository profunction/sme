// Local SQLite store using Node's built-in sqlite module. Nothing leaves the machine.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export class Store {
  constructor(file) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS contacts (
        jid TEXT PRIMARY KEY,
        name TEXT,
        last_inbound_at INTEGER,
        last_bot_outbound_at INTEGER,
        last_human_outbound_at INTEGER,
        language TEXT,
        muted_until INTEGER,
        phone TEXT,
        mode TEXT,
        tier TEXT,
        pending TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jid TEXT NOT NULL,
        direction TEXT NOT NULL,   -- in | bot | human
        text TEXT NOT NULL,
        reason TEXT,
        created_at INTEGER NOT NULL,
        sender TEXT,
        options TEXT
      );
      CREATE INDEX IF NOT EXISTS messages_jid ON messages(jid, created_at);
      CREATE TABLE IF NOT EXISTS sent_ids (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS polls (
        id TEXT PRIMARY KEY,       -- WhatsApp message id of the poll we sent
        jid TEXT NOT NULL,
        secret TEXT,               -- base64 key needed to read the votes
        labels TEXT NOT NULL,
        sends TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS broadcasts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        status TEXT NOT NULL,      -- sending | paused | done | cancelled
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS broadcast_recipients (
        broadcast_id INTEGER NOT NULL,
        jid TEXT NOT NULL,
        status TEXT NOT NULL,      -- pending | sent | failed | skipped
        error TEXT,
        sent_at INTEGER,
        PRIMARY KEY (broadcast_id, jid)
      );
    `);
    // Older databases predate the muted_until column.
    const columns = this.db.prepare("PRAGMA table_info(contacts)").all().map((c) => c.name);
    if (!columns.includes("muted_until")) this.db.exec("ALTER TABLE contacts ADD COLUMN muted_until INTEGER");
    if (!columns.includes("phone")) this.db.exec("ALTER TABLE contacts ADD COLUMN phone TEXT");
    if (!columns.includes("mode")) this.db.exec("ALTER TABLE contacts ADD COLUMN mode TEXT");
    if (!columns.includes("tier")) this.db.exec("ALTER TABLE contacts ADD COLUMN tier TEXT");
    if (!columns.includes("opted_out")) this.db.exec("ALTER TABLE contacts ADD COLUMN opted_out INTEGER");
    if (!columns.includes("chat_at")) this.db.exec("ALTER TABLE contacts ADD COLUMN chat_at INTEGER");
    const messageColumns = this.db.prepare("PRAGMA table_info(messages)").all().map((c) => c.name);
    if (!messageColumns.includes("sender")) this.db.exec("ALTER TABLE messages ADD COLUMN sender TEXT");
    if (!messageColumns.includes("options")) this.db.exec("ALTER TABLE messages ADD COLUMN options TEXT");
    if (!columns.includes("pending")) this.db.exec("ALTER TABLE contacts ADD COLUMN pending TEXT");
  }

  contact(jid) {
    const row = this.db.prepare("SELECT * FROM contacts WHERE jid = ?").get(jid);
    return row
      ? {
          jid: row.jid,
          name: row.name,
          lastInboundAt: row.last_inbound_at,
          lastBotOutboundAt: row.last_bot_outbound_at,
          lastHumanOutboundAt: row.last_human_outbound_at,
          language: row.language,
          mutedUntil: row.muted_until,
          phone: row.phone,
          mode: row.mode,
          tier: row.tier,
          pending: row.pending ? JSON.parse(row.pending) : null,
          optedOut: !!row.opted_out,
        }
      : { jid, name: null, lastInboundAt: null, lastBotOutboundAt: null, lastHumanOutboundAt: null, language: null, mutedUntil: null, phone: null, mode: null, tier: null, pending: null };
  }

  recordInbound(jid, text, name, now = Date.now(), phone = null) {
    this.db
      .prepare(
        `INSERT INTO contacts(jid, name, last_inbound_at, phone) VALUES(?, ?, ?, ?)
         ON CONFLICT(jid) DO UPDATE SET last_inbound_at = excluded.last_inbound_at,
         name = COALESCE(contacts.name, excluded.name),
         phone = COALESCE(excluded.phone, contacts.phone)`
      )
      .run(jid, name ?? null, now, phone ?? null);
    this.db.prepare("INSERT INTO messages(jid, direction, text, created_at) VALUES(?, 'in', ?, ?)").run(jid, text, now);
  }

  // Group chats are only observed: who said what, and whether our side has answered since.
  recordGroupMessage(jid, groupName, text, sender, fromMe, now = Date.now()) {
    const column = fromMe ? "last_human_outbound_at" : "last_inbound_at";
    this.db
      .prepare(
        `INSERT INTO contacts(jid, name, ${column}) VALUES(?, ?, ?)
         ON CONFLICT(jid) DO UPDATE SET ${column} = excluded.${column}, name = COALESCE(excluded.name, contacts.name)`
      )
      .run(jid, groupName ?? null, now);
    this.db
      .prepare("INSERT INTO messages(jid, direction, text, created_at, sender) VALUES(?, ?, ?, ?, ?)")
      .run(jid, fromMe ? "human" : "in", text, now, fromMe ? null : sender ?? null);
  }

  recordBotReply(jid, text, reason, language, now = Date.now(), options = null) {
    this.db
      .prepare(
        `INSERT INTO contacts(jid, last_bot_outbound_at, language) VALUES(?, ?, ?)
         ON CONFLICT(jid) DO UPDATE SET last_bot_outbound_at = excluded.last_bot_outbound_at, language = excluded.language`
      )
      .run(jid, now, language);
    this.db
      .prepare("INSERT INTO messages(jid, direction, text, reason, created_at, options) VALUES(?, 'bot', ?, ?, ?, ?)")
      .run(jid, text, reason, now, options && options.length ? JSON.stringify(options) : null);
  }

  // Polls we sent, so a tap on an option can be mapped back to what it means.
  savePoll(id, jid, secret, labels, sends, now = Date.now()) {
    this.db
      .prepare("INSERT OR REPLACE INTO polls(id, jid, secret, labels, sends, created_at) VALUES(?, ?, ?, ?, ?, ?)")
      .run(id, jid, secret ?? null, JSON.stringify(labels), JSON.stringify(sends), now);
    this.db.prepare("DELETE FROM polls WHERE created_at < ?").run(now - 7 * 24 * 3600 * 1000);
  }

  poll(id) {
    const row = this.db.prepare("SELECT * FROM polls WHERE id = ?").get(id);
    return row ? { id: row.id, jid: row.jid, secret: row.secret, labels: JSON.parse(row.labels), sends: JSON.parse(row.sends) } : null;
  }

  // Labels of the options shown in the bot's latest message to this chat.
  lastBotOptions(jid) {
    const row = this.db.prepare("SELECT options FROM messages WHERE jid = ? AND direction = 'bot' AND reason IS NOT 'broadcast' ORDER BY id DESC LIMIT 1").get(jid);
    return row?.options ? JSON.parse(row.options) : null;
  }

  recordHumanReply(jid, text, now = Date.now()) {
    this.db
      .prepare(
        `INSERT INTO contacts(jid, last_human_outbound_at) VALUES(?, ?)
         ON CONFLICT(jid) DO UPDATE SET last_human_outbound_at = excluded.last_human_outbound_at`
      )
      .run(jid, now);
    this.db.prepare("INSERT INTO messages(jid, direction, text, created_at) VALUES(?, 'human', ?, ?)").run(jid, text, now);
  }

  setMode(jid, mode) {
    this.db
      .prepare(`INSERT INTO contacts(jid, mode) VALUES(?, ?) ON CONFLICT(jid) DO UPDATE SET mode = excluded.mode`)
      .run(jid, mode ?? null);
  }

  // Tier chosen by hand in the dashboard: a tier name, "none" to override config, or null to follow config.
  setTier(jid, tier) {
    this.db
      .prepare(`INSERT INTO contacts(jid, tier) VALUES(?, ?) ON CONFLICT(jid) DO UPDATE SET tier = excluded.tier`)
      .run(jid, tier ?? null);
  }

  // Customers who replied STOP no longer receive broadcasts.
  setOptOut(jid, optedOut) {
    this.db
      .prepare(`INSERT INTO contacts(jid, opted_out) VALUES(?, ?) ON CONFLICT(jid) DO UPDATE SET opted_out = excluded.opted_out`)
      .run(jid, optedOut ? 1 : 0);
  }

  // Chats and groups that already exist in the linked WhatsApp account, so the
  // owner can see and pick them before they ever message the bot.
  importDirectory(entries) {
    const upsert = this.db.prepare(
      `INSERT INTO contacts(jid, name, chat_at) VALUES(?, ?, ?)
       ON CONFLICT(jid) DO UPDATE SET
         name = CASE WHEN contacts.jid LIKE '%@g.us' THEN COALESCE(excluded.name, contacts.name) ELSE COALESCE(contacts.name, excluded.name) END,
         chat_at = MAX(COALESCE(contacts.chat_at, 0), COALESCE(excluded.chat_at, 0))`
    );
    let count = 0;
    for (const entry of entries || []) {
      if (!/^[0-9-]+@(s\.whatsapp\.net|lid|g\.us)$/.test(entry?.jid || "")) continue;
      upsert.run(entry.jid, entry.name || null, entry.at || null);
      count += 1;
    }
    return count;
  }

  hasContact(jid) {
    return !!this.db.prepare("SELECT 1 FROM contacts WHERE jid = ?").get(jid);
  }

  // ---- broadcasts: a persisted queue, so a restart resumes where it stopped ----

  createBroadcast(text, jids, now = Date.now()) {
    const id = Number(this.db.prepare("INSERT INTO broadcasts(text, status, created_at) VALUES(?, 'sending', ?)").run(text, now).lastInsertRowid);
    const insert = this.db.prepare("INSERT OR IGNORE INTO broadcast_recipients(broadcast_id, jid, status) VALUES(?, ?, 'pending')");
    for (const jid of jids) insert.run(id, jid);
    return id;
  }

  // Oldest unfinished broadcast first; one recipient at a time.
  nextBroadcastRecipient() {
    const row = this.db
      .prepare(
        `SELECT b.id, b.text, r.jid FROM broadcasts b JOIN broadcast_recipients r ON r.broadcast_id = b.id
         WHERE b.status = 'sending' AND r.status = 'pending' ORDER BY b.id, r.rowid LIMIT 1`
      )
      .get();
    return row ? { id: row.id, text: row.text, jid: row.jid } : null;
  }

  markBroadcastRecipient(id, jid, status, error = null, now = Date.now()) {
    this.db
      .prepare("UPDATE broadcast_recipients SET status = ?, error = ?, sent_at = ? WHERE broadcast_id = ? AND jid = ?")
      .run(status, error, status === "sent" ? now : null, id, jid);
    const left = this.db.prepare("SELECT COUNT(*) AS n FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'pending'").get(id).n;
    if (!left) this.db.prepare("UPDATE broadcasts SET status = 'done' WHERE id = ? AND status = 'sending'").run(id);
  }

  setBroadcastStatus(id, status) {
    const allowed = { paused: ["sending"], sending: ["paused"], cancelled: ["sending", "paused"] }[status];
    if (!allowed) return false;
    const current = this.db.prepare("SELECT status FROM broadcasts WHERE id = ?").get(id)?.status;
    if (!allowed.includes(current)) return false;
    this.db.prepare("UPDATE broadcasts SET status = ? WHERE id = ?").run(status, id);
    if (status === "cancelled") this.db.prepare("UPDATE broadcast_recipients SET status = 'skipped' WHERE broadcast_id = ? AND status = 'pending'").run(id);
    return true;
  }

  broadcastsSentSince(since) {
    return this.db.prepare("SELECT COUNT(*) AS n FROM broadcast_recipients WHERE status = 'sent' AND sent_at >= ?").get(since).n;
  }

  broadcasts(limit = 30) {
    return this.db
      .prepare(
        `SELECT b.id, b.text, b.status, b.created_at,
                COUNT(r.jid) AS total,
                SUM(r.status = 'sent') AS sent, SUM(r.status = 'failed') AS failed,
                SUM(r.status = 'pending') AS pending, SUM(r.status = 'skipped') AS skipped
         FROM broadcasts b LEFT JOIN broadcast_recipients r ON r.broadcast_id = b.id
         GROUP BY b.id ORDER BY b.id DESC LIMIT ?`
      )
      .all(limit)
      .map((row) => ({ ...row, sent: row.sent || 0, failed: row.failed || 0, pending: row.pending || 0, skipped: row.skipped || 0 }));
  }

  // The announcement appears in the chat history without counting as an answer to the customer.
  recordBroadcast(jid, text, now = Date.now()) {
    this.db.prepare("INSERT INTO messages(jid, direction, text, reason, created_at) VALUES(?, 'bot', ?, 'broadcast', ?)").run(jid, text, now);
  }

  // Ids of the related topics the bot just offered as A / B / C.
  setPending(jid, ids) {
    this.db
      .prepare(`INSERT INTO contacts(jid, pending) VALUES(?, ?) ON CONFLICT(jid) DO UPDATE SET pending = excluded.pending`)
      .run(jid, ids && ids.length ? JSON.stringify(ids) : null);
  }

  lastBotReason(jid) {
    return this.db.prepare("SELECT reason FROM messages WHERE jid = ? AND direction = 'bot' AND reason IS NOT 'broadcast' ORDER BY id DESC LIMIT 1").get(jid)?.reason ?? null;
  }

  messages(jid, limit = 200) {
    return this.db
      .prepare("SELECT id, direction, text, reason, created_at, sender, options FROM messages WHERE jid = ? ORDER BY id DESC LIMIT ?")
      .all(jid, limit)
      .reverse()
      .map((row) => ({ ...row, options: row.options ? JSON.parse(row.options) : null }));
  }

  // Mute the bot on this chat until the given time. The customer stays on the
  // waiting list because no human has replied yet.
  silence(jid, until) {
    this.db
      .prepare(
        `INSERT INTO contacts(jid, muted_until) VALUES(?, ?)
         ON CONFLICT(jid) DO UPDATE SET muted_until = excluded.muted_until`
      )
      .run(jid, until);
  }

  rememberSent(id, now = Date.now()) {
    this.db.prepare("INSERT OR IGNORE INTO sent_ids(id, created_at) VALUES(?, ?)").run(id, now);
    this.db.prepare("DELETE FROM sent_ids WHERE created_at < ?").run(now - 24 * 3600 * 1000);
  }

  wasSentByBot(id) {
    return !!this.db.prepare("SELECT 1 FROM sent_ids WHERE id = ?").get(id);
  }

  repliesSince(since) {
    return this.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE direction = 'bot' AND created_at >= ?").get(since).n;
  }

  history(jid, limit = 10) {
    return this.db
      .prepare("SELECT direction, text FROM messages WHERE jid = ? ORDER BY id DESC LIMIT ?")
      .all(jid, limit)
      .reverse();
  }

  // Every known chat, newest activity first; chats imported from WhatsApp but never
  // seen by the bot have last_at = null.
  recentConversations(limit = 50) {
    return this.db
      .prepare(
        `SELECT c.jid, c.name, c.phone, c.mode, c.tier, c.muted_until, c.opted_out, c.language, c.last_inbound_at, c.last_bot_outbound_at, c.last_human_outbound_at,
                (SELECT text FROM messages m WHERE m.jid = c.jid ORDER BY id DESC LIMIT 1) AS last_text,
                (SELECT sender FROM messages m WHERE m.jid = c.jid ORDER BY id DESC LIMIT 1) AS last_sender,
                (SELECT MAX(created_at) FROM messages m WHERE m.jid = c.jid) AS last_at
         FROM contacts c ORDER BY COALESCE(last_at, c.chat_at, 0) DESC LIMIT ?`
      )
      .all(limit);
  }

  // Customers whose last message got no human reply yet.
  waitingForHuman(limit = 50) {
    return this.db
      .prepare(
        `SELECT jid, name, phone, mode, tier, last_inbound_at FROM contacts
         WHERE last_inbound_at IS NOT NULL AND jid NOT LIKE '%@g.us'
           AND (last_human_outbound_at IS NULL OR last_human_outbound_at < last_inbound_at)
         ORDER BY last_inbound_at DESC LIMIT ?`
      )
      .all(limit);
  }

  stats() {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const q = (sql) => this.db.prepare(sql).get(dayAgo).n;
    return {
      inbound24h: q("SELECT COUNT(*) AS n FROM messages WHERE direction='in' AND jid NOT LIKE '%@g.us' AND created_at >= ?"),
      botReplies24h: q("SELECT COUNT(*) AS n FROM messages WHERE direction='bot' AND created_at >= ?"),
      humanReplies24h: q("SELECT COUNT(*) AS n FROM messages WHERE direction='human' AND jid NOT LIKE '%@g.us' AND created_at >= ?"),
      contacts: this.db.prepare("SELECT COUNT(*) AS n FROM contacts WHERE jid NOT LIKE '%@g.us'").get().n,
    };
  }

  close() {
    this.db.close();
  }
}
