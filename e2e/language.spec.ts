import { test, expect } from "@playwright/test";
import { join } from "node:path";

test("language switches preserve drafts and never send a message or run a task", async ({ page }) => {
  let changes = 0;
  page.on("request", request => {
    if (request.method() === "POST" && /\/(chat|tasks)(\?|$)/.test(request.url())) changes++;
  });
  await page.goto("/");
  await page.getByText("开发者连接（浏览器预览）", { exact: true }).click();
  await page.getByLabel("Backend session token").fill("nightbrew-e2e-not-production");
  await page.getByRole("button", { name: "连接工作区", exact: true }).click();
  await page.getByText("开发者连接（浏览器预览）", { exact: true }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page.getByRole("tab", { name: "帮我写回复", exact: true }).click();
  await page.getByLabel("Message", { exact: true }).fill("客户问交货时间；已确认星期五发货。");
  if (process.env.NIGHTBREW_UI_PREVIEW_DIR) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(process.env.NIGHTBREW_UI_PREVIEW_DIR, "nightbrew-simple-zh.png"), fullPage: true });
  }
  await page.getByLabel("界面语言 / Interface language").selectOption("en");
  await expect(page.getByRole("tab", { name: "Draft a reply", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("客户问交货时间；已确认星期五发货。");
  if (process.env.NIGHTBREW_UI_PREVIEW_DIR)
    await page.screenshot({ path: join(process.env.NIGHTBREW_UI_PREVIEW_DIR, "nightbrew-simple-en.png"), fullPage: true });
  await page.getByText("AI & privacy options", { exact: true }).click();
  await expect(page.getByLabel("Processing mode", { exact: true })).toHaveValue("LOCAL_ONLY");
  await page.getByLabel("界面语言 / Interface language").selectOption("zh");
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("客户问交货时间；已确认星期五发货。");
  expect(changes).toBe(0);
});

test("editable replies move into reviewed fill without automatically executing", async ({ page }) => {
  let chatCount = 0, taskCount = 0;
  await page.route("**/chat", async route => {
    chatCount++;
    const data = route.request().postDataJSON();
    expect(data.mode).toBe("LOCAL_ONLY");
    expect(data.cloud_consent).toBe(false);
    expect(data.response_language).toBe("en");
    expect(data.intent).toBe("reply");
    await route.fulfill({ json: { answer: "Dispatch is confirmed for Friday.", provider: "local fixture" } });
  });
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/tasks")) taskCount++; });
  await page.goto("/");
  await page.getByText("开发者连接（浏览器预览）", { exact: true }).click();
  await page.getByLabel("Backend session token").fill("nightbrew-e2e-not-production");
  await page.getByRole("button", { name: "连接工作区", exact: true }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page.getByLabel("界面语言 / Interface language").selectOption("en");
  await page.getByRole("tab", { name: "Draft a reply", exact: true }).click();
  await page.getByLabel("Message", { exact: true }).fill("Customer asks about delivery. Confirmed dispatch Friday.");
  await page.getByRole("button", { name: "Draft my reply →", exact: true }).click();
  await expect(page.getByLabel("Reply draft", { exact: true })).toHaveValue("Dispatch is confirmed for Friday.");
  await page.getByLabel("Reply draft", { exact: true }).fill("Thank you. Dispatch is confirmed for Friday.");
  await page.getByLabel("界面语言 / Interface language").selectOption("zh");
  await expect(page.getByLabel("回复草稿", { exact: true })).toHaveValue("Thank you. Dispatch is confirmed for Friday.");
  await page.getByRole("button", { name: "下一步：帮我填写", exact: true }).click();
  await expect(page.getByRole("tab", { name: "帮我填写", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(chatCount).toBe(1);
  expect(taskCount).toBe(0);
});
