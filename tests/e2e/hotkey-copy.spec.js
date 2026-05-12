const { test, expect } = require('./fixtures.js');

/**
 * Drives the content.js pipeline the same way background.js does on
 * `run-markdown-clean`: chrome.scripting.executeScript with the manifest's
 * script order. Playwright can't fire the global keyboard shortcut because
 * Chrome ignores synthetic input for chrome.commands.
 *
 * The page is served from a real http://127.0.0.1 origin so the injection
 * matches host_permissions (data:/about:blank URLs are rejected).
 */
test('content.js pipeline writes a Markdown table for an ARIA grid selection', async ({ context, server, serviceWorker }) => {
  server.servePage('/grid.html', `
    <!doctype html><html><body>
      <div role="grid" id="g">
        <div role="row"><span role="columnheader">A</span><span role="columnheader">B</span></div>
        <div role="row"><span role="gridcell">1</span><span role="gridcell">2</span></div>
      </div>
    </body></html>
  `);

  const page = await context.newPage();
  await page.goto(`${server.baseUrl}/grid.html`);
  await page.bringToFront();

  await page.evaluate(() => {
    const grid = document.getElementById('g');
    const range = document.createRange();
    range.selectNodeContents(grid);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });

  const tabId = await serviceWorker.evaluate(async (targetUrl) => {
    const tabs = await chrome.tabs.query({});
    const t = tabs.find((tab) => tab.url && tab.url.startsWith(targetUrl));
    return t ? t.id : null;
  }, `${server.baseUrl}/grid.html`);
  expect(tabId).not.toBeNull();

  await serviceWorker.evaluate(async (id) => {
    await chrome.scripting.executeScript({
      target: { tabId: id },
      files: ['lib/purify.min.js', 'lib/turndown.js', 'lib/turndown-plugin-gfm.js', 'lib/marked.min.js', 'tsv-detector.js', 'grid-detector.js', 'content.js'],
    });
  }, tabId);

  // content.js does an execCommand('copy') then clipboard read with retries (up to ~1s).
  await page.waitForTimeout(1500);

  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('| A | B |');
  expect(text).toContain('| 1 | 2 |');
});
