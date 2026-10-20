import { test, expect, type Page, type Route } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const user = { email: 'test@example.com', name: 'Test', role: 'editor' };
const job = { recordId: 'saved-1', customer: { jobNumber: 'UI-TEST', customerName: 'Recovered customer' } };
const ok = (route: Route, data: unknown) => route.fulfill({
  contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify({ ok: true, data }),
});

const sectionLabels = {
  home: 'Home', intake: 'Intake', customer: 'Customer & Property', insurance: 'Insurance & Claim',
  financials: 'Financials', mortgage: 'Mortgage', team: 'Team', productionNotes: 'Production Notes',
  checklist: 'Checklist', changeOrder: 'Change Order', documents: 'Documents',
};
async function navigate(page: Page, section: keyof typeof sectionLabels) {
  const group = ['customer', 'insurance', 'financials', 'mortgage'].includes(section) ? 'Job details'
    : ['team', 'productionNotes', 'checklist', 'changeOrder'].includes(section) ? 'Production' : sectionLabels[section];
  await page.getByRole('navigation', { name: 'Main navigation', exact: true })
    .getByRole('button', { name: group, exact: true }).click();
  if (group === 'Job details' || group === 'Production') {
    await page.getByRole('navigation', { name: `${group} sections`, exact: true })
      .getByRole('button', { name: new RegExp(`^${sectionLabels[section]}(?:\\s|$)`) }).click();
  }
}

async function start(page: Page, handler: (route: Route, body: any) => Promise<void>, savedJobs: unknown[] = []) {
  await page.addInitScript((account) => {
    localStorage.setItem('hays.db.session', JSON.stringify({ token: 'ui-session', expiresAt: '2099-01-01T00:00:00Z', user: account }));
  }, user);
  await page.route('https://script.google.com/macros/s/*/exec', async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === 'checkSession') await ok(route, { user });
    else if (body.action === 'listJobs') await ok(route, savedJobs);
    // This suite exercises the legacy backend. Model its explicit unsupported-action response.
    else if (body.action === 'getCapabilities') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'unknown_action', error: 'Legacy backend' }) });
    else await handler(route, body);
  });
  await page.goto('/');
}

test('startup recovers the shared draft before any autosave writes', async ({ page }) => {
  const sent: any[] = [];
  await start(page, async (route, body) => {
    if (body.action === 'getDraft') await ok(route, { draft: { job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' } });
    else if (body.action === 'saveDraft') { sent.push(body.draft.job); await ok(route, { job: body.draft.job, updatedAt: new Date().toISOString() }); }
  });
  await navigate(page, 'customer');
  await expect(page.locator('#customer-customerName')).toHaveValue('Recovered customer');
  await page.waitForTimeout(2300);
  expect(sent).toHaveLength(0);
  await page.locator('#customer-customerName').fill('Edited customer');
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].customer.customerName).toBe('Edited customer');
  await expect(page.getByText('Draft synced', { exact: true })).toBeVisible();
});

test('manual save stays responsive and edits survive a delayed cloud response', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let saveStarted = false;
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await start(page, async (route, body) => {
    if (body.action === 'getDraft') await ok(route, { draft: { job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' } });
    else if (body.action === 'saveJob') { saveStarted = true; await held; await ok(route, body.job); }
    else if (body.action === 'saveDraft') await ok(route, { job: body.draft.job, updatedAt: new Date().toISOString() });
  });
  await navigate(page, 'customer');
  await page.locator('#customer-customerName').fill('Saved snapshot');
  const save = page.getByRole('button', { name: 'Save job', exact: true });
  await save.click();
  await expect(save).toBeEnabled();
  await expect.poll(() => saveStarted).toBe(true);
  await page.locator('#customer-customerName').fill('Typed while syncing');
  release();
  await expect(page.locator('#customer-customerName')).toHaveValue('Typed while syncing');
  await expect(page.getByText('Draft synced', { exact: true })).toBeVisible();
  await page.reload();
  await navigate(page, 'customer');
  await expect(page.locator('#customer-customerName')).toHaveValue('Typed while syncing');
  expect(errors).toEqual([]);
});

test('a failed cloud request keeps the saved job without an uncaught UI error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await start(page, async (route, body) => {
    if (body.action === 'getDraft') await ok(route, { draft: { job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' } });
    else await route.fulfill({ status: 503, body: 'Temporarily unavailable', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.getByRole('button', { name: 'Save job', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save job', exact: true })).toBeEnabled();
  await expect(page.getByText('Retrying the connection automatically.', { exact: false })).toBeVisible();
  await expect(page.getByText('Recovered customer', { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

const intakeText = 'Customer Name: Uploaded customer\nClaim Number: OLD-CLAIM\nTotal Approved RCV: $12,000';
const intakePayload = {
  customer: { customerName: 'Uploaded customer' },
  insurance: { claimNumber: 'OLD-CLAIM' },
  financials: { totalApprovedRcv: 12000 },
};
const aiResponse = (route: Route) => route.fulfill({
  contentType: 'application/json',
  body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(intakePayload) } }] }),
});
const intakeInput = (page: Page) => page.getByRole('textbox', { name: 'Or paste intake notes', exact: true });

async function openNewJob(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'New job', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Start New Restoration Job?' })).toBeVisible();
}

async function clearJob(page: Page) {
  await openNewJob(page);
  await page.getByRole('button', { name: 'Clear All Fields', exact: true }).click();
  await expect(page.getByText('New blank job created — not yet saved to the database.', { exact: true })).toBeVisible();
  await expect(intakeInput(page)).toHaveValue('');
  await expect(page.getByText('Job information updated', { exact: true })).toHaveCount(0);
  await navigate(page, 'customer');
  await expect(page.locator('#customer-customerName')).toHaveValue('');
  await navigate(page, 'intake');
}

for (const fileType of ['text', 'PDF'] as const) {
  test(`clearing a ${fileType} intake removes uploads and results, preserves cancellation, and survives reload`, async ({ page }) => {
    let serverDraft: any = { job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' };
    let analyses = 0;
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.route('https://api.deepseek.com/chat/completions', async (route) => {
      analyses++;
      await aiResponse(route);
    });
    await start(page, async (route, body) => {
      if (body.action === 'getDraft') await ok(route, { draft: serverDraft });
      else if (body.action === 'saveDraft') {
        serverDraft = { job: body.draft.job, recordId: body.draft.recordId, updatedAt: new Date().toISOString() };
        await ok(route, serverDraft);
      }
    });
    await navigate(page, 'intake');
    let buffer = Buffer.from(intakeText);
    if (fileType === 'PDF') {
      const pdf = await PDFDocument.create();
      const pdfPage = pdf.addPage();
      intakeText.split('\n').forEach((line, index) => pdfPage.drawText(line, { x: 40, y: 740 - index * 24, size: 12 }));
      buffer = Buffer.from(await pdf.save());
    }
    const file = { name: fileType === 'PDF' ? 'old-intake.pdf' : 'old-intake.txt', mimeType: fileType === 'PDF' ? 'application/pdf' : 'text/plain', buffer };
    await page.locator('input[type=file]').setInputFiles(file);
    await expect(page.getByText(file.name, { exact: true })).toBeVisible();
    await expect(page.getByText('Job information updated', { exact: true })).toBeVisible();
    await expect(intakeInput(page)).toHaveValue(/Uploaded customer/);

    await navigate(page, 'customer');
    await expect(page.locator('#customer-customerName')).toHaveValue('Uploaded customer');
    await expect(page.getByRole('button', { name: 'Review intake', exact: true })).toBeVisible();
    await expect(intakeInput(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Review intake', exact: true }).click();
    await expect(intakeInput(page)).toHaveValue(/Uploaded customer/);

    await openNewJob(page);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText(file.name, { exact: true })).toBeVisible();
    await expect(page.getByText('Job information updated', { exact: true })).toBeVisible();

    await clearJob(page);
    await expect(page.getByText(file.name, { exact: true })).toHaveCount(0);
    // Reload as soon as clearing completes, before the normal cloud autosave delay.
    await page.reload();
    await navigate(page, 'customer');
    await expect(page.locator('#customer-customerName')).toHaveValue('');
    await navigate(page, 'intake');
    await expect(intakeInput(page)).toHaveValue('');
    await expect(page.getByText(file.name, { exact: true })).toHaveCount(0);
    await expect.poll(() => serverDraft.job.customer.customerName).toBe('');
    expect(serverDraft.job.insurance.claimNumber).toBe('');
    expect(serverDraft.job.financials.totalApprovedRcv).toBe('');
    expect(serverDraft.job.recordId).not.toBe(job.recordId);

    // The same file can be uploaded again after clearing, with a fresh analysis.
    await page.locator('input[type=file]').setInputFiles(file);
    await navigate(page, 'customer');
    await expect(page.locator('#customer-customerName')).toHaveValue('Uploaded customer');
    expect(analyses).toBe(2);
    expect(errors).toEqual([]);
  });
}

for (const outcome of ['success', 'failure'] as const) {
  test(`edits made in another section survive a delayed intake ${outcome}`, async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route('https://api.deepseek.com/chat/completions', async (route) => {
      await held;
      if (outcome === 'success') await aiResponse(route);
      else await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Test failure' } }) });
    });
    await start(page, async (route, body) => {
      if (body.action === 'getDraft') await ok(route, { draft: { job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' } });
      else if (body.action === 'saveDraft') await ok(route, { job: body.draft.job, updatedAt: new Date().toISOString() });
    });
    await navigate(page, 'intake');
    await page.locator('input[type=file]').setInputFiles({ name: 'held-intake.txt', mimeType: 'text/plain', buffer: Buffer.from(intakeText) });
    await expect(page.getByRole('button', { name: 'Analyzing intake…', exact: true })).toBeVisible();
    await navigate(page, 'customer');
    await page.locator('#customer-mainPhone').fill('260-555-0188');
    release();
    await expect(page.locator('#customer-customerName')).toHaveValue('Uploaded customer');
    await expect(page.locator('#customer-mainPhone')).toHaveValue('260-555-0188');
    await page.getByRole('button', { name: 'Review intake', exact: true }).click();
    await expect(page.getByText('Job information updated', { exact: true })).toBeVisible();
    await expect(intakeInput(page)).toHaveValue(/Uploaded customer/);
  });
}

test('missing document fields lead directly to inputs and readiness updates across screens', async ({ page }) => {
  await page.route('https://api.deepseek.com/chat/completions', aiResponse);
  await start(page, async (route, body) => {
    if (body.action === 'getDraft') await ok(route, { draft: { job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' } });
    else if (body.action === 'saveDraft') await ok(route, { job: body.draft.job, updatedAt: new Date().toISOString() });
  });
  await navigate(page, 'intake');
  await page.locator('input[type=file]').setInputFiles({ name: 'review-intake.txt', mimeType: 'text/plain', buffer: Buffer.from(intakeText) });
  await expect(page.getByText('Job information updated', { exact: true })).toBeVisible();
  await navigate(page, 'documents');
  await expect(page.getByText('3 required fields to review', { exact: true })).toBeVisible();
  for (const field of [
    { label: 'Loss property address', id: 'customer-lossAddress', value: '123 Review Street' },
    { label: 'Insurance carrier', id: 'insurance-carrier', value: 'Review Carrier' },
    { label: 'Deductible', id: 'deductible-input', value: '500' },
  ]) {
    await page.getByRole('button', { name: field.label, exact: true }).click();
    await expect(page.locator(`#${field.id}`)).toBeFocused();
    await page.locator(`#${field.id}`).fill(field.value);
    await navigate(page, 'documents');
  }
  await expect(page.getByText('Required fields complete', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Missing required fields', { exact: true })).toHaveCount(0);
  await navigate(page, 'intake');
  await expect(page.getByText('Required information to confirm', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Required intake fields are complete.', { exact: false })).toBeVisible();
});

async function startIntakeTest(page: Page) {
  await start(page, async (route, body) => {
    if (body.action === 'getDraft') await ok(route, { draft: { job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' } });
    else if (body.action === 'saveDraft') await ok(route, { job: body.draft.job, updatedAt: new Date().toISOString() });
    else if (body.action === 'saveJob') await ok(route, body.job);
  });
  await navigate(page, 'intake');
}
async function respondWithPayload(route: Route, fields: unknown) {
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(fields) } }] }) });
}

test('local results are usable during AI, manual edits survive, and conflicts can be reviewed on a phone', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://api.deepseek.com/chat/completions', async route => {
    await held;
    await respondWithPayload(route, { customer: { customerName: 'AI customer', email: 'ai@example.com' }, insurance: { claimNumber: 'AI-CLAIM' }, financials: { totalApprovedRcv: 20000, deductible: 500 } });
  });
  await startIntakeTest(page);
  await page.locator('input[type=file]').setInputFiles({ name: 'both.txt', mimeType: 'text/plain', buffer: Buffer.from(intakeText) });
  await expect(page.getByText(/Built-in extraction: Complete/)).toBeVisible();
  await expect(page.getByText('AI extraction: Running', { exact: true })).toBeVisible();
  await expect(page.getByText('Job information updated', { exact: true })).toBeVisible();
  await expect(intakeInput(page)).toBeEnabled();
  await navigate(page, 'customer');
  await expect(page.locator('#customer-customerName')).toHaveValue('Uploaded customer');
  await page.locator('#customer-customerName').fill('Manual correction');
  await page.getByRole('button', { name: 'Save job', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save job', exact: true })).toBeEnabled();
  release();
  await page.getByRole('button', { name: 'Review intake', exact: true }).click();
  await expect(page.getByText(/AI extraction: Complete/)).toBeVisible();
  await expect(page.getByRole('group', { name: 'Review Customer Name', exact: true })).toContainText('Manual correction');
  await page.getByRole('button', { name: 'Keep current Customer Name', exact: true }).click();
  await page.getByRole('button', { name: 'Use AI for Claim Number', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.getByRole('group', { name: 'Review Total Approved RCV', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/intake-conflict-phone.png', fullPage: true });
  await page.getByRole('button', { name: 'Use AI for Total Approved RCV', exact: true }).click();
  await navigate(page, 'customer');
  await expect(page.locator('#customer-customerName')).toHaveValue('Manual correction');
  await expect(page.locator('#customer-email')).toHaveValue('ai@example.com');
  await navigate(page, 'insurance');
  await expect(page.locator('#insurance-claimNumber')).toHaveValue('AI-CLAIM');
  await navigate(page, 'financials');
  await expect(page.locator('#rcv-input')).toHaveValue('20000');
  await expect(page.locator('#deductible-input')).toHaveValue('500');
  expect(errors).toEqual([]);
});

for (const failure of ['unauthorized', 'invalid JSON', 'empty fields'] as const) {
  test(`AI ${failure} preserves local results and Retry AI runs only AI`, async ({ page }) => {
    let calls = 0;
    await page.route('https://api.deepseek.com/chat/completions', async route => {
      calls++;
      if (calls > 1) return respondWithPayload(route, { customer: { email: 'retry@example.com' } });
      if (failure === 'unauthorized') await route.fulfill({ status: 401, body: '{}' });
      else if (failure === 'invalid JSON') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'not JSON' } }] }) });
      else await respondWithPayload(route, {});
    });
    await startIntakeTest(page);
    await page.locator('input[type=file]').setInputFiles({ name: 'local.txt', mimeType: 'text/plain', buffer: Buffer.from(intakeText) });
    await expect(page.getByRole('button', { name: 'Retry AI', exact: true })).toBeVisible();
    await navigate(page, 'customer');
    await page.locator('#customer-customerName').fill('Manual correction');
    await page.getByRole('button', { name: 'Review intake', exact: true }).click();
    await page.getByRole('button', { name: 'Retry AI', exact: true }).click();
    await expect(page.getByText(/AI extraction: Complete/)).toBeVisible();
    await navigate(page, 'customer');
    await expect(page.locator('#customer-customerName')).toHaveValue('Manual correction');
    await expect(page.locator('#customer-email')).toHaveValue('retry@example.com');
    expect(calls).toBe(2);
  });
}

test('a paste starts both methods and empty local extraction still permits AI-only success', async ({ page }) => {
  await page.route('https://api.deepseek.com/chat/completions', route => respondWithPayload(route, { customer: { customerName: 'AI-only customer' } }));
  await startIntakeTest(page);
  // Chromium's insertFromPaste event follows the same input and paste handlers as a clipboard paste.
  await intakeInput(page).evaluate((node: HTMLTextAreaElement) => {
    const text = 'Here is an unstructured report.';
    const clipboardData = new DataTransfer();
    clipboardData.setData('text', text);
    node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData }));
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(node, text);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.getByText('Built-in extraction: No usable fields', { exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Review Customer Name', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use AI for Customer Name', exact: true }).click();
  await navigate(page, 'customer');
  await expect(page.locator('#customer-customerName')).toHaveValue('AI-only customer');
});

test('neither method finding fields leaves the job unchanged and retains input', async ({ page }) => {
  await page.route('https://api.deepseek.com/chat/completions', route => respondWithPayload(route, {}));
  await startIntakeTest(page);
  await intakeInput(page).fill('???');
  await page.getByRole('button', { name: 'Analyze intake', exact: true }).click();
  await expect(page.getByText(/Neither method extracted usable fields/)).toBeVisible();
  await expect(intakeInput(page)).toHaveValue('???');
  await expect(page.getByText('Job information updated', { exact: true })).toHaveCount(0);
  await navigate(page, 'customer');
  await expect(page.locator('#customer-customerName')).toHaveValue('Recovered customer');
});

test('a new intake and a reset ignore older AI responses', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route('https://api.deepseek.com/chat/completions', async route => {
    calls++;
    await held;
    await respondWithPayload(route, { customer: { email: 'stale@example.com' } });
  });
  await startIntakeTest(page);
  await intakeInput(page).fill('Customer Name: First intake');
  await page.getByRole('button', { name: 'Analyze intake', exact: true }).click();
  await expect.poll(() => calls).toBe(1);
  await intakeInput(page).fill('Customer Name: Second intake');
  await page.getByRole('button', { name: 'Analyzing intake…', exact: true }).click();
  await expect.poll(() => calls).toBe(2);
  await navigate(page, 'customer');
  await expect(page.locator('#customer-customerName')).toHaveValue('Second intake');
  await navigate(page, 'intake');
  await clearJob(page);
  release();
  await navigate(page, 'customer');
  await expect(page.locator('#customer-customerName')).toHaveValue('');
  await expect(page.locator('#customer-email')).toHaveValue('');
});

test('the 60 second AI deadline leaves local extraction usable', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route('https://api.deepseek.com/chat/completions', async route => { calls++; await held; await respondWithPayload(route, {}); });
  await startIntakeTest(page);
  await page.clock.install();
  await intakeInput(page).fill(intakeText);
  await page.getByRole('button', { name: 'Analyze intake', exact: true }).click();
  await expect.poll(() => calls).toBe(1);
  await page.clock.fastForward(60_001);
  await expect(page.getByRole('button', { name: 'Retry AI', exact: true })).toBeVisible();
  await expect(page.getByText(/timed out after 60 seconds/)).toBeVisible();
  release();
  await navigate(page, 'customer');
  await expect(page.locator('#customer-customerName')).toHaveValue('Uploaded customer');
  expect(calls).toBe(1);
});

test('a transient AI retry shares the original 60 second deadline', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route('https://api.deepseek.com/chat/completions', async route => {
    if (++calls === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    await held;
    await respondWithPayload(route, {});
  });
  await startIntakeTest(page);
  await page.clock.install();
  const failedResponse = page.waitForResponse(response => response.url().includes('api.deepseek.com') && response.status() === 503);
  await intakeInput(page).fill(intakeText);
  await page.getByRole('button', { name: 'Analyze intake', exact: true }).click();
  await failedResponse;
  await page.clock.runFor(701);
  await expect.poll(() => calls).toBe(2);
  await page.clock.fastForward(59_301);
  await expect(page.getByRole('button', { name: 'Retry AI', exact: true })).toBeVisible();
  release();
  await navigate(page, 'customer');
  await expect(page.locator('#customer-customerName')).toHaveValue('Uploaded customer');
  expect(calls).toBe(2);
});

const libraryJobs = [
  { recordId: 'saved-1', customerName: 'Zulu customer', jobNumber: 'JOB-2', lossAddress: '2 Main Street', updatedAt: '2026-10-07T12:00:00Z' },
  { recordId: 'saved-2', customerName: 'Alpha customer', jobNumber: 'JOB-10', lossAddress: '10 Main Street', updatedAt: '2026-10-06T12:00:00Z' },
];

test('home offers direct starting actions and five destinations at every screen size', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await start(page, async (route, body) => {
    if (body.action === 'getDraft') await ok(route, { draft: null });
    else if (body.action === 'saveDraft') await ok(route, { job: body.draft.job, updatedAt: new Date().toISOString() });
  });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true });
    await expect(navigation.getByRole('button')).toHaveCount(5);
    await expect(navigation.getByRole('button', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('complementary')).toHaveCount(0);
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New job', exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Import job information', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Bring in your job information' })).toBeVisible();
    await navigate(page, 'home');
    await page.getByRole('button', { name: 'Enter manually', exact: true }).click();
    await expect(page.locator('#customer-customerName')).toBeVisible();
    await navigate(page, 'home');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: /^0 saved jobs/ }).click();
    await expect(page.getByRole('searchbox', { name: 'Search jobs', exact: true })).toBeFocused();
  }
  expect(errors).toEqual([]);
});

test('dashboard next steps focus the missing field and sync notices leave phone navigation accessible', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page, async (route, body) => {
    if (body.action === 'getDraft') await ok(route, { draft: { job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' } });
    else if (body.action === 'saveDraft') await ok(route, { job: body.draft.job, updatedAt: new Date().toISOString() });
  });
  await expect(page.getByRole('progressbar', { name: 'Required job fields' })).toHaveAttribute('aria-valuenow', '1');
  await page.getByRole('button', { name: 'Loss property address', exact: true }).click();
  await expect(page.locator('#customer-lossAddress')).toBeFocused();
  await page.locator('#customer-lossAddress').fill('123 Test Street');
  await navigate(page, 'checklist');
  await navigate(page, 'home');
  await expect(page.getByRole('progressbar', { name: 'Required job fields' })).toHaveAttribute('aria-valuenow', '2');
  await context.setOffline(true);
  const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  await expect(page.getByText('Offline', { exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: 'Job details', exact: true }).click();
  await expect(page.locator('#customer-lossAddress')).toHaveValue('123 Test Street');
  await expect(navigation.getByRole('button', { name: 'Job details', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('jobs can be searched and sorted, and Continue editing keeps current draft edits', async ({ page }) => {
  let loads = 0;
  await start(page, async (route, body) => {
    if (body.action === 'getDraft') await ok(route, { draft: { job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' } });
    else if (body.action === 'getJob') { loads++; await ok(route, job); }
    else if (body.action === 'saveDraft') await ok(route, { job: body.draft.job, updatedAt: new Date().toISOString() });
  }, libraryJobs);
  const library = page.getByRole('region', { name: 'Jobs', exact: true });
  await expect(library.getByRole('listitem').first()).toContainText('Zulu customer');
  await library.getByLabel('Sort by', { exact: true }).selectOption('customer');
  await expect(library.getByRole('listitem').first()).toContainText('Alpha customer');
  await library.getByLabel('Sort by', { exact: true }).selectOption('number');
  await expect(library.getByRole('listitem').first()).toContainText('Zulu customer');
  await library.getByRole('searchbox', { name: 'Search jobs', exact: true }).fill('10 Main Street');
  await expect(library.getByRole('listitem')).toHaveCount(1);
  await expect(library.getByRole('listitem')).toContainText('Alpha customer');
  await library.getByRole('searchbox', { name: 'Search jobs', exact: true }).fill('no-match');
  await library.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(library.getByRole('listitem')).toHaveCount(2);
  await navigate(page, 'customer');
  await page.locator('#customer-mainPhone').fill('260-555-0199');
  await page.getByRole('button', { name: 'Open saved jobs', exact: true }).click();
  await library.getByRole('button', { name: /^Continue editing/ }).click();
  await expect(page.locator('#customer-mainPhone')).toHaveValue('260-555-0199');
  expect(loads).toBe(0);
});

test('phone and tablet navigation, form actions, and account menu fit the screen', async ({ page }) => {
  await start(page, async (route, body) => {
    if (body.action === 'getDraft') await ok(route, { draft: { job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' } });
    else if (body.action === 'saveDraft') await ok(route, { job: body.draft.job, updatedAt: new Date().toISOString() });
  }, libraryJobs);
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await navigate(page, 'intake');
    await expect(page.getByRole('heading', { name: 'Bring in your job information' })).toBeVisible();
    await expect(page.getByRole('banner').getByRole('button', { name: 'New job', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save job', exact: true })).toBeVisible();
    await navigate(page, 'mortgage');
    await expect(page.getByRole('heading', { name: 'Mortgage & Lienholder', exact: true })).toBeVisible();
    await navigate(page, 'team');
    await expect(page.getByRole('heading', { name: 'Mortgage & Lienholder', exact: true })).toHaveCount(0);
    await navigate(page, 'home');
    await expect(page.getByRole('region', { name: 'Jobs', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const account = page.getByRole('button', { name: 'Account and connections', exact: true });
    await account.click();
    await expect(page.locator('#account-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#account-panel')).toHaveCount(0);
    await expect(account).toBeFocused();
  }
});

for (const outcome of ['success', 'failure'] as const) {
  test(`a delayed AI ${outcome} cannot restore an intake after clearing`, async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let analysisFinished = false;
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.route('https://api.deepseek.com/chat/completions', async (route) => {
      await held;
      if (outcome === 'success') await aiResponse(route);
      else await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Test failure' } }) });
      analysisFinished = true;
    });
    await start(page, async (route, body) => {
      if (body.action === 'getDraft') await ok(route, { draft: { job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' } });
      else if (body.action === 'saveDraft') await ok(route, { job: body.draft.job, updatedAt: new Date().toISOString() });
    });
    await navigate(page, 'intake');
    await page.locator('input[type=file]').setInputFiles({ name: 'pending-intake.txt', mimeType: 'text/plain', buffer: Buffer.from(intakeText) });
    await expect(page.getByRole('button', { name: 'Analyzing intake…', exact: true })).toBeVisible();
    // Moving through job sections must not discard an analysis in progress.
    await navigate(page, 'customer');
    await expect(page.getByText('Analyzing intake', { exact: false }).last()).toBeVisible();
    await clearJob(page);
    release();
    await expect.poll(() => analysisFinished).toBe(true);
    // Allow response parsing and the fallback path to finish before checking the form.
    await page.waitForTimeout(200);
    await expect(intakeInput(page)).toHaveValue('');
    await expect(page.getByText('Job information updated', { exact: true })).toHaveCount(0);
    await expect(page.getByText('pending-intake.txt', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Analyze intake', exact: true })).toBeDisabled();
    await navigate(page, 'customer');
    await expect(page.locator('#customer-customerName')).toHaveValue('');
    expect(errors).toEqual([]);
  });
}
