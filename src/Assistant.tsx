import { useState } from "react";
import type { FormEvent } from "react";
import { errorText, type API } from "./api";
type Message = { role: string; content: string };
export function Assistant({ api }: { api: API }) {
  const [message, setMessage] = useState(""),
    [mode, setMode] = useState("LOCAL_ONLY"),
    [consent, setConsent] = useState(false),
    [privacy, setPrivacy] = useState("standard"),
    [complexity, setComplexity] = useState("simple"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [history, setHistory] = useState<Message[]>([]),
    [estimate, setEstimate] = useState("");
  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api<{ answer: string; provider: string }>(
        "/chat",
        "POST",
        { message, mode, privacy, complexity, cloud_consent: consent },
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
    <>
      <div className="row">
        <label>
          AI mode
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setConsent(false);
            }}
          >
            <option>LOCAL_ONLY</option>
            <option>CLOUD_ONLY</option>
            <option>HYBRID</option>
          </select>
        </label>
        <label>
          Privacy
          <select value={privacy} onChange={(e) => setPrivacy(e.target.value)}>
            <option value="standard">Standard</option>
            <option value="private">Private · local only</option>
          </select>
        </label>
        <label>
          Task
          <select
            value={complexity}
            onChange={(e) => setComplexity(e.target.value)}
          >
            <option value="simple">Simple text</option>
            <option value="complex">Complex text</option>
          </select>
        </label>
      </div>
      {mode !== "LOCAL_ONLY" && privacy !== "private" && (
        <label>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />{" "}
          I consent to sending this message to the configured cloud provider if
          selected.
        </label>
      )}
      <button className="secondary" onClick={load}>
        Load saved history
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
        Estimate this message
      </button>
      {estimate && <p role="status">{estimate}</p>}
      <article aria-live="polite">
        {history.map((m, i) => (
          <div key={i}>
            <strong>{m.role}</strong>
            <p>{m.content}</p>
          </div>
        ))}
        {!history.length && (
          <p>
            Your next idea starts here. Local mode uses only your local Ollama
            service.
          </p>
        )}
      </article>
      {error && <p role="alert">{error}</p>}
      <form onSubmit={send}>
        <textarea
          aria-label="Message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What would you like to work on?"
          required
          maxLength={32000}
        />
        <button disabled={busy || !message.trim()}>
          {busy ? "Thinking…" : "Send message →"}
        </button>
      </form>
      <small>
        Cloud authorization resets after each request. AI replies are text,
        never executable commands.
      </small>
    </>
  );
}
