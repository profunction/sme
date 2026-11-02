import { useEffect, useState } from "react";
import { type API, errorText } from "./api";
import { useLanguage } from "./i18n";
import { TaskReview } from "./TaskReview";

type Task = { id: string; tool: string; status: string; payload: unknown; error: string | null;
  result: { file?: { id: string; name: string }; totals?: { total: string; currency: string }; [key: string]: unknown } | null };

export function AssignedTask({ api, id, token }: { api: API; id: string; token?: string }) {
  const { t } = useLanguage();
  const [task, setTask] = useState<Task>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true, pending = false;
    let timer: ReturnType<typeof setInterval>;
    setTask(undefined); setError("");
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const current = await api<Task>(`/tasks/${id}`);
        if (active) {
          setTask(current); setError("");
          if (["completed", "failed", "cancelled", "interrupted"].includes(current.status)) clearInterval(timer);
        }
      } catch (failure) { if (active) setError(errorText(failure)); }
      finally { pending = false; }
    };
    timer = setInterval(() => void poll(), 1000);
    void poll();
    return () => { active = false; clearInterval(timer); };
  }, [api, id]);
  const states: Record<string, [string, string]> = {
    pending_approval: ["等待你批准，尚未执行", "Awaiting approval — not executed"],
    queued: ["已排队，尚未完成", "Queued — not completed"],
    running: ["执行中，尚未完成", "Running — not completed"],
    completed: ["任务已完成", "Task completed"],
    failed: ["任务失败，未完成", "Task failed — not completed"],
    cancel_requested: ["正在请求停止", "Stop requested"],
    cancelled: ["任务已停止", "Task stopped"],
    interrupted: ["执行被中断，请先检查结果再重试", "Interrupted — verify the outcome before retrying"],
  };
  async function act(action: "approve" | "cancel") {
    setBusy(true); setError("");
    try {
      await api(`/tasks/${id}/${action}`, "POST");
      setTask(await api<Task>(`/tasks/${id}`));
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  async function download() {
    if (!task?.result?.file || !token) return;
    setBusy(true); setError("");
    try {
      const file = task.result.file;
      const response = await fetch(`http://127.0.0.1:8765/files/${file.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(t("无法下载结果，请重试。", "Result download unavailable. Try again."));
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = file.name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  const label = task ? states[task.status] : undefined;
  return <section className="panel" aria-label={t("已分配任务状态", "Assigned task status")}>
    <h3>{t("任务执行状态", "Task execution status")}</h3>
    <p role="status"><strong>{label ? t(...label) : t("已提交，正在查询实际状态…", "Submitted. Checking actual status…")}</strong></p>
    <small>{t("任务编号", "Task ID")}: {id}</small>
    {task && <p>{task.tool} · <span className="badge">{task.status}</span></p>}
    {error && <p role="alert">{error}</p>}
    {task?.error && <p role="alert">{task.error}</p>}
    {task?.status === "pending_approval" && <>
      <TaskReview value={task.payload} />
      <button disabled={busy} onClick={() => void act("approve")}>{t("批准此任务并执行", "Approve and run this task")}</button>
    </>}
    {task && ["pending_approval", "queued", "running"].includes(task.status) &&
      <button className="secondary" disabled={busy} onClick={() => void act("cancel")}>{t("停止此任务", "Stop this task")}</button>}
    {task?.status === "completed" && <>
      {task.result?.totals && <p>{t("总额", "Total")}: {task.result.totals.total} {task.result.totals.currency}</p>}
      {task.result?.file && <button disabled={busy || !token} onClick={() => void download()}>{t("下载任务结果", "Download task result")}: {task.result.file.name}</button>}
      <details><summary>{t("查看执行结果", "View execution result")}</summary><TaskReview value={task.result} /></details>
    </>}
  </section>;
}
