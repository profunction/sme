// Optional AI reply. Disabled by default; every provider is behind one function.
// Ollama is free and local. DeepSeek and other OpenAI-compatible hosts cost money.
// Claude uses the official Anthropic SDK.

function buildMessages(history, text) {
  const messages = [];
  for (const row of history) {
    if (row.direction === "in") messages.push({ role: "user", content: row.text });
    else messages.push({ role: "assistant", content: row.text });
  }
  // Collapse consecutive same-role turns so every provider accepts the sequence.
  const merged = [];
  for (const m of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += "\n" + m.content;
    else merged.push({ ...m });
  }
  if (!merged.length || merged[merged.length - 1].role !== "user" || merged[merged.length - 1].content !== text) {
    if (merged.length && merged[merged.length - 1].role === "user") merged[merged.length - 1].content += "\n" + text;
    else merged.push({ role: "user", content: text });
  }
  if (merged[0]?.role !== "user") merged.shift();
  return merged;
}

const fill = (text, variables) => String(text || "").replace(/\{(company|email|phone|address|name)\}/g, (_, key) => variables?.[key] ?? "");

// The model answers from the business facts plus the knowledge-base entries the
// engine found for this message, so it stays inside what the company has written.
export function systemPrompt(ai, { language, context = [], mode = null, variables = {} }) {
  const languageName = { zh: "Chinese", en: "English", ms: "Malay" }[language] || language;
  const lang = (texts) => texts?.[language] ?? texts?.en ?? Object.values(texts || {})[0] ?? "";
  const knowledge = context
    .map((entry) => `### ${lang(entry.title)}\nQuick steps:\n${lang(entry.reply)}\nBackground:\n${lang(entry.explain)}`)
    .join("\n\n");
  const style =
    mode === "explain"
      ? "The customer wants to understand the cause: explain what is likely going on, how serious it is and whether they can handle it themselves."
      : mode === "fix"
        ? "The customer is in a hurry: give only the fastest safe steps, numbered, most likely fix first."
        : "";
  return [
    fill(ai.system_prompt, variables),
    `Reply in ${languageName}.`,
    style,
    ai.facts ? `Business facts:\n${fill(ai.facts, variables)}` : "",
    knowledge
      ? `Knowledge base entries that may be relevant. Prefer these over your own knowledge and do not contradict them:\n\n${knowledge}`
      : "No knowledge base entry matched. Ask for the brand, model, exact symptom and a photo instead of guessing.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function ollama(ai, system, messages, signal) {
  const base = (ai.base_url || "http://127.0.0.1:11434").replace(/\/$/, "");
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      model: ai.model || "qwen3:4b",
      stream: false,
      think: false, // Qwen3/DeepSeek-R1 style models: answer directly, no slow reasoning pass
      messages: [{ role: "system", content: system }, ...messages],
      options: { num_predict: ai.max_output_tokens },
    }),
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const data = await response.json();
  return (data?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

async function openaiCompatible(ai, system, messages, signal) {
  const base = (ai.base_url || "https://api.deepseek.com/v1").replace(/\/$/, "");
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env[ai.api_key_env]}` },
    signal,
    body: JSON.stringify({
      model: ai.model || "deepseek-chat",
      max_tokens: ai.max_output_tokens,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

let anthropicClient;
async function anthropic(ai, system, messages, signal) {
  if (!anthropicClient) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    anthropicClient = new Anthropic({ apiKey: process.env[ai.api_key_env], timeout: 30_000, maxRetries: 1 });
  }
  // Sonnet 5.5 for everyday customer chat (the user's chosen tier); low effort keeps replies quick and cheap.
  const response = await anthropicClient.beta.messages.create(
    {
      model: ai.model || "claude-sonnet-5-5",
      max_tokens: ai.max_output_tokens,
      system,
      messages,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    },
    { signal }
  );
  if (response.stop_reason === "refusal") return "";
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

const PROVIDERS = { ollama, openai_compatible: openaiCompatible, anthropic };

export async function aiReply(ai, { history, text, language, context = [], mode = null, variables = {} }, { timeoutMs = 25_000 } = {}) {
  const provider = PROVIDERS[ai.provider];
  if (!provider) throw new Error(`Unknown AI provider ${ai.provider}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await provider(ai, systemPrompt(ai, { language, context, mode, variables }), buildMessages(history, text), controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export { buildMessages };
