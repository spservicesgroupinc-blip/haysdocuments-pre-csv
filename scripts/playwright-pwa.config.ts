import { defineConfig } from '@playwright/test';

const port = 3128;
export default defineConfig({
  testDir: '.', testMatch: 'test-pwa-ui.spec.ts', workers: 1, timeout: 45000,
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 390, height: 844 }, trace: 'retain-on-failure' },
  webServer: { command: `npm run preview -- --host=127.0.0.1 --port=${port} --strictPort`, cwd: '..',
    url: `http://127.0.0.1:${port}`, reuseExistingServer: false },
  outputDir: '../test-results/pwa',
});
