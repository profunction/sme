import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function connect(page: Page) {
  await page.goto("/");
  await page.getByText("开发者连接（浏览器预览）", { exact: true }).click();
  await page.getByLabel("Backend session token").fill("nightbrew-e2e-not-production");
  await page.getByRole("button", { name: "连接工作区", exact: true }).click();
  await expect(page.locator(".connection-pill.connected")).toBeVisible();
}

test("assigned work shows real completion, downloads its PDF and dashboard cards open details", async ({ page }) => {
  await connect(page);
  await page.getByRole("button", { name: "Employees", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Results employee");
  await page.getByLabel("Instructions", { exact: true }).fill("Use supplied document facts only.");
  await page.getByRole("button", { name: "Save employee", exact: true }).click();
  await expect(page.getByRole("heading", { name: "员工资料已保存（不是任务执行结果）" })).toBeVisible();
  await page.getByLabel("进阶任务配置（JSON）").check();
  await page.getByLabel("Task data (JSON)").fill('{bad json');
  await page.getByRole("button", { name: "Assign task", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("heading", { name: "员工资料已保存（不是任务执行结果）" })).toHaveCount(0);
  await page.getByLabel("Task data (JSON)").fill(JSON.stringify({ company: "NightBrew", customer: "Test", reference: "RESULTS-094", lines: [{ description: "Verified input", quantity: "2", unit_price: "7.50" }] }));
  await page.getByRole("button", { name: "Assign task", exact: true }).click();
  const task = page.getByRole("region", { name: "已分配任务状态" });
  await expect(task.getByText("等待你批准，尚未执行", { exact: true })).toBeVisible();
  await expect(task.getByRole("button", { name: /下载任务结果/ })).toHaveCount(0);
  await task.getByRole("button", { name: "批准此任务并执行", exact: true }).click();
  await expect(task.getByText("任务已完成", { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await task.getByRole("button", { name: /下载任务结果/ }).click();
  const downloaded = await downloadPromise;
  expect((await readFile((await downloaded.path())!)).subarray(0, 4).toString()).toBe("%PDF");
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: /^已完成任务/ }).click();
  const results = page.getByRole("list", { name: "任务明细" });
  await expect(results.getByRole("button", { name: /下载任务结果/ }).first()).toBeVisible();
  await expect(results.locator(".badge").filter({ hasNotText: /^completed$/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: /^等待你的审批/ }).click();
  await expect(page.getByRole("button", { name: "待审批", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: /^进行中的任务/ }).click();
  await expect(page.getByRole("button", { name: "进行中", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: /^工作中的 AI 员工/ }).click();
  const employee = page.locator("li").filter({ has: page.getByText("Results employee · Admin", { exact: true }) });
  await employee.getByRole("button", { name: "启用聊天并打开", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "正在与这位员工聊天" })).toContainText("Results employee");
  await page.getByText("AI 与隐私选项", { exact: true }).click();
  await expect(page.getByLabel("选择助理")).not.toHaveValue("");
});

test("AI key entry is distinct from demo business connectors and never starts inference automatically", async ({ page, request }) => {
  const headers = { Authorization: "Bearer nightbrew-e2e-not-production" };
  const oldModels = await (await request.get("http://127.0.0.1:8765/settings/models", { headers })).json();
  const oldPolicy = await (await request.get("http://127.0.0.1:8765/settings/ai", { headers })).json();
  let stored = false, chatCount = 0;
  await page.route("**/settings/cloud-connection", async route => route.fulfill({ json: { key_present: stored, local_only_preview: false, byok_preview: true, models: oldModels } }));
  await page.route("**/settings/cloud-key", async route => {
    expect(route.request().postDataJSON()).toEqual({ key: "fixture-not-a-real-api-key" });
    stored = true; await route.fulfill({ json: { stored: true, storage: "mock native vault" } });
  });
  await page.route("**/settings/cloud-connection/test", async route => {
    expect(route.request().postDataJSON()).toEqual({ consent: true });
    await route.fulfill({ json: { authenticated: true, model_available: true, inference_tested: false } });
  });
  page.on("request", req => { if (req.method() === "POST" && req.url().endsWith("/chat")) chatCount++; });
  try {
    await connect(page);
    await page.getByRole("button", { name: "Connectors", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Mock WMS/ })).toHaveCount(0);
    await page.getByRole("button", { name: "连接 AI / 填 API Key", exact: true }).click();
    const setup = page.getByRole("region", { name: "连接 AI", exact: true });
    await setup.getByRole("button", { name: "使用 DeepSeek", exact: true }).click();
    await setup.getByLabel("AI API key", { exact: true }).fill("fixture-not-a-real-api-key");
    await page.getByLabel("界面语言 / Interface language").selectOption("en");
    await expect(page.getByRole("region", { name: "Connect AI", exact: true }).getByLabel("AI API key", { exact: true })).toHaveValue("fixture-not-a-real-api-key");
    await expect(page.getByRole("button", { name: "Test AI connection", exact: true })).toBeDisabled();
    await page.getByLabel("界面语言 / Interface language").selectOption("zh");
    await setup.getByRole("button", { name: "保存密钥与配置", exact: true }).click();
    await expect(setup.getByLabel("AI API key", { exact: true })).toHaveValue("");
    await expect(setup.getByRole("button", { name: "测试 AI 连接", exact: true })).toBeDisabled();
    await setup.getByLabel("Allow AI connection test", { exact: true }).check();
    await setup.getByRole("button", { name: "测试 AI 连接", exact: true }).click();
    await expect(setup.getByRole("status")).toContainText("密钥连接测试通过");
    await setup.getByLabel("input_usd_per_million", { exact: true }).fill("1");
    await setup.getByLabel("output_usd_per_million", { exact: true }).fill("2");
    await setup.getByLabel("monthly_limit_usd", { exact: true }).fill("1");
    await setup.getByLabel("我已核实当前服务商和模型价格", { exact: true }).check();
    await setup.getByLabel("允许使用自己的付费 API；每次聊天仍须同意发送内容", { exact: true }).check();
    await setup.getByRole("button", { name: "保存费用保护", exact: true }).click();
    await expect(setup.getByRole("status")).toContainText("已保存费用保护");
    await setup.getByRole("button", { name: "开始 AI 聊天", exact: true }).click();
    await page.getByText("AI 与隐私选项", { exact: true }).click();
    await expect(page.getByLabel("处理方式", { exact: true })).toHaveValue("CLOUD_ONLY");
    await expect(page.getByRole("button", { name: "同意云端处理并发送 →", exact: true })).toBeVisible();
    expect(chatCount).toBe(0);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("fixture-not-a-real-api-key");
  } finally {
    await request.put("http://127.0.0.1:8765/settings/models", { headers, data: oldModels });
    await request.put("http://127.0.0.1:8765/settings/ai", { headers, data: oldPolicy });
  }
});
