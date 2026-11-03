import { useEffect, useState } from "react";
import { APIError, errorText } from "./api";
import { useLanguage } from "./i18n";

type Policy = { billing_source: string; cloud_allowed: boolean; monthly_limit_usd: number; credit_balance_usd: number; input_usd_per_million: number; output_usd_per_million: number; pricing_confirmed: boolean; local_complex_capable: boolean; max_output_tokens: number };
export type WebAIStatus = { website_backend: boolean; authenticated: boolean; csrf_token?: string; settings?: { model: string; policy: Policy; key_present: boolean } };
let csrf = "";
export async function webRequest<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/web-api/${path}`, { method, credentials: "same-origin", headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(method === "GET" || path === "login" ? {} : { "X-CSRF-Token": csrf }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data;
  try { data = await response.json(); } catch { throw new Error("Website backend not connected"); }
  if (!response.ok) {
    if (response.status === 401 || (response.status === 403 && typeof data.detail === "string" && /verification failed/i.test(data.detail))) { csrf = ""; window.dispatchEvent(new Event("nightbrew:web-login-expired")); }
    const detail = data.detail;
    if (detail && typeof detail === "object" && typeof detail.code === "string") throw new APIError(typeof detail.message === "string" ? detail.message : "AI request failed", detail.code, detail.mode || "", detail.model || "", detail.provider_status);
    throw new Error(typeof detail === "string" ? detail : "Website request failed");
  }
  return data as T;
}
export function webError(error: unknown, language: "zh" | "en") {
  const message = error instanceof Error ? error.message : "";
  const entries: [RegExp, string, string][] = [
    [/backend not connected/, "当前网站尚未连接后端，GitHub Pages 静态页面不能保存密钥或调用 AI。", "This site has no backend. GitHub Pages cannot store keys or call AI."],
    [/login required|password rejected/i, "请使用此网站的工作区密码登录。", "Sign in with this website's workspace password."],
    [/request verification|origin rejected/i, "网站请求验证失败，请重新登录，并使用管理员配置的同一网站地址。", "Website request verification failed. Sign in again using the configured website origin."],
    [/key format invalid/i, "请只粘贴 API Key，不包含 Bearer、空格或换行。", "Paste only the API key, without Bearer, spaces or line breaks."],
    [/Save your DeepSeek API key first/i, "请先在此页面保存你的 DeepSeek API Key。", "Save your DeepSeek API key on this page first."],
    [/Website credential storage unavailable/i, "服务端密钥存储暂时不可用，请管理员检查私有加密配置。", "Server credential storage is unavailable. Ask the administrator to check the private encryption configuration."],
    [/Two website AI requests/i, "当前已有两条 AI 请求在处理，请完成后再主动发送。", "Two AI requests are already active. Wait before sending again."],
    [/Wait ten seconds/i, "请等待十秒后再测试连接。", "Wait ten seconds before testing again."],
    [/Too many login attempts/i, "登录尝试过多，请五分钟后再试。", "Too many login attempts. Wait five minutes."],
  ];
  const match = entries.find(([pattern]) => pattern.test(message));
  return match ? match[language === "en" ? 2 : 1] : errorText(error, language);
}
export function useWebAI() {
  const [status, setStatus] = useState<WebAIStatus>({ website_backend: false, authenticated: false });
  const [checking, setChecking] = useState(true);
  async function refresh() {
    const next = await webRequest<WebAIStatus>("status");
    if (!next.website_backend) throw new Error("Website backend not connected");
    csrf = next.authenticated ? next.csrf_token || "" : "";
    setStatus(next); return next;
  }
  useEffect(() => {
    let active = true;
    webRequest<WebAIStatus>("status").then(next => {
      if (active && next.website_backend) { csrf = next.authenticated ? next.csrf_token || "" : ""; setStatus(next); }
    }).catch(() => {}).finally(() => { if (active) setChecking(false); });
    const expire = () => { csrf = ""; setStatus(current => ({ website_backend: current.website_backend, authenticated: false })); };
    window.addEventListener("nightbrew:web-login-expired", expire);
    return () => { active = false; window.removeEventListener("nightbrew:web-login-expired", expire); };
  }, []);
  async function login(password: string) { const next = await webRequest<WebAIStatus>("login", "POST", { password }); csrf = next.csrf_token || ""; setStatus(next); }
  async function logout() { await webRequest("logout", "POST", {}); csrf = ""; setStatus({ website_backend: true, authenticated: false }); }
  const ready = status.authenticated && !!status.settings?.key_present && !!status.settings.policy.cloud_allowed && !!status.settings.policy.pricing_confirmed;
  return { status, checking, refresh, login, logout, ready };
}
export type WebAIService = ReturnType<typeof useWebAI>;
const defaults: Policy = { billing_source: "BYOK", cloud_allowed: false, monthly_limit_usd: 5, credit_balance_usd: 0, input_usd_per_million: 0, output_usd_per_million: 0, pricing_confirmed: false, local_complex_capable: false, max_output_tokens: 512 };

export function WebAISettings({ service, onChat }: { service: WebAIService; onChat: () => void }) {
  const { t, language } = useLanguage();
  const [password, setPassword] = useState(""), [key, setKey] = useState("");
  const [model, setModel] = useState("deepseek-chat"), [policy, setPolicy] = useState<Policy>(defaults);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (service.status.authenticated && service.status.settings) { setModel(service.status.settings.model); setPolicy(service.status.settings.policy); }
  }, [service.status.authenticated]);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setMessage(""); setError(null);
    try { await fn(); } catch (failure) { setError(failure); } finally { setBusy(false); }
  }
  return <section className="web-card" aria-label={t("DeepSeek API 连接", "DeepSeek API connection")}>
    <h2>{t("在这里填写 DeepSeek API Key", "Enter your DeepSeek API key here")}</h2>
    <p>{t("使用你自己的 DeepSeek 账号。密钥通过同源后端加密保存，不保存在网页代码或浏览器存储。", "Use your own DeepSeek account. Keys are encrypted by the same-origin backend, not kept in page code or browser storage.")}</p>
    {!service.status.website_backend && <div className="web-tip"><strong>{t("当前是静态预览，后端尚未部署。", "This is a static preview; the backend is not deployed.")}</strong><p>{t("GitHub Pages 只能展示页面。连接网站后端并登录后，下方密钥输入框才会启用；目前不要在草稿或聊天里粘贴 Key。", "GitHub Pages serves pages only. The key input becomes available after the website backend is running and you sign in. Do not paste keys into drafts or chat.")}</p></div>}
    {service.checking && <p role="status">{t("正在检查网站后端…", "Checking website backend…")}</p>}
    {service.status.website_backend && !service.status.authenticated && <form onSubmit={event => { event.preventDefault(); void run(async () => { try { await service.login(password); setMessage(t("工作区已登录，可以保存 Key。", "Signed in. You can save your key now.")); } finally { setPassword(""); } }); }}>
      <label>{t("网站工作区密码", "Website workspace password")}<input aria-label="Website workspace password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label><button className="web-primary" disabled={busy || !password}>{t("登录工作区", "Sign in to workspace")}</button>
    </form>}
    <fieldset className="web-ai-fields" disabled={busy || !service.status.authenticated}>
      <h3>{t("1. 保存自己的 API Key", "1. Save your own API key")}</h3>
      <p>DeepSeek · https://api.deepseek.com/v1</p>
      <label>{t("DeepSeek API Key", "DeepSeek API key")}<input aria-label="DeepSeek API key" type="password" autoComplete="off" spellCheck={false} placeholder={service.status.authenticated ? "" : t("登录后在此填写", "Sign in to enter your key")} value={key} onChange={event => setKey(event.target.value)} /></label>
      <button type="button" className="web-primary" disabled={!key.trim()} onClick={() => void run(async () => { try { await webRequest("key", "PUT", { key: key.trim() }); await service.refresh(); setMessage(t("密钥已加密保存，没有调用 AI。", "Key encrypted and saved. No AI inference requested.")); } finally { setKey(""); } })}>{t("保存 API Key", "Save API key")}</button>
      <button type="button" className="web-secondary" disabled={!service.status.settings?.key_present} onClick={() => void run(async () => { await webRequest("key", "PUT", { key: "" }); setKey(""); await service.refresh(); setMessage(t("已删除服务端保存的 Key。", "Saved server key removed.")); })}>{t("删除已保存的 Key", "Remove saved key")}</button>
      <p>{service.status.settings?.key_present ? t("已检测到保存的密钥，不会回显内容。", "Saved key detected; its value is never returned.") : t("尚未保存密钥。", "No key saved yet.")}</p>
      <h3>{t("2. 设置模型、价格和预算", "2. Set model, prices and budget")}</h3>
      <label>{t("模型名称", "Model name")}<input aria-label="Website AI model" value={model} maxLength={200} onChange={event => { setModel(event.target.value); setPolicy({ ...policy, pricing_confirmed: false, cloud_allowed: false }); }} /></label>
      <p>{t("价格以 DeepSeek 当前官方 USD / 百万 token 为准，应用没有核实实时价格。本机预算不是 DeepSeek 账户余额。", "Use current official DeepSeek USD prices per million tokens; live prices have not been verified by this app. The local budget is not your DeepSeek account balance.")}</p>
      <div className="web-form-grid">{([
        ["input_usd_per_million", "输入价格（USD / 百万 token）", "Input price (USD / million tokens)"],
        ["output_usd_per_million", "输出价格（USD / 百万 token）", "Output price (USD / million tokens)"],
        ["monthly_limit_usd", "每月最高预算（USD）", "Monthly budget cap (USD)"],
      ] as const).map(([name, zh, en]) => <label key={name}>{t(zh, en)}<input aria-label={name} type="number" min="0" max="10000" step="any" value={policy[name]} onChange={event => setPolicy({ ...policy, [name]: Number(event.target.value), pricing_confirmed: false, cloud_allowed: false })} /></label>)}</div>
      <label className="web-check"><input type="checkbox" checked={policy.pricing_confirmed} onChange={event => setPolicy({ ...policy, pricing_confirmed: event.target.checked })} />{t("我已核实当前模型价格", "I verified current model prices")}</label>
      <label className="web-check"><input type="checkbox" checked={policy.cloud_allowed} onChange={event => setPolicy({ ...policy, cloud_allowed: event.target.checked })} />{t("允许使用我自己的付费 DeepSeek API", "Allow my paid DeepSeek API")}</label>
      <button type="button" className="web-primary" disabled={!policy.pricing_confirmed || !policy.cloud_allowed || policy.monthly_limit_usd <= 0 || policy.input_usd_per_million <= 0 || policy.output_usd_per_million <= 0 || !model.trim()} onClick={() => void run(async () => { await webRequest("settings", "PUT", { model, policy: { ...policy, billing_source: "BYOK", credit_balance_usd: policy.monthly_limit_usd } }); await service.refresh(); setMessage(t("模型与预算已保存。每次聊天仍须明确同意。", "Model and budget saved. Each chat request still needs explicit consent.")); })}>{t("保存模型与预算", "Save model and budget")}</button>
      <h3>{t("3. 测试并开始聊天", "3. Test and start chatting")}</h3>
      <p>{t("下方测试会把 Key 发给 DeepSeek 查询模型列表，不生成回答。列表可访问不代表余额充足或回答可用。", "The check sends the key to DeepSeek to list models, without generating an answer. A reachable list does not verify account balance or inference.")}</p>
      <button type="button" className="web-secondary" disabled={!service.status.settings?.key_present} onClick={() => void run(async () => { const result = await webRequest<{ model_listed: boolean }>("test", "POST", { consent: true }); setMessage(result.model_listed ? t("模型列表可访问，已找到配置的模型。实际回答请在聊天里测试。", "Model list reachable and configured model listed. Test an actual answer in chat.") : t("列表可访问，但没有找到配置的模型名称。", "Model list reachable, but configured model was not listed.")); })}>{t("同意查询 DeepSeek 模型列表", "Consent to check DeepSeek models")}</button>
      <button type="button" className="web-primary" disabled={!service.ready} onClick={onChat}>{t("开始 DeepSeek 聊天", "Start DeepSeek chat")}</button>
    </fieldset>
    {service.status.authenticated && <button type="button" className="web-secondary" disabled={busy} onClick={() => void run(async () => { await service.logout(); setKey(""); setPassword(""); })}>{t("退出网站工作区", "Sign out of website")}</button>}
    {message && <p className="web-notice" role="status">{message}</p>}
    {error !== null && <p className="web-error" role="alert">{webError(error, language)}</p>}
  </section>;
}
