import { test, expect, type Page } from '@playwright/test';
import { blankDecision, createCloseout } from '../src/types/workflow';
import { editor, openWorkflow, WorkflowMock } from './workflow-ui-fixture';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';

async function start(page: Page, mock: WorkflowMock) {
  await mock.install(page.context());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Job progress', exact: true })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test('quick changes are reachable on phone and desktop and unfinished inputs recover', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const mock = new WorkflowMock(); mock.seedWorkflow(); await start(page, mock);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true });
    await expect(nav.getByRole('button')).toHaveText(['Home', 'Job details', 'Changes', 'Production', 'Documents']);
    await nav.getByRole('button', { name: 'Changes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Quick change order', exact: true })).toBeVisible();
    const brandButtonColor = await page.getByRole('button', { name: 'Save job', exact: true }).evaluate(node => getComputedStyle(node).backgroundColor);
    await expect(page.getByRole('button', { name: 'Review change order', exact: true })).toHaveCSS('background-color', brandButtonColor);
    await expect(page.getByRole('button', { name: 'Review change order', exact: true })).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(page.getByRole('heading', { name: 'Bring in your job information' })).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Job section actions' })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/quick-change-${width}.png`, fullPage: true });
  }
  await page.getByLabel('What needs to change?', { exact: true }).fill('Replace kitchen base cabinet after concealed damage.');
  await page.getByLabel('Change amount ($)', { exact: true }).fill('250.17');
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: 'Documents', exact: true }).click();
  await openWorkflow(page, 'Change Order');
  await expect(page.getByLabel('What needs to change?', { exact: true })).toHaveValue('Replace kitchen base cabinet after concealed damage.');
  await page.reload(); await openWorkflow(page, 'Change Order');
  await expect(page.getByLabel('Change amount ($)', { exact: true })).toHaveValue('250.17');
  await page.getByRole('button', { name: 'Add change / supplement', exact: true }).click();
  await expect(page.getByLabel('Scope of this change', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Register status', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('quick change review submits exact credits and zero amounts once with approval pending', async ({ page }) => {
  const mock = new WorkflowMock(); mock.seedWorkflow(); await start(page, mock);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Quick change order', exact: true }).click();
  for (const [index, amount] of ['-125.37', '0'].entries()) {
    if (index) await page.getByRole('button', { name: 'Quick change order', exact: true }).click();
    await page.getByLabel('What needs to change?', { exact: true }).fill(`Reviewed change ${index + 1}`);
    await page.getByLabel('Change amount ($)', { exact: true }).fill(amount);
    await page.getByRole('button', { name: 'Review change order', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review change order', exact: true })).toBeVisible();
    await expect(page.getByText('Workflow customer · WF-UI-100', { exact: true })).toBeVisible();
    expect([...mock.items.values()].filter(item => item.kind === 'change')).toHaveLength(index);
    await page.getByRole('button', { name: 'Submit change order', exact: true }).click();
    await expect.poll(() => [...mock.items.values()].filter(item => item.kind === 'change').length).toBe(index + 1);
    const saved = [...mock.items.values()].find(item => item.kind === 'change' && item.payload.scope === `Reviewed change ${index + 1}`)!;
    expect(saved.payload).toMatchObject({ amountCents: index ? 0 : -12537, lifecycle: 'submitted', number: `CO-00${index + 1}`, customerDecision: { status: 'pending' } });
  }
});

test('quick change draft saves offline and remains queued until reconnecting', async ({ page, context }) => {
  const mock = new WorkflowMock(); mock.seedWorkflow(); await start(page, mock); await openWorkflow(page, 'Change Order');
  await page.getByLabel('What needs to change?', { exact: true }).fill('Offline field change');
  await page.getByLabel('Change amount ($)', { exact: true }).fill('300.01');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Save change draft', exact: true }).click();
  await expect(page.getByText('Offline field change', { exact: true })).toBeVisible();
  await expect(page.getByText(/Change draft saved on this device/)).toBeVisible();
  expect([...mock.items.values()].filter(item => item.kind === 'change')).toHaveLength(0);
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => [...mock.items.values()].filter(item => item.kind === 'change').length).toBe(1);
  expect([...mock.items.values()].find(item => item.kind === 'change')!.payload).toMatchObject({ amountCents: 30001, lifecycle: 'draft', number: '' });
});

test('quick changes for a new job use the saved job identity', async ({ page }) => {
  const mock = new WorkflowMock(); await mock.install(page.context());
  await page.route('https://script.google.com/macros/s/*/exec', route => {
    const body = route.request().postDataJSON();
    if (body.action === 'listWorkspaceDrafts') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: { drafts: [] } }) });
    return route.fallback();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick change order', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Quick change order', exact: true })).toBeHidden();
  await page.getByLabel('Customer / job name', { exact: true }).fill('New field job');
  await page.getByRole('button', { name: 'Save job and continue', exact: true }).click();
  await page.getByLabel('What needs to change?', { exact: true }).fill('New job additional repairs');
  await page.getByLabel('Change amount ($)', { exact: true }).fill('99.99');
  await page.getByRole('button', { name: 'Save change draft', exact: true }).click();
  await expect.poll(() => [...mock.items.values()].filter(item => item.kind === 'change').length).toBe(1);
  expect([...mock.items.values()].find(item => item.kind === 'change')!.jobId).toBe(mock.job.recordId);
  expect(mock.job.customer.customerName).toBe('New field job');
});

test('two editors refresh shared progress; completion removes its reminder and reopening restores it', async ({ page, browser }) => {
  const mock = new WorkflowMock(); mock.seedWorkflow();
  await start(page, mock);
  const second = await browser.newContext();
  await mock.install(second, { ...editor, email: 'second@example.com', name: 'Second Editor' });
  const other = await second.newPage(); await other.goto('/');
  await expect(other.getByRole('heading', { name: 'Job progress', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit progress', exact: true }).click();
  await page.getByLabel('Job stage', { exact: true }).selectOption('in_production');
  await page.getByLabel('Next action', { exact: true }).fill('Review flooring choice');
  await page.getByLabel('Responsible person', { exact: true }).fill(editor.name);
  await page.getByLabel("Responsible person's email", { exact: true }).fill(editor.email);
  await page.getByLabel('Due date', { exact: true }).fill('2020-01-01');
  await page.getByRole('button', { name: 'Save progress', exact: true }).click();
  await expect.poll(() => mock.items.get(`workflow:${mock.job.id}`)?.payload).toMatchObject({ stage: 'in_production', nextAction: { title: 'Review flooring choice' } });
  await other.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(other.getByText('Review flooring choice', { exact: true }).first()).toBeVisible();
  await page.getByRole('region', { name: 'Needs attention' }).getByRole('combobox').selectOption('mine');
  await expect(page.getByRole('region', { name: 'Needs attention' }).getByText(/Review flooring choice/)).toBeVisible();
  await page.getByRole('button', { name: 'Edit progress', exact: true }).click();
  await page.getByLabel('Action completed', { exact: true }).check();
  await page.getByRole('button', { name: 'Save progress', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Needs attention' }).getByText('No items match this view.')).toBeVisible();
  await page.getByRole('button', { name: 'Edit progress', exact: true }).click();
  await page.getByLabel('Action completed', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save progress', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Needs attention' }).getByText(/Review flooring choice/)).toBeVisible();
  await second.close();
});

test('posted notes survive offline reload, retain files and produce only explicitly selected customer text', async ({ page }) => {
  const mock = new WorkflowMock(); mock.seedWorkflow(); await start(page, mock);
  await openWorkflow(page, 'Updates');
  await expect(page.getByLabel('Update', { exact: true })).toBeVisible();
  await page.context().setOffline(true);
  await page.getByLabel('Update', { exact: true }).fill('Cabinet installation finished today.');
  await page.getByRole('button', { name: 'Post update', exact: true }).click();
  await expect(page.getByRole('listitem').getByText('Cabinet installation finished today.', { exact: true })).toBeVisible();
  await page.reload();
  await openWorkflow(page, 'Updates');
  await expect(page.getByRole('listitem').getByText('Cabinet installation finished today.', { exact: true })).toBeVisible();
  await page.getByLabel('Use in customer draft', { exact: true }).check();
  await page.getByRole('button', { name: 'Build draft (1 selected)', exact: true }).click();
  const draft = await page.getByLabel('Customer update draft', { exact: true }).inputValue();
  expect(draft).toContain('Cabinet installation finished today.');
  expect(draft).not.toMatch(/PRIVATE-|9876/);
  await page.context().setOffline(false);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => [...mock.items.values()].filter(item => item.kind === 'activity' && item.payload.source === 'manual').length).toBe(1);
});

test('selection decisions reset when a finish changes and create a linked change without inferred charge', async ({ page }) => {
  const mock = new WorkflowMock(); mock.seedWorkflow();
  mock.seed('selection', 'approved-selection', { room: 'Kitchen', item: 'Flooring', specification: 'Oak', allowanceCents: null, neededBy: '', responsiblePerson: { name: editor.name }, decision: { ...blankDecision(), status: 'approved', name: 'Customer', date: '2026-10-19', note: 'Verbal review' }, attachmentIds: [] });
  await start(page, mock); await openWorkflow(page, 'Selections');
  await expect(page.getByText('Allowance: Not recorded', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit selection / decision', exact: true }).click();
  await page.getByLabel('Specification / selected finish', { exact: true }).fill('Maple');
  await expect(page.getByText(/Saving resets its decision to Pending/)).toBeVisible();
  await page.getByRole('button', { name: 'Save selection', exact: true }).click();
  await expect.poll(() => mock.items.get('approved-selection')?.payload).toMatchObject({ specification: 'Maple', allowanceCents: null, decision: { status: 'pending' } });
  await page.getByRole('button', { name: 'Create change from selection', exact: true }).click();
  await expect(page.getByLabel('Scope of this change', { exact: true })).toHaveValue(/Kitchen.*Flooring.*Maple/);
  await expect(page.getByLabel('Change amount ($)', { exact: true })).toHaveValue('');
});

test('closeout audience changes clear private file choices and completion remains explicit', async ({ page }) => {
  const mock = new WorkflowMock(); mock.seedWorkflow(); const closeout = createCloseout(); closeout.completionDate = '2026-10-19'; closeout.completionOverrideReason = 'Office reviewed remaining items';
  mock.seed('closeout', `closeout:${mock.job.id}`, closeout);
  await start(page, mock); await openWorkflow(page, 'Closeout');
  await expect(page.getByRole('button', { name: 'Publish reviewed packet', exact: true })).toBeDisabled();
  await page.getByLabel('Packet audience', { exact: true }).selectOption('customer');
  await page.getByLabel('I reviewed the summary audience and every selected attachment for this packet.', { exact: true }).check();
  await expect(page.getByRole('button', { name: 'Download draft packet', exact: true })).toBeEnabled();
  expect(mock.items.get(`workflow:${mock.job.id}`)?.payload).toMatchObject({ stage: 'intake' });
  await page.getByRole('button', { name: 'Mark job complete', exact: true }).click();
  await expect.poll(() => mock.items.get(`workflow:${mock.job.id}`)?.payload).toMatchObject({ stage: 'complete' });
});

test('mobile dark and light production sections have labeled keyboard controls and fit the viewport', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  const mock = new WorkflowMock(); mock.seedWorkflow(); await start(page, mock);
  for (const section of ['Updates', 'Handoff', 'Selections', 'Change Order', 'Closeout'] as const) {
    await openWorkflow(page, section);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await openWorkflow(page, 'Selections');
  const add = page.getByRole('button', { name: 'Add selection', exact: true }); await add.focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('Selection item', { exact: true })).toBeVisible();
  await page.getByLabel('Selection item', { exact: true }).focus(); await expect(page.getByLabel('Selection item', { exact: true })).toBeFocused();
  await page.screenshot({ path: 'test-results/workflow-mobile-dark.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: 'test-results/workflow-mobile-light.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('two editors preserve a conflicting local progress change until explicit review', async ({ page, browser }) => {
  const mock = new WorkflowMock(); mock.seedWorkflow(); await start(page, mock);
  const second = await browser.newContext();
  try {
    await mock.install(second, { ...editor, email: 'reviewer@example.com', name: 'Reviewer' });
    const other = await second.newPage(); await other.goto('/');
    await expect(other.getByRole('heading', { name: 'Job progress', exact: true })).toBeVisible();
    await other.getByRole('button', { name: 'Edit progress', exact: true }).click();
    await other.getByLabel('Job stage', { exact: true }).selectOption('ready_for_production');
    await page.getByRole('button', { name: 'Edit progress', exact: true }).click();
    await page.getByLabel('Job stage', { exact: true }).selectOption('in_production');
    await page.getByRole('button', { name: 'Save progress', exact: true }).click();
    await expect.poll(() => mock.items.get(`workflow:${mock.job.id}`)?.payload).toMatchObject({ stage: 'in_production' });
    await other.getByRole('button', { name: 'Save progress', exact: true }).click();
    const review = other.getByRole('region', { name: 'Changes needing review', exact: true });
    await expect(review).toBeVisible();
    await expect(review.getByText(/ready_for_production/)).toBeVisible();
    await expect(review.getByText(/in_production/)).toBeVisible();
    expect(mock.items.get(`workflow:${mock.job.id}`)?.payload).toMatchObject({ stage: 'in_production' });
    await review.getByRole('button', { name: 'Save reviewed device version', exact: true }).click();
    await expect.poll(() => mock.items.get(`workflow:${mock.job.id}`)?.payload).toMatchObject({ stage: 'ready_for_production' });
    await expect(review).toHaveCount(0);
  } finally { await second.close(); }
});

test('supporting PDF upload recovers a lost acknowledgment without duplicating the file or note', async ({ page }) => {
  const mock = new WorkflowMock(); mock.seedWorkflow(); mock.loseUploadResponse = true;
  await start(page, mock); await openWorkflow(page, 'Updates');
  const pdf = await PDFDocument.create(); pdf.addPage();
  await page.getByLabel('Update', { exact: true }).fill('Reviewed completion evidence');
  await page.getByLabel('Optional photos or PDFs', { exact: true }).setInputFiles({ name: 'reviewed-evidence.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await page.getByRole('button', { name: 'Post update', exact: true }).click();
  await expect.poll(() => mock.uploadAttempts).toBe(1);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => mock.uploadAttempts).toBe(2);
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTitle('Preview of reviewed-evidence.pdf', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect([...mock.items.values()].filter(item => item.kind === 'attachment')).toHaveLength(1);
  expect([...mock.items.values()].filter(item => item.kind === 'activity' && item.payload.source === 'manual')).toHaveLength(1);
});

test('viewers can read updates and published documents without authoring controls', async ({ page }) => {
  const mock = new WorkflowMock(); mock.seedWorkflow();
  await mock.install(page.context(), { ...editor, role: 'viewer' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'View details', exact: true })).toBeVisible();
  await openWorkflow(page, 'Updates');
  await expect(page.getByText('Read-only workspace.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Post update', exact: true })).toHaveCount(0);
  await openWorkflow(page, 'Selections');
  await expect(page.getByRole('button', { name: 'Add selection', exact: true })).toHaveCount(0);
});

test('reviewed closeout publishes its frozen files and downloads exactly the displayed manifest', async ({ page }) => {
  const mock = new WorkflowMock(); mock.seedWorkflow(); const closeout = createCloseout();
  closeout.completionDate = '2026-10-21'; closeout.completionOverrideReason = 'Office reviewed completion evidence.';
  mock.seed('closeout', `closeout:${mock.job.id}`, closeout);
  await start(page, mock); await openWorkflow(page, 'Closeout');
  await page.getByLabel('Packet audience', { exact: true }).selectOption('customer');
  await page.getByLabel('I reviewed the summary audience and every selected attachment for this packet.', { exact: true }).check();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Publish reviewed packet', exact: true }).click();
  const download = await downloading;
  const path = await download.path();
  const { readFile } = await import('node:fs/promises');
  const zip = await JSZip.loadAsync(await readFile(path!));
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  expect(Object.values(zip.files).filter(file => !file.dir).map(file => file.name).sort()).toEqual([...manifest.entries].sort());
  expect(manifest.reviewState).toBe('final');
  expect(manifest.audience).toBe('customer');
  expect(Object.keys(zip.files).some(name => name.includes('snapshot'))).toBe(false);
  await expect.poll(() => [...mock.items.values()].filter(item => item.kind === 'artifact' && item.payload.reviewState === 'final').length).toBe(1);
  expect(mock.items.get(`workflow:${mock.job.id}`)?.payload).toMatchObject({ stage: 'intake' });
});
