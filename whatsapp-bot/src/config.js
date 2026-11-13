// Loads config.json and fills in safe defaults. Never put API keys in config.json;
// name an environment variable in ai.api_key_env instead.
import fs from "node:fs";
import path from "node:path";

export const DEFAULTS = {
  phone_number: "",
  default_language: "zh",
  languages: ["zh", "en", "ms"],
  timezone: "Asia/Kuala_Lumpur",
  hours: { open: "09:00", close: "18:00", days: [1, 2, 3, 4, 5, 6] },
  greeting_cooldown_hours: 12,
  handoff_minutes: 30,
  reply_delay_ms: { min: 1500, max: 4000 },
  max_replies_per_minute: 20,
  min_seconds_between_replies_per_contact: 4,
  ignore_groups: true,
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
    if (value && typeof value === "object" && !Array.isArray(value) && typeof base[key] === "object" && !Array.isArray(base[key])) {
      out[key] = merge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function load(file = path.resolve(process.cwd(), "config.json")) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${file}. Copy config.example.json to config.json and edit it.`);
  }
  const config = merge(DEFAULTS, JSON.parse(fs.readFileSync(file, "utf8")));
  const problems = validate(config);
  if (problems.length) {
    throw new Error("config.json problems:\n - " + problems.join("\n - "));
  }
  return config;
}
