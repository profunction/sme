import { useEffect, useRef, useState } from "react";
import { errorText, type API } from "./api";
import { useLanguage } from "./i18n";
import { AssignedTask } from "./AssignedTask";
import type { Page } from "./workspace";

type Config = {
  id: string; name: string; category: string; kind: string;
  read_enabled: boolean; write_enabled: boolean;
  base_url: string; read_path: string; write_path: string; write_method: string;
  auth_env: string; requests_per_minute: number; read_retries: number;
};
const blank: Config = {
  id: "my-api", name: "", category: "API", kind: "rest",
  read_enabled: true, write_enabled: false, base_url: "",
  read_path: "/records", write_path: "/records", write_method: "POST",
  auth_env: "", requests_per_minute: 30, read_retries: 1,
};

export function Connectors({ api, token, go }: { api: API; token?: string; go?: (page: Page) => void }) {
  const { t } = useLanguage();
  const [configs, setConfigs] = useState<Config[]>([]);
  const [selected, setSelected] = useState<Config | null>(null);
  const [saved, setSaved] = useState(false);
  const [editingExisting, setEditingExisting] = useState(false);
  const [showDemos, setShowDemos] = useState(false);
  const [record, setRecord] = useState('{"id":"demo-item","quantity":5}');
  const [result, setResult] = useState<unknown>();
  const [notice, setNotice] = useState("");
  const [taskId, setTaskId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    api<Config[]>("/connectors").then((items) => { if (active) setConfigs(items); })
      .catch((failure) => { if (active) setError(errorText(failure)); });
    return () => { active = false; };
  }, [api]);
  function edit(config: Config, exists: boolean) {
    setSelected({ ...config }); setSaved(exists); setEditingExisting(exists); setResult(undefined); setNotice(""); setTaskId(""); setError("");
    setTimeout(() => editor.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
  }
  function field<K extends keyof Config>(key: K, value: Config[K]) {
    if (selected) setSelected({ ...selected, [key]: value });
    setSaved(false); setResult(undefined); setNotice(""); setTaskId(""); setError("");
  }
  async function action(fn: () => Promise<unknown>, message: string, after?: (value: unknown) => void) {
    if (busy) return;
    setBusy(true); setError(""); setResult(undefined); setNotice(""); setTaskId("");
    try {
      const value = await fn(); setResult(value); setNotice(message); after?.(value);
      setConfigs(await api<Config[]>("/connectors"));
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  const real = configs.filter((config) => config.kind !== "mock");
  function cards(items: Config[]) {
    return <ul className="cards">{items.map((config) => <li key={config.id}>
      <h3>{config.name}</h3>
      <span className="badge">{config.category} · {config.kind === "mock" ? t("演示数据，未连接你的系统", "Demo data — not your system") : t("自定义 API，厂商兼容性未验证", "Custom API — vendor compatibility unverified")}</span>
      <p>{t("读取", "Read")}: {config.read_enabled ? t("允许", "allowed") : t("关闭", "disabled")} · {t("写入", "Write")}: {config.write_enabled ? t("须逐项审批", "exact-task approval required") : t("关闭", "disabled")}</p>
      <button className="secondary" disabled={busy} onClick={() => edit(config, true)}>{t("配置", "Configure")}</button>
      <button disabled={busy || !config.read_enabled} onClick={() => {
        edit(config, true);
        void action(() => api(`/connectors/${config.id}/test`, "POST"), config.kind === "mock"
          ? t("演示测试通过。尚未连接任何真实公司系统。", "Demo test passed. No real business system is connected.")
          : t("读取接口测试通过，仅验证此接口，不代表整个系统兼容或写入可用。", "Read endpoint test passed. Full system compatibility and writes remain unverified."));
      }}>{t("测试连接", "Test connection")}</button>
      <button disabled={busy || !config.read_enabled} onClick={() => {
        edit(config, true);
        void action(() => api(`/connectors/${config.id}/records`), config.kind === "mock" ? t("以下是演示数据。", "Demo records shown below.") : t("已读取指定接口的数据，请核对内容。", "Read endpoint returned data. Review it below."));
      }}>{t("读取资料", "Read records")}</button>
    </li>)}</ul>;
  }
  return <>
    <div className="notice"><div><strong>{t("你要连接 DeepSeek / AI API Key？", "Looking for DeepSeek / an AI API key?")}</strong><p>{t("AI 密钥请填在 AI 设置，不是下面的业务系统连接。", "Enter AI keys in AI settings, not in a business connector below.")}</p><button onClick={() => go?.("AI & privacy")}>{t("连接 AI / 填 API Key", "Connect AI / enter API key")}</button></div></div>
    <h2>{t("连接你正在用的公司软件", "Connect your business software")}</h2>
    <p>{t("ERP 是企业管理，POS 是收银，WMS 是仓库，TMS 是运输。它们是系统类别，不是已经连接好的软件。所有套餐都可使用已支持的连接。", "ERP manages business operations, POS handles sales, WMS manages warehouses, and TMS handles transport. These are categories, not connected products. Supported connections are available on every plan.")}</p>
    <div className="row">
      <button disabled={busy} onClick={() => { let id = "my-api"; let number = 2; while (configs.some((config) => config.id === id)) id = `my-api-${number++}`; edit({ ...blank, id }, false); }}>{t("软件有 API：开始连接", "Software has an API: start setup")}</button>
      <button className="secondary" onClick={() => go?.("Computer tools")}>{t("只有网页或电脑软件：设置填写", "Website or desktop app: set up filling")}</button>
      <button className="secondary" onClick={() => go?.("Business tools")}>{t("只有 Excel / PDF：导入文件", "Excel / PDF only: import files")}</button>
    </div>
    <p>{t("API 连接需要软件供应商提供接口说明与授权。网页网址、软件名称或 AI 的 API Key 不能代替业务系统接口。没有 API 也可以先处理文件，或配置受支持的表单填写。", "An API connection needs your software vendor’s endpoint documentation and authorization. A website URL, product name or AI API key cannot replace these. Without an API, start with files or configure supported form filling.")}</p>
    <h3>{t("我的真实系统连接", "My real system connections")}</h3>
    {real.length ? cards(real) : <p>{t("尚未配置真实系统。点击上面的“开始连接”，按步骤填写。", "No real system configured yet. Choose start setup above and follow the steps.")}</p>}
    <label><input type="checkbox" checked={showDemos} onChange={(event) => setShowDemos(event.target.checked)} />{t("显示测试演示系统（不是真实业务资料）", "Show demo systems (not real business data)")}</label>
    {showDemos && cards(configs.filter((config) => config.kind === "mock"))}
    <div ref={editor}>
      {selected && <section className="panel" aria-label={t("连接设置", "Connection setup")}>
        <h2>{selected.kind === "mock" ? t("测试演示设置", "Demo settings") : t("连接设置：先保存，再测试", "Connection setup: save, then test")}</h2>
        {selected.kind === "mock" && <p>{t("这是测试系统，不能在这里填写真实公司账号来接入 POS 或仓库。请使用上方“软件有 API”建立真实连接。", "This is a test system. Entering company account details here will not connect your POS or warehouse. Use API setup above for a real connection.")}</p>}
        <fieldset disabled={busy}>
          <h3>{t("1. 这是什么软件？", "1. Which software?")}</h3>
          <label>{t("软件 / 连接名称", "Software / connection name")}<input aria-label="Connection name" required value={selected.name} placeholder={t("例如：公司订单 API", "Example: company orders API")} onChange={(event) => field("name", event.target.value)} /></label>
          <label>{t("系统类别", "Category")}<select aria-label="Connection category" value={selected.category} onChange={(event) => field("category", event.target.value)}>{["ERP", "POS", "WMS", "TMS", "API"].map((category) => <option key={category}>{category}</option>)}</select></label>
          {selected.kind === "rest" && <>
            <h3>{t("2. 按供应商接口说明填写", "2. Enter the vendor’s API details")}</h3>
            <label>{t("API 基础地址（HTTPS，不是登录网址）", "API base URL (HTTPS, not the login page)")}<input aria-label="HTTPS base URL" value={selected.base_url} placeholder="https://api.your-vendor.com/v1" onChange={(event) => field("base_url", event.target.value)} /></label>
            <label>{t("读取接口路径", "Read endpoint path")}<input aria-label="Read path" value={selected.read_path} onChange={(event) => field("read_path", event.target.value)} /></label>
            <label>{t("授权资料名称（不是密钥内容）", "Credential reference (not the secret)")}<input aria-label="Credential reference" value={selected.auth_env} placeholder="NIGHTBREW_CONNECTOR_VENDOR_KEY" onChange={(event) => field("auth_env", event.target.value)} /></label>
            <p>{t("当前通用接口支持 HTTPS + JSON，授权支持 Bearer Token 或无授权。其他登录方式需要适配，不能保证任意软件即填即用。", "The generic connector supports HTTPS + JSON with Bearer Token or no authentication. Other authentication methods require an adapter; arbitrary software is not plug-and-play.")}</p>
            <details><summary>{t("管理员配置说明：允许地址及安全存放密钥", "Administrator setup: allow the host and store credentials securely")}</summary>
              <p>{t("管理员须在本机后端环境设置 NIGHTBREW_CONNECTOR_ALLOWED_HOSTS，加入供应商的公开 API 域名；如使用密钥，须把它保存在上面所填名称对应的后端环境变量，重启应用后生效。不要把密钥填进名称、网址、聊天或截图。本页面不会自动放宽网络权限。", "The administrator must add the vendor’s public API host to NIGHTBREW_CONNECTOR_ALLOWED_HOSTS in the local backend environment. Store any token in the referenced backend environment variable and restart the app. Do not enter secrets in names, URLs, chat or screenshots. This page does not automatically broaden network permissions.")}</p>
            </details>
          </>}
          <h3>{t("3. 保存并测试只读连接", "3. Save and test read access")}</h3>
          <label><input type="checkbox" checked={selected.read_enabled} onChange={(event) => field("read_enabled", event.target.checked)} />{t("允许读取资料", "Allow reads")}</label>
          <p>{t("新连接默认不能更改业务资料。保存配置不代表已连接成功；测试会请求读取接口。", "New connections cannot change business records by default. Saving is not a successful connection; testing makes a request to the read endpoint.")}</p>
          <details><summary>{t("高级设置与写入权限", "Advanced settings and write permissions")}</summary>
            <label>{t("连接编号", "Connector ID")}<input aria-label="Connector ID" value={selected.id} disabled={editingExisting} onChange={(event) => field("id", event.target.value)} /></label>
            <label><input type="checkbox" aria-label="Allow writes after exact-task approval" checked={selected.write_enabled} onChange={(event) => field("write_enabled", event.target.checked)} />{t("允许写入，每项操作仍须审批", "Allow writes after exact-task approval")}</label>
            {selected.kind === "rest" && <>
              <label>{t("写入路径", "Write path")}<input value={selected.write_path} onChange={(event) => field("write_path", event.target.value)} /></label>
              <label>{t("写入方式", "Write method")}<select value={selected.write_method} onChange={(event) => field("write_method", event.target.value)}>{["POST", "PUT", "PATCH", "DELETE"].map((method) => <option key={method}>{method}</option>)}</select></label>
            </>}
            <label>{t("每分钟请求上限", "Requests per minute")}<input type="number" min={1} max={120} value={selected.requests_per_minute} onChange={(event) => field("requests_per_minute", Number(event.target.value))} /></label>
            <label>{t("读取重试次数（写入不重试）", "Read retries (writes are never retried)")}<input type="number" min={0} max={2} value={selected.read_retries} onChange={(event) => field("read_retries", Number(event.target.value))} /></label>
          </details>
          <button disabled={!selected.name.trim() || (!editingExisting && configs.some((config) => config.id === selected.id)) || (selected.kind === "rest" && !selected.base_url.trim())} onClick={() => void action(() => api("/connectors", "PUT", selected), t("配置已保存。请继续测试连接。", "Configuration saved. Test the connection next."), () => setSaved(true))}>{t("保存连接设置", "Save connector")}</button>
          <button disabled={!saved || !selected.read_enabled} onClick={() => void action(() => api(`/connectors/${selected.id}/test`, "POST"), selected.kind === "mock" ? t("演示测试通过，未连接真实系统。", "Demo test passed; no real system is connected.") : t("读取接口测试通过。写入及完整业务兼容性未验证。", "Read endpoint test passed. Writes and full workflow compatibility remain unverified."))}>{t("测试此连接", "Test this connection")}</button>
          {selected.write_enabled && <details><summary>{t("申请写入资料", "Request a record write")}</summary>
            <p>{t("先保存。审批绑定本次目标、配置与资料；修改配置后必须重新审批。", "Save first. Approval binds the target, configuration and record; configuration changes require new approval.")}</p>
            <label>Record JSON<textarea aria-label="Record JSON" value={record} maxLength={32000} onChange={(event) => setRecord(event.target.value)} /></label>
            <button disabled={!saved} onClick={() => void action(() => api<{ id: string }>(`/connectors/${selected.id}/writes`, "POST", { record: JSON.parse(record) }), t("已申请审批，尚未写入。", "Approval requested; nothing written yet."), (value) => setTaskId((value as { id: string }).id))}>{t("申请写入审批", "Request write approval")}</button>
          </details>}
        </fieldset>
      </section>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">{t("正在处理，请稍候…", "Working. Please wait…")}</p>}
      {taskId && <AssignedTask api={api} token={token} id={taskId} />}
      {result !== undefined && <details open><summary>{t("查看接口返回资料", "View endpoint response")}</summary><pre aria-live="polite">{JSON.stringify(result, null, 2)}</pre></details>}
    </div>
  </>;
}
