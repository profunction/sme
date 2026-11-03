import { test, expect, type Page } from '@playwright/test';
const models = { local_model: 'fixture:3b', cloud_model: 'deepseek-chat', cloud_url: 'https://api.deepseek.com/v1' };
async function openChat(page: Page) {
  await page.route('**/settings/cloud-connection', route => route.fulfill({ json: { key_present: true, local_only_preview: false, models } }));
  await page.route('**/settings/ai', route => route.fulfill({ json: { billing_source: 'BYOK', cloud_allowed: true, pricing_confirmed: true } }));
  await page.goto('/');
  await page.getByText('开发者连接（浏览器预览）', { exact: true }).click();
  await page.getByLabel('Backend session token').fill('nightbrew-e2e-not-production');
  await page.getByRole('button', { name: '连接工作区', exact: true }).click();
  await page.getByRole('button', { name: 'Assistant', exact: true }).click();
  await expect(page.getByLabel('处理方式', { exact: true })).toHaveValue('CLOUD_ONLY');
}

test('cloud send confirms exactly that message, including a fresh retry after failure', async ({ page }) => {
  const calls: Record<string, unknown>[] = [];
  await page.route('**/chat', async route => {
    calls.push(route.request().postDataJSON());
    await route.fulfill(calls.length === 1
      ? { status: 502, json: { detail: { code: 'AI_CLOUD_NETWORK', message: 'Network failure', mode: 'CLOUD_ONLY', model: 'deepseek-chat' } } }
      : { json: { answer: 'Fixture answer', provider: 'owned fixture' } });
  });
  await openChat(page);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByLabel('Message', { exact: true }).fill('try');
  expect(calls).toHaveLength(0);
  const send = page.getByRole('button', { name: '同意云端处理并发送 →', exact: true });
  await send.click();
  await expect(page.getByRole('alert')).toContainText('无法连接云端 AI');
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('try');
  await send.focus(); await send.press('Enter');
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
  await expect(send).toBeDisabled();
  expect(calls).toHaveLength(2);
  for (const call of calls) expect(call).toMatchObject({ message: 'try', cloud_consent: true, mode: 'CLOUD_ONLY' });
  await page.getByLabel('Message', { exact: true }).fill('a new message');
  await page.getByLabel('界面语言 / Interface language').selectOption('en');
  await expect(page.getByRole('button', { name: 'Consent and send to cloud →', exact: true })).toBeVisible();
  expect(calls).toHaveLength(2); // Editing and changing language do not dispatch.
});

test('implicit form submission cannot grant cloud consent', async ({ page }) => {
  let calls = 0;
  await page.route('**/chat', async route => { calls++; await route.fulfill({ json: { answer: 'Approved fixture', provider: 'fixture' } }); });
  await openChat(page);
  await page.getByLabel('Message', { exact: true }).fill('Do not send implicitly');
  await page.locator('form.chat-composer').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.getByRole('alert')).toContainText('请点击输入框旁');
  expect(calls).toBe(0);
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Do not send implicitly');
  await page.getByRole('button', { name: '同意云端处理并发送 →', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
  expect(calls).toBe(1);
});

test('rapid duplicate send gestures dispatch only once and protect the draft while running', async ({ page }) => {
  let calls = 0, release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/chat', async route => { calls++; await hold; await route.fulfill({ json: { answer: 'One fixture answer', provider: 'fixture' } }); });
  await openChat(page);
  await page.getByLabel('Message', { exact: true }).fill('one request only');
  await page.locator('form.chat-composer button[type=submit]').evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => calls).toBe(1);
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  release();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
  expect(calls).toBe(1);
});

test('private data cannot be confirmed for cloud and local send carries no cloud authorization', async ({ page }) => {
  const calls: Record<string, unknown>[] = [];
  await page.route('**/chat', async route => { calls.push(route.request().postDataJSON()); await route.fulfill({ json: { answer: 'Local fixture', provider: 'local fixture' } }); });
  await openChat(page);
  await page.getByLabel('Message', { exact: true }).fill('Private field note');
  await page.getByText('AI 与隐私选项', { exact: true }).click();
  await page.getByLabel('资料隐私', { exact: true }).selectOption('private');
  await expect(page.locator('form.chat-composer button[type=submit]')).toBeDisabled();
  await expect(page.getByText('这条消息设为私密资料，请先选择本地 AI 后再发送。', { exact: true })).toBeVisible();
  expect(calls).toHaveLength(0);
  await page.getByLabel('处理方式', { exact: true }).selectOption('LOCAL_ONLY');
  await page.getByRole('button', { name: '发送给助理 →', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
  expect(calls[0]).toMatchObject({ mode: 'LOCAL_ONLY', privacy: 'private', cloud_consent: false });
});

test('a service rejection after consent was sent reports a mismatch rather than blaming an unticked box', async ({ page }) => {
  let sent = false;
  await page.route('**/chat', async route => {
    sent = route.request().postDataJSON().cloud_consent;
    await route.fulfill({ status: 403, json: { detail: 'Explicit cloud data consent is required' } });
  });
  await openChat(page);
  await page.getByLabel('Message', { exact: true }).fill('try');
  await page.getByRole('button', { name: '同意云端处理并发送 →', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('本次请求已提交云端许可，但服务仍拒绝该许可');
  await expect(page.getByRole('alert')).not.toContainText('勾选');
  expect(sent).toBe(true);
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('try');
});

test('cloud estimate consent dispatches no chat and grants no future implicit send', async ({ page }) => {
  let estimates = 0, chats = 0;
  await page.route('**/ai/estimate', async route => {
    estimates++; expect(route.request().postDataJSON().cloud_consent).toBe(true);
    await route.fulfill({ json: { provider: 'CLOUD_ONLY', estimated_max_cost_usd: 0.001 } });
  });
  await page.route('**/chat', async route => { chats++; await route.fulfill({ json: { answer: 'No implicit permission', provider: 'fixture' } }); });
  await openChat(page);
  await page.getByLabel('Message', { exact: true }).fill('Estimate this only');
  await page.getByText('AI 与隐私选项', { exact: true }).click();
  await page.getByRole('button', { name: '同意本次云端估算', exact: true }).click();
  await expect.poll(() => estimates).toBe(1);
  await page.locator('form.chat-composer').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.getByRole('alert')).toContainText('请点击输入框旁');
  expect(chats).toBe(0);
});
