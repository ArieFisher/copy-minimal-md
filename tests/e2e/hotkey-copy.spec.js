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
const INJECT_FILES = [
  'lib/purify.min.js',
  'lib/turndown.js',
  'lib/turndown-plugin-gfm.js',
  'lib/marked.min.js',
  'tsv-detector.js',
  'grid-detector.js',
  'equivalents.js',
  'pipeline.js',
  'content.js',
];

/**
 * Serve `html`, select the node with id `selectId`, run the cleaner over it, and
 * hand back everything the clipboard ended up holding.
 */
async function runCleaner({ context, server, serviceWorker }, { path, html, selectId }) {
  server.servePage(path, html);

  const page = await context.newPage();
  await page.goto(`${server.baseUrl}${path}`);
  await page.bringToFront();

  await page.evaluate((id) => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById(id));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }, selectId);

  const tabId = await serviceWorker.evaluate(async (targetUrl) => {
    const tabs = await chrome.tabs.query({});
    const t = tabs.find((tab) => tab.url && tab.url.startsWith(targetUrl));
    return t ? t.id : null;
  }, `${server.baseUrl}${path}`);
  expect(tabId).not.toBeNull();

  await serviceWorker.evaluate(async ({ id, files }) => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files });
  }, { id: tabId, files: INJECT_FILES });

  // content.js does an execCommand('copy') then clipboard read with retries (up to ~1s).
  await page.waitForTimeout(1500);

  return page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const read = async (type) => (item.types.includes(type)
      ? (await (await item.getType(type)).text())
      : null);
    return { types: item.types, plain: await read('text/plain'), html: await read('text/html') };
  });
}

test('writes a Markdown table for an ARIA grid selection, and the table as text/html', async ({ context, server, serviceWorker }) => {
  const clip = await runCleaner({ context, server, serviceWorker }, {
    path: '/grid.html',
    selectId: 'g',
    html: `
      <!doctype html><html><body>
        <div role="grid" id="g">
          <div role="row"><span role="columnheader">A</span><span role="columnheader">B</span></div>
          <div role="row"><span role="gridcell">1</span><span role="gridcell">2</span></div>
        </div>
      </body></html>
    `,
  });

  expect(clip.plain).toContain('| A | B |');
  expect(clip.plain).toContain('| 1 | 2 |');

  // The grid path has no clipboard HTML of its own — this entry is synthesized.
  expect(clip.types).toContain('text/html');
  expect(clip.html).toContain('<table>');
  expect(clip.html).toContain('<th>A</th>');
  expect(clip.html).toContain('<td>2</td>');
});

test('writes both entries for a native table selection', async ({ context, server, serviceWorker }) => {
  const clip = await runCleaner({ context, server, serviceWorker }, {
    path: '/table.html',
    selectId: 't',
    html: `
      <!doctype html><html><body>
        <table id="t">
          <thead><tr><th>Name</th><th>Age</th></tr></thead>
          <tbody><tr><td>Alice</td><td>30</td></tr></tbody>
        </table>
      </body></html>
    `,
  });

  expect(clip.plain).toContain('| Name | Age |');
  expect(clip.plain).toContain('| Alice | 30 |');

  expect(clip.html).toContain('<th>Name</th>');
  expect(clip.html).toContain('<td>Alice</td>');
  // The Simple HTML is the point: no inline styles or vendor attributes.
  expect(clip.html).not.toContain('style=');
});

test('leaves text/html alone for a copy with no table', async ({ context, server, serviceWorker }) => {
  const clip = await runCleaner({ context, server, serviceWorker }, {
    path: '/prose.html',
    selectId: 'p',
    html: `
      <!doctype html><html><body>
        <div id="p"><h1>Title</h1><p>Some <b>bold</b> prose.</p></div>
      </body></html>
    `,
  });

  expect(clip.plain).toContain('# Title');
  expect(clip.plain).toContain('**bold**');
  // text/plain alone — writing HTML here would change what every ordinary paste
  // produces, so the hotkey reserves it for tables.
  expect(clip.types).toEqual(['text/plain']);
});
