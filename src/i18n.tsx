import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Language = "zh" | "en";
type LanguageState = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (zh: string, en: string) => string;
};
const LanguageContext = createContext<LanguageState>({
  language: "zh",
  setLanguage: () => {},
  t: (zh) => zh,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    try { return localStorage.getItem("nightbrew.language") === "en" ? "en" : "zh"; }
    catch { return "zh"; }
  });
  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    try { localStorage.setItem("nightbrew.language", language); } catch { /* Optional preference only. */ }
  }, [language]);
  return <LanguageContext.Provider value={{ language, setLanguage, t: (zh, en) => language === "zh" ? zh : en }}>
    {children}
  </LanguageContext.Provider>;
}

export function useLanguage() { return useContext(LanguageContext); }

// Template field keys remain unchanged so switching language preserves entered facts.
import type { Prompt } from "./workspace";
const englishTemplates: Record<string, [string, string, string, string]> = {
  followup: ["Customer follow-up email", "Turn confirmed customer facts into a friendly follow-up draft.",
    "An editable email draft. Nothing is sent automatically.",
    "Please draft a customer follow-up email.\nCustomer: [填写客户名称]\nPrevious conversation: [填写日期和沟通内容]\nQuotation or product: [填写已确认的信息]\nNext step: [例如确认需求或安排会议]\nLanguage and tone: [中文／英文，专业友好]\nDo not invent prices or promises. Ask when facts are missing. Draft only; do not send."],
  quote: ["Prepare a quotation", "Enter real products, quantities and prices to create a PDF or Word draft.",
    "Open document tools to enter confirmed facts and create a local quotation draft.",
    "Organize quotation details: customer [名称], product [名称], quantity [数量], confirmed unit price [MYR], tax [实际适用税率]. Ask for missing prices or tax details; do not guess."],
  excel: ["Analyze a sales spreadsheet", "Review numeric column totals in an uploaded workbook.",
    "Upload XLSX in Documents & Excel and choose Analyze Excel. Chat does not read local files automatically.",
    "Help me review a sales spreadsheet. Confirm column names, date range, currency and return handling first. Separate observed facts from suggestions; do not invent missing data."],
  inventory: ["Review replenishment needs", "Organize suggestions from stock data and rules you provide.",
    "Advice based on your supplied data. Live stock requires a separately tested business connection.",
    "Review replenishment needs using: [粘贴已授权的数据]\nList products below minimum stock and show the basis. Ask for missing limits or lead times. Do not change stock or submit purchase orders."],
  sop: ["Organize a company SOP", "Turn confirmed working practices into clear steps.",
    "A structured SOP draft for you to review.",
    "Organize an SOP.\nProcess and role: [填写]\nCurrent working practices: [粘贴内容]\nInclude purpose, preparation, steps, checks and exception handling. Mark uncertain rules as requiring confirmation; do not invent company policy."],
  reply: ["Reply to a customer", "Draft a clear response based on confirmed policies.",
    "An editable response you can copy. Nothing is sent automatically.",
    "Draft a customer-service reply.\nCustomer question: [粘贴客户问题]\nConfirmed policy: [填写退换货、服务或交期政策]\nTone: [友好、专业]\nDo not promise unconfirmed refunds, discounts or delivery dates. Ask when needed. Draft only; do not send."],
};
export function localizedPrompt(prompt: Prompt, language: Language): Prompt {
  const translated = englishTemplates[prompt.id];
  return language === "zh" || !translated ? prompt : {
    ...prompt, title: translated[0], description: translated[1], outcome: translated[2], prompt: translated[3],
  };
}
export function localizedCategory(value: string, language: Language) {
  const labels: Record<string, string> = { 全部: "All", 销售: "Sales", 财务: "Finance", 仓库: "Warehouse", 行政: "Administration", 客服: "Customer service" };
  return language === "zh" ? value : labels[value] || value;
}
export function localizedField(value: string, language: Language) {
  const labels: Record<string, string> = {
    填写客户名称: "Customer name", 填写日期和沟通内容: "Date and previous conversation",
    填写已确认的信息: "Confirmed product or quotation details", 例如确认需求或安排会议: "Desired next step",
    "中文／英文，专业友好": "Language and preferred tone", 名称: "Name", 数量: "Quantity", MYR: "Confirmed unit price (MYR)",
    实际适用税率: "Applicable tax rate", 粘贴已授权的数据: "Authorized stock data", 填写: "Confirmed process and role",
    粘贴内容: "Current working practices", 粘贴客户问题: "Customer question", "填写退换货、服务或交期政策": "Confirmed return, service or delivery policy",
    "友好、专业": "Preferred tone",
  };
  return language === "zh" ? value : labels[value] || "Confirmed information";
}
