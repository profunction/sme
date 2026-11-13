// Loads config.json and fills in safe defaults. Never put API keys in config.json;
// name an environment variable in ai.api_key_env instead.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULTS = {
  phone_number: "",
  // Fill these once; every text can use {company}, {email}, {phone}, {address}.
  business: { company: "", email: "", phone: "", address: "" },
  // "poll": choices are sent as a tappable WhatsApp poll; "text": as a numbered list to answer by number.
  menu_style: "text",
  // Optional tappable main menu: { question: {zh,en}, options: [{ label: {zh,en}, send: "1" }] }.
  // `send` is what tapping means: a menu key ("1"), "0" for a person, or "pick:other".
  main_menu: null,
  // Device categories offered after "fix" or "explain": [{ id, title: {zh,en}, entries: [knowledge ids] }]
  categories: [],
  // After each knowledge answer, ask "did that solve it?" with tappable choices.
  follow_up: false,
  // WhatsApp numbers of staff who get an alert for "other" reports, visit requests, emergencies and handoffs.
  notify: { numbers: [] },
  // Folders or files with knowledge-base entries ({id,title,match,reply,explain}); appended to faq.
  knowledge: [],
  // Customer tiers, e.g. { vip: { label, priority, ignore_hours, bot: "on"|"off", texts: {...overrides} } }
  tiers: {},
  // Known customers: [{ phones: ["6591234567"], name: "Mr Tan", tier: "vip" }]
  customers: [],
  default_language: "zh",
  languages: ["zh", "en", "ms"],
  timezone: "Asia/Kuala_Lumpur",
  hours: { open: "09:00", close: "18:00", days: [1, 2, 3, 4, 5, 6] },
  greeting_cooldown_hours: 12,
  handoff_minutes: 30,
  reply_delay_ms: { min: 1500, max: 4000 },
  max_replies_per_minute: 20,
  min_seconds_between_replies_per_contact: 4,
  // Announcements from the Broadcast page: paced one by one, capped per day.
  broadcast: {
    delay_seconds: { min: 20, max: 45 },
    max_per_day: 150,
    footer: {
      zh: "回复「退订」可停止接收此类通知。",
      en: "Reply STOP to stop receiving these updates.",
      ms: "Balas STOP untuk berhenti menerima makluman ini.",
    },
  },
  // Group chats: "observe" records them for the dashboard (the bot never posts in groups); "ignore" skips them.
  groups: "observe",
  mark_read: false,
  dashboard_port: 8787,
  texts: {
    greeting: {
      zh: "您好，感谢联系我们！",
      en: "Hello, thanks for contacting us!",
      ms: "Hai, terima kasih kerana menghubungi kami!",
    },
    menu: {
      zh: "请回复数字：\n1 价格\n2 预约\n3 地址与营业时间\n0 人工客服",
      en: "Reply with a number:\n1 Prices\n2 Appointment\n3 Address & hours\n0 Talk to a person",
      ms: "Balas dengan nombor:\n1 Harga\n2 Temu janji\n3 Alamat & waktu operasi\n0 Bercakap dengan staf",
    },
    after_hours: {
      zh: "现在是非营业时间，我们会在营业时间尽快回复您。",
      en: "We are closed right now and will reply during business hours.",
      ms: "Kami tutup sekarang dan akan membalas pada waktu operasi.",
    },
    fallback: {
      zh: "收到，我们的同事会尽快回复您。",
      en: "Got it, a colleague will get back to you shortly.",
      ms: "Diterima, rakan sekerja kami akan membalas sebentar lagi.",
    },
    handoff: {
      zh: "好的，已为您转接人工客服，请稍候。",
      en: "Sure, connecting you to a person. One moment.",
      ms: "Baik, menyambungkan anda kepada staf. Sila tunggu.",
    },
    // Appended after every FAQ answer. Leave empty to disable.
    escalate: { zh: "", en: "", ms: "" },
    // Question shown above related topics when nothing matches exactly.
    suggest: { zh: "您说的是哪一个问题？", en: "Which of these is your problem?", ms: "Yang mana satu masalah anda?" },
    choose_category: { zh: "是哪一类设备？请选择，或直接打字描述问题。", en: "Which kind of equipment? Choose one, or just type what is happening.", ms: "Jenis peralatan yang mana? Pilih satu, atau taip masalah anda." },
    choose_issue: { zh: "是哪个问题？", en: "Which problem is it?", ms: "Masalah yang mana?" },
    describe: {
      zh: "好的，请直接打字描述：什么设备、出现什么情况。可以发照片。",
      en: "OK. Please type what equipment it is and what is happening. Photos are welcome.",
      ms: "Baik. Sila taip peralatan apa dan apa yang berlaku. Gambar dialu-alukan.",
    },
    follow_up: { zh: "这样解决了吗？", en: "Did that solve it?", ms: "Adakah masalah selesai?" },
    option_solved: { zh: "解决了，谢谢", en: "Solved, thank you", ms: "Selesai, terima kasih" },
    option_not_solved: { zh: "还是不行，请技术员联系我", en: "Still not working, have a technician contact me", ms: "Masih tidak berfungsi, minta juruteknik hubungi saya" },
    option_show_explain: { zh: "告诉我是什么原因", en: "Tell me what causes this", ms: "Terangkan puncanya" },
    option_show_fix: { zh: "给我处理步骤", en: "Give me the steps to fix it", ms: "Beri langkah pembaikan" },
    option_menu: { zh: "回到主菜单", en: "Back to the main menu", ms: "Kembali ke menu utama" },
    solved: { zh: "太好了，问题解决了就好。之后再有状况随时找我们。", en: "Great, glad it is sorted. Reach out any time if it happens again.", ms: "Bagus, gembira ia selesai. Hubungi kami bila-bila masa." },
    option_other: { zh: "其他（告诉我们发生什么事）", en: "Other (tell us what happened)", ms: "Lain-lain (beritahu kami)" },
    option_none: { zh: "都不是，我自己描述", en: "None of these, let me describe", ms: "Tiada, saya terangkan sendiri" },
    other_prompt: {
      zh: "好的，请告诉我们发生了什么情况：什么设备、在哪里、从什么时候开始。可以发照片或语音，我们的同事会亲自查看并回复您。",
      en: "Sure. Please tell us what happened: which equipment, where, and since when. Photos or voice notes are welcome; a member of our team will read it and reply to you.",
      ms: "Baik. Sila beritahu apa yang berlaku: peralatan apa, di mana dan sejak bila. Gambar atau nota suara dialu-alukan; pasukan kami akan membaca dan membalas.",
    },
    other_received: {
      zh: "已收到，并已通知我们的同事，会尽快回复您。还有补充的直接发过来即可。",
      en: "Received, and our team has been notified. We will reply shortly. Send anything else you want to add here.",
      ms: "Diterima dan pasukan kami telah dimaklumkan. Kami akan membalas sebentar lagi.",
    },
    opt_out: {
      zh: "已为您取消通知订阅。需要技术支持仍可随时发消息给我们；回复「订阅」可恢复。",
      en: "You are unsubscribed from our updates. You can still message us for support any time; reply START to resubscribe.",
      ms: "Anda telah berhenti melanggan makluman kami. Anda masih boleh menghubungi kami untuk sokongan; balas START untuk melanggan semula.",
    },
    opt_in: {
      zh: "已恢复通知订阅，谢谢！",
      en: "You are subscribed to our updates again. Thank you!",
      ms: "Anda melanggan makluman kami semula. Terima kasih!",
    },
    // Sent when a customer in "visit" mode sends details (address, photos, etc.).
    visit_received: {
      zh: "已收到，技术员会尽快联系您确认上门时间。",
      en: "Received. A technician will contact you shortly to confirm the visit.",
      ms: "Diterima. Juruteknik akan menghubungi anda untuk mengesahkan lawatan.",
    },
  },
  menu: [],
  faq: [],
  ai: {
    enabled: false,
    provider: "ollama",
    model: "",
    base_url: "",
    api_key_env: "",
    system_prompt:
      "You are the customer service assistant of a small business. Reply briefly in the customer's language. Use only the facts given to you; if you do not know, say a colleague will follow up. Never promise prices or discounts that are not in the facts.",
    facts: "",
    max_history: 10,
    max_output_tokens: 300,
  },
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validate(config) {
  const problems = [];
  if (!/^\d{8,15}$/.test(config.phone_number || "")) {
    problems.push("phone_number must be digits only with country code, e.g. 60123456789");
  }
  if (!TIME.test(config.hours.open) || !TIME.test(config.hours.close)) {
    problems.push("hours.open and hours.close must be HH:MM");
  }
  if (!Array.isArray(config.hours.days) || config.hours.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    problems.push("hours.days must be weekday numbers 0 (Sunday) to 6 (Saturday)");
  }
  if (!config.languages.includes(config.default_language)) {
    problems.push("default_language must be one of languages");
  }
  for (const [index, item] of [...config.menu, ...config.faq].entries()) {
    const keys = item.keys || item.match;
    if (!Array.isArray(keys) || keys.length === 0 || typeof item.reply !== "object") {
      problems.push(`menu/faq item ${index} needs keys (or match) and a reply object`);
    }
  }
  if (!["observe", "ignore"].includes(config.groups)) problems.push('groups must be "observe" or "ignore"');
  if (!["poll", "text"].includes(config.menu_style)) problems.push('menu_style must be "poll" or "text"');
  if (config.main_menu) {
    const options = config.main_menu.options;
    if (!Array.isArray(options) || options.length < 2 || options.length > 12) problems.push("main_menu.options needs 2 to 12 options");
    else if (options.some((o) => !o.label || typeof o.send !== "string")) problems.push("each main_menu option needs label and send");
  }
  const knowledgeIds = new Set(config.faq.map((entry) => entry.id).filter(Boolean));
  for (const category of config.categories || []) {
    if (!category.id || !category.title || !Array.isArray(category.entries)) problems.push("each category needs id, title and entries");
    else for (const id of category.entries) if (!knowledgeIds.has(id)) problems.push(`category ${category.id} lists unknown knowledge id ${id}`);
  }
  if ((config.categories || []).length > 11) problems.push("at most 11 categories (a WhatsApp poll holds 12 options)");
  for (const number of config.notify?.numbers || []) if (!/^\d{8,15}$/.test(String(number))) problems.push(`notify.numbers: ${number} must be digits with country code`);
  const pace = config.broadcast?.delay_seconds;
  if (!pace || !(pace.min >= 5) || !(pace.max >= pace.min)) problems.push("broadcast.delay_seconds needs min of at least 5 and max no smaller than min");
  if (!(config.broadcast?.max_per_day >= 1)) problems.push("broadcast.max_per_day must be at least 1");
  for (const [name, tier] of Object.entries(config.tiers || {})) {
    if (tier.bot && !["on", "off"].includes(tier.bot)) problems.push(`tiers.${name}.bot must be "on" or "off"`);
  }
  for (const [index, customer] of (config.customers || []).entries()) {
    if (!Array.isArray(customer.phones) || !customer.phones.length) problems.push(`customers[${index}] needs phones`);
    if (customer.tier && !config.tiers?.[customer.tier]) problems.push(`customers[${index}] uses unknown tier ${customer.tier}`);
  }
  const seen = new Set();
  for (const item of config.faq) {
    if (!item.id) continue;
    if (seen.has(item.id)) problems.push(`duplicate knowledge id ${item.id}`);
    seen.add(item.id);
  }
  if (config.ai.enabled) {
    if (!["ollama", "openai_compatible", "anthropic"].includes(config.ai.provider)) {
      problems.push("ai.provider must be ollama, openai_compatible or anthropic");
    }
    if (config.ai.provider !== "ollama" && !config.ai.api_key_env) {
      problems.push("ai.api_key_env must name the environment variable that holds the API key");
    }
    if (config.ai.provider !== "ollama" && config.ai.api_key_env && !process.env[config.ai.api_key_env]) {
      problems.push(`environment variable ${config.ai.api_key_env} is not set`);
    }
  }
  return problems;
}

export function merge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object" && !Array.isArray(base[key])) {
      out[key] = merge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Notepad on older Windows saves UTF-8 with a byte-order mark; JSON.parse rejects it.
export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

export function loadKnowledge(entries, baseDirs) {
  const out = [];
  for (const entry of entries || []) {
    const found = baseDirs.map((dir) => path.resolve(dir, entry)).find((candidate) => fs.existsSync(candidate));
    if (!found) throw new Error(`knowledge path not found: ${entry}`);
    const files = fs.statSync(found).isDirectory()
      ? fs.readdirSync(found).filter((name) => name.endsWith(".json")).sort().map((name) => path.join(found, name))
      : [found];
    for (const file of files) {
      const data = readJson(file);
      const list = Array.isArray(data) ? data : data.entries;
      if (!Array.isArray(list)) throw new Error(`${file} must be a JSON array of knowledge entries`);
      out.push(...list);
    }
  }
  return out;
}

// Merge defaults, then append knowledge-base entries after the config's own faq.
export function prepare(raw, baseDir = process.cwd()) {
  const config = merge(DEFAULTS, raw);
  const knowledge = loadKnowledge(config.knowledge, [baseDir, PACKAGE_ROOT]);
  if (knowledge.length) config.faq = [...config.faq, ...knowledge];
  return config;
}

export function load(file = path.resolve(process.cwd(), "config.json")) {
  if (!fs.existsSync(file)) {
    throw new Error(`找不到 ${file}。请先运行 npm run setup。 / Missing ${file}. Run "npm run setup" first.`);
  }
  const config = prepare(readJson(file), path.dirname(file));
  const problems = validate(config);
  if (problems.length) {
    throw new Error(`${path.basename(file)} problems:\n - ` + problems.join("\n - "));
  }
  return config;
}

// A profile is one WhatsApp account: its own config, login and database.
// The default profile keeps the original file names so existing pairings survive.
export function profilePaths(root, profile = "") {
  const name = String(profile || "").trim();
  if (name && !/^[a-z0-9_-]{1,30}$/i.test(name)) throw new Error("profile name: letters, digits, - and _ only");
  return name
    ? { profile: name, config: path.join(root, `config.${name}.json`), auth: path.join(root, `auth-${name}`), db: path.join(root, "data", `${name}.sqlite3`) }
    : { profile: "", config: path.join(root, "config.json"), auth: path.join(root, "auth"), db: path.join(root, "data", "bot.sqlite3") };
}
