import { test, expect, type Page } from '@playwright/test';

const account = { email: 'theme@example.com', name: 'Theme test', role: 'editor' };
async function startWorkspace(page: Page) {
  await page.addInitScript(user => {
    localStorage.setItem('hays.db.session', JSON.stringify({ token: 'theme-test-session', expiresAt: '2099-01-01T00:00:00Z', user }));
  }, account);
  await page.route('https://script.google.com/macros/s/*/exec', route => {
    const request = route.request().postDataJSON();
    const data = request.action === 'checkSession' ? { user: account }
      : request.action === 'listJobs' ? []
      : request.action === 'getDraft' ? { draft: null }
      : { job: request.draft?.job, updatedAt: new Date().toISOString() };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Account and connections', exact: true })).toBeVisible();
}
async function openAppearance(page: Page) {
  await page.getByRole('button', { name: 'Account and connections', exact: true }).click();
  return page.getByRole('group', { name: 'Appearance', exact: true });
}

test('appearance switches both themes, supports keyboard, and persists after reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await startWorkspace(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light', { timeout: 1000 });
  const appearance = await openAppearance(page);
  await appearance.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(appearance.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(11, 18, 32)');
  await expect(page.getByRole('banner')).toHaveCSS('color-scheme', 'dark');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/theme-dark-desktop.png', fullPage: true });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const again = await openAppearance(page);
  await again.getByRole('button', { name: 'Light', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(248, 250, 252)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('first visit follows system preference and an explicit choice overrides it at startup', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await startWorkspace(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark', { timeout: 1000 });
  const appearance = await openAppearance(page);
  await appearance.getByRole('button', { name: 'Light', exact: true }).click();
  // Observe the document at DOMContentLoaded, before app data recovery finishes.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f8fafc');
});

test('dark forms, notices, and appearance controls fit mobile and tablet screens', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ colorScheme: 'dark' });
  await startWorkspace(page);
  await page.getByRole('button', { name: 'Enter manually', exact: true }).click();
  await page.locator('#customer-customerName').fill('Theme test customer');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const appearance = await openAppearance(page);
    await expect(appearance.getByRole('button', { name: 'Dark', exact: true })).toBeVisible();
    await appearance.getByRole('button', { name: 'Dark', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#customer-customerName')).toHaveValue('Theme test customer');
    await expect(page.locator('#customer-customerName')).toHaveCSS('background-color', 'rgb(17, 28, 46)');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390) await page.screenshot({ path: 'test-results/theme-dark-phone.png', fullPage: true });
  }
  expect(errors).toEqual([]);
});

test('signed-out users can change appearance even if preference storage is unavailable', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Storage unavailable', 'SecurityError'); };
  });
  await page.route('https://script.google.com/macros/s/*/exec', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: { enabled: false } }) }));
  await page.goto('/');
  const appearance = page.getByRole('group', { name: 'Appearance', exact: true });
  await expect(appearance).toBeVisible({ timeout: 1000 });
  await appearance.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#signin-email')).toBeVisible();
});
