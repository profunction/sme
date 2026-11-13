// WhatsApp link via Baileys (WhatsApp Web multi-device protocol) using a pairing code.
// This is an unofficial client: WhatsApp's terms do not allow it, numbers can be banned,
// and the library may stop working after a WhatsApp update. Use a spare number.
import fs from "node:fs";
import pino from "pino";
import baileys, {
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
export async function connect({ config, authDir, status, onMessage, log, backoffMs = 2000 }) {
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

  let pairingRequested = false;
  let reconnectDelay = backoffMs;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr && !state.creds.registered && !pairingRequested) {
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
      status.connectedAt = Date.now();
      status.lastError = null;
      reconnectDelay = 2000;
      log(`已连接 / Connected as ${jidNormalizedUser(sock.user?.id || "")}`);
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      status.lastError = `disconnected (${code ?? "unknown"})`;
      if (code === DisconnectReason.loggedOut) {
        if (state.creds.registered) {
          log("此设备已在手机上被登出，正在重新开始配对。 / Logged out from the phone; starting a fresh pairing.");
        } else {
          log("配对码已过期或未被输入，10 秒后生成新的配对码。 / Pairing code expired or was not entered; a new code comes in 10s.");
        }
        fs.rmSync(authDir, { recursive: true, force: true });
        setTimeout(() => connect({ config, authDir, status, onMessage, log, backoffMs: 10_000 }).catch((e) => log(e.message)), 10_000);
        return;
      }
      log(`连接断开，${Math.round(reconnectDelay / 1000)} 秒后重连 / Reconnecting in ${Math.round(reconnectDelay / 1000)}s (${code})`);
      const next = Math.min(reconnectDelay * 2, 60_000);
      setTimeout(() => connect({ config, authDir, status, onMessage, log, backoffMs: next }).catch((e) => log(e.message)), reconnectDelay);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        const jid = msg.key?.remoteJid;
        if (!msg.message || !isCustomerChat(jid)) continue;
        if (msg.message.protocolMessage || msg.message.reactionMessage) continue;
        const text = extractText(msg.message);
        if (!text) continue;
        await onMessage({ jid: jidNormalizedUser(jid), text, name: msg.pushName, id: msg.key.id, fromMe: !!msg.key.fromMe, raw: msg });
      } catch (error) {
        log(`message handling failed: ${error.message}`);
      }
    }
  });

  return {
    sock,
    async sendText(jid, text, { delayMs = 0, markRead = null } = {}) {
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
    },
  };
}
