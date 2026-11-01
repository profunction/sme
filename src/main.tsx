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
import "./style.css";
function App() {
  const [token, setToken] = useState("");
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
      .then((s) => setToken(s.token))
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
            <strong>我的企业工作区</strong>
            <small>每一件小事，都值得做好</small>
          </div>
        </div>
        <span className="nav-heading">WORKSPACE / 工作空间</span>
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
              <span>{p.label}</span>
              {tab === p.id && <span className="active-dot" />}
            </button>
          ))}
        </nav>
        <span className="nav-heading">MANAGE / 管理与帮助</span>
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
              <span>{p.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-help">
          <Icon name="book" size={23} />
          <strong>第一次使用 NightBrew？</strong>
          <p>不用懂技术，从一份草稿开始。</p>
          <button onClick={() => go("Guide")}>
            查看使用指南 <Icon name="arrow" size={15} />
          </button>
        </div>
        <div className="sidebar-foot">
          <span className={`connection-dot ${token ? "online" : ""}`} />
          {token ? "工作区已连接" : "尚未连接工作区"}
          <small>Windows & macOS · v0.9.1</small>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div>
            <span className="breadcrumb">
              工作空间 <span>/</span> {page.label}
            </span>
          </div>
          <div className="topbar-actions">
            <select
              className="theme-switch"
              aria-label="外观主题"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            >
              <option value="navy">商务深蓝</option>
              <option value="light">明亮简洁</option>
              <option value="midnight">深色模式</option>
            </select>
            <button className="help-button" onClick={() => go("Guide")}>
              <Icon name="book" size={17} />
              使用指南
            </button>
            <span className="topbar-divider" />
            <div className="user-avatar">NB</div>
            <div className="workspace-user">
              <strong>我的工作区</strong>
              <small>由你审核 · 由你决定</small>
            </div>
          </div>
        </header>
        <section className="page-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">NIGHTBREW WORKSPACE</span>
              <h1>
                {page.label}
                {tab === "Dashboard" && <span className="heading-dot">.</span>}
              </h1>
              <p>{page.description}</p>
            </div>
            <span className={`connection-pill ${token ? "connected" : ""}`}>
              <span className={`connection-dot ${token ? "online" : ""}`} />
              {token ? "已连接" : "界面预览"}
            </span>
          </div>
          {sessionError && (
            <div className="notice warning" role="alert">
              <Icon name="shield" />
              <div>
                <strong>暂时无法连接应用服务</strong>
                <p>请稍等后重试；若仍失败，请重新打开应用。</p>
                <button onClick={connectDesktop}>重新连接</button>
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
              <h2>连接工作区后，就可以开始工作</h2>
              <p>
                桌面应用会自动连接。当前可先浏览指南和提示词，尚未发起任何真实任务。
              </p>
              <button onClick={() => go("Guide")}>
                先看看怎么使用 <Icon name="arrow" size={17} />
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
                />
              ) : tab === "Business tools" ? (
                <>
                  <div className="feature-guide">
                    <Icon name="file" />
                    <div>
                      <strong>先填资料，再生成草稿，最后检查并下载</strong>
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
                      <strong>请由企业管理员配置连接</strong>
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
                      <strong>先设定允许范围，再检查并批准计划</strong>
                      <p>
                        这是进阶功能。Windows 应用操作只支持
                        Windows；浏览器自动化需要先配置兼容浏览器。
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
              <summary>开发者连接（浏览器预览）</summary>
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
                  {connecting ? "连接中…" : "连接工作区"}
                </button>
              </form>
            </details>
          )}
          <footer className="page-footer">
            <span>NightBrew AI Employee</span>
            <span>重要决定，由你掌握。AI 生成内容请审核后使用。</span>
          </footer>
        </section>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
