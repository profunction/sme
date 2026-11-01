import { useEffect, useState } from "react";
import { type API } from "./api";
import { Icon } from "./Icon";
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
}: {
  api: API;
  connected: boolean;
  go: (p: Page) => void;
  usePrompt: (p: Prompt) => void;
}) {
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
      name: "工作中的 AI 员工",
      value: employees ? employees.filter((e) => e.active).length : "—",
      detail: "已启用的员工",
      icon: "people",
      color: "blue",
    },
    {
      name: "进行中的任务",
      value: count(["running", "queued"]),
      detail: "运行与排队中",
      icon: "clock",
      color: "violet",
    },
    {
      name: "等待你的审批",
      value: count(["pending_approval"]),
      detail: "确认后才会执行",
      icon: "shield",
      color: "amber",
    },
    {
      name: "已完成任务",
      value: count(["completed"]),
      detail: `失败 ${count(["failed", "interrupted"])} 项 · 最近 100 项`,
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
            把重复的工作，
            <br />
            交给你的 AI 团队。
          </h2>
          <p>
            从一封客户邮件、一份报价单开始。
            <br />
            你负责决定，NightBrew 帮你做好准备。
          </p>
          <button onClick={() => go("Guide")}>
            带我完成第一件事 <Icon name="arrow" size={17} />
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
            报价与文档
          </div>
          <div className="float-chip chip-two">
            <Icon name="people" />
            你的 AI 团队
          </div>
          <div className="float-chip chip-three">
            <Icon name="shield" />
            由你审核决定
          </div>
        </div>
      </div>
      {!connected && (
        <div className="notice">
          <Icon name="shield" />
          <div>
            <strong>先看看如何使用</strong>
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
            <strong>需要完成设备授权</strong>
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
        {metrics.map((m) => (
          <div className="metric-card" key={m.name}>
            <div className={`metric-icon ${m.color}`}>
              <Icon name={m.icon} />
            </div>
            <span>{m.name}</span>
            <strong>{m.value}</strong>
            <small>{m.detail}</small>
          </div>
        ))}
      </div>
      <div className="section-heading">
        <div>
          <h2>今天，想先完成什么？</h2>
          <p>选一个常用任务，不需要自己想提示词。</p>
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
            <span className="workflow-category">{p.category}</span>
            <strong>{p.title}</strong>
            <span>{p.description}</span>
            <span className="card-action">
              {p.destination ? "打开工作工具" : "使用提示词"}{" "}
              <Icon name="arrow" size={16} />
            </span>
          </button>
        ))}
      </div>
      <div className="dashboard-bottom">
        <div className="panel">
          <div className="section-heading compact">
            <h2>最近任务</h2>
            <button
              className="text-button"
              onClick={() => go("Business tools")}
            >
              查看任务与审批 →
            </button>
          </div>
          {tasks?.length ? (
            <ul className="recent-list">
              {tasks.slice(0, 4).map((t) => (
                <li key={t.id}>
                  <div className="recent-icon">
                    <Icon name="file" />
                  </div>
                  <div>
                    <strong>{toolNames[t.tool] || t.tool}</strong>
                    <small>{t.id.slice(0, 8)}</small>
                  </div>
                  <span className={`status-badge ${t.status}`}>
                    {statusNames[t.status] || t.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              <Icon name="file" size={30} />
              <strong>
                {tasks
                  ? "还没有任务，先做一个小尝试"
                  : "连接后，你的任务会显示在这里"}
              </strong>
              <p>生成一份报价草稿，就能看到进度和结果。</p>
              <button
                className="secondary"
                onClick={() => go("Business tools")}
              >
                制作第一份报价
              </button>
            </div>
          )}
        </div>
        <div className="panel system-panel">
          <h2>工作区状态</h2>
          <div className="system-line">
            <span>本地 AI</span>
            <span
              className={hardware?.ollama_available ? "good-text" : "muted"}
            >
              {hardware
                ? hardware.ollama_available
                  ? "Ollama 已连接"
                  : "尚未连接 Ollama"
                : "待检查"}
            </span>
          </div>
          <div className="system-line">
            <span>可用本地模型</span>
            <strong>{hardware ? hardware.models.length : "—"}</strong>
          </div>
          <div className="system-line">
            <span>云端使用许可</span>
            <span>
              {usage
                ? usage.policy.cloud_allowed
                  ? "已允许 · 仍需逐次同意"
                  : "默认关闭"
                : "待检查"}
            </span>
          </div>
          <div className="system-line">
            <span>近期云端费用记录</span>
            <strong>
              {usage
                ? `USD ${usage.entries.reduce((sum, e) => sum + e.cost, 0).toFixed(2)}`
                : "—"}
            </strong>
          </div>
          <small>
            最近 100 笔本地记录，可能含预留金额，并非服务商账单或已购买余额。
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
