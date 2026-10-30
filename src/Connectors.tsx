import { useEffect, useState } from "react";
import { errorText, type API } from "./api";
type Config = {
  id: string;
  name: string;
  category: string;
  kind: string;
  read_enabled: boolean;
  write_enabled: boolean;
  base_url: string;
  read_path: string;
  write_path: string;
  write_method: string;
  auth_env: string;
  requests_per_minute: number;
  read_retries: number;
};
const blank: Config = {
  id: "my-api",
  name: "My REST API",
  category: "API",
  kind: "rest",
  read_enabled: true,
  write_enabled: false,
  base_url: "",
  read_path: "/records",
  write_path: "/records",
  write_method: "POST",
  auth_env: "",
  requests_per_minute: 30,
  read_retries: 1,
};
export function Connectors({ api }: { api: API }) {
  const [configs, setConfigs] = useState<Config[]>([]),
    [selected, setSelected] = useState<Config | null>(null),
    [record, setRecord] = useState('{"id":"demo-item","quantity":5}'),
    [result, setResult] = useState<unknown>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setConfigs(await api<Config[]>("/connectors"));
  }
  useEffect(() => {
    let active = true;
    api<Config[]>("/connectors")
      .then((c) => {
        if (active) setConfigs(c);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [api]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      setResult(await fn());
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function field<K extends keyof Config>(key: K, value: Config[K]) {
    if (selected) setSelected({ ...selected, [key]: value });
  }
  return (
    <>
      <p>
        ERP, POS, WMS, TMS and API connectors are available to every plan. Mock
        connectors contain demonstration data only. No real vendor is certified.
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        onClick={() => {
          setSelected({ ...blank });
          setResult(undefined);
        }}
      >
        Add REST connector
      </button>
      <ul className="cards">
        {configs.map((config) => (
          <li key={config.id}>
            <h3>{config.name}</h3>
            <span className="badge">
              {config.category} ·{" "}
              {config.kind === "mock"
                ? "MOCK · development only"
                : "REST · vendor unverified"}
            </span>
            <p>
              Read: {config.read_enabled ? "allowed" : "denied"} · Write:{" "}
              {config.write_enabled ? "approval required" : "denied"}
            </p>
            <button
              className="secondary"
              onClick={() => {
                setSelected(config);
                setResult(undefined);
              }}
            >
              Configure
            </button>
            <button
              disabled={busy}
              onClick={() =>
                action(() => api(`/connectors/${config.id}/test`, "POST"))
              }
            >
              Test connection
            </button>
            <button
              disabled={busy || !config.read_enabled}
              onClick={() =>
                action(() => api(`/connectors/${config.id}/records`))
              }
            >
              Read records
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <>
          <h2>Configure {selected.name}</h2>
          <fieldset disabled={busy}>
            <div className="row">
              <label>
                Connector ID
                <input
                  required
                  value={selected.id}
                  onChange={(e) => field("id", e.target.value)}
                />
              </label>
              <label>
                Name
                <input
                  value={selected.name}
                  onChange={(e) => field("name", e.target.value)}
                />
              </label>
              <label>
                Category
                <select
                  value={selected.category}
                  onChange={(e) => field("category", e.target.value)}
                >
                  {["ERP", "POS", "WMS", "TMS", "API"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              <input
                type="checkbox"
                checked={selected.read_enabled}
                onChange={(e) => field("read_enabled", e.target.checked)}
              />{" "}
              Allow reads
            </label>
            <label>
              <input
                type="checkbox"
                checked={selected.write_enabled}
                onChange={(e) => field("write_enabled", e.target.checked)}
              />{" "}
              Allow writes after exact-task approval
            </label>
            {selected.kind === "rest" && (
              <>
                <p>
                  The backend operator must first allow the trusted public
                  destination in NIGHTBREW_CONNECTOR_ALLOWED_HOSTS. Enter a
                  credential variable name, never a token. Responses are
                  untrusted data.
                </p>
                <label>
                  HTTPS base URL
                  <input
                    value={selected.base_url}
                    onChange={(e) => field("base_url", e.target.value)}
                  />
                </label>
                <label>
                  Read path
                  <input
                    value={selected.read_path}
                    onChange={(e) => field("read_path", e.target.value)}
                  />
                </label>
                <label>
                  Write path
                  <input
                    value={selected.write_path}
                    onChange={(e) => field("write_path", e.target.value)}
                  />
                </label>
                <label>
                  Write method
                  <select
                    value={selected.write_method}
                    onChange={(e) => field("write_method", e.target.value)}
                  >
                    {["POST", "PUT", "PATCH", "DELETE"].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Credential environment reference (optional)
                  <input
                    value={selected.auth_env}
                    placeholder="NIGHTBREW_CONNECTOR_VENDOR_KEY"
                    onChange={(e) => field("auth_env", e.target.value)}
                  />
                </label>
              </>
            )}
            <label>
              Requests per minute
              <input
                type="number"
                min={1}
                max={120}
                value={selected.requests_per_minute}
                onChange={(e) =>
                  field("requests_per_minute", Number(e.target.value))
                }
              />
            </label>
            <label>
              Read retries (writes are never retried)
              <input
                type="number"
                min={0}
                max={2}
                value={selected.read_retries}
                onChange={(e) => field("read_retries", Number(e.target.value))}
              />
            </label>
            <button
              onClick={() => action(() => api("/connectors", "PUT", selected))}
            >
              Save connector
            </button>
          </fieldset>
          <h2>Request a record write</h2>
          <p>
            Save permissions first. The exact destination, configuration and
            record will be attached to an approval in Business tools. Changing
            the connector invalidates pending writes.
          </p>
          <label>
            Record JSON
            <textarea
              aria-label="Record JSON"
              value={record}
              maxLength={32000}
              onChange={(e) => setRecord(e.target.value)}
            />
          </label>
          <button
            disabled={busy || !selected.write_enabled}
            onClick={() =>
              action(() =>
                api(`/connectors/${selected.id}/writes`, "POST", {
                  record: JSON.parse(record),
                }),
              )
            }
          >
            Request write approval
          </button>
        </>
      )}
      {result !== undefined && (
        <>
          <h2>Result</h2>
          <pre aria-live="polite">{JSON.stringify(result, null, 2)}</pre>
        </>
      )}
    </>
  );
}
