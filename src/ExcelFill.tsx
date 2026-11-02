import { useEffect, useState } from "react";
import type { API } from "./api";
import { useLanguage } from "./i18n";

export type SpreadsheetInspection = {
  file_id: string; source_sha256: string; preview_limit: number;
  sheets: { name: string; rows: number; columns: number;
    cells: { cell: string; value: string | number | boolean | null; kind: string; editable: boolean }[] }[];
};
type CellEdit = { sheet: string; cell: string; kind: "text" | "number" | "boolean" | "blank"; value: string };
export type SpreadsheetPreview = {
  changes: { sheet: string; cell: string; before: string | number | boolean | null;
    after: string | number | boolean | null; kind: string }[];
  preview_hash: string;
  fill: { file_id: string; source_sha256: string; values: CellEdit[] };
};
type Props = {
  api: API;
  files: { id: string; name: string }[];
  tasks: { id: string; tool: string; status: string; error?: string | null;
    result: { spreadsheet?: SpreadsheetInspection; spreadsheet_preview?: SpreadsheetPreview;
      file?: { id: string; name: string } } | null }[];
  disabled: boolean;
  action: (fn: () => Promise<unknown>) => Promise<void>;
};
const emptyEdit = (sheet: string): CellEdit => ({ sheet, cell: "", kind: "text", value: "" });

export function ExcelFill({ api, files, tasks, disabled, action }: Props) {
  const { t } = useLanguage();
  const [fileId, setFileId] = useState("");
  const [inspectId, setInspectId] = useState("");
  const [loadedId, setLoadedId] = useState("");
  const [source, setSource] = useState<SpreadsheetInspection>();
  const [edits, setEdits] = useState<CellEdit[]>([]);
  const [previewId, setPreviewId] = useState("");
  const [preview, setPreview] = useState<SpreadsheetPreview>();
  const [fillId, setFillId] = useState("");
  const inspectTask = tasks.find((task) => task.id === inspectId);
  const previewTask = tasks.find((task) => task.id === previewId);
  const fillTask = tasks.find((task) => task.id === fillId);
  const fillStatus = fillTask?.status || (fillId ? "pending_approval" : "");
  const savedTaskActive = ["pending_approval", "queued", "running", "cancel_requested"].includes(fillStatus);
  const blocked = disabled || savedTaskActive;
  const shown = (value: string | number | boolean | null) => value === null ? t("（空白）", "(blank)") : String(value);

  function changed() { setPreview(undefined); setPreviewId(""); setFillId(""); }
  useEffect(() => {
    if (inspectTask?.result?.spreadsheet && inspectId !== loadedId) {
      const value = inspectTask.result.spreadsheet;
      setSource(value);
      setEdits(value.sheets.length ? [emptyEdit(value.sheets[0].name)] : []);
      setLoadedId(inspectId);
    }
  }, [inspectTask, inspectId, loadedId]);
  useEffect(() => {
    if (previewTask?.result?.spreadsheet_preview) setPreview(previewTask.result.spreadsheet_preview);
  }, [previewTask]);
  function update(index: number, patch: Partial<CellEdit>) {
    changed(); setEdits(edits.map((edit, i) => i === index ? { ...edit, ...patch } : edit));
  }
  const failure = [inspectTask, previewTask, fillTask].find((task) => task && ["failed", "interrupted"].includes(task.status));
  return <section data-testid="excel-fill">
    <h2>{t("填写 Excel 模板", "Fill an Excel template")}</h2>
    <p>{t("选模板 → 填写内容 → 预览并确认。程序生成新文件，原文件保持不变。", "Choose a template, enter values, then preview and confirm. A new file is created; the original stays unchanged.")}</p>
    <fieldset disabled={blocked}>
      <legend>{t("1. 选择模板", "1. Choose a template")}</legend>
      <label>{t("Excel 模板文件", "Excel template file")}
        <select value={fileId} onChange={(event) => {
          changed(); setFileId(event.target.value); setInspectId(""); setLoadedId(""); setSource(undefined); setEdits([]);
        }}>
          <option value="">{t("选择已上传的 XLSX 文件", "Choose an uploaded XLSX file")}</option>
          {files.filter((file) => /\.xlsx$/i.test(file.name)).map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}
        </select>
      </label>
      {!files.some((file) => /\.xlsx$/i.test(file.name)) && <p>{t("请先在本页上传一个 XLSX 文件。", "Upload an XLSX file on this page first.")}</p>}
      <button disabled={!fileId} onClick={() => action(async () => {
        changed(); setSource(undefined);
        const task = await api<{ id: string }>("/tasks", "POST", { tool: "excel.inspect", payload: { file_id: fileId } });
        setInspectId(task.id);
      })}>{t("读取模板", "Inspect template")}</button>
    </fieldset>
    {inspectId && !source && !failure && <p role="status">{t("正在读取模板…", "Reading the template…")}</p>}
    {source && <>
      <form onSubmit={(event) => {
        event.preventDefault(); changed();
        void action(async () => {
          const task = await api<{ id: string }>("/tasks", "POST", { tool: "excel.preview", payload: {
            file_id: source.file_id, source_sha256: source.source_sha256, values: edits,
          } });
          setPreviewId(task.id);
        });
      }}>
        <fieldset disabled={blocked || !source.sheets.length}>
          <legend>{t("2. 填写内容", "2. Enter values")}</legend>
          {edits.map((edit, index) => <div className="row line" key={index}>
            <label>{t("工作表", "Worksheet")} #{index + 1}<select value={edit.sheet} onChange={(e) => update(index, { sheet: e.target.value })}>
              {source.sheets.map((sheet) => <option key={sheet.name} value={sheet.name}>{sheet.name}</option>)}
            </select></label>
            <label>{t("单元格", "Cell")} #{index + 1}<input required pattern="[A-Z]{1,3}[1-9][0-9]{0,6}" placeholder={t("例如 B2", "For example B2")} value={edit.cell} onChange={(e) => update(index, { cell: e.target.value.toUpperCase() })} /></label>
            {edit.kind === "boolean" ? <label>{t("填入内容", "Value")} #{index + 1}<select value={edit.value} onChange={(e) => update(index, { value: e.target.value })}><option value="true">{t("是", "True")}</option><option value="false">{t("否", "False")}</option></select></label> :
              <label>{t("填入内容", "Value")} #{index + 1}<input disabled={edit.kind === "blank"} maxLength={4000} value={edit.value} onChange={(e) => update(index, { value: e.target.value })} /></label>}
            <details><summary>{t("内容类型", "Value type")}</summary>
              <label>{t("选择内容类型", "Choose a value type")} #{index + 1}<select value={edit.kind} onChange={(e) => {
                const kind = e.target.value as CellEdit["kind"];
                update(index, { kind, value: kind === "blank" ? "" : kind === "boolean" ? "true" : edit.value });
              }}><option value="text">{t("文字（保留前导零）", "Text (keep leading zeros)")}</option><option value="number">{t("数字", "Number")}</option><option value="boolean">{t("是 / 否", "True / false")}</option><option value="blank">{t("清空单元格", "Clear the cell")}</option></select></label>
            </details>
            <button type="button" className="secondary" disabled={edits.length <= 1} onClick={() => { changed(); setEdits(edits.filter((_, i) => i !== index)); }}>{t("移除", "Remove")} #{index + 1}</button>
          </div>)}
          <button type="button" className="secondary" disabled={edits.length >= 100} onClick={() => { changed(); setEdits([...edits, emptyEdit(source.sheets[0].name)]); }}>{t("再填一个单元格", "Add another cell")}</button>
          <button disabled={!edits.length}>{t("预览修改", "Preview changes")}</button>
        </fieldset>
      </form>
      <details>
        <summary>{t("查看模板内容与支持范围", "Template contents and supported cells")}</summary>
        <p>{t(`只展示最多 ${source.preview_limit} 个非空单元格。公式、合并、保护和数据校验单元格不支持覆盖；公式不会重新计算。`, `Shows up to ${source.preview_limit} non-empty cells. Formula, merged, protected and validated cells cannot be overwritten. Formulas are not recalculated.`)}</p>
        {source.sheets.map((sheet) => <details key={sheet.name}>
          <summary>{sheet.name} · {sheet.rows} × {sheet.columns}</summary>
          <table><thead><tr><th>{t("单元格", "Cell")}</th><th>{t("当前内容", "Current value")}</th><th>{t("选择", "Select")}</th></tr></thead><tbody>
            {sheet.cells.map((cell) => <tr key={cell.cell}><td>{cell.cell}</td><td>{shown(cell.value)}</td><td><button type="button" disabled={blocked || !cell.editable || edits.length >= 100} onClick={() => {
              changed();
              if (edits.length === 1 && !edits[0].cell) setEdits([{ ...edits[0], sheet: sheet.name, cell: cell.cell }]);
              else setEdits([...edits, { ...emptyEdit(sheet.name), cell: cell.cell }]);
            }}>{t("填写", "Fill")} {sheet.name}!{cell.cell}</button></td></tr>)}
          </tbody></table>
        </details>)}
      </details>
    </>}
    {previewId && !preview && !failure && <p role="status">{t("正在检查修改…", "Checking the changes…")}</p>}
    {preview && <div className="feature-guide"><div>
      <h3>{t("3. 预览并确认", "3. Preview and confirm")}</h3>
      <table><thead><tr><th>{t("目标", "Target")}</th><th>{t("修改前", "Before")}</th><th>{t("修改后", "After")}</th></tr></thead><tbody>
        {preview.changes.map((edit) => <tr key={edit.sheet + "!" + edit.cell}><td>{edit.sheet}!{edit.cell}</td><td>{shown(edit.before)}</td><td>{shown(edit.after)}</td></tr>)}
      </tbody></table>
      {!fillId && <button disabled={disabled} onClick={() => action(async () => {
        const task = await api<{ id: string }>("/tasks", "POST", { tool: "excel.fill", payload: { ...preview.fill, preview_hash: preview.preview_hash } });
        setFillId(task.id);
      })}>{t("准备填写", "Prepare to fill")}</button>}
      {fillStatus === "pending_approval" && <>
        <p>{t("确认后会按以上内容生成新文件。", "Confirm to create a new file with the values shown above.")}</p>
        <button disabled={disabled} onClick={() => action(() => api(`/tasks/${fillId}/approve`, "POST"))}>{t("确认填写这些单元格", "Confirm these cell changes")}</button>
        <button className="secondary" disabled={disabled} onClick={() => action(() => api(`/tasks/${fillId}/cancel`, "POST"))}>{t("取消", "Cancel")}</button>
      </>}
      {["queued", "running", "cancel_requested"].includes(fillStatus) && <p role="status">{t("正在生成新文件…", "Creating the new file…")}</p>}
      {fillStatus === "completed" && <p role="status">{t("新文件已生成，请到本页文件列表下载：", "The new file is ready. Download it from the file list on this page:")} {fillTask?.result?.file?.name}</p>}
      {fillStatus === "cancelled" && <p role="status">{t("已取消，原文件保持不变。修改内容后可重新预览。", "Cancelled. The original file is unchanged. Edit the values to start a new preview.")}</p>}
    </div></div>}
    {failure && <p role="alert">{t("未完成，请核对模板和填写内容后重新读取。详细记录可在任务历史查看。", "Could not finish. Check the template and values, then inspect again. Details are available in task history.")}</p>}
  </section>;
}
