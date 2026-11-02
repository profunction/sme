import { useMemo, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { apiFor } from "./api";
import { Assistant } from "./Assistant";
import { Connectors } from "./Connectors";
import { Business } from "./Business";
import { Billing } from "./Billing";
import { Workforce } from "./Workforce";
import { Automation } from "./Automation";
import { Settings } from "./Settings";
import { Dashboard } from "./Dashboard";
import { Guide } from "./Guide";
import { Icon } from "./Icon";
import { pages, type Page, type Prompt } from "./workspace";
import { LanguageProvider, useLanguage } from "./i18n";
import "./style.css";
function App() {
  const { language, setLanguage, t } = useLanguage();
  const englishPages: Record<Page, [string, string]> = {
    Dashboard: ["Dashboard", "Start with one useful task."],
    Assistant: ["AI Assistant", "Ask a question, draft a reply, or fill a reviewed form."],
    Employees: ["My AI Employees", "Assign roles, tools and work budgets."],
    "Business tools": ["Documents & Excel", "Prepare documents and review your uploaded spreadsheets."],
    "Computer tools": ["Fill for me", "Choose a permitted target, review the fields, then approve."],
    Connectors: ["Business connections", "Configure and test your authorized business systems."],
    "AI & privacy": ["AI & privacy", "Check local AI, cloud consent and spending limits."],
    Subscription: ["Subscription & usage", "Review your license, plan and usage."],
    Guide: ["Guide & templates", "Start simply, with examples when you need them."],
  };
  const label = (p: typeof pages[number]) => t(p.label, englishPages[p.id][0]);
  const [token, setToken] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("nightbrew.theme");
    return ["navy", "light", "midnight"].includes(saved || "")
      ? saved!
      : "navy";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme =
      theme === "midnight" ? "dark" : "light";
    localStorage.setItem("nightbrew.theme", theme);
  }, [theme]);
  const [tab, setTab] = useState<Page>("Dashboard");
  const [sessionError, setSessionError] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [draft, setDraft] = useState({ text: "", revision: 0 });
  const [connectionInput, setConnectionInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const api = useMemo(() => apiFor(token), [token]);
  function connectDesktop() {
    setSessionError(false);
    window.nightbrew
      ?.session()
      .then((s) => { setToken(s.token); setAppVersion(s.version || ""); setTab("Assistant"); })
      .catch(() => setSessionError(true));
  }
  useEffect(connectDesktop, []);
  const page = pages.find((p) => p.id === tab)!;
  function go(p: Page) {
    setTab(p);
    window.scrollTo({ top: 0 });
  }
  function usePrompt(p: Prompt) {
    if (p.destination) go(p.destination);
    else {
      setSelectedPrompt(p);
      go("Guide");
    }
  }
  function compose(text: string) {
    setDraft({ text, revision: draft.revision + 1 });
    go("Assistant");
  }
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("Dashboard");
          }}
        >
          <div className="brand-mark">
            <Icon name="sparkle" size={25} />
          </div>
          <div>
            <strong>
              NightBrew<span>®</span>
            </strong>
            <small>AI EMPLOYEE</small>
          </div>
        </a>
        <div className="workspace-switch">
          <div className="workspace-avatar">N</div>
          <div>
            <strong>{t("我的企业工作区", "My business workspace")}</strong>
            <small>{t("说出任务，由你确认", "Tell me the task. You stay in control.")}</small>
          </div>
        </div>
        <span className="nav-heading">{t("工作空间", "WORKSPACE")}</span>
        <nav aria-label="主导航">
          {pages.slice(0, 6).map((p) => (
            <button
              key={p.id}
              aria-label={p.id}
              aria-current={tab === p.id ? "page" : undefined}
              className={`nav-button ${tab === p.id ? "active" : ""}`}
              onClick={() => go(p.id)}
            >
              <Icon name={p.icon} />
              <span>{label(p)}</span>
              {tab === p.id && <span className="active-dot" />}
            </button>
          ))}
        </nav>
        <span className="nav-heading">{t("管理与帮助", "MANAGE & HELP")}</span>
        <nav aria-label="管理导航">
          {pages.slice(6).map((p) => (
            <button
              key={p.id}
              aria-label={p.id}
              aria-current={tab === p.id ? "page" : undefined}
              className={`nav-button ${tab === p.id ? "active" : ""}`}
              onClick={() => go(p.id)}
            >
              <Icon name={p.icon} />
              <span>{label(p)}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-help">
          <Icon name="book" size={23} />
          <strong>{t("不知道怎样开始？", "Not sure where to start?")}</strong>
          <p>{t("先告诉助理你想做什么。", "Tell the assistant what you need.")}</p>
          <button onClick={() => go("Guide")}>
            {t("查看使用指南", "Open the guide")} <Icon name="arrow" size={15} />
          </button>
        </div>
        <div className="sidebar-foot">
          <span className={`connection-dot ${token ? "online" : ""}`} />
          {token ? t("工作区已连接", "Workspace connected") : t("尚未连接工作区", "Workspace disconnected")}
          <small>Windows & macOS{appVersion ? ` · v${appVersion}` : ""}</small>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div>
            <span className="breadcrumb">
              {t("工作空间", "Workspace")} <span>/</span> {label(page)}
            </span>
          </div>
          <div className="topbar-actions">
            <select className="theme-switch" aria-label="界面语言 / Interface language" value={language} onChange={(event) => setLanguage(event.target.value as "zh" | "en")}>
              <option value="zh">中文</option><option value="en">English</option>
            </select>
            <select
              className="theme-switch"
              aria-label={t("外观主题", "Appearance theme")}
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            >
              <option value="navy">{t("商务深蓝", "Business navy")}</option>
              <option value="light">{t("明亮简洁", "Light")}</option>
              <option value="midnight">{t("深色模式", "Dark")}</option>
            </select>
            <button className="help-button" onClick={() => go("Guide")}>
              <Icon name="book" size={17} />
              {t("使用指南", "Guide")}
            </button>
            <span className="topbar-divider" />
            <div className="user-avatar">NB</div>
            <div className="workspace-user">
              <strong>{t("我的工作区", "My workspace")}</strong>
              <small>{t("由你审核 · 由你决定", "Review first. You decide.")}</small>
            </div>
          </div>
        </header>
        <section className="page-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">NIGHTBREW WORKSPACE</span>
              <h1>
                {label(page)}
                {tab === "Dashboard" && <span className="heading-dot">.</span>}
              </h1>
              <p>{t(page.description, englishPages[page.id][1])}</p>
            </div>
            <span className={`connection-pill ${token ? "connected" : ""}`}>
              <span className={`connection-dot ${token ? "online" : ""}`} />
              {token ? t("已连接", "Connected") : t("界面预览", "Interface preview")}
            </span>
          </div>
          {sessionError && (
            <div className="notice warning" role="alert">
              <Icon name="shield" />
              <div>
                <strong>{t("暂时无法连接应用服务", "Cannot connect to the app service")}</strong>
                <p>{t("请稍等后重试；若仍失败，请重新打开应用。", "Retry shortly, or reopen the app if the problem continues.")}</p>
                <button onClick={connectDesktop}>{t("重新连接", "Reconnect")}</button>
              </div>
            </div>
          )}
          {tab === "Dashboard" ? (
            <Dashboard
              api={api}
              connected={!!token}
              go={go}
              usePrompt={usePrompt}
            />
          ) : tab === "Guide" ? (
            <Guide initialPrompt={selectedPrompt} go={go} compose={compose} />
          ) : !token ? (
            <div className="panel empty-state connection-empty">
              <Icon name="shield" size={40} />
              <h2>{t("连接工作区后，就可以开始工作", "Connect your workspace to start")}</h2>
              <p>
                {t("桌面应用会自动连接。当前可先浏览指南和提示词，尚未发起任何真实任务。", "The desktop app connects automatically. You can browse the guide first; no task has been started.")}
              </p>
              <button onClick={() => go("Guide")}>
                {t("先看看怎么使用", "Show me how")} <Icon name="arrow" size={17} />
              </button>
            </div>
          ) : (
            <div className="feature-panel">
              {tab === "Assistant" ? (
                <Assistant
                  key={token}
                  api={api}
                  initialDraft={draft}
                  onDraftLoaded={() =>
                    setDraft((current) => ({ ...current, text: "" }))
                  }
                  onGuide={() => go("Guide")}
                  onSettings={() => go("AI & privacy")}
                />
              ) : tab === "Business tools" ? (
                <>
                  <div className="feature-guide">
                    <Icon name="file" />
                    <div>
                      <strong>{t("先填资料，再生成草稿，最后检查并下载", "Enter the facts, create a draft, then review and download")}</strong>
                      <p>
                        金额按你填写的数量、单价及税率计算。上传 Excel 后点击
                        Analyze Excel；下方可查看任务进度与审批。
                      </p>
                    </div>
                  </div>
                  <Business key={token} api={api} token={token} />
                </>
              ) : tab === "Connectors" ? (
                <>
                  <div className="feature-guide">
                    <Icon name="link" />
                    <div>
                      <strong>{t("请由企业管理员配置连接", "Ask your administrator to configure connections")}</strong>
                      <p>
                        标有 Mock
                        的是演示系统，不是你的真实库存。先测试只读连接，再按需开启写入和审批。
                      </p>
                    </div>
                  </div>
                  <Connectors key={token} api={api} />
                </>
              ) : tab === "Computer tools" ? (
                <>
                  <div className="feature-guide">
                    <Icon name="shield" />
                    <div>
                      <strong>{t("选择目标，再检查并批准填写内容", "Choose the target, review the values, then approve")}</strong>
                      <p>
                        {t("先读取获准的表单，再核对要填的内容。可操作范围取决于当前系统、权限和软件支持。", "Read an approved form, then review what will be filled. Availability depends on your OS, permissions and supported controls.")}
                      </p>
                    </div>
                  </div>
                  <Automation key={token} api={api} />
                </>
              ) : tab === "Employees" ? (
                <Workforce key={token} api={api} />
              ) : tab === "Subscription" ? (
                <Billing key={token} api={api} />
              ) : (
                <Settings key={token} api={api} />
              )}
            </div>
          )}
          {!window.nightbrew && (
            <details className="developer-connection">
              <summary>{t("开发者连接（浏览器预览）", "Developer connection (browser preview)")}</summary>
              <p>
                顾客的桌面应用自动连接，不需要输入会话密钥。此处只用于本机开发调试；密钥不会保存到浏览器存储。
              </p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setConnecting(true);
                  try {
                    await apiFor(connectionInput)("/session");
                    setToken(connectionInput);
                    setConnectionInput("");
                    setSessionError(false);
                  } catch {
                    setSessionError(true);
                  } finally {
                    setConnecting(false);
                  }
                }}
              >
                <label>
                  Backend session token
                  <input
                    type="password"
                    autoComplete="off"
                    value={connectionInput}
                    onChange={(e) => setConnectionInput(e.target.value)}
                  />
                </label>
                <button disabled={connecting || !connectionInput.trim()}>
                  {connecting ? t("连接中…", "Connecting…") : t("连接工作区", "Connect workspace")}
                </button>
              </form>
            </details>
          )}
          <footer className="page-footer">
            <span>NightBrew AI Employee</span>
            <span>{t("重要决定，由你掌握。AI 生成内容请审核后使用。", "You control important decisions. Review AI content before using it.")}</span>
          </footer>
        </section>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<LanguageProvider><App /></LanguageProvider>);
