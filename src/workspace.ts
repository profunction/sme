export type Page =
  | "Dashboard"
  | "Assistant"
  | "Business tools"
  | "Connectors"
  | "Computer tools"
  | "Employees"
  | "Subscription"
  | "AI & privacy"
  | "Guide";
export const pages: {
  id: Page;
  label: string;
  icon: string;
  description: string;
}[] = [
  {
    id: "Dashboard",
    label: "工作台",
    icon: "home",
    description: "今天的工作，从这里开始。",
  },
  {
    id: "Assistant",
    label: "AI 助理",
    icon: "chat",
    description: "说出你要完成的事，让助理帮你整理思路和起草内容。",
  },
  {
    id: "Employees",
    label: "我的 AI 员工",
    icon: "people",
    description: "为不同岗位分配职责、工具和工作预算。",
  },
  {
    id: "Business tools",
    label: "文档与 Excel",
    icon: "file",
    description: "生成报价、发票和采购单草稿，分析你上传的表格。",
  },
  {
    id: "Computer tools",
    label: "电脑与浏览器",
    icon: "screen",
    description: "先设定允许的操作，再查看并批准执行计划。",
  },
  {
    id: "Connectors",
    label: "业务系统连接",
    icon: "link",
    description: "连接 ERP、POS、WMS 和 TMS；演示连接器会明确标示。",
  },
  {
    id: "AI & privacy",
    label: "AI 与隐私设置",
    icon: "settings",
    description: "检查本地 AI，设置云端许可和消费上限。",
  },
  {
    id: "Subscription",
    label: "订阅与用量",
    icon: "card",
    description: "查看授权、方案及用量；真实付款需要已配置的服务。",
  },
  {
    id: "Guide",
    label: "使用指南与提示词",
    icon: "book",
    description: "第一次使用也不怕，从一个具体任务开始。",
  },
];
export type Prompt = {
  id: string;
  title: string;
  category: string;
  icon: string;
  description: string;
  prompt: string;
  outcome: string;
  destination?: Page;
};
export const prompts: Prompt[] = [
  {
    id: "followup",
    title: "客户跟进邮件",
    category: "销售",
    icon: "chat",
    description: "把客户背景和报价情况变成得体的跟进草稿。",
    prompt:
      "请帮我起草客户跟进邮件。\n客户名称：[填写客户名称]\n上次沟通：[填写日期和沟通内容]\n报价或产品：[填写已确认的信息]\n希望下一步：[例如确认需求或安排会议]\n语言与语气：[中文／英文，专业友好]\n要求：不要编造价格或承诺；缺少资料先问我。只生成供我审核的草稿，不发送。",
    outcome: "一封可审核和修改的邮件草稿，不会自动发送。",
  },
  {
    id: "quote",
    title: "制作客户报价单",
    category: "销售",
    icon: "file",
    description: "填写客户、产品、数量及价格，生成 PDF 或 Word。",
    prompt:
      "请帮我整理报价资料：客户[名称]，产品[名称]，数量[数量]，已确认单价[MYR]，税率[实际适用税率]。缺少价格或税务资料请先问，不要猜测。",
    outcome: "进入文档工具填写真实资料，生成本地报价草稿。",
    destination: "Business tools",
  },
  {
    id: "excel",
    title: "分析销售 Excel",
    category: "财务",
    icon: "file",
    description: "上传表格，查看工作表行数和数值列合计。",
    prompt:
      "我想分析销售表格。请先确认列名、日期范围、货币和退货处理方式。结论必须区分表格中的事实与建议，不要猜测没有提供的数据。",
    outcome:
      "在文档工具上传 XLSX，点击 Analyze Excel 查看实际数值合计。聊天不会自动读取本地文件。",
    destination: "Business tools",
  },
  {
    id: "inventory",
    title: "整理补货建议",
    category: "仓库",
    icon: "link",
    description: "根据你提供的库存和补货规则，整理建议。",
    prompt:
      "请根据以下库存资料整理补货建议：\n商品、现有库存、最低库存、采购周期：[粘贴已授权的数据]\n请列出低于最低库存的商品，说明建议依据；没有最低库存或采购周期时先问我。不要修改库存，也不要提交采购订单。",
    outcome:
      "一份基于你提供资料的建议。实时库存需要另外连接并验证你的业务系统。",
  },
  {
    id: "sop",
    title: "整理公司 SOP",
    category: "行政",
    icon: "book",
    description: "把零散做法整理成新人也能跟着走的步骤。",
    prompt:
      "请把以下工作流程整理成 SOP：\n流程名称：[填写]\n适用岗位：[填写]\n目前做法：[粘贴内容]\n请按目的、准备资料、操作步骤、检查清单和异常处理组织。不能确定的规则请标为待确认，不要虚构公司政策。",
    outcome: "结构清楚的 SOP 文本草稿，由你审核后采用。",
  },
  {
    id: "reply",
    title: "回复客户问题",
    category: "客服",
    icon: "people",
    description: "根据真实政策写清楚、友好的客服回复。",
    prompt:
      "请帮我起草客服回复。\n客户问题：[粘贴客户问题]\n已确认的公司政策：[填写退换货、服务或交期政策]\n期望语气：[友好、专业]\n不要承诺未经确认的退款、折扣或交期；资料不足先问我。只生成草稿，不发送消息。",
    outcome: "一段可复制、可修改的回复，不会代你发送。",
  },
];
