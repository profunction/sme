import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";

let fixture: Server;
let fixtureUrl: string;
let submissions = 0;
test.beforeAll(async () => {
  fixture = createServer((request, response) => {
    if (request.method === "POST") { submissions++; response.writeHead(204); response.end(); return; }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end('<label for="customer">Customer</label><input id="customer" oninput="fetch(\'/save\',{method:\'POST\',body:this.value})"><input type="password" value="secret"><button onclick="fetch(\'/save\',{method:\'POST\'})">Send</button>');
  });
  await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind");
  fixtureUrl = `http://127.0.0.1:${address.port}/`;
});
test.afterAll(async () => { await new Promise<void>(resolve => fixture.close(() => resolve())); });

test("guided autofill requires inspection and fill approval and blocks automatic submission", async ({ page }) => {
  await page.goto("/");
  await page.getByText("开发者连接（浏览器预览）", { exact: true }).click();
  await page.getByLabel("Backend session token").fill("nightbrew-e2e-not-production");
  await page.getByRole("button", { name: "连接工作区", exact: true }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page.getByRole("tab", { name: "帮我填写", exact: true }).click();
  const wizard = page.getByLabel("自动填写向导", { exact: true });
  await wizard.getByLabel("要填写的网页地址").fill(fixtureUrl);
  await wizard.getByRole("button", { name: "允许此网站并读取字段", exact: true }).click();
  await expect(wizard.getByRole("button", { name: "批准读取字段", exact: true })).toBeVisible();
  await expect(wizard.getByRole("button", { name: "准备填写，等我批准", exact: true })).toHaveCount(0);
  await wizard.getByRole("button", { name: "批准读取字段", exact: true }).click();
  await wizard.getByLabel("批量粘贴资料（每行“字段名称：内容”）").fill("Customer: NightBrew pilot\nUnknown: do not guess");
  await wizard.getByRole("button", { name: "匹配并预览", exact: true }).click();
  await expect(wizard.getByLabel("填写内容 · Customer")).toHaveValue("NightBrew pilot");
  await expect(wizard.getByText(/未匹配或名称重复：Unknown/)).toBeVisible();
  await wizard.getByText("进阶设置", { exact: false }).first().click();
  await wizard.getByLabel("显示浏览器窗口供我核对").uncheck();
  await wizard.getByRole("button", { name: "准备填写，等我批准", exact: true }).click();
  await expect(wizard.getByRole("button", { name: "批准以上内容并填写", exact: true })).toBeVisible();
  await wizard.getByRole("button", { name: "批准以上内容并填写", exact: true }).click();
  await expect(wizard.getByText("填写操作 · 已完成", { exact: true })).toBeVisible();
  expect(submissions).toBe(0);
});
