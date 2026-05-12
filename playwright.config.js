import { defineConfig } from '@playwright/test';
import path from 'node:path';

const extensionPath = path.resolve('.');

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    trace: 'retain-on-failure',
  },
  metadata: { extensionPath },
});
