import { test, expect, type Page } from '@playwright/test';
async function connect(page: Page) {
  await page.goto('/');
  await page.getByText('开发者连接（浏览器预览）', { exact: true }).click();
  await page.getByLabel('Backend session token').fill('nightbrew-e2e-not-production');
  await page.getByRole('button', { name: '连接工作区', exact: true }).click();
  await page.locator('.connection-pill.connected').waitFor();
  await page.getByRole('button', { name: 'Assistant', exact: true }).click();
}
const models = { local_model: 'local-fixture:3b', cloud_model: 'deepseek-chat', cloud_url: 'https://api.deepseek.com/v1' };

test('configured cloud choice is visible, billing failures are bilingual and drafts survive', async ({ page }) => {
  let calls = 0;
  await page.route('**/settings/cloud-connection', route => route.fulfill({ json: { key_present: true, local_only_preview: false, models } }));
  await page.route('**/settings/ai', route => route.fulfill({ json: { cloud_allowed: true, pricing_confirmed: true, billing_source: 'BYOK' } }));
  await page.route('**/chat', async route => {
    calls++;
    const body = route.request().postDataJSON();
    expect(body.mode).toBe('CLOUD_ONLY'); expect(body.cloud_consent).toBe(true);
    await route.fulfill({ status: 502, json: { detail: { code: 'AI_CLOUD_BALANCE', message: 'Provider reported billing issue', mode: 'CLOUD_ONLY', model: 'deepseek-chat', provider_status: 402 } } });
  });
  await connect(page);
  await expect(page.getByLabel('处理方式', { exact: true })).toHaveValue('CLOUD_ONLY');
  await expect(page.getByLabel('当前 AI 连接')).toContainText('deepseek-chat');
  expect(calls).toBe(0);
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  const draft = '帮我想一下我要怎样用你做东西';
  await page.getByLabel('Message', { exact: true }).fill(draft);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '发送给助理 →', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('云端返回余额或计费问题');
  await expect(page.getByRole('alert')).toContainText('HTTP 402');
  await expect(page.getByRole('alert')).toContainText('deepseek-chat');
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(draft);
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.getByLabel('界面语言 / Interface language').selectOption('en');
  await expect(page.getByRole('alert')).toContainText('billing or balance issue');
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(draft);
  expect(calls).toBe(1);
});

test('saving an API key alone does not authorize cloud processing', async ({ page }) => {
  let calls = 0;
  await page.route('**/settings/cloud-connection', route => route.fulfill({ json: { key_present: true, local_only_preview: false, models } }));
  await page.route('**/settings/ai', route => route.fulfill({ json: { cloud_allowed: false, pricing_confirmed: false, billing_source: 'BYOK' } }));
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/chat')) calls++; });
  await connect(page);
  await expect(page.getByLabel('处理方式', { exact: true })).toHaveValue('LOCAL_ONLY');
  await expect(page.getByLabel('当前 AI 连接')).toContainText('已保存 API Key，但当前选择的是本地 Ollama');
  await page.getByLabel('处理方式', { exact: true }).selectOption('CLOUD_ONLY');
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Assistant', exact: true }).click();
  await expect(page.getByLabel('处理方式', { exact: true })).toHaveValue('CLOUD_ONLY');
  expect(calls).toBe(0);
});
