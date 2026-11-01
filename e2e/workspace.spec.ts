import { test, expect } from "@playwright/test";

test("business drafts and approved mock connector writes through the actual UI", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByText("开发者连接（浏览器预览）", { exact: true }).click();
  await page
    .getByLabel("Backend session token")
    .fill("nightbrew-e2e-not-production");
  await page.getByRole("button", { name: "连接工作区", exact: true }).click();
  await expect(page.locator(".connection-pill.connected")).toBeVisible();
  await page.getByRole("button", { name: "AI & privacy", exact: true }).click();
  await page
    .getByRole("button", { name: "Load settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save privacy & budget" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Inspect hardware" }).click();
  await expect(
    page.getByText("统一内存 / RAM（字节）", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Business tools", exact: true })
    .click();
  await page.getByLabel("Your company").fill("NightBrew UI Test");
  await page.getByLabel("Customer / supplier").fill("Test customer");
  await page.getByLabel("Reference").fill("UI-Q-001");
  await page.getByLabel(/Description/).fill("Tea");
  await page.getByLabel(/Quantity/).fill("3");
  await page.getByLabel("Price (MYR)").fill("10.05");
  await page.getByLabel("Tax %").fill("6");
  await page.getByRole("button", { name: "Create local draft" }).click();
  await expect(page.getByText("Total: 31.96 MYR · Tax: 1.81")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Connectors", exact: true }).click();
  const warehouse = page.locator("li").filter({
    has: page.getByRole("heading", {
      name: "Mock WMS (development only)",
      exact: true,
    }),
  });
  await warehouse.getByRole("button", { name: "Configure" }).click();
  await page.getByLabel("Allow writes after exact-task approval").check();
  await page.getByRole("button", { name: "Save connector" }).click();
  await expect(page.locator("pre")).toContainText('"write_enabled": true');
  await page.getByLabel("Record JSON").fill('{"id":"ui-stock","quantity":42}');
  await page.getByRole("button", { name: "Request write approval" }).click();
  await expect(page.locator("pre")).toContainText("pending_approval");
  await page
    .getByRole("button", { name: "Business tools", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve exact task" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve exact task" }).click();
  const write = page
    .locator("li")
    .filter({ has: page.getByText("connector.write", { exact: true }) });
  await expect(write.getByText("completed", { exact: true })).toBeVisible();
  await expect(write.locator("pre")).toContainText('"quantity": 42');
  await page
    .getByRole("button", { name: "Emergency stop", exact: true })
    .click();
  await expect(
    page.getByText("Stopped · new tasks blocked", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create local draft" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Resume new work" }).click();
  await expect(
    page.getByRole("button", { name: "Create local draft" }),
  ).toBeEnabled();
});

test("employee assignment and development license status are visible", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByText("开发者连接（浏览器预览）", { exact: true }).click();
  await page
    .getByLabel("Backend session token")
    .fill("nightbrew-e2e-not-production");
  await page.getByRole("button", { name: "连接工作区", exact: true }).click();
  await expect(page.locator(".connection-pill.connected")).toBeVisible();
  await page.getByRole("button", { name: "Employees", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Finance UI Employee");
  await page.getByLabel("Role", { exact: true }).fill("Finance");
  await page
    .getByLabel("Instructions", { exact: true })
    .fill("Verify document totals.");
  await page
    .getByRole("button", { name: "Save employee", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Assign a job to Finance UI Employee" }),
  ).toBeVisible();
  await page.getByLabel("进阶任务配置（JSON）").check();
  await page.getByLabel("Task data (JSON)").fill(
    JSON.stringify({
      company: "NightBrew",
      customer: "UI Customer",
      reference: "EMP-001",
      lines: [{ description: "Tea", quantity: "2", unit_price: "5.00" }],
    }),
  );
  await page.getByRole("button", { name: "Assign task", exact: true }).click();
  await expect(
    page.getByText("pending_approval", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Business tools", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Approve exact task/, exact: false })
    .click();
  await expect(
    page.getByText("Total: 10.00 MYR · Tax: 0.00", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Subscription", exact: true }).click();
  await expect(page.locator("pre")).toContainText("development");
  await expect(
    page.getByRole("button", { name: "Check & download signed update" }),
  ).toBeDisabled();
});
