import { useEffect, useState } from "react";
import { errorText, type API } from "./api";
import { ModelSetup } from "./ModelSetup";
import { TaskReview } from "./TaskReview";
type Policy = {
  billing_source: "BYOK" | "INCLUDED";
  cloud_allowed: boolean;
  monthly_limit_usd: number;
  credit_balance_usd: number;
  input_usd_per_million: number;
  output_usd_per_million: number;
  pricing_confirmed: boolean;
  local_complex_capable: boolean;
  max_output_tokens: number;
};
const initial: Policy = {
  billing_source: "BYOK",
  cloud_allowed: false,
  monthly_limit_usd: 5,
  credit_balance_usd: 0,
  input_usd_per_million: 0,
  output_usd_per_million: 0,
  pricing_confirmed: false,
  local_complex_capable: false,
  max_output_tokens: 512,
};
export function Settings({ api }: { api: API }) {
  const [policy, setPolicy] = useState<Policy>(initial),
    [loaded, setLoaded] = useState(false),
    [info, setInfo] = useState<unknown>(),
    [status, setStatus] = useState(""),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false);
  async function reloadPolicy() {
    setPolicy(await api<Policy>("/settings/ai"));
    setLoaded(true);
  }
  useEffect(() => {
    void reloadPolicy().catch((e) => setStatus(errorText(e)));
  }, [api]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      const value = await fn();
      setInfo(value);
      setStatus("Done");
    } catch (e) {
      setStatus(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ModelSetup api={api} onSaved={reloadPolicy} />
      <h2>隐私与 AI 预算 / Privacy & AI budget</h2>
      <label>
        Cloud funding
        <select
          value={policy.billing_source}
          onChange={(e) =>
            setPolicy({
              ...policy,
              billing_source: e.target.value as "BYOK" | "INCLUDED",
            })
          }
        >
          <option value="BYOK">My own API key (BYOK)</option>
          <option value="INCLUDED">Trusted gateway / included credits</option>
        </select>
      </label>
      <p>
        Local development allowances in USD; these balances are not proof of
        payment. Configure the provider model and endpoint in the form above.
      </p>
      <button
        disabled={busy}
        onClick={() =>
          action(async () => {
            const p = await api<Policy>("/settings/ai");
            setPolicy(p);
            setLoaded(true);
            return p;
          })
        }
      >
        Load settings
      </button>
      <fieldset disabled={!loaded || busy}>
        <label>
          <input
            type="checkbox"
            checked={policy.cloud_allowed}
            onChange={(e) =>
              setPolicy({ ...policy, cloud_allowed: e.target.checked })
            }
          />{" "}
          Permit cloud inference (individual messages still need consent)
        </label>
        {(
          [
            "monthly_limit_usd",
            "credit_balance_usd",
            "input_usd_per_million",
            "output_usd_per_million",
            "max_output_tokens",
          ] as const
        ).map((name) => (
          <label key={name}>
            {name.replaceAll("_", " ")}
            <input
              type="number"
              min="0"
              step="any"
              value={policy[name]}
              onChange={(e) =>
                setPolicy({ ...policy, [name]: Number(e.target.value) })
              }
            />
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={policy.pricing_confirmed}
            onChange={(e) =>
              setPolicy({ ...policy, pricing_confirmed: e.target.checked })
            }
          />{" "}
          I verified the configured provider/model pricing
        </label>
        <label>
          <input
            type="checkbox"
            checked={policy.local_complex_capable}
            onChange={(e) =>
              setPolicy({ ...policy, local_complex_capable: e.target.checked })
            }
          />{" "}
          My benchmarked local model supports complex text tasks
        </label>
        <button
          onClick={() => action(() => api("/settings/ai", "PUT", policy))}
        >
          Save privacy & budget
        </button>
      </fieldset>
      <h2>Bring your own key</h2>
      <p>
        Keys use Windows Credential Manager or macOS Keychain. On Linux cloud,
        use the backend environment binding.
      </p>
      <input
        aria-label="Cloud API key"
        type="password"
        autoComplete="off"
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <button
        disabled={busy || !key}
        onClick={() =>
          action(async () => {
            try {
              return await api("/settings/cloud-key", "PUT", { key });
            } finally {
              setKey("");
            }
          })
        }
      >
        Store in system credential vault
      </button>
      <button
        disabled={busy}
        onClick={() =>
          action(() => api("/settings/cloud-key", "PUT", { key: "" }))
        }
      >
        Remove stored key
      </button>
      <h2>Hardware & measured readiness</h2>
      <button disabled={busy} onClick={() => action(() => api("/hardware"))}>
        Inspect hardware
      </button>
      <button
        disabled={busy}
        onClick={() => action(() => api("/hardware/benchmark", "POST"))}
      >
        Benchmark local model
      </button>
      <button disabled={busy} onClick={() => action(() => api("/usage"))}>
        Usage ledger
      </button>
      <p role="status">{status}</p>
      {info !== undefined && (
        <div className="panel">
          <h3>检查结果</h3>
          <TaskReview value={info} />
          <details>
            <summary>进阶诊断数据</summary>
            <pre>{JSON.stringify(info, null, 2)}</pre>
          </details>
        </div>
      )}
    </>
  );
}
