import { test, expect, type Page } from '@playwright/test';
import { blankDecision, createCloseout } from '../src/types/workflow';
import { editor, openWorkflow, WorkflowMock } from './workflow-ui-fixture';

async function start(page: Page, mock: WorkflowMock) {
  await mock.install(page.context());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Job progress', exact: true })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

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
  await expect(page.getByText('Cabinet installation finished today.', { exact: true })).toBeVisible();
  await page.reload();
  await openWorkflow(page, 'Updates');
  await expect(page.getByText('Cabinet installation finished today.', { exact: true })).toBeVisible();
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
