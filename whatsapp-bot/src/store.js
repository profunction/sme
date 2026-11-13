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
        muted_until INTEGER
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jid TEXT NOT NULL,
        direction TEXT NOT NULL,   -- in | bot | human
        text TEXT NOT NULL,
        reason TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_jid ON messages(jid, created_at);
      CREATE TABLE IF NOT EXISTS sent_ids (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
    `);
    // Older databases predate the muted_until column.
    const columns = this.db.prepare("PRAGMA table_info(contacts)").all().map((c) => c.name);
    if (!columns.includes("muted_until")) this.db.exec("ALTER TABLE contacts ADD COLUMN muted_until INTEGER");
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
        }
      : { jid, name: null, lastInboundAt: null, lastBotOutboundAt: null, lastHumanOutboundAt: null, language: null, mutedUntil: null };
  }

  recordInbound(jid, text, name, now = Date.now()) {
    this.db
      .prepare(
        `INSERT INTO contacts(jid, name, last_inbound_at) VALUES(?, ?, ?)
         ON CONFLICT(jid) DO UPDATE SET last_inbound_at = excluded.last_inbound_at,
         name = COALESCE(excluded.name, contacts.name)`
      )
      .run(jid, name ?? null, now);
    this.db.prepare("INSERT INTO messages(jid, direction, text, created_at) VALUES(?, 'in', ?, ?)").run(jid, text, now);
  }

  recordBotReply(jid, text, reason, language, now = Date.now()) {
    this.db
      .prepare(
        `INSERT INTO contacts(jid, last_bot_outbound_at, language) VALUES(?, ?, ?)
         ON CONFLICT(jid) DO UPDATE SET last_bot_outbound_at = excluded.last_bot_outbound_at, language = excluded.language`
      )
      .run(jid, now, language);
    this.db
      .prepare("INSERT INTO messages(jid, direction, text, reason, created_at) VALUES(?, 'bot', ?, ?, ?)")
      .run(jid, text, reason, now);
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
      .prepare("SELECT direction, text FROM messages WHERE jid = ? ORDER BY created_at DESC LIMIT ?")
      .all(jid, limit)
      .reverse();
  }

  recentConversations(limit = 50) {
    return this.db
      .prepare(
        `SELECT c.jid, c.name, c.last_inbound_at, c.last_bot_outbound_at, c.last_human_outbound_at,
                (SELECT text FROM messages m WHERE m.jid = c.jid ORDER BY created_at DESC LIMIT 1) AS last_text
         FROM contacts c ORDER BY COALESCE(c.last_inbound_at, 0) DESC LIMIT ?`
      )
      .all(limit);
  }

  // Customers whose last message got no human reply yet.
  waitingForHuman(limit = 50) {
    return this.db
      .prepare(
        `SELECT jid, name, last_inbound_at FROM contacts
         WHERE last_inbound_at IS NOT NULL
           AND (last_human_outbound_at IS NULL OR last_human_outbound_at < last_inbound_at)
         ORDER BY last_inbound_at DESC LIMIT ?`
      )
      .all(limit);
  }

  stats() {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const q = (sql) => this.db.prepare(sql).get(dayAgo).n;
    return {
      inbound24h: q("SELECT COUNT(*) AS n FROM messages WHERE direction='in' AND created_at >= ?"),
      botReplies24h: q("SELECT COUNT(*) AS n FROM messages WHERE direction='bot' AND created_at >= ?"),
      humanReplies24h: q("SELECT COUNT(*) AS n FROM messages WHERE direction='human' AND created_at >= ?"),
      contacts: this.db.prepare("SELECT COUNT(*) AS n FROM contacts").get().n,
    };
  }

  close() {
    this.db.close();
  }
}
