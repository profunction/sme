// WhatsApp link via Baileys (WhatsApp Web multi-device protocol) using a pairing code.
// This is an unofficial client: WhatsApp's terms do not allow it, numbers can be banned,
// and the library may stop working after a WhatsApp update. Use a spare number.
import fs from "node:fs";
import { createHash } from "node:crypto";
import pino from "pino";
import QRCode from "qrcode";
import baileys, {
  decryptPollVote,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  jidNormalizedUser,
  useMultiFileAuthState,
  Browsers,
} from "@whiskeysockets/baileys";

const makeWASocket = baileys.default ?? baileys;

export function extractText(message) {
  if (!message) return "";
  const m = message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    (m.audioMessage ? "[voice]" : "") ||
    (m.imageMessage ? "[image]" : "") ||
    (m.stickerMessage ? "[sticker]" : "") ||
    (m.locationMessage ? "[location]" : "") ||
    ""
  );
}

export function isCustomerChat(jid) {
  return !!jid && !isJidGroup(jid) && !isJidBroadcast(jid) && !isJidStatusBroadcast(jid) && !isJidNewsletter(jid);
}

export function formatPairingCode(code) {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/**
 * @param {object} options
 * @param {object} options.config
 * @param {string} options.authDir
 * @param {object} options.status shared status object the dashboard reads
 * @param {(event: {jid: string, text: string, name?: string, id: string, fromMe: boolean}) => Promise<void>} options.onMessage
 * @param {(line: string) => void} options.log
 */
// Which option of one of our polls a customer tapped. WhatsApp encrypts the vote with
// the poll's secret plus the ids of creator and voter, and each of those can be a phone
// number id or an anonymous LID, so every pairing is tried until one decrypts.
// Returns the option index, -1 when the vote was withdrawn, or null when unreadable.
export function readPollVote({ vote, pollId, secret, labels, creators, voters, decrypt = decryptPollVote }) {
  if (!secret || !vote?.encPayload || !vote?.encIv) return null;
  const pollEncKey = Buffer.from(secret, "base64");
  for (const pollCreatorJid of [...new Set(creators.filter(Boolean))]) {
    for (const voterJid of [...new Set(voters.filter(Boolean))]) {
      try {
        const result = decrypt({ encPayload: vote.encPayload, encIv: vote.encIv }, { pollCreatorJid, pollMsgId: pollId, pollEncKey, voterJid });
        const chosen = (result.selectedOptions || []).map((hash) => Buffer.from(hash).toString("hex"));
        if (!chosen.length) return -1;
        const index = labels.findIndex((label) => chosen.includes(createHash("sha256").update(Buffer.from(label)).digest("hex")));
        return index >= 0 ? index : null;
      } catch {
        // wrong pairing: the authentication tag does not verify, try the next one
      }
    }
  }
  return null;
}

export async function connect({ config, authDir, status, onMessage, onGroupMessage = null, onDirectory = null, onPollVote = null, getPoll = null, log, backoffMs = 2000, handle = null }) {
  // One handle survives reconnects; index.js keeps sending through it after WhatsApp
  // forces a restart (status 515 right after pairing, or any network drop).
  handle = handle || { sock: null, sendText: null, groupNames: new Map(), contactNames: new Map() };
  const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || "silent" });
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch {
    version = undefined; // offline: fall back to the library's bundled version
  }

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: Browsers.ubuntu("Chrome"),
    markOnlineOnConnect: false, // phone keeps receiving notifications
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });

  handle.sock = sock;
  let pairingRequested = false;
  let qrAnnounced = false;
  let reconnectDelay = backoffMs;
  const reconnect = (delay, nextBackoff) =>
    setTimeout(
      () => connect({ config, authDir, status, onMessage, onGroupMessage, onDirectory, onPollVote, getPoll, log, backoffMs: nextBackoff, handle }).catch((e) => log(e.message)),
      delay
    );

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr && !state.creds.registered && config.link_with === "qr") {
      // Scanning a QR code is WhatsApp's standard way to link and the most reliable one.
      try {
        status.qr = await QRCode.toDataURL(qr, { margin: 2, width: 320 });
        status.pairingCode = null;
        if (!qrAnnounced) {
          qrAnnounced = true;
          log(`请在浏览器打开后台扫二维码 / Open the dashboard and scan the QR code: http://127.0.0.1:${status.dashboardPort || config.dashboard_port}`);
          log("手机 WhatsApp → 已连接的设备 → 连接设备 → 对准电脑屏幕上的二维码。 / Phone WhatsApp → Linked devices → Link a device → scan the code on this computer.");
          console.log(await QRCode.toString(qr, { type: "terminal", small: true }));
        }
      } catch (error) {
        status.lastError = `QR failed: ${error.message}`;
        log(status.lastError);
      }
    } else if (qr && !state.creds.registered && !pairingRequested) {
      pairingRequested = true;
      try {
        const code = await sock.requestPairingCode(config.phone_number);
        status.pairingCode = formatPairingCode(code);
        log(`配对码 / Pairing code: ${status.pairingCode}   （请在 1 分钟内输入 / enter within about 1 minute）`);
        log("手机 WhatsApp → 已连接的设备 → 连接设备 → 改用电话号码连接，输入上面的配对码。");
        log("Phone WhatsApp → Linked devices → Link a device → Link with phone number instead → enter the code.");
      } catch (error) {
        status.lastError = `pairing failed: ${error.message}`;
        log(status.lastError);
      }
    }
    if (connection) status.connection = connection;
    if (connection === "open") {
      status.pairingCode = null;
      status.qr = null;
      status.connectedAt = Date.now();
      status.lastError = null;
      reconnectDelay = 2000;
      log(`已连接 / Connected as ${jidNormalizedUser(sock.user?.id || "")}`);
      syncGroups();
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      status.lastError = `disconnected (${code ?? "unknown"})`;
      if (code === DisconnectReason.loggedOut) {
        if (state.creds.registered) {
          log("此设备已在手机上被登出，正在重新开始配对。 / Logged out from the phone; starting a fresh pairing.");
        } else {
          log(
            config.link_with === "qr"
              ? "二维码已过期，10 秒后出新的。 / QR code expired; a new one comes in 10s."
              : "配对失败或配对码过期，10 秒后生成新的配对码（旧的作废）。如果一直失败，改用二维码：npm run qr / Pairing failed or the code expired; a NEW code comes in 10s (the old one is void). If it keeps failing, link by QR instead: npm run qr"
          );
          status.qr = null;
          status.pairingCode = null;
        }
        fs.rmSync(authDir, { recursive: true, force: true });
        reconnect(10_000, 10_000);
        return;
      }
      if (code === DisconnectReason.restartRequired) {
        log("WhatsApp 要求重启连接（配对后正常现象），马上重连 / WhatsApp asked for a restart (normal after pairing); reconnecting");
        reconnect(500, 2000);
        return;
      }
      log(`连接断开，${Math.round(reconnectDelay / 1000)} 秒后重连 / Reconnecting in ${Math.round(reconnectDelay / 1000)}s (${code})`);
      reconnect(reconnectDelay, Math.min(reconnectDelay * 2, 60_000));
    }
  });

  // The account's own chat list. Groups can be listed at any time; individual chats
  // arrive from WhatsApp only in the history sync that follows pairing.
  const report = (entries) => {
    if (!onDirectory || !entries.length) return;
    try {
      onDirectory(entries);
    } catch (error) {
      log(`directory import failed: ${error.message}`);
    }
  };
  async function syncGroups() {
    try {
      const groups = await sock.groupFetchAllParticipating();
      const entries = Object.values(groups || {}).map((group) => ({ jid: group.id, name: group.subject || null, at: (group.creation || 0) * 1000 || null }));
      for (const entry of entries) if (entry.name) handle.groupNames.set(entry.jid, entry.name);
      report(entries);
      if (entries.length) log(`已读取 ${entries.length} 个群 / Found ${entries.length} groups`);
    } catch (error) {
      log(`could not list groups: ${error.message}`);
    }
  }
  const rememberNames = (contacts) => {
    for (const contact of contacts || []) {
      const name = contact?.name || contact?.verifiedName || contact?.notify;
      if (contact?.id && name) handle.contactNames.set(jidNormalizedUser(contact.id), name);
    }
  };
  const chatEntries = (chats) =>
    (chats || [])
      .filter((chat) => chat?.id && (isJidGroup(chat.id) || isCustomerChat(chat.id)))
      .map((chat) => {
        const jid = isJidGroup(chat.id) ? chat.id : jidNormalizedUser(chat.id);
        const stamp = Number(chat.conversationTimestamp?.low ?? chat.conversationTimestamp ?? 0);
        return { jid, name: chat.name || handle.contactNames.get(jid) || handle.groupNames.get(jid) || null, at: stamp ? stamp * 1000 : null };
      });
  sock.ev.on("messaging-history.set", ({ chats, contacts }) => {
    rememberNames(contacts);
    const entries = chatEntries(chats);
    report(entries);
    if (entries.length) log(`已读取 ${entries.length} 个现有对话 / Imported ${entries.length} existing chats`);
  });
  sock.ev.on("contacts.upsert", rememberNames);
  sock.ev.on("contacts.update", rememberNames);
  sock.ev.on("chats.upsert", (chats) => report(chatEntries(chats)));

  // Group subjects are fetched once and cached; a failed lookup just leaves the name empty.
  async function groupName(jid) {
    if (!handle.groupNames.has(jid)) {
      try {
        handle.groupNames.set(jid, (await sock.groupMetadata(jid))?.subject || null);
      } catch {
        return null;
      }
    }
    return handle.groupNames.get(jid);
  }
  sock.ev.on("groups.update", (updates) => {
    for (const update of updates) if (update.id && update.subject) handle.groupNames.set(update.id, update.subject);
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        const jid = msg.key?.remoteJid;
        if (!msg.message || !jid) continue;
        if (msg.message.protocolMessage || msg.message.reactionMessage) continue;
        const vote = msg.message.pollUpdateMessage;
        if (vote) {
          const pollId = vote.pollCreationMessageKey?.id;
          const poll = !msg.key.fromMe && onPollVote && getPoll && pollId ? getPoll(pollId) : null;
          if (!poll || isJidGroup(jid)) continue;
          const mine = [sock.user?.id, sock.user?.lid].filter(Boolean).map((value) => jidNormalizedUser(value));
          const theirs = [jid, msg.key.senderPn, msg.key.senderLid, msg.key.participant].filter(Boolean).map((value) => jidNormalizedUser(value));
          const index = readPollVote({ vote: vote.vote, pollId, secret: poll.secret, labels: poll.labels, creators: mine, voters: theirs });
          if (index === -1) continue; // vote withdrawn
          await onPollVote({ jid: jidNormalizedUser(jid), phone: phoneNumberOf(msg.key), name: msg.pushName, pollId, index });
          continue;
        }
        const text = extractText(msg.message);
        if (!text) continue;
        if (isJidGroup(jid)) {
          if (!onGroupMessage) continue;
          await onGroupMessage({
            jid,
            groupName: await groupName(jid),
            sender: msg.pushName || phoneNumberOf({ participantPn: msg.key.participantPn, remoteJid: msg.key.participant }) || "",
            text,
            fromMe: !!msg.key.fromMe,
            id: msg.key.id,
          });
          continue;
        }
        if (!isCustomerChat(jid)) continue;
        await onMessage({
          jid: jidNormalizedUser(jid),
          phone: phoneNumberOf(msg.key),
          text,
          name: msg.pushName,
          id: msg.key.id,
          fromMe: !!msg.key.fromMe,
          raw: msg,
        });
      } catch (error) {
        log(`message handling failed: ${error.message}`);
      }
    }
  });

  handle.sendText = async function sendText(jid, text, { delayMs = 0, markRead = null } = {}) {
      const sock = handle.sock;
      if (status.connection !== "open") throw new Error("WhatsApp is not connected right now");
      if (markRead) {
        try {
          await sock.readMessages([markRead]);
        } catch {
          /* best effort */
        }
      }
      try {
        await sock.presenceSubscribe(jid);
        await sock.sendPresenceUpdate("composing", jid);
      } catch {
        /* presence is cosmetic */
      }
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      try {
        await sock.sendPresenceUpdate("paused", jid);
      } catch {
        /* cosmetic */
      }
      const sent = await sock.sendMessage(jid, { text });
      return sent?.key?.id;
  };
  // Tappable choices: a single-answer poll. Returns its id and the secret needed to read votes.
  handle.sendPoll = async function sendPoll(jid, question, labels, { delayMs = 0 } = {}) {
    const sock = handle.sock;
    if (status.connection !== "open") throw new Error("WhatsApp is not connected right now");
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    const sent = await sock.sendMessage(jid, { poll: { name: question.slice(0, 255), values: labels.map((label) => label.slice(0, 100)), selectableCount: 1 } });
    const secret = sent?.message?.messageContextInfo?.messageSecret;
    return { id: sent?.key?.id, secret: secret ? Buffer.from(secret).toString("base64") : null };
  };
  return handle;
}

// WhatsApp now addresses many chats by an anonymous LID instead of the phone number.
// The real number travels alongside in sender_pn when the server shares it.
export function phoneNumberOf(key) {
  const candidate = key?.senderPn || key?.participantPn || (key?.remoteJid?.endsWith("@s.whatsapp.net") ? key.remoteJid : null);
  return candidate ? jidNormalizedUser(candidate).split("@")[0] : null;
}
