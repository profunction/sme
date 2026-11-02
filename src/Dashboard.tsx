import { useEffect, useState } from "react";
import { type API } from "./api";
import { Icon } from "./Icon";
import { useLanguage, localizedPrompt, localizedCategory } from "./i18n";
import { prompts, type Page, type Prompt } from "./workspace";
type Task = { id: string; tool: string; status: string; error?: string };
type Hardware = {
  ollama_available: boolean;
  models: string[];
  ram_bytes: number;
  platform: string;
  local_plan_recommended: boolean;
};
const toolNames: Record<string, string> = {
  "document.generate": "生成业务文档",
  "excel.analyze": "分析 Excel",
  "document.extract": "提取文档文字",
  "file.delete": "删除文件",
  "connector.read": "读取业务系统",
  "connector.write": "更新业务系统",
  "browser.run": "浏览器操作",
  "windows.run": "Windows 操作",
};
export const statusNames: Record<string, string> = {
  completed: "已完成",
  failed: "失败",
  pending_approval: "待你审批",
  queued: "排队中",
  running: "进行中",
  cancelled: "已取消",
  interrupted: "已中断",
};
export function Dashboard({
  api,
  connected,
  go,
  usePrompt,
  openTasks,
}: {
  api: API;
  connected: boolean;
  go: (p: Page) => void;
  openTasks?: (filter: string, id?: string) => void;
  usePrompt: (p: Prompt) => void;
}) {
  const { t, language } = useLanguage();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [employees, setEmployees] = useState<{ active: boolean }[] | null>(
    null,
  );
  const [hardware, setHardware] = useState<Hardware | null>(null);
  const [usage, setUsage] = useState<{
    entries: { cost: number }[];
    policy: { cloud_allowed: boolean; monthly_limit_usd: number };
  } | null>(null);
  const [license, setLicense] = useState<{
    required: boolean;
    valid: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!connected) return;
    let active = true;
    async function refresh() {
      const results = await Promise.allSettled([
        api<Task[]>("/tasks"),
        api<{ active: boolean }[]>("/employees"),
        api<Hardware>("/hardware"),
        api<NonNullable<typeof usage>>("/usage"),
        api<NonNullable<typeof license>>("/license"),
      ]);
      if (!active) return;
      const [t, e, h, u, l] = results;
      if (t.status === "fulfilled") setTasks(t.value);
      if (e.status === "fulfilled") setEmployees(e.value);
      if (h.status === "fulfilled") setHardware(h.value);
      if (u.status === "fulfilled") setUsage(u.value);
      if (l.status === "fulfilled") setLicense(l.value);
      setError(
        results.some((r) => r.status === "rejected")
          ? "部分工作区状态暂时读取失败。请检查连接，稍后会自动重试。"
          : "",
      );
    }
    void refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api, connected]);
  const count = (s: string[]) =>
    tasks ? tasks.filter((t) => s.includes(t.status)).length : "—";
  const metrics = [
    {
      name: t("工作中的 AI 员工", "Active AI employees"),
      value: employees ? employees.filter((e) => e.active).length : "—",
      detail: t("已启用的员工", "Enabled employees"),
      icon: "people",
      color: "blue",
    },
    {
      name: t("进行中的任务", "Tasks in progress"),
      value: count(["running", "queued"]),
      detail: t("运行与排队中", "Running and queued"),
      icon: "clock",
      color: "violet",
    },
    {
      name: t("等待你的审批", "Awaiting your approval"),
      value: count(["pending_approval"]),
      detail: t("确认后才会执行", "Runs only after approval"),
      icon: "shield",
      color: "amber",
    },
    {
      name: t("已完成任务", "Completed tasks"),
      value: count(["completed"]),
      detail: t(`失败 ${count(["failed", "interrupted"])} 项 · 最近 100 项`, `Failed ${count(["failed", "interrupted"])} · latest 100 tasks`),
      icon: "check",
      color: "green",
    },
  ];
  return (
    <>
      <div className="welcome-panel">
        <div className="welcome-copy">
          <span className="eyebrow">LESS BUSYWORK. MORE BUSINESS.</span>
          <h2>
            {t("把重复的工作，", "Less repeated work.")}
            <br />
            {t("交给你的 AI 团队。", "More help from your assistant.")}
          </h2>
          <p>
            {t("从一句话开始，告诉助理你想完成什么。", "Start with one sentence. Tell the assistant what you need.")}
            <br />
            {t("你负责决定，NightBrew 帮你做好准备。", "You decide; NightBrew prepares the work.")}
          </p>
          <button onClick={() => go("Assistant")}>
            {t("开始对话", "Start a conversation")} <Icon name="arrow" size={17} />
          </button>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="hero-core">
            <Icon name="sparkle" size={43} />
            <span>NightBrew</span>
          </div>
          <div className="float-chip chip-one">
            <Icon name="file" />
            {t("报价与文档", "Quotes and documents")}
          </div>
          <div className="float-chip chip-two">
            <Icon name="people" />
            {t("你的 AI 团队", "Your AI team")}
          </div>
          <div className="float-chip chip-three">
            <Icon name="shield" />
            {t("由你审核决定", "You review and decide")}
          </div>
        </div>
      </div>
      {!connected && (
        <div className="notice">
          <Icon name="shield" />
          <div>
            <strong>{t("先看看如何使用", "See how to start")}</strong>
            <p>
              当前未连接工作区，数字显示为“—”。指南和提示词可以直接浏览；真实任务需要应用连接成功。
            </p>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {license?.required && !license.valid && (
        <div className="notice warning">
          <Icon name="card" />
          <div>
            <strong>{t("需要完成设备授权", "Device activation required")}</strong>
            <p>
              此安装包尚未激活。你仍可查看指南；正式 AI 与任务功能需要有效授权。
            </p>
            <button className="text-button" onClick={() => go("Subscription")}>
              查看授权设置 →
            </button>
          </div>
        </div>
      )}
      <div className="metric-grid">
        {metrics.map((m, index) => (
          <button type="button" className="metric-card" key={m.name} style={{ textAlign: "left", color: "inherit", width: "100%" }} onClick={() => index === 0 ? go("Employees") : openTasks ? openTasks(["all", "running", "pending_approval", "completed"][index]) : go("Business tools")}>
            <div className={`metric-icon ${m.color}`}>
              <Icon name={m.icon} />
            </div>
            <span>{m.name}</span>
            <strong>{m.value}</strong>
            <small>{m.detail} · {t("点击查看", "View details")} →</small>
          </button>
        ))}
      </div>
      <div className="section-heading">
        <div>
          <h2>{t("今天，想先完成什么？", "What would you like to do first?")}</h2>
          <p>{t("选一个常用任务，不需要自己想提示词。", "Choose a task, or tell the assistant what you need.")}</p>
        </div>
        <button className="text-button" onClick={() => go("Guide")}>
          查看全部模板 <Icon name="arrow" size={16} />
        </button>
      </div>
      <div className="workflow-grid">
        {prompts.slice(0, 4).map((p) => (
          <button
            className="workflow-card"
            key={p.id}
            onClick={() => usePrompt(p)}
          >
            <span className="workflow-icon">
              <Icon name={p.icon} size={24} />
            </span>
            <span className="workflow-category">{localizedCategory(p.category, language)}</span>
            <strong>{localizedPrompt(p, language).title}</strong>
            <span>{localizedPrompt(p, language).description}</span>
            <span className="card-action">
              {p.destination ? t("打开工作工具", "Open tool") : t("使用提示词", "Use example")}{" "}
              <Icon name="arrow" size={16} />
            </span>
          </button>
        ))}
      </div>
      <div className="dashboard-bottom">
        <div className="panel">
          <div className="section-heading compact">
            <h2>{t("最近任务", "Recent tasks")}</h2>
            <button
              className="text-button"
              onClick={() => go("Business tools")}
            >
              {t("查看任务与审批 →", "Tasks and approvals →")}
            </button>
          </div>
          {tasks?.length ? (
            <ul className="recent-list">
              {tasks.slice(0, 4).map((task) => (
                <li key={task.id}>
                  <div className="recent-icon">
                    <Icon name="file" />
                  </div>
                  <div>
                    <strong>{t(toolNames[task.tool] || task.tool, task.tool)}</strong>
                    <small>{task.id.slice(0, 8)}</small>
                    <button className="text-button" onClick={() => openTasks ? openTasks("all", task.id) : go("Business tools")}>{t("查看结果", "View result")}</button>
                  </div>
                  <span className={`status-badge ${task.status}`}>
                    {t(statusNames[task.status] || task.status, task.status.replaceAll("_", " "))}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              <Icon name="file" size={30} />
              <strong>
                {tasks
                  ? t("还没有任务，先做一个小尝试", "No tasks yet. Try something small.")
                  : t("连接后，你的任务会显示在这里", "Your tasks appear here after connecting.")}
              </strong>
              <p>{t("生成一份报价草稿，就能看到进度和结果。", "Create a quotation draft to see its progress and result.")}</p>
              <button
                className="secondary"
                onClick={() => go("Business tools")}
              >
                {t("制作第一份报价", "Create a quotation")}
              </button>
            </div>
          )}
        </div>
        <div className="panel system-panel">
          <h2>{t("工作区状态", "Workspace status")}</h2>
          <div className="system-line">
            <span>{t("本地 AI", "Local AI")}</span>
            <span
              className={hardware?.ollama_available ? "good-text" : "muted"}
            >
              {hardware
                ? hardware.ollama_available
                  ? t("Ollama 已连接", "Ollama connected")
                  : t("尚未连接 Ollama", "Ollama disconnected")
                : t("待检查", "Not checked")}
            </span>
          </div>
          <div className="system-line">
            <span>{t("可用本地模型", "Installed local models")}</span>
            <strong>{hardware ? hardware.models.length : "—"}</strong>
          </div>
          <div className="system-line">
            <span>{t("云端使用许可", "Cloud permission")}</span>
            <span>
              {usage
                ? usage.policy.cloud_allowed
                  ? t("已允许 · 仍需逐次同意", "Allowed · consent for each request")
                  : t("默认关闭", "Off by default")
                : t("待检查", "Not checked")}
            </span>
          </div>
          <div className="system-line">
            <span>{t("近期云端费用记录", "Recent cloud usage records")}</span>
            <strong>
              {usage
                ? `USD ${usage.entries.reduce((sum, e) => sum + e.cost, 0).toFixed(2)}`
                : "—"}
            </strong>
          </div>
          <small>
            {t("最近 100 笔本地记录，可能含预留金额，并非服务商账单或已购买余额。", "Latest 100 local records, which may include reservations. These are not provider invoices or purchased credit balances.")}
          </small>
          <button
            className="secondary full-width"
            onClick={() => go("AI & privacy")}
          >
            检查 AI 与隐私设置 <Icon name="arrow" size={16} />
          </button>
        </div>
      </div>
    </>
  );
}
