import { useEffect, useState } from "react";
import { errorText, type API } from "./api";
import { Icon } from "./Icon";
import { TaskReview } from "./TaskReview";
type Employee = {
  id?: string;
  name: string;
  role: string;
  instructions: string;
  tools: string[];
  connectors: Record<string, string[]>;
  monthly_spending_limit_usd: number;
  monthly_task_limit: number;
  require_approval: boolean;
  active: boolean;
};
const fresh = (): Employee => ({
  name: "",
  role: "Admin",
  instructions: "",
  tools: ["document.generate", "excel.analyze", "document.extract"],
  connectors: {},
  monthly_spending_limit_usd: 0,
  monthly_task_limit: 100,
  require_approval: true,
  active: true,
});
const tools = [
  "ai.chat",
  "document.generate",
  "excel.analyze",
  "document.extract",
  "file.delete",
  "connector.read",
  "connector.write",
  "browser.run",
  "windows.run",
];
export function Workforce({ api }: { api: API }) {
  const [employees, setEmployees] = useState<Employee[]>([]),
    [selected, setSelected] = useState<Employee>(fresh()),
    [connectors, setConnectors] = useState<{ id: string; name: string }[]>([]),
    [tool, setTool] = useState("document.generate"),
    [payload, setPayload] = useState("{}"),
    [result, setResult] = useState<unknown>(),
    [error, setError] = useState("");
  const [assignment, setAssignment] = useState({
    company: "",
    customer: "",
    reference: "",
    description: "",
    quantity: "1",
    unit_price: "0.00",
  });
  const [advanced, setAdvanced] = useState(false);
  const roles = [
    {
      name: "销售助理",
      role: "Sales",
      instructions:
        "你是企业销售助理。根据用户提供的客户、产品和已确认价格起草专业内容。缺少价格、税务或政策资料时先询问，不能编造承诺。只准备草稿，不发送消息或提交订单。",
    },
    {
      name: "财务助理",
      role: "Finance",
      instructions:
        "你是企业财务助理。帮助整理发票和表格，区分原始资料与推测。金额计算交给确定性文档工具，缺少税务信息先询问。不代替专业财务审核，不执行支付。",
    },
    {
      name: "行政助理",
      role: "Admin",
      instructions:
        "你是企业行政助理。将用户提供的流程和政策整理成易读的草稿或检查清单。缺少的公司政策标记待确认，不编造记录，不擅自访问文件或发送消息。",
    },
    {
      name: "客服助理",
      role: "Customer Service",
      instructions:
        "你是企业客服助理。依据已提供的真实政策起草友好回复，不承诺未经确认的退款、折扣或交期。资料不足先询问，所有回复交给用户审核后自行发送。",
    },
  ];
  async function refresh() {
    setEmployees(await api<Employee[]>("/employees"));
    setConnectors(await api("/connectors"));
  }
  useEffect(() => {
    void refresh().catch((e) => setError(errorText(e)));
  }, [api]);
  async function action(fn: () => Promise<unknown>) {
    setError("");
    try {
      setResult(await fn());
      await refresh();
    } catch (e) {
      setError(errorText(e));
    }
  }
  function toggleTool(name: string) {
    setSelected({
      ...selected,
      tools: selected.tools.includes(name)
        ? selected.tools.filter((t) => t !== name)
        : [...selected.tools, name],
    });
  }
  return (
    <>
      <div className="feature-guide">
        <Icon name="people" />
        <div>
          <strong>选岗位 → 修改职责 → 保存员工 → 分配工作</strong>
          <p>
            先用一个岗位模板，不用从空白开始。默认要求任务审批，云端预算为
            0；保存后可在 AI 助理中选择这个员工。
          </p>
        </div>
      </div>
      <div className="role-presets">
        {roles.map((r) => (
          <button
            key={r.role}
            onClick={() => {
              setSelected({
                ...fresh(),
                name: r.name,
                role: r.role,
                instructions: r.instructions,
                tools: [
                  "ai.chat",
                  "document.generate",
                  "excel.analyze",
                  "document.extract",
                ],
              });
              setResult(undefined);
            }}
          >
            <Icon name="people" size={17} />
            {r.name}模板
          </button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <button
        onClick={() => {
          setSelected(fresh());
          setResult(undefined);
        }}
      >
        New employee
      </button>
      <ul className="cards">
        {employees.map((e) => (
          <li key={e.id}>
            <strong>
              {e.name} · {e.role}
            </strong>
            <span className="badge">{e.active ? "active" : "paused"}</span>
            <button className="secondary" onClick={() => setSelected(e)}>
              Edit employee
            </button>
            <button
              onClick={() => action(() => api("/tasks?employee_id=" + e.id))}
            >
              Task history
            </button>
          </li>
        ))}
      </ul>
      <h2>{selected.id ? "Edit" : "Create"} employee</h2>
      <label>
        员工名称
        <input
          aria-label="Name"
          placeholder="例如：小林 · 销售助理"
          value={selected.name}
          onChange={(e) => setSelected({ ...selected, name: e.target.value })}
        />
      </label>
      <label>
        岗位
        <input
          aria-label="Role"
          value={selected.role}
          onChange={(e) => setSelected({ ...selected, role: e.target.value })}
        />
      </label>
      <label>
        员工的工作说明（可以修改模板）
        <textarea
          aria-label="Instructions"
          value={selected.instructions}
          onChange={(e) =>
            setSelected({ ...selected, instructions: e.target.value })
          }
        />
      </label>
      <h3>Assigned tools</h3>
      {tools.map((t) => (
        <label key={t}>
          <input
            type="checkbox"
            checked={selected.tools.includes(t)}
            onChange={() => toggleTool(t)}
          />
          {t}
        </label>
      ))}
      <h3>Connector permissions</h3>
      {connectors.map((c) => (
        <div key={c.id}>
          {c.name}
          {["read", "write"].map((access) => (
            <label key={access}>
              <input
                type="checkbox"
                checked={(selected.connectors[c.id] || []).includes(access)}
                onChange={(e) =>
                  setSelected({
                    ...selected,
                    connectors: {
                      ...selected.connectors,
                      [c.id]: e.target.checked
                        ? [...(selected.connectors[c.id] || []), access]
                        : (selected.connectors[c.id] || []).filter(
                            (v) => v !== access,
                          ),
                    },
                  })
                }
              />
              {access}
            </label>
          ))}
        </div>
      ))}
      <label>
        Monthly AI spending limit (USD)
        <input
          type="number"
          min={0}
          value={selected.monthly_spending_limit_usd}
          onChange={(e) =>
            setSelected({
              ...selected,
              monthly_spending_limit_usd: Number(e.target.value),
            })
          }
        />
      </label>
      <label>
        Monthly assigned job limit
        <input
          type="number"
          min={0}
          value={selected.monthly_task_limit}
          onChange={(e) =>
            setSelected({
              ...selected,
              monthly_task_limit: Number(e.target.value),
            })
          }
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={selected.require_approval}
          onChange={(e) =>
            setSelected({ ...selected, require_approval: e.target.checked })
          }
        />{" "}
        Require approval for all jobs (consequential tools always require
        approval)
      </label>
      <label>
        <input
          type="checkbox"
          checked={selected.active}
          onChange={(e) =>
            setSelected({ ...selected, active: e.target.checked })
          }
        />{" "}
        Active employee
      </label>
      <button
        onClick={() =>
          action(async () => {
            const saved = await api<Employee>(
              selected.id ? "/employees/" + selected.id : "/employees",
              selected.id ? "PUT" : "POST",
              selected,
            );
            setSelected(saved);
            return saved;
          })
        }
      >
        Save employee
      </button>
      {selected.id && (
        <>
          <h2>Assign a job to {selected.name}</h2>
          <p>日常报价可以直接填下方表单；其他工具的任务结构留给管理员配置。</p>
          <label>
            <input
              type="checkbox"
              checked={advanced}
              onChange={(e) => setAdvanced(e.target.checked)}
            />
            进阶任务配置（JSON）
          </label>
          {!advanced && (
            <div className="row">
              {(
                [
                  ["company", "报价公司"],
                  ["customer", "客户名称"],
                  ["reference", "报价编号"],
                  ["description", "产品或服务"],
                  ["quantity", "数量"],
                  ["unit_price", "已确认单价（MYR）"],
                ] as const
              ).map(([field, label]) => (
                <label key={field}>
                  {label}
                  <input
                    type={
                      field === "quantity" || field === "unit_price"
                        ? "number"
                        : "text"
                    }
                    min={field === "quantity" ? "0.001" : "0"}
                    step="any"
                    value={assignment[field]}
                    onChange={(e) =>
                      setAssignment({ ...assignment, [field]: e.target.value })
                    }
                  />
                </label>
              ))}
            </div>
          )}
          {advanced && (
            <>
              <label>
                Tool
                <select value={tool} onChange={(e) => setTool(e.target.value)}>
                  {selected.tools
                    .filter((t) => t !== "ai.chat")
                    .map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                </select>
              </label>
              <label>
                Task data (JSON)
                <textarea
                  value={payload}
                  onChange={(e) => setPayload(e.target.value)}
                />
              </label>
              <p>
                Use the documented task schemas. For connector writes provide
                connector_id and record; the backend binds the current connector
                configuration before approval.
              </p>
            </>
          )}
          <button
            disabled={
              !advanced &&
              (!selected.tools.includes("document.generate") ||
                !assignment.company.trim() ||
                !assignment.customer.trim() ||
                !assignment.reference.trim() ||
                !assignment.description.trim() ||
                !Number.isFinite(Number(assignment.quantity)) ||
                Number(assignment.quantity) <= 0 ||
                !Number.isFinite(Number(assignment.unit_price)) ||
                Number(assignment.unit_price) < 0)
            }
            onClick={() =>
              action(() => {
                const data = advanced
                  ? JSON.parse(payload)
                  : {
                      company: assignment.company,
                      customer: assignment.customer,
                      reference: assignment.reference,
                      lines: [
                        {
                          description: assignment.description,
                          quantity: assignment.quantity,
                          unit_price: assignment.unit_price,
                        },
                      ],
                    };
                const selectedTool = advanced ? tool : "document.generate";
                return selectedTool === "connector.write"
                  ? api(
                      `/employees/${selected.id}/connector-writes/${data.connector_id}`,
                      "POST",
                      { record: data.record },
                    )
                  : api("/tasks", "POST", {
                      tool: selectedTool,
                      payload: data,
                      employee_id: selected.id,
                    });
              })
            }
          >
            Assign task
          </button>
        </>
      )}
      {result !== undefined && (
        <div className="panel">
          <h3>保存 / 任务结果</h3>
          <TaskReview value={result} />
          <details>
            <summary>进阶诊断数据</summary>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      )}
    </>
  );
}
