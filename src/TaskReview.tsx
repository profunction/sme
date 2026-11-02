import { useLanguage } from "./i18n";
const labels: Record<string, string> = {
  platform: "系统",
  cpu: "处理器",
  ram_bytes: "统一内存 / RAM（字节）",
  available_ram_bytes: "可用内存（字节）",
  available_storage_bytes: "可用磁盘（字节）",
  logical_cpus: "逻辑处理器数",
  gpus: "显示设备",
  gpu_detection: "显示设备检测",
  ollama_binary_found: "检测到 Ollama 程序",
  ollama_available: "Ollama 服务可用",
  models: "已安装模型",
  benchmark: "测速结果",
  local_plan_recommended: "测速建议使用本地 AI",
  tokens_per_second: "每秒生成 token 数",
  model: "模型",
  note: "说明",
  company: "公司",
  customer: "客户 / 供应商",
  reference: "单据编号",
  kind: "单据类型",
  format: "文件格式",
  tax_percent: "税率 (%)",
  currency: "货币",
  lines: "明细",
  description: "产品说明",
  quantity: "数量",
  unit_price: "单价",
  notes: "备注",
  connector_id: "业务连接",
  record: "将写入的记录",
  destination: "目标",
  endpoint: "目标网址",
  policy_snapshot: "已保存的权限范围",
  plan: "执行计划",
  steps: "操作步骤",
  file_id: "文件编号",
  url: "网址",
  browser_hosts: "允许的网站",
  browser_writes: "允许网页写入",
  applications: "允许的应用",
  mac_applications: "允许的 Mac 应用",
  values: "确认填写的内容",
  form_snapshot: "已读取的表单",
  visible: "显示独立浏览器",
  hold_seconds: "浏览器保留时间（秒）",
  allow_network_writes: "允许此网页任务自动保存或写入",
  preview_hash: "确认内容的校验值",
  source_sha256: "原文件校验值",
};
export function TaskReview({ value }: { value: unknown }) {
  const { language, t } = useLanguage();
  if (value === null || typeof value !== "object")
    return (
      <span className="review-value">
        {typeof value === "boolean"
          ? value
            ? t("是", "Yes")
            : t("否", "No")
          : value === null
            ? t("无", "None")
            : String(value)}
      </span>
    );
  if (Array.isArray(value))
    return (
      <ol className="review-array">
        {value.map((entry, i) => (
          <li key={i}>
            <TaskReview value={entry} />
          </li>
        ))}
      </ol>
    );
  return (
    <dl className="task-review">
      {Object.entries(value).map(([key, entry]) => (
        <div key={key}>
          <dt>{language === "en" ? key.replaceAll("_", " ") : labels[key] || key}</dt>
          <dd>
            <TaskReview value={entry} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
