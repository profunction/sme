import { useEffect, useState } from "react";
import { errorText, type API } from "./api";
import { TaskReview } from "./TaskReview";
import { Icon } from "./Icon";
export function Billing({ api }: { api: API }) {
  const [status, setStatus] = useState<unknown>(),
    [result, setResult] = useState<unknown>(),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    api("/license")
      .then(setStatus)
      .catch((e) => setError(errorText(e)));
  }, [api]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      setResult(await fn());
      setStatus(await api("/license"));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const license = status as
    | { required: boolean; valid: boolean; device_id: string }
    | undefined;
  return (
    <>
      <p>
        Production entitlements come from a separate trusted backend and signed
        device grants. Development mode and mock billing are not proof of
        payment. Every plan can use ERP, POS, WMS, TMS and API connectors.
      </p>
      {error && <p role="alert">{error}</p>}
      <h2>授权与设备激活 / License & computer activation</h2>
      <div className="feature-guide">
        <Icon name="shield" />
        <div>
          <strong>
            {!license
              ? "正在检查授权…"
              : !license.required
                ? "开发模式（未验证付费）"
                : license.valid
                  ? "设备授权有效"
                  : "这台设备需要激活"}
          </strong>
          <p>
            正式安装包需要企业管理员提供的账号密钥和已配置的授权服务。演示数据与开发模式不代表已购买订阅。
          </p>
        </div>
      </div>
      <details>
        <summary>查看授权诊断信息</summary>
        <pre>{JSON.stringify(status, null, 2)}</pre>
      </details>
      <label>
        Account key (system credential vault)
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      <button
        disabled={busy || !key}
        onClick={() =>
          action(async () => {
            try {
              return await api("/license/account-key", "PUT", { key });
            } finally {
              setKey("");
            }
          })
        }
      >
        Store account key
      </button>
      <button
        disabled={busy}
        onClick={() => action(() => api("/license/activate", "POST"))}
      >
        Activate / refresh this computer
      </button>
      <button
        disabled={busy}
        onClick={() => action(() => api("/billing/account"))}
      >
        Account & credit balance
      </button>
      <button
        disabled={busy}
        onClick={() => action(() => api("/billing/catalog"))}
      >
        Trusted plan catalog
      </button>
      <h2>Subscriptions & additional services</h2>
      <p>
        Checkout creates a payment session only. Open the returned provider URL
        yourself to review and pay. Existing subscriptions must be changed in
        the billing portal to avoid duplicate subscriptions.
      </p>
      {[
        "Starter",
        "Business",
        "Enterprise",
        "credits",
        "computer",
        "setup",
        "custom_connector",
      ].map((sku) => (
        <button
          key={sku}
          disabled={busy}
          onClick={() =>
            action(() => api("/billing/checkout", "POST", { sku }))
          }
        >
          {sku}
        </button>
      ))}
      <button
        disabled={busy}
        onClick={() => action(() => api("/billing/portal", "POST"))}
      >
        Manage subscription
      </button>
      <h2>Application updates</h2>
      <p>
        Windows production updates require HTTPS metadata and a matching signed
        Windows publisher. Save work before installing.
      </p>
      <button
        disabled={!window.nightbrew || busy}
        onClick={() => action(() => window.nightbrew!.checkForUpdates())}
      >
        Check & download signed update
      </button>
      <button
        disabled={!window.nightbrew || busy}
        onClick={() => action(() => window.nightbrew!.installUpdate())}
      >
        Install downloaded update
      </button>
      <h2>Connector marketplace foundation</h2>
      <p>
        Built-in adapters and explicit custom development quotes; no downloaded
        plugin code is executed.
      </p>
      <button disabled={busy} onClick={() => action(() => api("/marketplace"))}>
        Browse supported adapters
      </button>
      {result !== undefined && (
        <pre role="status">{JSON.stringify(result, null, 2)}</pre>
      )}
    </>
  );
}
