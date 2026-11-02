import { useState, useEffect, useRef } from "react";
import type { FormEvent } from "react";
import { APIError, errorText, type API } from "./api";
import { Icon } from "./Icon";
import { Automation } from "./Automation";
import { useLanguage } from "./i18n";
type Message = { role: string; content: string };
type Intent = "ask" | "reply" | "fill";
export function Assistant({ api, initialDraft, onGuide, onDraftLoaded, onSettings, initialEmployeeId, initialMode, onModeChange }: {
  api: API;
  initialDraft?: { text: string; revision: number };
  onGuide?: () => void;
  onDraftLoaded?: () => void;
  onSettings?: () => void;
  initialEmployeeId?: string;
  initialMode?: string;
  onModeChange?: (mode: string) => void;
}) {
  const { language, t } = useLanguage();
  const [intent, setIntent] = useState<Intent>("ask");
  const [message, setMessage] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [fillSource, setFillSource] = useState("");
  const [mode, setMode] = useState(initialMode || "LOCAL_ONLY");
  const [consent, setConsent] = useState(false);
  const [privacy, setPrivacy] = useState("standard");
  const [complexity, setComplexity] = useState("simple");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [history, setHistory] = useState<Message[]>([]);
  const [estimate, setEstimate] = useState("");
  const [localPreview, setLocalPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [connection, setConnection] = useState<{ key_present: boolean; local_only_preview: boolean; models: { local_model: string; cloud_model: string; cloud_url: string } }>();
  const [modeReady, setModeReady] = useState(false);
  const modeTouched = useRef(false);
  useEffect(() => {
    let active = true;
    Promise.all([api<NonNullable<typeof connection>>("/settings/cloud-connection"), api<{ cloud_allowed: boolean; pricing_confirmed: boolean; billing_source: string }>("/settings/ai")])
      .then(([info, policy]) => {
        if (!active) return;
        setConnection(info); setLocalPreview(info.local_only_preview);
        // A saved key alone is not cloud authorization. Only use an explicitly
        // enabled cloud policy, and still require consent on every message.
        if (!initialMode && !modeTouched.current && !info.local_only_preview && policy.cloud_allowed &&
            (policy.billing_source === "INCLUDED" || (policy.pricing_confirmed && info.key_present))) setMode("CLOUD_ONLY");
      })
      .catch(() => { /* Keep the explicit/default mode; settings remain user-accessible. */ })
      .finally(() => { if (active) setModeReady(true); });
    return () => { active = false; };
  }, [api]);
  function chooseMode(value: string) {
    modeTouched.current = true; setMode(value); onModeChange?.(value);
    setConsent(false); setEstimate(""); setError(null);
  }
  const sourceName = mode === "LOCAL_ONLY" ? t("本地 Ollama", "Local Ollama") : mode === "HYBRID" ? t("混合 AI", "Hybrid AI") : t("云端 API", "Cloud API");
  const modelName = mode === "LOCAL_ONLY" ? connection?.models.local_model : mode === "CLOUD_ONLY" ? connection?.models.cloud_model : undefined;

  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  useEffect(() => { if (initialEmployeeId) setEmployeeId(initialEmployeeId); }, [initialEmployeeId]);
  useEffect(() => {
    api<{ claims?: { environment?: string } }>("/license")
      .then((value) => setLocalPreview(value.claims?.environment === "local_preview"))
      .catch(() => {});
    api<{ id: string; name: string; tools: string[]; active: boolean }[]>("/employees")
      .then((list) => setEmployees(list.filter((employee) => employee.active && employee.tools.includes("ai.chat"))))
      .catch(() => {});
  }, [api]);
  useEffect(() => {
    if (initialDraft?.text) { setMessage(initialDraft.text); onDraftLoaded?.(); }
  }, [initialDraft?.revision]);
  function payload() { return { message, response_language: language, intent: intent === "reply" ? "reply" : "ask", mode, privacy, complexity,
    cloud_consent: consent, employee_id: employeeId || null }; }
  async function send(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setCopied(false);
    try {
      const data = await api<{ answer: string; provider: string }>("/chat", "POST", payload());
      setHistory((current) => [...current, { role: "user", content: message },
        { role: `NightBrew · ${data.provider}`, content: data.answer }]);
      if (intent === "reply") setReplyDraft(data.answer);
      setMessage("");
    } catch (failure) { setError(failure); }
    finally { setBusy(false); setConsent(false); }
  }
  async function load() {
    try { setHistory(await api<Message[]>("/messages")); setError(null); }
    catch (failure) { setError(failure); }
  }
  function fillThis(text: string) { setFillSource(text); setIntent("fill"); }
  return <div className="assistant-layout">
    <div className="chat-intro">
      <div className="assistant-avatar"><Icon name="sparkle" size={27} /></div>
      <div><h2>{t("告诉我，你想做什么？", "What would you like me to do?")}</h2>
        <p>{t("先说目标；涉及填写时，先看内容，再由你确认。", "Tell me the goal. Review any field changes before you approve them.")}</p></div>
      <button className="secondary" onClick={onGuide}>{t("看例子", "Examples")}</button>
    </div>
    {employeeId && <p role="status">{t("正在与这位员工聊天", "Chatting with this employee")}: <strong>{employees.find((employee) => employee.id === employeeId)?.name || t("正在读取…", "Loading…")}</strong></p>}
    <div className="filter-tabs" role="tablist" aria-label={t("你想做什么", "Choose a task")}>
      {([['ask', '问问题', 'Ask a question'], ['reply', '帮我写回复', 'Draft a reply'], ['fill', '帮我填写', 'Fill for me']] as const).map(([value, zh, en]) =>
        <button type="button" role="tab" key={value} aria-selected={intent === value}
          className={intent === value ? "selected" : ""} onClick={() => setIntent(value)}>{t(zh, en)}</button>)}
    </div>
    {intent === "fill" ? <>
      <p>{t("先选择你允许读取的网站或软件。助理会列出可填写的字段，你核对内容并批准后才会执行；不会主动点击发送。", "Choose a website or app you permit us to inspect. Review the fields and values before approving the fill. Sending is not automatic.")}</p>
      <Automation api={api} initialSource={fillSource} employeeId={employeeId} />
    </> : <>
      {localPreview && <div className="notice"><Icon name="shield" /><div>
        <strong>{t("本地 AI 模式", "Local AI mode")}</strong>
        <p>{t("聊天使用这台电脑上的 Ollama；请先选择已安装的模型。", "Chat uses Ollama on this computer. Select an installed model first.")}</p>
        {onSettings && <button type="button" className="text-button" onClick={onSettings}>{t("检查 AI 连接", "Check AI connection")}</button>}
      </div></div>}
      <div className="panel" aria-label={t("当前 AI 连接", "Current AI connection")}>
        <div className="row">
          <label>{t("处理方式", "Processing mode")}<select aria-label={t("处理方式", "Processing mode")} value={mode} disabled={busy} onChange={(event) => chooseMode(event.target.value)}>
            <option value="LOCAL_ONLY">{t("本地 AI · 留在电脑", "Local AI · on this computer")}</option>
            <option disabled={localPreview} value="CLOUD_ONLY">{t("云端 AI · 使用 API Key", "Cloud AI · use API key")}</option>
            <option disabled={localPreview} value="HYBRID">{t("混合 AI · 按策略选择", "Hybrid AI · policy controlled")}</option>
          </select></label>
          <p role="status">{t("当前使用", "Using")}: <strong>{sourceName}</strong>{modelName ? ` · ${modelName}` : ""}</p>
          <button className="secondary" onClick={onSettings}>{t("检查 API Key 与 AI 设置", "Check API key and AI settings")}</button>
        </div>
        {connection?.key_present && mode === "LOCAL_ONLY" && <p>{t("已保存 API Key，但当前选择的是本地 Ollama。要使用 Key，请选择云端 AI，并确认云端许可与预算已配置。", "An API key is saved, but Local Ollama is selected. Select Cloud AI to use the key and check cloud permission and budget settings.")}</p>}
        {!modeReady && <p role="status">{t("正在读取 AI 配置…", "Loading AI configuration…")}</p>}
      </div>
      <details className="chat-controls">
        <summary>{t("AI 与隐私选项", "AI & privacy options")}</summary>
        <label>{t("选择助理", "Assistant")}<select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
          <option value="">{t("业务助理", "Business assistant")}</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
        <div className="row">
          <label>{t("资料隐私", "Data privacy")}<select value={privacy} onChange={(event) => setPrivacy(event.target.value)}>
            <option value="standard">{t("一般资料", "Standard data")}</option><option value="private">{t("私密资料 · 仅本地", "Private data · local only")}</option>
          </select></label>
          <label>{t("内容复杂度", "Task complexity")}<select value={complexity} onChange={(event) => setComplexity(event.target.value)}>
            <option value="simple">{t("一般文字", "Simple text")}</option><option value="complex">{t("复杂文字", "Complex text")}</option>
          </select></label>
        </div>
        <button className="secondary" onClick={load}>{t("加载聊天记录", "Load chat history")}</button>
        <button className="secondary" disabled={!message.trim() || busy} onClick={async () => {
          try {
            const value = await api<{ provider: string; estimated_max_cost_usd: number }>("/ai/estimate", "POST", payload());
            setEstimate(`${value.provider} · ${t("预计预留 USD", "estimated reservation USD")} ${value.estimated_max_cost_usd.toFixed(6)}`); setError(null);
          } catch (failure) { setError(failure); }
        }}>{t("先估算本次用量", "Estimate this request")}</button>
        {estimate && <p role="status">{estimate}</p>}
      </details>
      {mode !== "LOCAL_ONLY" && privacy !== "private" && <label>
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />{' '}
        {t("我同意将这一次消息发送给已配置的云端 AI；私密资料不会发送。", "I consent to sending this message to the configured cloud AI. Private data will not be sent.")}
      </label>}
      <article className="conversation" aria-label={t("聊天记录", "Conversation")} aria-live="polite">
        {history.map((entry, index) => <div className={`chat-bubble ${entry.role === "user" ? "user-message" : "assistant-message"}`} key={index}>
          <strong>{entry.role === "user" ? t("你", "You") : t("NightBrew 助理", "NightBrew assistant")}</strong>
          <p>{entry.content}</p>
          {entry.role !== "user" && <div className="row"><button className="text-button" onClick={() => { setReplyDraft(entry.content); setIntent("reply"); }}>{t("编辑这段回复", "Edit this reply")}</button>
            <button className="text-button" onClick={() => fillThis(entry.content)}>{t("用这段内容帮我填写", "Fill using this text")}</button></div>}
        </div>)}
        {!history.length && <div className="chat-empty"><Icon name="sparkle" size={34} />
          <h3>{intent === "reply" ? t("粘贴对方的话，再说你想怎样回复。", "Paste their message and tell me how you want to reply.") : t("直接说就好，不需要写提示词。", "Just tell me. No prompt template required.")}</h3>
          <p>{intent === "reply" ? t("例如：客户问什么时候交货。已确认星期五出货，帮我友好地回复。", "For example: The customer asks about delivery. Dispatch is confirmed for Friday; draft a friendly reply.") : t("例如：帮我整理这段资料，或者解释这份采购单应该检查什么。", "For example: Organize these notes, or explain what to check in a purchase order.")}</p>
          <small>{t("回答和草稿不会自动发送或修改电脑；填写操作会单独列出内容供你批准。", "Answers and drafts do not send messages or change your computer. Field changes are reviewed separately before approval.")}</small>
        </div>}
      </article>
      {error !== null && <div role="alert">
        <p>{errorText(error, language)}</p>
        {error instanceof APIError && <p>{t("本次请求使用", "This request used")}: {error.mode === "LOCAL_ONLY" ? t("本地 Ollama", "Local Ollama") : t("云端 API", "Cloud API")} · {error.model}{error.providerStatus ? ` · HTTP ${error.providerStatus}` : ""}</p>}
        <button type="button" className="secondary" onClick={onSettings}>{t("去检查 AI 连接", "Check AI connection")}</button>
      </div>}
      <form className="chat-composer" onSubmit={send}>
        <textarea aria-label="Message" value={message} onChange={(event) => setMessage(event.target.value)}
          placeholder={intent === "reply" ? t("粘贴客户消息，补充已确认的事实和期望语气…", "Paste the customer's message, confirmed facts and preferred tone…") : t("你想让我帮什么？", "What can I help you with?")} required maxLength={30000} />
        <button disabled={busy || !modeReady || !message.trim()}>{busy ? t("正在准备回复…", "Preparing a reply…") : intent === "reply" ? t("帮我起草 →", "Draft my reply →") : t("发送给助理 →", "Ask assistant →")}</button>
      </form>
      {intent === "reply" && replyDraft && <section className="panel" aria-label={t("可编辑回复草稿", "Editable reply draft")}>
        <h3>{t("看看这段回复，满意后再用。", "Review and edit this reply before using it.")}</h3>
        <textarea aria-label={t("回复草稿", "Reply draft")} rows={8} value={replyDraft} onChange={(event) => { setReplyDraft(event.target.value); setCopied(false); }} />
        <div className="row"><button className="secondary" onClick={async () => {
          try { await navigator.clipboard.writeText(replyDraft); setCopied(true); }
          catch { setError(new Error(t("无法访问剪贴板，请选中文字复制。", "Clipboard unavailable. Select and copy the text manually."))); }
        }}>{copied ? t("已复制", "Copied") : t("复制回复", "Copy reply")}</button>
        <button onClick={() => fillThis(replyDraft)}>{t("下一步：帮我填写", "Next: fill for me")}</button></div>
        <small>{t("只会准备填写内容，不会直接发送、下单或付款。", "This prepares field values; it does not automatically send, order or pay.")}</small>
      </section>}
      <small>{t("切换中文 / English 不会发送消息或清空草稿；下一次回复会按当前语言生成。", "Switching 中文 / English does not send messages or clear drafts. The next reply uses the selected language.")}</small>
    </>}
  </div>;
}
