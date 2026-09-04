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
 *
 * Set PW_CHROMIUM_PATH to run against a Chromium that Playwright did not install
 * itself — a sandbox with a preloaded browser, say, or a build whose version does
 * not match the pinned @playwright/test. Unset (the CI case) uses whichever
 * browser `npx playwright install` put down.
 */
const { test: base, chromium } = require('@playwright/test');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const EXTENSION_PATH = path.resolve(__dirname, '..', '..');

function startServer() {
  const pages = new Map();
  // Every path asked for, served or not. A test that puts a URL in a clipboard
  // payload and expects nothing to load asserts against this: a request that
  // 404s still got made, and getting made is the thing being tested.
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
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
        requests,
        close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); },
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
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
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

/**
 * Put the given entries on the real clipboard from a real page, then open the
 * inspector on them.
 *
 * The seeding has to happen in an http:// page: an extension page cannot write
 * a clipboard it has not been granted, and chrome.scripting refuses data: and
 * about:blank. Returns the inspector page, once it has finished reading.
 */
exports.inspectClipboard = async function inspectClipboard({ context, server, extensionId }, { plain, html, png }) {
  server.servePage('/seed.html', '<!doctype html><html><body>seed</body></html>');
  const seeder = await context.newPage();
  await seeder.goto(`${server.baseUrl}/seed.html`);
  await seeder.bringToFront();
  await seeder.evaluate(async ([p, h, image]) => {
    const payload = {};
    if (p) payload['text/plain'] = new Blob([p], { type: 'text/plain' });
    if (h) payload['text/html'] = new Blob([h], { type: 'text/html' });
    if (image) {
      const bytes = Uint8Array.from(atob(image), (c) => c.charCodeAt(0));
      payload['image/png'] = new Blob([bytes], { type: 'image/png' });
    }
    await navigator.clipboard.write([new ClipboardItem(payload)]);
  }, [plain, html, png]);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/inspector.html`);
  await page.bringToFront();
  await base.expect(page.locator('#loading')).toBeHidden();
  return page;
};
