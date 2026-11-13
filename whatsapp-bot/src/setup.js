// Guided setup: asks a few questions and writes the config file, so nobody has to
// hand-edit JSON to get started.
//   npm run setup                 the default WhatsApp account
//   npm run setup -- second       a second account (profile "second")
// Non-interactive: node src/setup.js [profile] --template av --number 6591234567 --company "ACME AV" --email a@b.c --yes
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { prepare, profilePaths, readJson, validate } from "./config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATES = {
  av: { file: "config.av-technician.example.json", label: "AV 技术支持（150+ 条故障知识库）/ AV technical support" },
  basic: { file: "config.example.json", label: "通用示例（补习中心）/ Generic example (tuition centre)" },
};

export function parseArgs(argv) {
  const out = { profile: "", flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--yes") out.flags.yes = true;
    else if (arg.startsWith("--")) out.flags[arg.slice(2)] = argv[(i += 1)] ?? "";
    else if (!out.profile) out.profile = arg;
  }
  return out;
}

export function buildConfig(templateKey, answers) {
  const template = TEMPLATES[templateKey];
  if (!template) throw new Error(`unknown template ${templateKey}`);
  const config = readJson(path.join(ROOT, template.file));
  config.phone_number = String(answers.number || "").replace(/\D/g, "");
  config.business = {
    company: answers.company || config.business?.company || "",
    email: answers.email || config.business?.email || "",
    phone: answers.phone || config.business?.phone || "",
    address: answers.address || config.business?.address || "",
  };
  const staff = String(answers.notify || "").split(/[,;，、\n]+/).map((n) => n.replace(/\D/g, "")).filter((n) => n && n !== config.phone_number);
  config.notify = { numbers: staff };
  if (config.phone_number.startsWith("65")) config.timezone = "Asia/Singapore";
  else if (config.phone_number.startsWith("60")) config.timezone = "Asia/Kuala_Lumpur";
  if (answers.style === "poll" || answers.style === "text") config.menu_style = answers.style;
  if (answers.port) config.dashboard_port = Number(answers.port);
  return config;
}

async function main() {
  const { profile, flags } = parseArgs(process.argv.slice(2));
  const paths = profilePaths(process.cwd(), profile);
  const interactive = !flags.yes;
  const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ask = async (question, fallback = "") => {
    if (!rl) return fallback;
    const answer = (await rl.question(`${question}${fallback ? ` [${fallback}]` : ""}: `)).trim();
    return answer || fallback;
  };

  console.log(`\n设置 WhatsApp 机器人${profile ? `（账号 ${profile}）` : ""} / Setting up the WhatsApp bot${profile ? ` (profile ${profile})` : ""}\n`);
  let existing = null;
  if (fs.existsSync(paths.config)) {
    try {
      existing = readJson(paths.config);
    } catch {
      existing = null;
    }
    const overwrite = flags.yes ? "y" : await ask(`${path.basename(paths.config)} 已存在，覆盖吗？/ already exists, overwrite? (y/N)`, "N");
    if (!/^y/i.test(overwrite)) {
      console.log("没有改动 / Nothing changed.");
      rl?.close();
      return;
    }
  }

  let template = flags.template;
  if (!template) {
    console.log("选择模板 / Choose a template:");
    Object.entries(TEMPLATES).forEach(([key, value], index) => console.log(`  ${index + 1}) ${value.label}`));
    const choice = await ask("输入数字 / Enter a number", "1");
    template = Object.keys(TEMPLATES)[Number(choice) - 1] || "av";
  }

  const previous = existing?.business || {};
  let number = flags.number || "";
  while (!/^\d{8,15}$/.test(number.replace(/\D/g, ""))) {
    if (!rl) throw new Error("--number must be digits with country code, e.g. 6591234567");
    number = await ask("机器人的 WhatsApp 号码，带国家代码，只要数字（例如 6591234567）/ Bot WhatsApp number with country code, digits only", existing?.phone_number || "");
  }
  const answers = {
    number,
    company: flags.company ?? (await ask("公司名称 / Company name", previous.company || "")),
    email: flags.email ?? (await ask("客户可以联系的 email / Support email", previous.email || "")),
    phone: flags.phone ?? (await ask("公司电话 / Company phone", previous.phone || "")),
    address: flags.address ?? (await ask("公司地址 / Company address", previous.address || "")),
    notify:
      flags.notify ??
      (await ask(
        "客人选「其他」、要上门或紧急时，要通知哪个 WhatsApp 号码？（你或同事的另一个号码，可留空）/ Staff WhatsApp number to alert (another number, optional)",
        (existing?.notify?.numbers || []).join(",")
      )),
    port: flags.port || (profile ? 8797 : ""),
  };
  rl?.close();

  const config = buildConfig(template, answers);
  const problems = validate(prepare(config, process.cwd())).filter((p) => !p.includes("environment variable"));
  if (problems.length) throw new Error(problems.join("\n"));
  fs.writeFileSync(paths.config, JSON.stringify(config, null, 2) + "\n", "utf8");

  const suffix = profile ? ` -- ${profile}` : "";
  console.log(`\n已写入 / Written: ${paths.config}`);
  console.log(`\n下一步 / Next:`);
  console.log(`  npm run demo            先在浏览器里试 / try it in the browser first${profile ? "（演示用默认账号配置 / demo uses the default profile）" : ""}`);
  console.log(`  npm start${suffix}        连接 WhatsApp / connect WhatsApp`);
  console.log(`\n想改话术或加客户等级，用记事本打开 ${path.basename(paths.config)}。 / Edit ${path.basename(paths.config)} in Notepad to change wording or tiers.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
