import { test, expect } from "@playwright/test";

test("a reviewed purchase order exports only after approval and edits invalidate review", async ({ page }) => {
  await page.goto("/");
  await page.getByText("开发者连接（浏览器预览）", { exact: true }).click();
  await page.getByLabel("Backend session token").fill("nightbrew-e2e-not-production");
  await page.getByRole("button", { name: "连接工作区", exact: true }).click();
  await expect(page.locator(".connection-pill.connected")).toBeVisible();
  await page.getByRole("button", { name: "Business tools", exact: true }).click();
  await page.getByLabel("Upload XLSX, PDF, Word or CSV (maximum 10 MiB)").setInputFiles({
    name: "po-ui.csv", mimeType: "text/csv",
    buffer: Buffer.from("sku,description,quantity,unit_price,line_total\nTEA,Tea,3,10.05,30.15\n"),
  });
  const po = page.locator("section").filter({ has: page.getByRole("heading", { name: "采购单校验与导出 / Purchase order review", exact: true }) });
  await po.getByLabel("选择采购单模板文件").selectOption({ label: "po-ui.csv" });
  await po.getByRole("button", { name: "导入明细 / Import lines", exact: true }).click();
  await po.getByRole("button", { name: "载入导入结果 · po-ui.csv", exact: true }).click();
  await po.getByLabel("采购单编号", { exact: true }).fill("PO-UI-001");
  await po.getByLabel("客户 / 供应商", { exact: true }).fill("Pilot fixture customer");
  await po.getByLabel("税率 (%)", { exact: true }).fill("6");
  await po.getByLabel("原采购单总额", { exact: true }).fill("31.96");
  await po.getByLabel("核准单价", { exact: true }).fill("9.00");
  await po.getByRole("button", { name: "校验产品、价格与总额 / Validate", exact: true }).click();
  await expect(po.getByText("有差异，请修改后重新校验", { exact: true })).toBeVisible();
  await expect(po.getByRole("button", { name: "申请导出审批 / Request export approval" })).toBeDisabled();
  await po.getByLabel("核准单价", { exact: true }).fill("10.05");
  await po.getByRole("button", { name: "校验产品、价格与总额 / Validate", exact: true }).click();
  await expect(po.getByText("校验通过，下一步申请导出审批", { exact: true })).toBeVisible();
  await po.getByRole("button", { name: "申请导出审批 / Request export approval" }).click();
  const exported = page.locator("li").filter({ has: page.getByText("purchase_order.export", { exact: true }) });
  await expect(exported.getByText("pending_approval", { exact: true })).toBeVisible();
  await expect(page.locator("li").filter({ has: page.getByText("reviewed-purchase-order.csv", { exact: true }) })).toHaveCount(0);
  await exported.getByRole("button", { name: "Approve exact task" }).click();
  await expect(exported.getByText("completed", { exact: true })).toBeVisible();
  const output = page.locator("li").filter({ has: page.getByText("reviewed-purchase-order.csv", { exact: true }) });
  await expect(output.getByRole("button", { name: "Download", exact: true })).toBeVisible();
  await po.getByLabel("原采购单总额", { exact: true }).fill("30.00");
  await expect(po.getByRole("button", { name: "申请导出审批 / Request export approval" })).toHaveCount(0);
});
