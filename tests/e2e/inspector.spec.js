const { test, expect } = require('./fixtures.js');

/** Exactly what cmd+shift+U leaves on the clipboard for a table copy — captured
 *  from a real run, so it carries the clipboard sanitizer's own normalisation
 *  (the <thead> we write comes back as a <tbody>). */
const HOTKEY_PLAIN = '| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |';
const HOTKEY_HTML = '<table><tbody><tr><th>Name</th><th>Age</th></tr><tr><td>Alice</td><td>30</td></tr><tr><td>Bob</td><td>25</td></tr></tbody></table>';

/** Put both entries on the real clipboard from a real page, then open the inspector. */
async function inspectClipboard({ context, server, extensionId }, { plain, html }) {
  server.servePage('/seed.html', '<!doctype html><html><body>seed</body></html>');
  const seeder = await context.newPage();
  await seeder.goto(`${server.baseUrl}/seed.html`);
  await seeder.bringToFront();
  await seeder.evaluate(async ([p, h]) => {
    const payload = { 'text/plain': new Blob([p], { type: 'text/plain' }) };
    if (h) payload['text/html'] = new Blob([h], { type: 'text/html' });
    await navigator.clipboard.write([new ClipboardItem(payload)]);
  }, [plain, html]);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/inspector.html`);
  await page.bringToFront();
  await expect(page.locator('#loading')).toBeHidden();
  return page;
}

test('inspector page opens and renders the clipboard cards', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/inspector.html`);

  await expect(page.locator('body')).toContainText(/Clipboard|Inspector|Markdown/i);
  expect((await page.title()).length).toBeGreaterThan(0);
});

test('switches off the actions a hotkey copy has already satisfied', async ({ context, server, extensionId }) => {
  const page = await inspectClipboard({ context, server, extensionId }, {
    plain: HOTKEY_PLAIN,
    html: HOTKEY_HTML,
  });

  // Both equivalents already sit on the clipboard, so every write is a no-op.
  await expect(page.locator('.card--markdown')).toHaveClass(/is-spent/);
  await expect(page.locator('.card--simple-html')).toHaveClass(/is-spent/);
  for (const btn of await page.locator('.replace-btn').all()) {
    await expect(btn).toBeDisabled();
  }
  await expect(page.locator('.replace-both-btn')).toBeDisabled();

  // Switched off in plain sight, with the reason next to the control.
  await expect(page.locator('.replace-hint').first()).toHaveText(/text\/plain already matches/);
  await expect(page.locator('.card--markdown .card-flag')).toHaveText(/already in text\/plain/);
  await expect(page.locator('.card--simple-html .card-flag')).toHaveText(/already in text\/html/);
});

test('sees through the <tbody> the clipboard restores on a headerless table', async ({ context, server, extensionId }) => {
  // A headerless copy is the case where written and read-back markup genuinely
  // differ: simplifyTables drops the <tbody>, the clipboard sanitizer puts it
  // back. Both strings below came off a real run.
  const page = await inspectClipboard({ context, server, extensionId }, {
    plain: '| header 1 | header 2 |\n| --- | --- |\n| text 1 | 12 |\n| text 2 | 34 |',
    html: '<table><tbody><tr><td>header 1</td><td>header 2</td></tr><tr><td>text 1</td><td>12</td></tr><tr><td>text 2</td><td>34</td></tr></tbody></table>',
  });

  await expect(page.locator('.card--markdown')).toHaveClass(/is-spent/);
  await expect(page.locator('.card--simple-html')).toHaveClass(/is-spent/);
  await expect(page.locator('.replace-both-btn')).toBeDisabled();
  for (const btn of await page.locator('.replace-btn').all()) {
    await expect(btn).toBeDisabled();
  }
});

test('keeps the actions live when the equivalents would change something', async ({ context, server, extensionId }) => {
  const page = await inspectClipboard({ context, server, extensionId }, {
    plain: 'Heading\nsome text',
    html: '<h1 style="color:red">Heading</h1><p>some <b>text</b></p>',
  });

  await expect(page.locator('.card--markdown')).not.toHaveClass(/is-spent/);
  await expect(page.locator('.replace-btn').first()).toBeEnabled();
  await expect(page.locator('.replace-hint').first()).toHaveText(/Markdown into text\/plain/);
});
