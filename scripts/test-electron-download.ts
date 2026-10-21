import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { _electron as electron } from 'playwright';

// A real Electron download verifies the native Save As configuration and exact bytes.
const directory = resolve('out/electron-qa');
await mkdir(directory, { recursive: true });
const source = await readFile(resolve('out/workflow-qa/handoff.pdf'));
const destination = join(directory, 'workflow-handoff.pdf');
const environment: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
environment.ELECTRON_START_URL = 'http://127.0.0.1:43999';
delete environment.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({ args: [resolve('dist-electron/main.cjs'), `--user-data-dir=${join(directory, 'profile')}`],
  env: environment, timeout: 30000 });
try {
  const page = await application.firstWindow();
  await application.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.hide(); });
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  await application.evaluate(({ session }, filename) => {
    const state = globalThis as typeof globalThis & { qaDownload?: { state?: string; title?: string; defaultPath?: string } };
    session.defaultSession.once('will-download', (_event, item) => {
      state.qaDownload = item.getSaveDialogOptions();
      item.setSavePath(filename);
      item.once('done', (_event, result) => { state.qaDownload!.state = result; });
    });
  }, destination);
  await page.evaluate(bytes => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'workflow-handoff.pdf';
    anchor.textContent = 'Save workflow PDF'; anchor.id = 'qa-save-file'; document.body.appendChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [...source]);
  await page.locator('#qa-save-file').click();
  let result: { state?: string; title?: string; defaultPath?: string } | undefined;
  for (let attempts = 0; attempts < 50; attempts++) {
    result = await application.evaluate(() => (globalThis as typeof globalThis & { qaDownload?: { state?: string; title?: string; defaultPath?: string } }).qaDownload);
    if (result?.state) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(result?.state, 'completed', JSON.stringify(result));
  assert.equal(result?.title, 'Save generated document');
  assert.match(result?.defaultPath || '', /workflow-handoff\.pdf$/);
  assert.deepEqual(await readFile(destination), source);
  console.log('Electron: workflow PDF reaches the native Save As configuration and saves byte-identical output.');
} finally { await application.close(); }
