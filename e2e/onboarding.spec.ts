import { test, expect } from "@playwright/test";

test("a new customer can prepare a safe prompt without knowing technical settings", async ({
  page,
}) => {
  let chatRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/chat") && request.method() === "POST")
      chatRequests++;
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "工作台", exact: false }),
  ).toBeVisible();
  await expect(page.getByText("界面预览", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Backend session token")).not.toBeVisible();
  await page.getByRole("button", { name: /客户跟进邮件/ }).click();
  await expect(
    page.getByRole("heading", { name: "客户跟进邮件", exact: true }),
  ).toBeVisible();
  const builder = page.getByLabel("提示词填写器");
  await expect(
    builder.getByRole("button", { name: /带入 AI 聊天/ }),
  ).toBeDisabled();
  for (const input of await builder.locator("textarea").all())
    await input.fill("已确认的客户资料");
  await expect(builder.locator(".prompt-preview")).toContainText(
    "已确认的客户资料",
  );
  await expect(builder.locator(".prompt-preview")).toContainText("不发送");
  await builder.getByRole("button", { name: /带入 AI 聊天/ }).click();
  await expect(
    page.getByRole("heading", { name: "连接工作区后，就可以开始工作" }),
  ).toBeVisible();
  expect(chatRequests).toBe(0);
});

test("guided draft survives connecting, remains unsent and keeps cloud consent off", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: /客户跟进邮件/ }).click();
  const builder = page.getByLabel("提示词填写器");
  for (const input of await builder.locator("textarea").all())
    await input.fill("安全的测试资料");
  await builder.getByRole("button", { name: /带入 AI 聊天/ }).click();
  await page.getByText("开发者连接（浏览器预览）", { exact: true }).click();
  await page
    .getByLabel("Backend session token")
    .fill("nightbrew-e2e-not-production");
  await page.getByRole("button", { name: "连接工作区", exact: true }).click();
  await expect(page.getByLabel("Message")).toContainText("安全的测试资料");
  await page.getByLabel("处理方式").selectOption("CLOUD_ONLY");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await expect(page.getByLabel("Message")).not.toHaveValue("");
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(page.locator(".metric-card").first()).not.toContainText("—");
  await page.getByText("开发者连接（浏览器预览）", { exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({
    path: testInfo.outputPath("dashboard.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Guide", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("appearance can be chosen and is retained without changing workspace permissions", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("外观主题").selectOption("midnight");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  await page.reload();
  await expect(page.getByLabel("外观主题")).toHaveValue("midnight");
  await expect(page.getByText("界面预览", { exact: true })).toBeVisible();
  await page.getByLabel("外观主题").selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("a customer can save a model in the GUI and changing provider requires fresh consent", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByText("开发者连接（浏览器预览）", { exact: true }).click();
  await page
    .getByLabel("Backend session token")
    .fill("nightbrew-e2e-not-production");
  await page.getByRole("button", { name: "连接工作区", exact: true }).click();
  await page.getByRole("button", { name: "AI & privacy", exact: true }).click();
  await expect(page.getByLabel("本地 Ollama 模型名称")).toHaveValue(
    "llama3.2:3b",
  );
  await page.getByLabel("本地 Ollama 模型名称").fill("customer-model:3b");
  await page.getByLabel("云端模型名称").fill("customer-cloud");
  await page.getByRole("button", { name: "保存模型配置", exact: true }).click();
  await expect(page.getByText(/模型配置已保存/)).toBeVisible();
  await expect(page.getByLabel(/Permit cloud inference/)).not.toBeChecked();
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: "AI & privacy", exact: true }).click();
  await expect(page.getByLabel("本地 Ollama 模型名称")).toHaveValue(
    "customer-model:3b",
  );
});
