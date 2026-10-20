import { defineConfig } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_WORKFLOW_PORT || 3118);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PLAYWRIGHT_WORKFLOW_PORT must be a valid port number.');
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: '.', testMatch: 'test-workflow-ui.spec.ts', workers: 1, timeout: 40000,
  expect: { timeout: 10000 },
  use: { baseURL, viewport: { width: 1440, height: 1100 }, trace: 'retain-on-failure' },
  webServer: { command: `npm run dev -- --port=${port} --strictPort`, cwd: '..', url: baseURL, reuseExistingServer: false,
    env: { VITE_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/WORKFLOW_TEST/exec', VITE_DEV_SHARED_SECRET: '', VITE_DEEPSEEK_API_KEY: 'workflow-test-key' } },
});
