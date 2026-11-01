import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { errorText, type API } from "./api";
import { Icon } from "./Icon";
type Message = { role: string; content: string };
export function Assistant({
  api,
  initialDraft,
  onGuide,
  onDraftLoaded,
}: {
  api: API;
  initialDraft?: { text: string; revision: number };
  onGuide?: () => void;
  onDraftLoaded?: () => void;
}) {
  const [message, setMessage] = useState(""),
    [mode, setMode] = useState("LOCAL_ONLY"),
    [consent, setConsent] = useState(false),
    [privacy, setPrivacy] = useState("standard"),
    [complexity, setComplexity] = useState("simple"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [history, setHistory] = useState<Message[]>([]),
    [estimate, setEstimate] = useState("");
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>(
      [],
    ),
    [employeeId, setEmployeeId] = useState("");
  useEffect(() => {
    api<{ id: string; name: string; tools: string[]; active: boolean }[]>(
      "/employees",
    )
      .then((list) =>
        setEmployees(
          list.filter((e) => e.active && e.tools.includes("ai.chat")),
        ),
      )
      .catch(() => {});
  }, [api]);
  useEffect(() => {
    if (initialDraft?.text) {
      setMessage(initialDraft.text);
      onDraftLoaded?.();
    }
  }, [initialDraft?.revision]);
  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api<{ answer: string; provider: string }>(
        "/chat",
        "POST",
        {
          message,
          mode,
          privacy,
          complexity,
          cloud_consent: consent,
          employee_id: employeeId || null,
        },
      );
      setHistory([
        ...history,
        { role: "user", content: message },
        { role: `NightBrew · ${data.provider}`, content: data.answer },
      ]);
      setMessage("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      setConsent(false);
    }
  }
  async function load() {
    try {
      setHistory(await api<Message[]>("/messages"));
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <div className="assistant-layout">
      <div className="chat-intro">
        <div className="assistant-avatar">
          <Icon name="sparkle" size={27} />
        </div>
        <div>
          <h2>你的业务助理，随时待命</h2>
          <p>告诉我背景和目标，我会帮你准备可审核的文本草稿。</p>
        </div>
        <button className="secondary" onClick={onGuide}>
          选择提示词模板
        </button>
      </div>
      <div className="chat-controls">
        <label>
          选择助理
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">业务助理</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <label>
            处理方式
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value);
                setConsent(false);
              }}
            >
              <option value="LOCAL_ONLY">本地 AI · 留在电脑</option>
              <option value="CLOUD_ONLY">云端 AI · 需要同意</option>
              <option value="HYBRID">混合 AI · 按策略选择</option>
            </select>
          </label>
          <label>
            资料隐私
            <select
              value={privacy}
              onChange={(e) => setPrivacy(e.target.value)}
            >
              <option value="standard">一般资料</option>
              <option value="private">私密资料 · 仅本地</option>
            </select>
          </label>
          <label>
            内容复杂度
            <select
              value={complexity}
              onChange={(e) => setComplexity(e.target.value)}
            >
              <option value="simple">一般文字</option>
              <option value="complex">复杂文字</option>
            </select>
          </label>
        </div>
      </div>
      {mode !== "LOCAL_ONLY" && privacy !== "private" && (
        <label>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />{" "}
          我同意将这一次消息发送给已配置的云端 AI 服务。私密资料不会发送到云端。
        </label>
      )}
      <button className="secondary" onClick={load}>
        加载聊天记录
      </button>
      <button
        className="secondary"
        disabled={!message.trim() || busy}
        onClick={async () => {
          try {
            const value = await api<{
              provider: string;
              estimated_max_cost_usd: number;
            }>("/ai/estimate", "POST", {
              employee_id: employeeId || null,
              message,
              mode,
              privacy,
              complexity,
              cloud_consent: consent,
            });
            setEstimate(
              `${value.provider} · estimated reservation USD ${value.estimated_max_cost_usd.toFixed(6)}`,
            );
            setError("");
          } catch (e) {
            setError(errorText(e));
          }
        }}
      >
        先估算本次用量
      </button>
      {estimate && <p role="status">{estimate}</p>}
      <article
        className="conversation"
        aria-label="聊天记录"
        aria-live="polite"
      >
        {history.map((m, i) => (
          <div
            className={`chat-bubble ${m.role === "user" ? "user-message" : "assistant-message"}`}
            key={i}
          >
            <strong>{m.role === "user" ? "你" : "NightBrew 助理"}</strong>
            <p>{m.content}</p>
          </div>
        ))}
        {!history.length && (
          <div className="chat-empty">
            <Icon name="sparkle" size={34} />
            <h3>你想先完成哪件事？</h3>
            <p>
              例如：“帮我起草跟进客户的邮件，语气友好，不要承诺折扣。”
              <br />
              不确定怎么写？从提示词模板开始。
            </p>
            <small>
              聊天不会自动读取本地文件、生成下载文件或操作电脑。真实文档请到“文档与
              Excel”处理。
            </small>
          </div>
        )}
      </article>
      {error && <p role="alert">{error}</p>}
      <form className="chat-composer" onSubmit={send}>
        <textarea
          aria-label="Message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="描述你要完成的工作，附上已确认的背景资料…"
          required
          maxLength={32000}
        />
        <button disabled={busy || !message.trim()}>
          {busy ? "正在准备回复…" : "发送给助理 →"}
        </button>
      </form>
      <small>
        云端许可每次使用后重置。AI
        回复仅为文本，请核对价格、日期和政策后再使用。
      </small>
    </div>
  );
}
