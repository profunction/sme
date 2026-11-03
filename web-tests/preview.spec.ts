import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('web preview preserves drafts across pages and language changes without contacting an AI provider', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
  await page.goto('/web-preview.html');
  await expect(page.getByRole('heading', { name: '今天，先完成一件事。', exact: true })).toBeVisible();
  await expect(page.getByText(/AI 与服务器尚未连接/)).toBeVisible();
  await page.getByLabel('任务内容', { exact: true }).fill('请整理星期五交货的客户跟进事项。');
  await page.getByRole('button', { name: '保存任务草稿', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('尚未交给 AI 执行');
  await page.getByRole('button', { name: '草稿与结果', exact: true }).click();
  await expect(page.getByText('草稿已保存，未执行', { exact: true })).toBeVisible();
  await expect(page.locator('.web-draft-content')).toContainText('星期五交货');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载这份草稿', exact: true }).click();
  const file = await downloadEvent;
  expect(await readFile((await file.path())!, 'utf8')).toContain('星期五交货');
  await page.getByLabel('界面语言 / Interface language').selectOption('en');
  await page.getByRole('button', { name: 'AI workspace', exact: true }).click();
  await expect(page.getByLabel('Task brief', { exact: true })).toHaveValue('请整理星期五交货的客户跟进事项。');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await expect(page.getByText('Not connected; no API keys collected', { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test('quotation CSV uses exact decimal rounding and neutralizes spreadsheet formulas', async ({ page }) => {
  await page.goto('/web-preview.html');
  await page.getByRole('button', { name: '文档与表格', exact: true }).click();
  await page.getByLabel('公司', { exact: true }).fill('NightBrew');
  await page.getByLabel('客户', { exact: true }).fill('=HYPERLINK("unsafe")');
  await page.getByLabel('报价编号', { exact: true }).fill('WEB-Q-001');
  await page.getByLabel('产品或服务', { exact: true }).fill('Tea');
  await page.getByLabel('数量', { exact: true }).fill('3');
  await page.getByLabel('单价', { exact: true }).fill('10.05');
  await page.getByLabel('实际税率（%）', { exact: true }).fill('6');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '生成并下载 CSV 草稿', exact: true }).click();
  const file = await downloadEvent;
  const csv = await readFile((await file.path())!, 'utf8');
  expect(csv).toContain('"Total","31.96"'); expect(csv).toContain('"Tax","1.81"');
  expect(csv).toContain("'" + '=HYPERLINK');
  expect(csv).toContain('Draft - requires review; not issued or submitted');
  await expect(page.getByRole('status')).toContainText('总额 31.96 MYR');
  await page.getByRole('button', { name: '草稿与结果', exact: true }).click();
  await expect(page.getByText('CSV 草稿已生成', { exact: true })).toBeVisible();
});

test('employee drafts and local file selection are truthful and the layout works on a phone', async ({ page }) => {
  await page.goto('/web-preview.html');
  await page.getByRole('button', { name: '我的 AI 员工', exact: true }).click();
  await page.getByLabel('员工名称', { exact: true }).fill('小林');
  await page.getByLabel('岗位', { exact: true }).fill('客服');
  await page.getByLabel('工作说明', { exact: true }).fill('依据确认的事实准备草稿，不发送。');
  await page.getByRole('button', { name: '保存员工配置草稿', exact: true }).click();
  await expect(page.getByText('配置草稿 · 未启动', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '文档与表格', exact: true }).click();
  await page.getByLabel('选择本地文件', { exact: true }).setInputFiles({ name: 'local.csv', mimeType: 'text/csv', buffer: Buffer.from('item,quantity\nTea,3') });
  await expect(page.locator('.web-file-list')).toContainText('local.csv');
  await expect(page.locator('.web-file-list')).toContainText('未上传');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'AI 工作台', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: /员工配置.*1/ })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '我的 AI 员工', exact: true }).click();
  await expect(page.getByText('还没有员工配置草稿。', { exact: true })).toBeVisible();
});
