const { test, expect } = require('./fixtures.js');

/**
 * Verifies the full content.js pipeline by triggering it the same way
 * background.js does: chrome.scripting.executeScript with the manifest's
 * script order. We can't fire the global keyboard shortcut from Playwright
 * (Chrome ignores synthetic input for chrome.commands), so we drive the
 * service worker directly.
 */
test('content.js pipeline writes a Markdown table for an ARIA grid selection', async ({ context }) => {
  const page = await context.newPage();
  await page.setContent(`
    <html><body>
      <div role="grid" id="g">
        <div role="row"><span role="columnheader">A</span><span role="columnheader">B</span></div>
        <div role="row"><span role="gridcell">1</span><span role="gridcell">2</span></div>
      </div>
    </body></html>
  `);

  await page.bringToFront();
  await page.evaluate(() => {
    const grid = document.getElementById('g');
    const range = document.createRange();
    range.selectNodeContents(grid);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });

  const [sw] = context.serviceWorkers();
  const tabId = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab.id;
  });

  await sw.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['lib/purify.min.js', 'lib/turndown.js', 'lib/turndown-plugin-gfm.js', 'lib/marked.min.js', 'tsv-detector.js', 'grid-detector.js', 'content.js'],
    });
  }, tabId);

  await page.waitForTimeout(1000);

  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('| A | B |');
  expect(text).toContain('| 1 | 2 |');
});
