/**
 * Playwright test fixtures for extension E2E.
 *
 * - Loads the unpacked extension in a persistent context (extensions require headed mode).
 * - Spins up a tiny localhost HTTP server so pages have a real http:// origin that matches
 *   the extension's host_permissions. chrome.scripting.executeScript refuses to inject into
 *   data:/about:blank URLs.
 * - Waits for the service worker so context.serviceWorkers() is never empty.
 *
 * CI must wrap Playwright in `xvfb-run` (Linux headed Chromium).
 */
const { test: base, chromium } = require('@playwright/test');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const EXTENSION_PATH = path.resolve(__dirname, '..', '..');

function startServer() {
  const pages = new Map();
  const server = http.createServer((req, res) => {
    const html = pages.get(req.url);
    if (html === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        servePage: (pathname, html) => pages.set(pathname, html),
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

exports.test = base.extend({
  server: async ({}, use) => {
    const s = await startServer();
    await use(s);
    await s.close();
  },
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
  serviceWorker: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw);
  },
  extensionId: async ({ serviceWorker }, use) => {
    const id = new URL(serviceWorker.url()).host;
    await use(id);
  },
});

exports.expect = base.expect;
