import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { useLanguage, localizedPrompt, localizedCategory, localizedField } from "./i18n";
import { prompts, type Page, type Prompt } from "./workspace";
export function Guide({
  initialPrompt,
  go,
  compose,
}: {
  initialPrompt: Prompt | null;
  go: (p: Page) => void;
  compose: (text: string) => void;
}) {
  const { language, t } = useLanguage();
  const [selected, setSelected] = useState<Prompt | null>(initialPrompt);
  const [values, setValues] = useState<Record<string, string>>({});
  const [category, setCategory] = useState("全部");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [understood, setUnderstood] = useState(
    () => localStorage.getItem("nightbrew.guide.seen") === "1",
  );
  useEffect(() => {
    setSelected(initialPrompt);
    setValues({});
    setCopied(false);
  }, [initialPrompt]);
  const fields = selected
    ? [
        ...new Set(
          [...selected.prompt.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]),
        ),
      ]
    : [];
  const text =
    selected && localizedPrompt(selected, language).prompt.replace(
      /\[([^\]]+)\]/g,
      (match, field: string) => values[field]?.trim() || (language === "zh" ? match : `[${localizedField(field, language)}]`),
    ) || "";
  const complete = fields.every((f) => values[f]?.trim());
  function pick(p: Prompt) {
    setSelected(p);
    setValues({});
    setCopied(false);
    setCopyError("");
  }
  return (
    <>
      <div className="guide-intro panel">
        <span className="eyebrow">YOUR FIRST 5 MINUTES</span>
        <h2>{t("不用学提示词，先说清楚一件事。", "No prompt skills needed. Start with one task.")}</h2>
        <button onClick={() => go("Assistant")}>{t("直接告诉助理我要做什么", "Tell the assistant what I need")}</button>
        <p>
          NightBrew
          可以帮你准备内容和处理资料。实际发送、修改或提交前，仍然由你决定。
        </p>
        <div className="guide-steps">
          <div>
            <b>01</b>
            <h3>{t("先检查连接", "Check the connection")}</h3>
            <p>
              打开应用后自动连接工作区。聊天还需要可用的本地模型或已配置的云端
              AI。右上角可以切换界面主题。
            </p>
            <button className="text-button" onClick={() => go("AI & privacy")}>
              {t("检查 AI 设置 →", "Check AI settings →")}
            </button>
          </div>
          <div>
            <b>02</b>
            <h3>{t("选一个小任务", "Choose a small task")}</h3>
            <p>
              先试客户跟进邮件，或填写真实价格生成一份报价草稿。模板里的资料由你填写。
            </p>
            <a href="#prompt-library">{t("选择下方模板 ↓", "Browse examples below ↓")}</a>
          </div>
          <div>
            <b>03</b>
            <h3>{t("检查结果，再使用", "Review before using")}</h3>
            <p>
              核对姓名、金额、日期和政策。聊天草稿不会发送邮件；任务需要审批时，请先检查完整内容。
            </p>
            <button
              className="text-button"
              onClick={() => go("Business tools")}
            >
              {t("查看文档和审批 →", "Documents and approvals →")}
            </button>
          </div>
        </div>
        <button
          className="secondary"
          onClick={() => {
            setUnderstood(true);
            localStorage.setItem("nightbrew.guide.seen", "1");
          }}
        >
          {understood ? t("✓ 已了解基本使用方法", "✓ I know how to start") : t("我知道如何开始了", "I know how to start")}
        </button>
      </div>
      <div className="section-heading" id="prompt-library">
        <div>
          <h2>{t("业务提示词模板", "Optional task examples")}</h2>
          <p>{t("填写背景 → 预览提示词 → 带入聊天，确认后才发送。", "Enter facts, review the prompt, then choose when to send it to chat.")}</p>
        </div>
        <span className="subtle-tag">{prompts.length} {t("个实用场景", "practical examples")}</span>
      </div>
      <div className="filter-tabs" aria-label="提示词分类">
        {["全部", "销售", "财务", "仓库", "行政", "客服"].map((c) => (
          <button
            key={localizedCategory(c, language)}
            aria-pressed={category === c}
            className={category === c ? "selected" : ""}
            onClick={() => setCategory(c)}
          >
            {localizedCategory(c, language)}
          </button>
        ))}
      </div>
      <div className="workflow-grid library-grid">
        {prompts
          .filter((p) => category === "全部" || p.category === category)
          .map((p) => (
            <button
              key={p.id}
              className={`workflow-card ${selected?.id === p.id ? "chosen" : ""}`}
              onClick={() => pick(p)}
            >
              <span className="workflow-icon">
                <Icon name={p.icon} size={24} />
              </span>
              <span className="workflow-category">{localizedCategory(p.category, language)}</span>
              <strong>{localizedPrompt(p, language).title}</strong>
              <span>{localizedPrompt(p, language).description}</span>
              <span className="card-action">
                {t("填写我的资料", "Use this example")} <Icon name="arrow" size={16} />
              </span>
            </button>
          ))}
      </div>
      {selected && (
        <div className="panel prompt-builder" aria-label={t("提示词填写器", "Prompt example builder")}>
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">MAKE IT YOURS</span>
              <h2>{localizedPrompt(selected, language).title}</h2>
            </div>
            <button className="secondary" onClick={() => setSelected(null)}>
              {t("收起模板", "Close example")}
            </button>
          </div>
          <div className="notice">
            <Icon name="file" />
            <p>{localizedPrompt(selected, language).outcome}</p>
          </div>
          <div className="prompt-builder-grid">
            <div>
              <h3>{t("1. 填写你的资料", "1. Enter confirmed facts")}</h3>
              {fields.map((f) => (
                <label key={f}>
                  {localizedField(f, language)}
                  <textarea
                    rows={2}
                    value={values[f] || ""}
                    onChange={(e) => {
                      setValues({ ...values, [f]: e.target.value });
                      setCopied(false);
                    }}
                    placeholder={t("填写已确认的信息；不清楚可以写“待确认”", "Use confirmed facts. Mark unknown details as requiring confirmation.")}
                  />
                </label>
              ))}
            </div>
            <div>
              <h3>{t("2. 预览将使用的提示词", "2. Review the prompt")}</h3>
              <pre className="prompt-preview">{text}</pre>
              <small>
                提示词是给 AI
                的工作说明，不会赋予它额外权限。外部文档或网页里的指令不能代替你的批准。
              </small>
              <div className="row">
                <button disabled={!complete} onClick={() => compose(text)}>
                  {t("带入 AI 聊天", "Use in AI chat")} <Icon name="arrow" size={16} />
                </button>
                <button
                  className="secondary"
                  disabled={!complete}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(text);
                      setCopied(true);
                      setCopyError("");
                    } catch {
                      setCopyError("无法访问剪贴板，请从预览中选中文字复制。");
                    }
                  }}
                >
                  {copied ? t("已复制", "Copied") : t("复制提示词", "Copy prompt")}
                </button>
              </div>
              {!complete && (
                <p className="muted">
                  {t("先填完左侧资料，再带入聊天；不会自动发送。", "Complete the facts before using the prompt in chat. Nothing is sent automatically.")}
                </p>
              )}
              {copyError && <p role="alert">{copyError}</p>}
              {selected.destination && (
                <button
                  className="text-button"
                  onClick={() => go(selected.destination!)}
                >
                  {t("此任务也可以直接使用文档工具 →", "Open document tools for this task →")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="panel faq-panel">
        <h2>{t("你可能想问", "Common questions")}</h2>
        <details>
          <summary>{t("不知道怎么提问怎么办？", "What if I do not know how to ask?")}</summary>
          <p>
            写清楚“要做什么、给谁、依据哪些资料、希望什么格式”。使用上方模板，填入自己的信息即可。不确定的价格和政策写“待确认”，不要让
            AI 猜。
          </p>
        </details>
        <details>
          <summary>{t("我在聊天里说“分析 Excel”，它会自动读取文件吗？", "Does asking about Excel automatically read my files?")}</summary>
          <p>
            不会。聊天目前处理你输入的文字；要分析真实 XLSX，请到“文档与
            Excel”上传文件，再点击 Analyze
            Excel。聊天没有读取你电脑任意文件的权限。
          </p>
        </details>
        <details>
          <summary>{t("为什么有些功能暂时用不了？", "Why are some features unavailable?")}</summary>
          <p>
            聊天需要先配置
            AI；正式安装包还需要设备授权。真实业务系统需要管理员配置并测试连接。演示连接器只有测试数据，不代表已经连接你的
            POS 或 ERP。
          </p>
        </details>
        <details>
          <summary>{t("AI 会自动发邮件或下单吗？", "Will AI automatically send emails or orders?")}</summary>
          <p>
            聊天只生成文本。当前没有内置邮件发送器；你需要审核后自行复制发送。支持的系统写入和电脑操作会先创建待审批任务。
          </p>
        </details>
        <details>
          <summary>{t("在 Mac 上可以控制 Windows 软件吗？", "Can a Mac operate Windows applications?")}</summary>
          <p>
            不可以。Windows UI Automation 需要 Windows 交互会话。Mac
            可以使用已支持的聊天、文档和业务功能；浏览器工具需要另外配置兼容浏览器。
          </p>
        </details>
      </div>
    </>
  );
}
