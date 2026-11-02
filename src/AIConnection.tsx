import { useEffect, useState } from "react";
import { errorText, type API } from "./api";
import { useLanguage } from "./i18n";

type Models = { local_model: string; cloud_model: string; cloud_url: string };
type Policy = { billing_source: string; cloud_allowed: boolean; monthly_limit_usd: number; credit_balance_usd: number; input_usd_per_million: number; output_usd_per_million: number; pricing_confirmed: boolean; local_complex_capable: boolean; max_output_tokens: number };
type Connection = { key_present: boolean; local_only_preview: boolean; byok_preview: boolean; models: Models };
export function AIConnection({ api, onChat, onSaved }: { api: API; onChat?: () => void; onSaved: () => Promise<void> }) {
  const { t } = useLanguage();
  const [connection, setConnection] = useState<Connection>();
  const [models, setModels] = useState<Models>();
  const [policy, setPolicy] = useState<Policy>();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [consent, setConsent] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [allowCloud, setAllowCloud] = useState(false);
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([api<Connection>("/settings/cloud-connection"), api<Policy>("/settings/ai")])
      .then(([info, settings]) => { if (active) { setConnection(info); setModels(info.models); setPolicy(settings); } })
      .catch((failure) => { if (active) setError(errorText(failure)); });
    return () => { active = false; };
  }, [api]);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await fn(); }
    catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  function modelField(name: keyof Models, value: string) {
    if (models) setModels({ ...models, [name]: value });
    setDirty(true); setChecked(false); setConsent(false); setConfirmed(false); setAllowCloud(false); setMessage("");
  }
  return <section className="panel" aria-label={t("连接 AI", "Connect AI")}>
    <h2>{t("连接 AI：填写你自己的 API Key", "Connect AI: use your own API key")}</h2>
    <p>{t("这里连接的是 DeepSeek 等 AI，让助理能回答问题；不需要配置 POS 或仓库连接。没有密钥可以继续使用本机 Ollama。", "Connect an AI provider such as DeepSeek so your assistant can answer. POS and warehouse connectors are separate. You can still use local Ollama without an API key.")}</p>
    {connection?.local_only_preview && <p role="status">{t("当前是 LOCAL-PREVIEW，仅支持本地 Ollama。使用云端需要安装独立的 API-PREVIEW 版本；此页面不会绕过版本限制。", "This LOCAL-PREVIEW build supports Ollama only. Install the separate API-PREVIEW build for cloud AI; this page does not bypass build restrictions.")}</p>}
    {connection?.byok_preview && <p>{t("API 试用版：使用你自己的服务商账号和密钥。没有 NightBrew 赠送额度或已付款订阅；服务商费用由你的账号承担。", "API preview uses your own provider account and key. No NightBrew-funded allowance or paid subscription is included; provider charges belong to your account.")}</p>}
    <fieldset disabled={busy || !models || !policy || !!connection?.local_only_preview}>
      <h3>{t("1. 选择 AI 服务商", "1. Choose your AI provider")}</h3>
      <button className="secondary" onClick={() => {
        if (models) { setModels({ ...models, cloud_model: "deepseek-chat", cloud_url: "https://api.deepseek.com/v1" }); setDirty(true); setChecked(false); setConsent(false); setConfirmed(false); setAllowCloud(false); setMessage(""); }
      }}>{t("使用 DeepSeek", "Use DeepSeek")}</button>
      <label>{t("模型名称", "Model name")}<input aria-label="AI connection model" value={models?.cloud_model || ""} onChange={(event) => modelField("cloud_model", event.target.value)} /></label>
      <details><summary>{t("其他 OpenAI 兼容服务 / 高级地址", "Other OpenAI-compatible providers / advanced URL")}</summary>
        <label>{t("API 服务地址", "API base URL")}<input aria-label="AI connection URL" type="url" value={models?.cloud_url || ""} onChange={(event) => modelField("cloud_url", event.target.value)} /></label>
        <p>{t("这里只支持 OpenAI 兼容的文字聊天接口，不代表支持所有服务商或图像功能。", "This path supports OpenAI-compatible text chat, not every provider or image capability.")}</p>
      </details>
      <h3>{t("2. 粘贴 API Key 并保存", "2. Paste and save your API key")}</h3>
      <p>{t("密钥只保存到这台电脑的 Windows 凭据管理器或 macOS 钥匙串，不放进聊天、浏览器存储或项目文件。Linux 开发环境须使用后端环境变量。", "Keys are stored in Windows Credential Manager or macOS Keychain, not in chat, browser storage or project files. Linux development requires a backend environment binding.")}</p>
      <label>{t("你的 API Key", "Your API key")}<input aria-label="AI API key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(event) => { setKey(event.target.value); setChecked(false); setConsent(false); setMessage(""); }} /></label>
      <button disabled={!key.trim() && !dirty} onClick={() => void run(async () => {
        if (!models) return;
        try {
          if (dirty) {
            await api("/settings/models", "PUT", models);
            setDirty(false); setConfirmed(false); setAllowCloud(false);
            setPolicy(await api<Policy>("/settings/ai"));
          }
          if (key.trim()) await api("/settings/cloud-key", "PUT", { key: key.trim() });
          setConnection(await api<Connection>("/settings/cloud-connection"));
          setChecked(false); setConsent(false);
          await onSaved();
          setMessage(t("已保存。下一步测试连接；还未发起 AI 聊天。", "Saved. Test the connection next; no AI chat has been sent."));
        } finally { setKey(""); }
      })}>{t("保存密钥与配置", "Save key and configuration")}</button>
      <p>{connection?.key_present ? t("已检测到密钥（不会显示内容），尚需测试当前服务商。", "Key detected (never displayed). Test the current provider next.") : t("尚未检测到保存的密钥。", "No saved key detected.")}</p>
      <button className="secondary" disabled={!connection?.key_present} onClick={() => void run(async () => {
        await api("/settings/cloud-key", "PUT", { key: "" }); setKey(""); setChecked(false); setConsent(false);
        const updated = await api<Connection>("/settings/cloud-connection"); setConnection(updated);
        setMessage(updated.key_present ? t("系统保管库密钥已移除，但后端环境仍绑定了密钥，请管理员检查。", "Vault key removed, but a backend environment key remains configured. Ask your administrator.") : t("已移除保存的密钥。", "Stored key removed."));
      })}>{t("移除保存的密钥", "Remove stored key")}</button>
      <h3>{t("3. 测试是否能连接", "3. Test the connection")}</h3>
      <label><input type="checkbox" aria-label="Allow AI connection test" checked={consent} onChange={(event) => setConsent(event.target.checked)} />{t("允许把密钥发送给上面已保存的服务地址，查询模型列表。此次测试不发送公司资料，也不生成回答。", "Allow sending the key to the saved provider URL to query its model list. This check sends no business content and generates no answer.")}</label>
      <button disabled={!consent || !connection?.key_present || dirty || !!key} onClick={() => void run(async () => {
        setChecked(false); setConsent(false);
        const result = await api<{ authenticated: boolean; model_available: boolean }>("/settings/cloud-connection/test", "POST", { consent: true });
        setChecked(result.authenticated && result.model_available);
        setMessage(result.model_available ? t("密钥连接测试通过，已找到配置的模型。尚未测试生成回答。请设置下方预算后开始聊天。", "Key connection passed and the configured model is listed. Answer generation remains untested. Set your budget below, then start chatting.") : t("服务商接受了密钥，但模型列表中没有这个名称。请核对模型名称。", "Provider accepted the key, but the configured model was not listed. Check the model name."));
      })}>{t("测试 AI 连接", "Test AI connection")}</button>
      <h3>{t("4. 设置费用保护，再聊天", "4. Set spending protection, then chat")}</h3>
      <p>{t("价格不会自动猜测。请按服务商当前官方价格填写 USD / 每百万 token；本机预算不是服务商账户余额，也不是购买额度。价格及真实余额尚未由应用核实。", "Prices are not guessed. Enter current official USD prices per million tokens. A local budget is not your provider balance or purchased credits. Prices and provider balance are unverified by the app.")}</p>
      {policy && ([
        ["input_usd_per_million", t("输入价格（USD / 百万 token）", "Input price (USD / million tokens)")],
        ["output_usd_per_million", t("输出价格（USD / 百万 token）", "Output price (USD / million tokens)")],
        ["monthly_limit_usd", t("本月最高 AI 预算（USD）", "Monthly AI budget cap (USD)")],
      ] as const).map(([field, label]) => <label key={field}>{label}<input aria-label={field} type="number" min="0" max="10000" step="any" value={policy[field]} onChange={(event) => { setPolicy({ ...policy, [field]: Number(event.target.value), cloud_allowed: false, pricing_confirmed: false }); setConfirmed(false); setAllowCloud(false); }} /></label>)}
      <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{t("我已核实当前服务商和模型价格", "I verified the current provider and model prices")}</label>
      <label><input type="checkbox" checked={allowCloud} onChange={(event) => setAllowCloud(event.target.checked)} />{t("允许使用自己的付费 API；每次聊天仍须同意发送内容", "Allow my paid API; each message still needs cloud data consent")}</label>
      <button disabled={!checked || !confirmed || !allowCloud || !policy || policy.input_usd_per_million <= 0 || policy.output_usd_per_million <= 0 || policy.monthly_limit_usd <= 0} onClick={() => void run(async () => {
        if (!policy) return;
        const value = await api<Policy>("/settings/ai", "PUT", { ...policy, billing_source: "BYOK", cloud_allowed: true, pricing_confirmed: true, credit_balance_usd: policy.monthly_limit_usd });
        setPolicy(value); await onSaved();
        setMessage(t("已保存费用保护，可以开始云端聊天。不会自动发送消息。", "Spending protection saved. Ready for cloud chat; no message is sent automatically."));
      })}>{t("保存费用保护", "Save spending protection")}</button>
      <button disabled={!checked || dirty || !!key || !policy?.cloud_allowed || !policy?.pricing_confirmed} onClick={onChat}>{t("开始 AI 聊天", "Start AI chat")}</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
