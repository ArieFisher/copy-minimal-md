/**
 * Playwright test fixture that loads the extension into a persistent context.
 *
 * Extensions require headed mode; CI must wrap Playwright in `xvfb-run`.
 */
const { test: base, chromium } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const EXTENSION_PATH = path.resolve(__dirname, '..', '..');

exports.test = base.extend({
  context: async ({}, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmm-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
      ],
    });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await use(context);
    await context.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  },
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const id = sw.url().split('/')[2];
    await use(id);
  },
});

exports.expect = base.expect;
