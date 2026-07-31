const { test, expect } = require('./fixtures.js');

/** Exactly what cmd+shift+U leaves on the clipboard for a table copy — captured
 *  from a real run, so it carries the clipboard sanitizer's own normalisation
 *  (the <thead> we write comes back as a <tbody>). */
const HOTKEY_PLAIN = '| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |';
const HOTKEY_HTML = '<table><tbody><tr><th>Name</th><th>Age</th></tr><tr><td>Alice</td><td>30</td></tr><tr><td>Bob</td><td>25</td></tr></tbody></table>';

/** A 1×1 transparent PNG, for seeding a copy that carries no text at all. */
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Put the given entries on the real clipboard from a real page, then open the inspector. */
async function inspectClipboard({ context, server, extensionId }, { plain, html, png }) {
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
  await expect(page.locator('.card--markdown')).toHaveClass(/is-inert/);
  await expect(page.locator('.card--simple-html')).toHaveClass(/is-inert/);
  for (const btn of await page.locator('.replace-btn').all()) {
    await expect(btn).toBeDisabled();
  }
  await expect(page.locator('.replace-both-btn')).toBeDisabled();

  // Switched off in plain sight, with the reason next to the control.
  await expect(page.locator('.replace-hint').first()).toHaveText(/text\/plain already matches/);
  await expect(page.locator('.card--markdown .card-flag')).toHaveText(/already in text\/plain/);
  await expect(page.locator('.card--simple-html .card-flag')).toHaveText(/already in text\/html/);

  // Head only. Repeating the payload inside a switched-off pane says nothing the
  // card to the left is not already saying.
  await expect(page.locator('.card--markdown .card-source, .card--markdown .card-render')).toHaveCount(0);
  await expect(page.locator('.card--simple-html .card-source, .card--simple-html .card-render')).toHaveCount(0);
});

test('sees through the <tbody> the clipboard restores on a headerless table', async ({ context, server, extensionId }) => {
  // A headerless copy is the case where written and read-back markup genuinely
  // differ: simplifyTables drops the <tbody>, the clipboard sanitizer puts it
  // back. Both strings below came off a real run.
  const page = await inspectClipboard({ context, server, extensionId }, {
    plain: '| header 1 | header 2 |\n| --- | --- |\n| text 1 | 12 |\n| text 2 | 34 |',
    html: '<table><tbody><tr><td>header 1</td><td>header 2</td></tr><tr><td>text 1</td><td>12</td></tr><tr><td>text 2</td><td>34</td></tr></tbody></table>',
  });

  await expect(page.locator('.card--markdown')).toHaveClass(/is-inert/);
  await expect(page.locator('.card--simple-html')).toHaveClass(/is-inert/);
  await expect(page.locator('.replace-both-btn')).toBeDisabled();
  for (const btn of await page.locator('.replace-btn').all()) {
    await expect(btn).toBeDisabled();
  }
});

test('a copy with no text at all leaves both clipboard cards inert', async ({ context, server, extensionId }) => {
  const page = await inspectClipboard({ context, server, extensionId }, { png: PNG_1PX });

  await expect(page.locator('.col-heading-sub').first()).toHaveText(/No text entries on the clipboard/);

  // Neither entry is present and nothing is waiting to fill either, so both read
  // the same way — an empty frame, with no line inside explaining itself.
  await expect(page.locator('.card--plain')).toHaveClass(/is-inert/);
  await expect(page.locator('.card--html')).toHaveClass(/is-inert/);
  await expect(page.locator('.card--plain .card-empty, .card--html .card-empty')).toHaveCount(0);
  // The heading says which entries the copy carried; the heads do not repeat it.
  // (Scoped to the two text cards — the image below still reports its size.)
  await expect(page.locator('.card--plain .card-meta, .card--html .card-meta')).toHaveCount(0);

  // The image itself still shows up below.
  await expect(page.locator('.extras')).toContainText('image/png');
});

test('names the missing entry while an equivalent is waiting to fill it', async ({ context, server, extensionId }) => {
  // HTML only: text/plain is absent, but the Markdown can be added to it, so the
  // card says what is missing next to the offer instead of going inert.
  const page = await inspectClipboard({ context, server, extensionId }, {
    html: '<h1 style="color:red">Heading</h1><p>some <b>text</b></p>',
  });

  await expect(page.locator('.card--plain')).not.toHaveClass(/is-inert/);
  await expect(page.locator('.card--plain .card-empty')).toHaveText(/did not include a text\/plain entry/);
  await expect(page.locator('.replace-btn').first()).toBeEnabled();
  await expect(page.locator('.replace-hint').first()).toHaveText(/Markdown into text\/plain/);
});

test('keeps the actions live when the equivalents would change something', async ({ context, server, extensionId }) => {
  const page = await inspectClipboard({ context, server, extensionId }, {
    plain: 'Heading\nsome text',
    html: '<h1 style="color:red">Heading</h1><p>some <b>text</b></p>',
  });

  await expect(page.locator('.card--markdown')).not.toHaveClass(/is-inert/);
  await expect(page.locator('.replace-btn').first()).toBeEnabled();
  await expect(page.locator('.replace-hint').first()).toHaveText(/Markdown into text\/plain/);
  // …and it still shows what it is offering.
  await expect(page.locator('.card--markdown .card-render')).toHaveCount(1);
});
