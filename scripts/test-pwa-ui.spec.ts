import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('built PWA caches its shell, manifest and lazy workflow assets for an offline reload', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://script.google.com/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: { enabled: false } }) }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) {
    const response = await page.request.get(icon.src);
    expect(response.ok()).toBeTruthy();
    expect((await response.body()).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  }
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBeTruthy();
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async name =>
    (await (await caches.open(name)).keys()).map(request => request.url)))).flat());
  expect(cached.some(url => /WorkflowWorkspace.*\.js/.test(url))).toBeTruthy();
  expect(cached.some(url => /workflowDocuments.*\.js/.test(url))).toBeTruthy();
  expect(cached.some(url => /pdf\.worker.*\.js/.test(url))).toBeTruthy();
  expect(cached.some(url => url.includes('script.google.com'))).toBeFalsy();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});

test('a new production service worker waits for explicit update before taking control', async ({ page }) => {
  await page.route('https://script.google.com/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: { enabled: false } }) }));
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBeTruthy();
  const file = resolve('dist/sw.js');
  const original = await readFile(file, 'utf8');
  try {
    await writeFile(file, `${original}\n// PWA update verification ${Date.now()}\n`);
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    await expect(page.getByText('A new version is ready', { exact: true })).toBeVisible({ timeout: 20000 });
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)).toBeTruthy();
    await page.getByRole('button', { name: 'Reload now', exact: true }).click();
    await expect.poll(() => page.evaluate(async () => !(await navigator.serviceWorker.getRegistration())?.waiting)).toBeTruthy();
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  } finally { await writeFile(file, original); }
});

test('iPhone install guidance is available without a Chromium install event', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' });
  try {
    const page = await context.newPage();
    await page.route('https://script.google.com/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: { enabled: false } }) }));
    await page.goto(baseURL!);
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
    await expect(page.getByText(/In Safari, tap Share, then Add to Home Screen/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  } finally { await context.close(); }
});
