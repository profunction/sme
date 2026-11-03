import { useEffect, useRef, useState } from "react";
import { WebAISettings, useWebAI, webRequest, webError } from "./WebAI";
import { Icon } from "./Icon";
import { useLanguage } from "./i18n";

type Tab = "chat" | "documents" | "employees" | "tasks" | "settings";
type Draft = { id: string; title: string; text: string; kind: "brief" | "csv"; at: string };
type Employee = { id: string; name: string; role: string; instructions: string };
export function money(value: bigint) { return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`; }
export function decimal(value: string) {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value)) throw new Error("invalid decimal");
  const [whole, cents = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(cents.padEnd(2, "0"));
}
function csvCell(value: string) {
  const safe = /^[\s]*[=+@\-]|^[\t\r\n]/.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}
function download(name: string, value: string, type: string) {
  const link = document.createElement("a"), url = URL.createObjectURL(new Blob([value], { type }));
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function WebPreview() {
  const { t, language, setLanguage } = useLanguage();
  const service = useWebAI();
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string; provider?: string }[]>([]);
  const [sending, setSending] = useState(false), [chatError, setChatError] = useState<unknown>(null);
  const sendLock = useRef(false);
  useEffect(() => {
    let active = true;
    if (service.status.authenticated) webRequest<typeof chatMessages>("messages").then(messages => { if (active) setChatMessages(messages); }).catch(() => {});
    else setChatMessages([]);
    return () => { active = false; };
  }, [service.status.authenticated]);
  const [tab, setTab] = useState<Tab>("chat"), [text, setText] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]), [employees, setEmployees] = useState<Employee[]>([]);
  const [activeDraft, setActiveDraft] = useState<string>(""), [notice, setNotice] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [employee, setEmployee] = useState({ name: "", role: "", instructions: "" });
  const [quote, setQuote] = useState({ company: "", customer: "", reference: "", item: "", quantity: "1", price: "", tax: "0", currency: "MYR" });
  const nav: [Tab, string, string, string][] = [
    ["chat", "chat", "AI 工作台", "AI workspace"], ["documents", "file", "文档与表格", "Documents"],
    ["employees", "people", "我的 AI 员工", "AI employees"], ["tasks", "clock", "草稿与结果", "Drafts & results"],
    ["settings", "settings", "连接与设置", "Connections"],
  ];
  function go(value: Tab) { setTab(value); setNotice(""); window.scrollTo({ top: 0 }); }
  function saveDraft(title: string, body: string, kind: Draft["kind"]) {
    const draft = { id: crypto.randomUUID(), title, text: body, kind, at: new Date().toLocaleString(language === "zh" ? "zh-CN" : "en-GB") };
    setDrafts(current => [draft, ...current]); setActiveDraft(draft.id); return draft;
  }
  function useExample(value: string) { setText(value); go("chat"); }
  const selected = drafts.find(draft => draft.id === activeDraft);
  return <div className="web-app">
    <aside className="web-sidebar">
      <a className="web-brand" href="#" onClick={event => { event.preventDefault(); go("chat"); }}><span className="web-brand-icon"><Icon name="sparkle" size={27} /></span><span>NightBrew<small>AI EMPLOYEE · WEB</small></span></a>
      <div className="web-workspace"><span>N</span><div><strong>{t("我的工作空间", "My workspace")}</strong><small>{t("先做好一件事", "One task at a time")}</small></div></div>
      <small className="web-nav-caption">{t("工作空间", "WORKSPACE")}</small>
      <nav aria-label={t("网站导航", "Website navigation")}>{nav.map(([id, icon, zh, en]) => <button key={id} className={tab === id ? "active" : ""} aria-label={t(zh, en)} aria-current={tab === id ? "page" : undefined} onClick={() => go(id)}><Icon name={icon} /><span>{t(zh, en)}</span><Icon name="arrow" size={15} /></button>)}</nav>
      <div className="web-sidebar-help"><Icon name="book" /><strong>{t("网站界面预览", "Website preview")}</strong><p>{t("可以切换页面、保存本次浏览的草稿，以及下载 CSV 报价草稿。", "Explore pages, keep session drafts and download a quotation CSV draft.")}</p><button onClick={() => go("settings")}>{t("查看连接状态", "View connection status")} →</button></div>
    </aside>
    <div className="web-body">
      <header className="web-topbar"><span>{t("工作空间", "Workspace")} <span className="web-breadcrumb">/ {t(nav.find(item => item[0] === tab)![2], nav.find(item => item[0] === tab)![3])}</span></span><div className="web-header-actions"><span className="web-preview-badge">{t("网页预览", "Web preview")}</span><select aria-label="界面语言 / Interface language" value={language} onChange={event => setLanguage(event.target.value as "zh" | "en")}><option value="zh">中文</option><option value="en">English</option></select></div></header>
      <main className="web-main">
        <div className="web-preview-note"><Icon name="shield" size={19} /><span>{service.status.authenticated
          ? t("已登录个人网站工作区。AI 聊天与密钥配置保存在网站后端；任务、员工和 CSV 草稿仍仅保留本次浏览会话。", "Signed in to the personal web workspace. AI conversations and key configuration use the website backend; task, employee and CSV drafts remain session-only.")
          : t("这是网站预览：AI 与服务器尚未连接。下面保存的是浏览器本次会话的草稿；文件留在本机，刷新页面会清空。", "Website preview: AI and server storage are not connected. Drafts are kept only in this browser session; files stay on your device and refreshing clears the session.")}</span></div>
        {notice && <p className="web-notice" role="status">{notice}</p>}
        {tab === "chat" && <>
          <div className="web-page-title"><span>NIGHTBREW WORKSPACE</span><h1>{t("今天，先完成一件事。", "One less thing on your list.")}</h1><p>{t("把任务说清楚，把资料与结果放在一起。", "Put the task, the facts and the result in one place.")}</p></div>
          <div className="web-metrics">{[[t("任务草稿", "Task drafts"), drafts.filter(d => d.kind === "brief").length, "tasks"], [t("CSV 草稿", "CSV drafts"), drafts.filter(d => d.kind === "csv").length, "tasks"], [t("员工配置", "Employee drafts"), employees.length, "employees"]].map(([name, count, target]) => <button key={name} onClick={() => go(target as Tab)}><span>{name}</span><strong>{count}</strong><small>{t("点击查看", "View details")} <Icon name="arrow" size={14} /></small></button>)}</div>
          <div className="web-grid"><section className="web-card web-chat-card"><div className="web-card-heading"><span className="web-blue-icon"><Icon name="sparkle" /></span><div><h2>{t("你想先做什么？", "What would you like to do?")}</h2><p>{t("先写目标与已确认的资料。", "Start with your goal and confirmed facts.")}</p></div></div>
            {!service.ready && <p><button className="web-secondary" onClick={() => go("settings")}>{t("填写 DeepSeek API Key", "Enter DeepSeek API key")}</button></p>}
            {chatMessages.length > 0 && <div className="web-ai-messages" aria-label={t("AI 聊天记录", "AI conversation")}>{chatMessages.map((message, index) => <article key={index} className="web-ai-message"><strong>{message.role === "user" ? t("你", "You") : `DeepSeek · ${message.provider || service.status.settings?.model || ""}`}</strong><p>{message.content}</p></article>)}</div>}
            {!chatMessages.length && <div className="web-chat-empty"><Icon name="chat" size={35} /><h3>{t("直接说就好。", "Start with a sentence.")}</h3><p>{t("例如：帮我整理客户跟进事项，缺少的资料先列出来。", "For example: organize this customer follow-up and list the missing facts.")}</p><small>{service.ready ? t("已配置 DeepSeek。点击同意发送后才会调用，可能产生 API 费用。", "DeepSeek is configured. Only clicking the consent/send button calls AI; API charges may apply.") : t("预览当前只保存任务草稿，不会生成 AI 回答。", "The preview saves a task brief; it does not generate an AI answer.")}</small></div>}
            {chatError !== null && <p className="web-error" role="alert">{webError(chatError, language)}</p>}
            <form onSubmit={async event => {
              event.preventDefault(); if (!text.trim() || sendLock.current) return;
              if (!service.ready) { saveDraft(text.trim().slice(0,55), text, "brief"); setNotice(t("任务草稿已保存，尚未交给 AI 执行。到“草稿与结果”查看或下载。", "Task brief saved, not executed by AI. Open Drafts & results to view or download it.")); return; }
              const submitter = (event.nativeEvent as SubmitEvent).submitter;
              if (!(submitter instanceof HTMLButtonElement) || submitter.dataset.cloudConsent !== "true") { setChatError(new Error("Explicit cloud data consent is required")); return; }
              const message = text; sendLock.current = true; setSending(true); setChatError(null);
              try {
                const result = await webRequest<{ answer: string; model: string }>("chat", "POST", { message, consent: true, language });
                setChatMessages(current => [...current, { role: "user", content: message }, { role: "assistant", content: result.answer, provider: result.model }]); setText("");
              } catch (error) { setChatError(error); } finally { sendLock.current = false; setSending(false); }
            }}><label className="web-sr-only" htmlFor="web-message">{t("任务内容", "Task brief")}</label><textarea id="web-message" value={text} disabled={sending} onChange={event => setText(event.target.value)} maxLength={10000} rows={4} placeholder={t("说说你的目标，或粘贴已确认的资料…", "Describe your goal or paste the confirmed facts…")} /><div className="web-composer-footer"><small>{service.ready ? t("仅本条消息会发送给 DeepSeek；不要填写 Key 或敏感资料", "Only this message is sent to DeepSeek; no keys or sensitive data") : t("不要填写 API Key 或敏感资料", "Do not enter API keys or sensitive data")}</small><button type="submit" data-cloud-consent={service.ready ? "true" : "false"} className="web-primary" disabled={sending || !text.trim()}>{sending ? t("等待 DeepSeek 回答…", "Waiting for DeepSeek…") : service.ready ? t("同意云端处理并发送", "Consent and send to cloud") : t("保存任务草稿", "Save task brief")} <Icon name="arrow" size={16} /></button></div></form>
          </section><aside className="web-card"><h2>{t("从一个常用任务开始", "Start with a familiar task")}</h2><p>{t("不用从空白开始。", "No blank page needed.")}</p><div className="web-shortcuts">
            <button onClick={() => useExample(t("帮我起草客户跟进邮件。客户：待填写。已确认的情况：待填写。请先列出缺少的资料，不要发送。", "Draft a customer follow-up. Customer: to confirm. Confirmed facts: to confirm. List missing information first; do not send."))}><Icon name="chat" /><span><strong>{t("客户跟进", "Customer follow-up")}</strong><small>{t("整理事实，准备回复", "Facts first, then a reply")}</small></span><Icon name="arrow" size={16} /></button>
            <button onClick={() => go("documents")}><Icon name="file" /><span><strong>{t("制作报价草稿", "Prepare a quotation")}</strong><small>{t("按真实数量与价格计算", "Use confirmed quantities and prices")}</small></span><Icon name="arrow" size={16} /></button>
            <button onClick={() => go("employees")}><Icon name="people" /><span><strong>{t("配置 AI 员工", "Configure an AI employee")}</strong><small>{t("设定名字、岗位与职责", "Name, role and instructions")}</small></span><Icon name="arrow" size={16} /></button>
          </div><div className="web-tip"><Icon name="check" size={18} /><p>{t("草稿与真正执行的任务会分开标示。预览不会把“已保存”显示成“AI 已完成”。", "Saving a draft is distinct from executing a task. The preview does not label a saved brief as completed AI work.")}</p></div></aside></div>
        </>}
        {tab === "documents" && <>
          <div className="web-page-title"><span>DOCUMENTS</span><h1>{t("文档清楚，工作轻松。", "Clear documents. Less busywork.")}</h1><p>{t("可以在本机生成 CSV 报价草稿；PDF、Word 与 AI 分析待接入后端。", "Create a local quotation CSV draft. PDF, Word and AI analysis need the backend connection.")}</p></div>
          <div className="web-grid"><section className="web-card"><h2>{t("制作报价草稿", "Prepare a quotation draft")}</h2><form onSubmit={event => { event.preventDefault(); try {
            if (!/^\d{1,7}$/.test(quote.quantity)) throw new Error("quantity");
            const quantity = BigInt(quote.quantity), price = decimal(quote.price), taxRate = decimal(quote.tax);
            if (quantity < 1n || quantity > 1000000n || taxRate > 10000n) throw new Error("range");
            const subtotal = quantity * price, tax = (subtotal * taxRate + 5000n) / 10000n, total = subtotal + tax;
            const rows = [["Document", "Quotation draft"], ["Company", quote.company], ["Customer", quote.customer], ["Reference", quote.reference], ["Item", quote.item], ["Quantity", quote.quantity], ["Unit price", money(price)], ["Subtotal", money(subtotal)], ["Tax percent", quote.tax], ["Tax", money(tax)], ["Total", money(total)], ["Currency", quote.currency], ["Status", "Draft - requires review; not issued or submitted"]];
            const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
            saveDraft(`${quote.reference} · ${money(total)} ${quote.currency}`, csv, "csv");
            download("nightbrew-quotation-draft.csv", csv, "text/csv;charset=utf-8");
            setNotice(t(`CSV 草稿已生成。总额 ${money(total)} ${quote.currency}；尚未发送或提交。`, `CSV draft created. Total ${money(total)} ${quote.currency}; not sent or submitted.`));
          } catch { setNotice(t("请填写有效数量、单价和 0–100% 的实际适用税率。金额最多两位小数。", "Enter a valid quantity, unit price and applicable tax rate from 0–100%. Use at most two decimal places.")); } }}>
            <div className="web-form-grid">{([['company','公司','Company'],['customer','客户','Customer'],['reference','报价编号','Reference'],['item','产品或服务','Item or service'],['quantity','数量','Quantity'],['price','单价','Unit price'],['tax','实际税率（%）','Applicable tax (%)']] as const).map(([key, zh, en]) => <label key={key}>{t(zh, en)}<input required value={quote[key]} inputMode={['quantity','price','tax'].includes(key) ? 'decimal' : undefined} maxLength={key === 'quantity' ? 7 : 120} onChange={event => setQuote({ ...quote, [key]: event.target.value })} /></label>)}<label>{t("币种", "Currency")}<select value={quote.currency} onChange={event => setQuote({ ...quote, currency: event.target.value })}><option>MYR</option><option>SGD</option></select></label></div><button className="web-primary">{t("生成并下载 CSV 草稿", "Create & download CSV draft")} <Icon name="arrow" size={16} /></button>
          </form></section><section className="web-card"><h2>{t("选择本地文件", "Select local files")}</h2><p>{t("预览只列出你选择的文件，不读取内容或上传。", "This preview lists your selected files; it does not read their contents or upload them.")}</p><label className="web-file-select"><Icon name="file" size={30} /><span>{t("选择 PDF / Excel / Word / CSV", "Select PDF / Excel / Word / CSV")}</span><input aria-label={t("选择本地文件", "Select local files")} type="file" accept=".pdf,.xlsx,.docx,.csv" multiple onChange={event => setFiles(Array.from(event.target.files || []))} /></label><ul className="web-file-list">{files.map((file, index) => <li key={index}><Icon name="file" size={17} /><span>{file.name}<small>{Math.ceil(file.size / 1024)} KB · {t("留在本机，未上传", "Local only, not uploaded")}</small></span></li>)}</ul></section></div>
        </>}
        {tab === "employees" && <>
          <div className="web-page-title"><span>YOUR AI TEAM</span><h1>{t("不同岗位，各有分工。", "Different roles. Clear responsibilities.")}</h1><p>{t("先写清楚职责。预览保存的是本次会话的配置草稿，不会启动员工或调用 AI。", "Define responsibilities first. These session-only configuration drafts do not start agents or call AI.")}</p></div>
          <div className="web-grid"><section className="web-card"><h2>{t("添加员工配置草稿", "Add employee configuration draft")}</h2><form onSubmit={event => { event.preventDefault(); if (!employee.name.trim() || !employee.role.trim()) return; setEmployees(current => [...current, { ...employee, id: crypto.randomUUID() }]); setEmployee({ name: "", role: "", instructions: "" }); setNotice(t("员工配置草稿已保存，尚未启动。", "Employee configuration draft saved; no agent started.")); }}><label>{t("员工名称", "Employee name")}<input required maxLength={100} value={employee.name} onChange={event => setEmployee({ ...employee, name: event.target.value })} /></label><label>{t("岗位", "Role")}<input required maxLength={100} value={employee.role} placeholder={t("例如：销售、财务、客服、运营", "For example: sales, finance, support, operations")} onChange={event => setEmployee({ ...employee, role: event.target.value })} /></label><label>{t("工作说明", "Instructions")}<textarea rows={5} maxLength={5000} value={employee.instructions} onChange={event => setEmployee({ ...employee, instructions: event.target.value })} /></label><button className="web-primary">{t("保存员工配置草稿", "Save employee draft")}</button></form></section><section className="web-card"><h2>{t("本次配置的员工", "This session's employee drafts")}</h2>{!employees.length && <div className="web-empty"><Icon name="people" size={35} /><p>{t("还没有员工配置草稿。", "No employee drafts yet.")}</p></div>}{employees.map(person => <article className="web-employee" key={person.id}><span className="web-avatar">{person.name.slice(0, 1)}</span><div><h3>{person.name}</h3><p>{person.role}</p><small>{person.instructions}</small><span className="web-tag">{t("配置草稿 · 未启动", "Configuration draft · not running")}</span></div></article>)}</section></div>
        </>}
        {tab === "tasks" && <>
          <div className="web-page-title"><span>DRAFTS & RESULTS</span><h1>{t("保存了什么，一眼看清。", "See exactly what was saved.")}</h1><p>{t("这里列出本次浏览创建的真实草稿，不会自动执行业务系统操作。", "These are actual drafts from this session; business system actions are not executed automatically.")}</p></div>
          <div className="web-grid"><section className="web-card"><h2>{t("草稿记录", "Draft history")}</h2>{!drafts.length && <div className="web-empty"><Icon name="clock" size={38} /><p>{t("目前没有草稿。先保存一条任务，或生成 CSV 报价。", "No drafts yet. Save a task brief or create a quotation CSV.")}</p><button className="web-primary" onClick={() => go("chat")}>{t("写第一条任务", "Write a task brief")}</button></div>}{drafts.map(draft => <button className={`web-draft-row ${activeDraft === draft.id ? 'selected' : ''}`} key={draft.id} onClick={() => setActiveDraft(draft.id)}><Icon name={draft.kind === "csv" ? "file" : "chat"} /><span><strong>{draft.title}</strong><small>{draft.at} · {draft.kind === "csv" ? t("本机 CSV 草稿", "Local CSV draft") : t("任务草稿 · 尚未执行", "Task brief · not executed")}</small></span><Icon name="arrow" size={16} /></button>)}</section><section className="web-card"><h2>{t("查看内容", "View contents")}</h2>{selected ? <><span className="web-tag">{selected.kind === "csv" ? t("CSV 草稿已生成", "CSV draft created") : t("草稿已保存，未执行", "Brief saved, not executed")}</span><pre className="web-draft-content">{selected.text}</pre><button className="web-primary" onClick={() => download(selected.kind === "csv" ? "nightbrew-quotation-draft.csv" : "nightbrew-task-brief.txt", selected.text, selected.kind === "csv" ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8")}>{t("下载这份草稿", "Download this draft")}</button></> : <p>{t("选择左边的草稿查看详情。", "Choose a draft to see its contents.")}</p>}</section></div>
        </>}
        {tab === "settings" && <>
          <div className="web-page-title"><span>CONNECTIONS</span><h1>{t("连接状态，清楚说明。", "Know what is connected.")}</h1><p>{t("预览先让你确认操作方式与页面布局。", "This preview lets you review the workflow and layout first.")}</p></div>
          <WebAISettings service={service} onChat={() => go("chat")} />
          <section className="web-card web-status-card"><h2>{t("当前网站预览", "Current website preview")}</h2>{[["浏览器界面 / Browser UI",t("可使用", "Available")],["任务与员工配置 / Drafts",t("仅本次会话", "This session only")],["CSV 报价草稿 / CSV quotation",t("本机计算与下载", "Local calculation and download")],["DeepSeek / AI API", service.ready ? t("已配置，实际调用结果以服务商返回为准", "Configured; live result depends on provider") : t("尚未完成后端、登录或 Key 设置", "Backend, login or key setup incomplete")],["云端数据库 / Cloud database",t("未连接", "Not connected")],["ERP / POS / WMS / TMS",t("未连接任何真实厂商", "No real vendor connected")],["操作电脑软件 / Desktop automation",t("网页尚未接入本机组件", "Local companion not connected")]].map(([name, status]) => <div className="web-status-row" key={name}><span>{name}</span><strong>{status}</strong></div>)}<p className="web-tip">{t("下一步接入带登录保护的后端，才能保存真实工作区、使用你授权的 AI 服务。浏览器不会直接取得你电脑的控制权限。", "A backend with protected login is needed for a persistent workspace and authorized AI service. This website does not directly gain control of your computer.")}</p></section>
        </>}
        <footer className="web-footer"><span>NightBrew AI Employee · {t("网站预览", "Website preview")}</span><span>{t("草稿先审核，重要决定由你掌握。", "Review drafts. Keep important decisions in your hands.")}</span></footer>
      </main>
    </div>
  </div>;
}
