import { useEffect, useState } from "react";
import type { API } from "./api";

type PORow = { sku: string; description: string; quantity: string; unit_price: string; line_total: string };
export type POImport = { file_id: string; source_sha256: string; rows: PORow[] };
type ReviewInput = POImport & {
  reference: string; customer: string; currency: string; tax_percent: string;
  expected_total: string; format: string; catalog: { sku: string; unit_price: string }[];
};
export type POReport = {
  valid: boolean; review_hash: string; review: ReviewInput;
  issues: { row: number | null; field: string; message: string }[];
  totals: { subtotal: string; tax: string; total: string; currency: string } | null;
};
type Props = {
  api: API;
  files: { id: string; name: string }[];
  tasks: { id: string; tool: string; status: string; result: { purchase_order?: POImport; po_review?: POReport } | null }[];
  disabled: boolean;
  action: (fn: () => Promise<unknown>) => Promise<void>;
};
export function PurchaseOrder({ api, files, tasks, disabled, action }: Props) {
  const [fileId, setFileId] = useState("");
  const [source, setSource] = useState<POImport>();
  const [rows, setRows] = useState<(PORow & { approved_price: string })[]>([]);
  const [reference, setReference] = useState("");
  const [customer, setCustomer] = useState("");
  const [tax, setTax] = useState("0");
  const [currency, setCurrency] = useState("MYR");
  const [expectedTotal, setExpectedTotal] = useState("");
  const [format, setFormat] = useState("csv");
  const [reviewTask, setReviewTask] = useState("");
  const [report, setReport] = useState<POReport>();
  function changed() { setReport(undefined); setReviewTask(""); }
  useEffect(() => {
    const task = tasks.find((task) => task.id === reviewTask);
    if (task?.result?.po_review) setReport(task.result.po_review);
  }, [tasks, reviewTask]);
  function load(imported: POImport) {
    changed(); setSource(imported);
    setRows(imported.rows.map((row) => ({ ...row, approved_price: "" })));
  }
  function update(index: number, field: keyof (PORow & { approved_price: string }), value: string) {
    changed();
    setRows(rows.map((row, i) => i === index ? {
      ...row, [field]: value, ...(field === "sku" ? { approved_price: "" } : {}),
    } : row));
  }
  return <section>
    <h2>采购单校验与导出 / Purchase order review</h2>
    <p>本地处理，无需 AI API。暂只支持单工作表 XLSX 或 UTF-8 CSV，固定表头：sku, description, quantity, unit_price，可选 line_total。PDF 请先提取文字并人工整理成此模板；不支持扫描件识别。</p>
    <fieldset disabled={disabled}>
      <label>选择采购单模板文件
        <select value={fileId} onChange={(event) => setFileId(event.target.value)}>
          <option value="">请选择已上传的 CSV / XLSX</option>
          {files.filter((file) => /\.(csv|xlsx)$/i.test(file.name)).map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}
        </select>
      </label>
      <button disabled={!fileId} onClick={() => action(() => api("/tasks", "POST", { tool: "purchase_order.import", payload: { file_id: fileId } }))}>导入明细 / Import lines</button>
      {tasks.filter((task) => task.result?.purchase_order).map((task) => <button key={task.id} className="secondary" onClick={() => load(task.result!.purchase_order!)}>载入导入结果 · {files.find((file) => file.id === task.result!.purchase_order!.file_id)?.name || task.id.slice(0, 8)}</button>)}
    </fieldset>
    {source && <form onSubmit={(event) => {
      event.preventDefault(); changed();
      void action(async () => {
        const result = await api<{ id: string }>("/tasks", "POST", { tool: "purchase_order.review", payload: {
          file_id: source.file_id, source_sha256: source.source_sha256,
          reference, customer, currency, tax_percent: tax, expected_total: expectedTotal, format,
          rows: rows.map(({ approved_price: _, ...row }) => row),
          catalog: rows.map((row) => ({ sku: row.sku, unit_price: row.approved_price })),
        } });
        setReviewTask(result.id);
      });
    }}>
      <fieldset disabled={disabled}>
        <p>请逐行核对原单，并从已确认的产品价格表填写“核准单价”。系统不会把采购单自己的价格当作核准价格。任何修改都需要重新校验。</p>
        <div className="row">
          <label>采购单编号<input required maxLength={80} value={reference} onChange={(e) => { changed(); setReference(e.target.value); }} /></label>
          <label>客户 / 供应商<input required maxLength={150} value={customer} onChange={(e) => { changed(); setCustomer(e.target.value); }} /></label>
          <label>货币<input required pattern="[A-Z]{3}" maxLength={3} value={currency} onChange={(e) => { changed(); setCurrency(e.target.value.toUpperCase()); }} /></label>
          <label>税率 (%)<input required inputMode="decimal" value={tax} onChange={(e) => { changed(); setTax(e.target.value); }} /></label>
          <label>原采购单总额<input required inputMode="decimal" value={expectedTotal} onChange={(e) => { changed(); setExpectedTotal(e.target.value); }} /></label>
          <label>导出格式<select value={format} onChange={(e) => { changed(); setFormat(e.target.value); }}><option value="csv">CSV</option><option value="xlsx">Excel XLSX</option></select></label>
        </div>
        {rows.map((row, index) => <div className="row line" key={index}>
          <strong>#{index + 1}</strong>
          {([['sku', '产品 SKU'], ['description', '说明'], ['quantity', '数量'], ['unit_price', '采购单价'], ['line_total', '原单行总额（可选）'], ['approved_price', '核准单价']] as const).map(([field, label]) => <label key={field}>{label}<input required={field !== 'line_total'} maxLength={field === 'description' ? 200 : field === 'sku' ? 100 : 30} value={row[field]} onChange={(e) => update(index, field, e.target.value)} /></label>)}
        </div>)}
        <button>校验产品、价格与总额 / Validate</button>
      </fieldset>
    </form>}
    {report && <div className="feature-guide">
      <div><strong>{report.valid ? "校验通过，下一步申请导出审批" : "有差异，请修改后重新校验"}</strong>
        {report.totals && <p>小计 {report.totals.subtotal} · 税额 {report.totals.tax} · 总额 {report.totals.total} {report.totals.currency}</p>}
        {report.issues.length > 0 && <ul>{report.issues.map((issue, index) => <li key={index}>{issue.row ? `第 ${issue.row} 行 · ` : ''}{issue.field}: {issue.message}</li>)}</ul>}
        <button disabled={disabled || !report.valid} onClick={() => action(() => api("/tasks", "POST", { tool: "purchase_order.export", payload: { ...report.review, review_hash: report.review_hash } }))}>申请导出审批 / Request export approval</button>
        <p>请在下方任务记录核对并批准。导出文件随后出现在本地文件列表；这是中性模板，不代表已兼容任何 ERP，也不会提交外部系统。</p>
      </div>
    </div>}
  </section>;
}
