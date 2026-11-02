import { useEffect, useState } from "react";
import { errorText, type API } from "./api";
import { useLanguage } from "./i18n";

export type AutomationPolicy = {
  browser_hosts: string[];
  browser_writes: boolean;
  applications: Record<string, string>;
  mac_applications?: Record<string, string>;
  browser_engine?: string;
};
type Capabilities = {
  platform: string;
  browser?: { available: boolean; name?: string; reason?: string };
  windows?: { available: boolean; reason?: string };
  macos?: { available: boolean; permission_required?: boolean; reason?: string };
};
type Field = { selector: string; label: string; type?: string; role?: string; readonly?: boolean; disabled?: boolean; editable?: boolean; max_length?: number; options?: { value: string; label: string }[] };
type Inspected = { fields: Field[]; form_snapshot: unknown; url?: string; note?: string; application_id?: string; title?: string };
type TaskPlan = { url?: string; application_id?: string; title?: string; form_snapshot?: unknown; values?: { selector: string; text: string }[]; allow_network_writes?: boolean; hold_seconds?: number };
type Task = { id: string; tool: string; status: string; error?: string; payload?: TaskPlan & { plan?: TaskPlan }; result?: Inspected & { note?: string } };
type Props = { api: API; policy: AutomationPolicy; setPolicy: (policy: AutomationPolicy) => void; initialSource?: string; employeeId?: string };
const taskPlan = (task: Task): TaskPlan => task.payload?.plan || task.payload || {};
const isFillTool = (tool: string) => ["browser.fill", "windows.fill", "macos.fill"].includes(tool);
const tools = ["browser.inspect", "browser.fill", "macos.inspect", "macos.fill", "windows.inspect", "windows.fill"];

export function Autofill({ api, policy, setPolicy, initialSource, employeeId }: Props) {
  const { t } = useLanguage();
  const [capabilities, setCapabilities] = useState<Capabilities>();
  const [tab, setTab] = useState("browser");
  const [url, setUrl] = useState("");
  const [app, setApp] = useState("");
  const [title, setTitle] = useState("");
  const [alias, setAlias] = useState("textedit");
  const [bundle, setBundle] = useState("com.apple.TextEdit");
  const [source, setSource] = useState(initialSource || "");
  const [sourceMessage, setSourceMessage] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [inspection, setInspection] = useState<Inspected>();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [hold, setHold] = useState(60);
  const [showBrowser, setShowBrowser] = useState(true);
  const [allowNetworkWrites, setAllowNetworkWrites] = useState(false);
  const [awaitingInspection, setAwaitingInspection] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { if (initialSource?.trim()) setSource(initialSource); }, [initialSource]);
  useEffect(() => {
    api<Capabilities>("/automation/capabilities").then(setCapabilities).catch((e) => setMessage(errorText(e)));
    let active = true;
    const refresh = async () => {
      try { const list = await api<Task[]>("/tasks"); if (active) setTasks(list); }
      catch (e) { if (active) setMessage(errorText(e)); }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => { active = false; clearInterval(timer); };
  }, [api]);
  function reset() { setInspection(undefined); setValues({}); setSelected({}); setSourceMessage(""); setAllowNetworkWrites(false); setAwaitingInspection(""); }
  async function action(fn: () => Promise<unknown>, completed: string) {
    setBusy(true); setMessage("");
    try { await fn(); setMessage(completed); setTasks(await api<Task[]>("/tasks")); }
    catch (e) { setMessage(errorText(e)); }
    finally { setBusy(false); }
  }
  const available = tab === "browser" ? capabilities?.browser?.available : tab === "windows" ? capabilities?.windows?.available : capabilities?.macos?.available;
  const supportedFields = inspection?.fields.filter((field) => !field.disabled && !field.readonly && field.editable !== false) || [];
  const chosen = supportedFields.filter((field) => selected[field.selector]);
  const maxFieldLength = tab === "windows" ? 2000 : 4000;
  const maxFields = tab === "macos" ? 20 : 40;
  const fieldLimit = (field: Field) => Math.min(maxFieldLength, field.max_length && field.max_length > 0 ? field.max_length : maxFieldLength);
  const inspectTool = tab === "browser" ? "browser.inspect" : tab === "windows" ? "windows.inspect" : "macos.inspect";
  const nativeApps = tab === "windows" ? policy.applications : policy.mac_applications || {};
  const recent = tasks.filter((task) => task.tool === inspectTool && task.status === "completed" && Array.isArray(task.result?.fields));
  function load(task: Task) {
    const details = taskPlan(task);
    reset(); setInspection(task.result);
    if (tab === "browser") {
      const snapshot = task.result?.form_snapshot as { url?: string } | undefined;
      setUrl(snapshot?.url || task.result?.url || details.url || "");
    } else {
      setApp(details.application_id || task.result?.application_id || "");
      setTitle(details.title || task.result?.title || "");
    }
  }
  useEffect(() => {
    if (!awaitingInspection) return;
    const task = tasks.find((entry) => entry.id === awaitingInspection);
    if (task?.status === "completed" && Array.isArray(task.result?.fields)) load(task);
    else if (task && ["failed", "cancelled", "interrupted"].includes(task.status)) setAwaitingInspection("");
  }, [tasks, awaitingInspection]);
  function matchSource() {
    const entries = source.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
      const index = line.search(/[:：]/);
      return index >= 0 ? { label: line.slice(0, index).trim(), value: line.slice(index + 1).trim() } : { label: line.trim(), value: null };
    });
    const nextValues: Record<string, string> = {}, nextSelected: Record<string, boolean> = {}, unmatched: string[] = [];
    let matched = 0;
    for (const entry of entries) {
      const fields = supportedFields.filter((field) => field.label.trim() === entry.label);
      if (entry.value === null || fields.length !== 1 || (fields[0] && entry.value.length > fieldLimit(fields[0])) || entries.filter((other) => other.label === entry.label).length !== 1) { unmatched.push(entry.label); continue; }
      let value = entry.value;
      if (fields[0].options?.length) {
        const options = fields[0].options.filter((option) => option.value === value || option.label === value);
        if (options.length !== 1) { unmatched.push(entry.label); continue; }
        value = options[0].value;
      }
      nextValues[fields[0].selector] = value; nextSelected[fields[0].selector] = true; matched++;
    }
    setValues(nextValues); setSelected(nextSelected);
    setSourceMessage(t(`准确匹配 ${matched} 项。`, `Matched ${matched} fields exactly. `) + (unmatched.length
      ? t(`未匹配或名称重复：${unmatched.join("、")}；这些项目没有填写。`, `Unmatched or duplicate names: ${unmatched.join(", ")}. These fields were left untouched.`)
      : t("请核对下方预览后再批准。", "Review the preview before approval.")));
  }
  function fieldsFor(task: Task) {
    const plan = taskPlan(task);
    const same = tasks.find((entry) => entry.tool.endsWith(".inspect") && entry.status === "completed" &&
      JSON.stringify(entry.result?.form_snapshot) === JSON.stringify(plan.form_snapshot));
    const fields = same?.result?.fields || [];
    return (plan.values || []).map((value, index) => ({ label: fields.find((field) => field.selector === value.selector)?.label || t(`字段 ${index + 1}`, `Field ${index + 1}`), text: value.text }));
  }
  const targetLabel = tab === "browser" ? url : `${app} / ${title}`;
  return <section aria-label={t("自动填写向导", "Guided form filling")}>
    <h2>{t("帮我填写", "Fill for me")}</h2>
    <p>{t("选目标、贴资料、核对后批准。软件按你确认的字段填写，不会推测客户资料或主动点击发送。", "Choose a target, paste the details, review and approve. Only confirmed fields are filled; no invented customer data or automatic Send clicks.")}</p>
    <div className="row" role="group" aria-label={t("填写目标类型", "Target type")}>
      {[["browser", t("网页表单", "Website")], ["windows", t("Windows 软件", "Windows app")], ["macos", t("Mac 软件", "Mac app")]].map(([mode, label]) =>
        <button key={mode} disabled={busy} className={tab === mode ? "" : "secondary"} onClick={() => { setTab(mode); reset(); }}>{label}</button>)}
    </div>
    <small>{t("当前系统", "System")}: {capabilities?.platform || t("检查中…", "Checking…")}</small>
    {tab === "browser" ? <>
      <label>{t("要填写的网页地址", "Website address")}<input type="url" value={url} onChange={(e) => { setUrl(e.target.value); reset(); }} placeholder="https://example.com/customer-form" /></label>
      <p>{t("会打开独立浏览器，不继承你当前浏览器的登录状态。需要登录的邮箱或 ERP 尚不能直接接入。", "Uses a separate browser without your current login. Sites requiring an email or ERP sign-in are not automatically connected.")}</p>
      {!available && <p role="status">{capabilities?.browser?.reason || t("尚未检测到兼容浏览器，请先安装 Chrome 或 Edge。", "No compatible browser detected. Install Chrome or Edge first.")}</p>}
    </> : <>
      <label>{t("目标应用", "Target application")}<select value={app} onChange={(e) => { setApp(e.target.value); reset(); }}><option value="">{t("选择允许的应用", "Choose an approved app")}</option>{Object.entries(nativeApps).map(([id]) => <option key={id} value={id}>{id}</option>)}</select></label>
      <label>{t("准确的窗口名称", "Exact window title")}<input value={title} onChange={(e) => { setTitle(e.target.value); reset(); }} placeholder={t("与软件窗口显示的名称一致", "Use the title shown by the application")} /></label>
      <p>{tab === "macos" ? t("先打开目标窗口，并按系统提示授予辅助功能/自动化权限。", "Open the target window and grant Accessibility/Automation permission if macOS asks.") : t("先打开目标软件的窗口，保持 Windows 桌面可交互。", "Open the target app in an interactive Windows desktop session.")}</p>
      <p>{t("只支持软件公开的普通文字字段；目标软件可能自动保存。首次请用测试资料核对。", "Only exposed ordinary text fields are supported. The target app may autosave; test with sample data first.")}</p>
      {tab === "macos" && <small>{t("Mac 填写属于实验功能，仍需在获准的真实 Mac 和目标软件上验证。", "Mac filling is experimental and still needs validation on a real permitted Mac and target app.")}</small>}
      {!available && <p role="status">{(tab === "windows" ? capabilities?.windows?.reason : capabilities?.macos?.reason) || t("此类型的软件操作不能在当前系统执行。", "This app type cannot be automated on the current operating system.")}</p>}
    </>}
    <button disabled={busy || !available || (tab === "browser" ? !url : !app || !title)} onClick={() => void action(async () => {
      if (tab === "browser") {
        const host = new URL(url).hostname.toLowerCase();
        if (!policy.browser_hosts.includes(host)) {
          const saved = await api<AutomationPolicy>("/automation/policy", "PUT", { ...policy, browser_hosts: [...policy.browser_hosts, host] }); setPolicy(saved);
        }
      }
      const task = await api<{ id: string }>("/tasks", "POST", { tool: inspectTool, employee_id: employeeId || null,
        payload: tab === "browser" ? { url, visible: false, hold_seconds: 0 } : { application_id: app, title } });
      setAwaitingInspection(task.id);
    }, t("读取申请已准备好，请在下方批准；这一步不会修改资料。", "The read request is ready. Approve below; this step does not modify data."))}>{tab === "browser" ? t("允许此网站并读取字段", "Allow this website and inspect fields") : t("读取目标字段", "Inspect target fields")}</button>
    {inspection && <>
      <h3>{t("把要填写的资料给我", "Provide the details to fill")}</h3>
      <label>{t("批量粘贴资料（每行“字段名称：内容”）", "Paste details (one Field name: value per line)")}<textarea value={source} maxLength={80000} onChange={(e) => setSource(e.target.value)} placeholder={t("客户名称：ABC 公司\n电话号码：0123456789", "Customer name: ABC Company\nPhone number: 0123456789")} /></label>
      <button className="secondary" disabled={!source || busy} onClick={matchSource}>{t("匹配并预览", "Match and preview")}</button>
      <small>{t("只匹配与目标完全相同的字段名称；不猜测、不调用云端 AI。", "Only exact field-name matches are used. No guesses or cloud AI calls.")}</small>
      {sourceMessage && <p role="status">{sourceMessage}</p>}
      {supportedFields.length === 0 && <p>{t("没有找到可安全填写的普通文本框。不会尝试密码、隐藏字段或盲点。", "No safe ordinary text fields were found. Passwords, hidden fields and blind clicks are not attempted.")}</p>}
      {supportedFields.map((field) => <fieldset key={field.selector}><legend>{field.label || t("未命名字段", "Unnamed field")}</legend>
        <label><input type="checkbox" checked={!!selected[field.selector]} onChange={(e) => setSelected({ ...selected, [field.selector]: e.target.checked })} />{t("填写此字段", "Fill this field")}: {field.label || t("未命名字段", "Unnamed field")}</label>
        <label>{t("填写内容", "Value to fill")} · {field.label || t("未命名字段", "Unnamed field")}{field.options?.length ? <select disabled={!selected[field.selector]} value={values[field.selector] || ""} onChange={(e) => setValues({ ...values, [field.selector]: e.target.value })}>
          <option value="">{t("请选择已识别选项", "Choose an inspected option")}</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select> : <textarea maxLength={fieldLimit(field)} disabled={!selected[field.selector]} value={values[field.selector] || ""} onChange={(e) => setValues({ ...values, [field.selector]: e.target.value })} />}</label>
        {initialSource?.trim() && !field.options?.length && <button className="secondary" disabled={busy || initialSource.length > fieldLimit(field)} onClick={() => {
          setSelected({ ...selected, [field.selector]: true }); setValues({ ...values, [field.selector]: initialSource });
        }}>{t("把整段 AI 回复放入此字段", "Use the entire AI reply in this field")}</button>}
      </fieldset>)}
      {initialSource && initialSource.length > maxFieldLength && <p>{t(`AI 回复超过单字段 ${maxFieldLength} 字限制，请先编辑或截取后再填写。`, `The AI reply exceeds the ${maxFieldLength}-character field limit. Edit it before filling.`)}</p>}
      <h3>{t("核对本次填写", "Review this fill")}</h3>
      <p>{t("目标", "Target")}: {targetLabel}</p>
      {chosen.length ? <table><thead><tr><th>{t("字段", "Field")}</th><th>{t("将填写的内容", "New value")}</th></tr></thead><tbody>{chosen.map((field) => <tr key={field.selector}><td>{field.label || t("未命名字段", "Unnamed field")}</td><td style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{values[field.selector] || t("（空值，将清空此字段）", "(Empty: this field will be cleared)")}</td></tr>)}</tbody></table> : <p>{t("尚未选择填写字段。", "No fields selected.")}</p>}
      {chosen.length > maxFields && <p role="alert">{t(`每次最多填写 ${maxFields} 个字段，请减少勾选项。`, `Select no more than ${maxFields} fields per task.`)}</p>}
      {tab === "browser" && <label><input type="checkbox" disabled={!policy.browser_writes} checked={allowNetworkWrites} onChange={(e) => setAllowNetworkWrites(e.target.checked)} />{t("允许此任务网页自动保存/写入（不会主动点击发送）", "Allow website autosave/writes for this task (no automatic Send click)")}</label>}
      <button disabled={busy || !available || !chosen.length || chosen.length > maxFields || chosen.some((field) => (values[field.selector] || "").length > fieldLimit(field))} onClick={() => void action(() => api("/tasks", "POST", {
        tool: tab === "browser" ? "browser.fill" : tab === "windows" ? "windows.fill" : "macos.fill", employee_id: employeeId || null, payload: {
          ...(tab === "browser" ? { url, visible: showBrowser, hold_seconds: showBrowser ? hold : 0, allow_network_writes: allowNetworkWrites } : { application_id: app, title }),
          form_snapshot: inspection.form_snapshot, values: chosen.map((field) => ({ selector: field.selector, text: values[field.selector] || "" })),
        },
      }), t("填写申请已准备好，尚未执行。请在下方核对并批准。", "The fill request is ready and has not run. Review and approve below."))}>{t("准备填写，等我批准", "Prepare fill for my approval")}</button>
    </>}
    <div aria-label={t("自动填写审批", "Form filling approvals")}>
      {tasks.filter((task) => tools.includes(task.tool) && ["pending_approval", "running", "failed", "completed"].includes(task.status)).slice(0, 12).map((task) => {
        const plan = taskPlan(task), fill = isFillTool(task.tool);
        return <article className="feature-guide" key={task.id}><div>
          <strong>{fill ? t("填写操作", "Fill action") : t("读取字段", "Inspect fields")} · {task.status === "pending_approval" ? t("等待批准", "Awaiting approval") : task.status === "running" ? t("执行/核对中", "Running/reviewing") : task.status === "completed" ? t("已完成", "Completed") : t("失败", "Failed")}</strong>
          <p>{t("目标", "Target")}: {plan.url || `${plan.application_id || ""} / ${plan.title || ""}`}</p>
          {fill && <table><thead><tr><th>{t("字段", "Field")}</th><th>{t("将填写的内容", "New value")}</th></tr></thead><tbody>{fieldsFor(task).map((field, index) => <tr key={index}><td>{field.label}</td><td style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{field.text || t("（空值，将清空）", "(Empty: clear field)")}</td></tr>)}</tbody></table>}
          {fill && task.tool === "browser.fill" && <p>{t("网页自动保存/写入", "Website autosave/writes")}: {plan.allow_network_writes ? t("允许", "Allowed") : t("禁止", "Blocked")} · {t("核对时间", "Review time")}: {plan.hold_seconds || 0} {t("秒", "seconds")}</p>}
          {task.status === "pending_approval" && <button disabled={busy} onClick={() => void action(() => api(`/tasks/${task.id}/approve`, "POST"), t("已批准此任务，执行结果会自动更新。", "This exact task was approved. The result will update automatically."))}>{fill ? t("批准以上内容并填写", "Approve these values and fill") : t("批准读取字段", "Approve field inspection")}</button>}
          {["pending_approval", "queued", "running"].includes(task.status) && <button className="secondary" disabled={busy} onClick={() => void action(() => api(`/tasks/${task.id}/cancel`, "POST"), t("已请求停止；已填写的内容不会自动撤销。", "Stop requested. Completed field edits are not automatically undone."))}>{t("停止此任务", "Stop this task")}</button>}
          {task.status === "completed" && !fill && task.tool === inspectTool && Array.isArray(task.result?.fields) && <button className="secondary" onClick={() => load(task)}>{t("载入这些字段", "Load these fields")}</button>}
          {task.error && <p role="alert">{task.error}</p>}
          {task.result?.note && <p>{task.result.note}</p>}
        </div></article>;
      })}
    </div>
    {message && <p role="status">{message}</p>}
    <details><summary>{t("进阶设置与兼容范围", "Advanced settings and compatibility")}</summary>
      <p>{t("不能保证任意软件兼容；需要登录的网页、特殊表格控件和密码可能不支持。Excel 文件请使用“文档与 Excel”的本地工具。", "Compatibility is not universal. Authenticated sites, custom grid controls and passwords may be unsupported. Use the local Business tools for Excel files.")}</p>
      {tab === "browser" ? <>
        <p>{t("已允许网站", "Allowed websites")}: {policy.browser_hosts.join(", ") || t("尚未配置", "None")}</p>
        <label><input type="checkbox" checked={showBrowser} onChange={(event) => setShowBrowser(event.target.checked)} />{t("显示浏览器窗口供我核对", "Show a browser window for review")}</label>
        {!showBrowser && <p>{t("仅生成已填写的预览截图；没有可继续操作的浏览器窗口。", "Only a filled preview screenshot is produced. No browser window remains open.")}</p>}
        <label>{t("浏览器核对时间", "Browser review time")}<select value={hold} disabled={!showBrowser} onChange={(e) => setHold(Number(e.target.value))}>{[30, 60, 120].map((seconds) => <option key={seconds} value={seconds}>{seconds} {t("秒", "seconds")}</option>)}</select></label>
        <p>{t("浏览器填写后会在上述时间关闭；独立会话不会保留当前浏览器登录。", "The separate browser closes after this review time and does not inherit your current login.")}</p>
        <label><input type="checkbox" disabled={busy} checked={policy.browser_writes} onChange={(event) => {
          const enabled = event.target.checked;
          void action(async () => { const saved = await api<AutomationPolicy>("/automation/policy", "PUT", { ...policy, browser_writes: enabled }); setPolicy(saved); reset(); }, t("已修改网页写入范围，需要重新读取字段。", "Website write policy changed. Inspect fields again."));
        }} />{t("允许已批准网页任务使用写入请求", "Permit writes in approved website tasks")}</label>
        <p>{t("此权限影响允许名单中的网站；具体任务仍需另外勾选并批准自动保存。", "Applies to allowed websites. Each task still needs separate write consent and approval.")}</p>
      </> : <>
        <label>{t("应用简称", "Application alias")}<input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder={tab === "windows" ? "customer_app" : "textedit"} /></label>
        <label>{tab === "windows" ? t("准确的 .exe 路径", "Exact .exe path") : "Bundle ID"}<input value={bundle} onChange={(e) => setBundle(e.target.value)} placeholder={tab === "windows" ? "C:\\Windows\\System32\\notepad.exe" : "com.apple.TextEdit"} /></label>
        <button className="secondary" disabled={busy || !alias || !bundle} onClick={() => void action(async () => {
          const next = tab === "windows" ? { ...policy, applications: { ...policy.applications, [alias]: bundle } } : { ...policy, mac_applications: { ...policy.mac_applications, [alias]: bundle } };
          const saved = await api<AutomationPolicy>("/automation/policy", "PUT", next); setPolicy(saved); reset();
        }, t("已保存允许的应用，请选择目标及窗口。", "Approved application saved. Choose its target window."))}>{t("保存允许的应用", "Save approved application")}</button>
      </>}
      {recent.length > 0 && <p>{t("已批准读取的结果可从上方任务卡重新载入，资料不会写入浏览器本地存储。", "Reload approved inspection results from the task cards above. Form details are not persisted to browser storage.")}</p>}
    </details>
  </section>;
}
