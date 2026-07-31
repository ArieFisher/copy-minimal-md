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

/* --------------------------------------------------- the payload's own CSS */

/** A Sheets copy, trimmed to the cells that carry formatting. Every style
 *  attribute below is verbatim from a real cmd+C out of Google Sheets — which
 *  is where all of the formatting lives: there is not one tag in here that says
 *  "yellow" or "italic". */
const SHEETS_HTML = [
  '<GOOGLE-sheets-html-origin style="color: rgb(0, 0, 0); font-size: medium;">',
  '<TABLE cellspacing="0" cellpadding="0" dir="ltr" border="1" data-sheets-root="1"',
  ' style="table-layout: fixed; font-size: 10pt; font-family: Arial; border-collapse: collapse;">',
  '<COLGROUP><COL width="131"><COL width="124"></COLGROUP><TBODY>',
  '<TR style="height: 21px;">',
  '<TD style="border: 1px solid rgb(204, 204, 204); padding: 2px 3px; background-color: rgb(255, 255, 0);">yellow highlight</TD>',
  '<TD style="border: 1px solid rgb(204, 204, 204); padding: 2px 3px; font-style: italic;">italics</TD>',
  '</TR><TR style="height: 21px;">',
  '<TD style="border: 1px solid rgb(204, 204, 204); padding: 2px 3px; font-family: &quot;Bree Serif&quot;;">funny font</TD>',
  '<TD style="border: 1px solid rgb(204, 204, 204); padding: 2px 3px; color: rgb(0, 0, 255);">blue</TD>',
  '</TR><TR style="height: 21px;">',
  '<TD style="border: 1px solid rgb(204, 204, 204); padding: 2px 3px; font-size: 16pt;">Larger</TD>',
  '<TD style="border: 1px solid rgb(204, 204, 204); padding: 2px 3px;"></TD>',
  '</TR></TBODY></TABLE></GOOGLE-sheets-html-origin>',
].join('');

const SHEETS_PLAIN = 'yellow highlight\titalics\nfunny font\tblue\nLarger\t';

/** Computed style of the cell whose text is `text`, inside `card`. */
function cellStyle(page, card, text, property) {
  return page.locator(`${card} .card-render td`, { hasText: text }).first()
    .evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);
}

test('the text/html card renders the formatting the payload actually carries', async ({ context, server, extensionId }) => {
  const page = await inspectClipboard({ context, server, extensionId }, {
    plain: SHEETS_PLAIN,
    html: SHEETS_HTML,
  });

  // The left card is the clipboard, so it looks like the clipboard.
  expect(await cellStyle(page, '.card--html', 'yellow highlight', 'background-color')).toBe('rgb(255, 255, 0)');
  expect(await cellStyle(page, '.card--html', 'italics', 'font-style')).toBe('italic');
  expect(await cellStyle(page, '.card--html', 'blue', 'color')).toBe('rgb(0, 0, 255)');
  expect(await cellStyle(page, '.card--html', 'funny font', 'font-family')).toContain('Bree Serif');

  const larger = await cellStyle(page, '.card--html', 'Larger', 'font-size');
  const normal = await cellStyle(page, '.card--html', 'blue', 'font-size');
  expect(parseFloat(larger)).toBeGreaterThan(parseFloat(normal));
});

test('the Simple HTML card is set in the inspector\'s own typography', async ({ context, server, extensionId }) => {
  const page = await inspectClipboard({ context, server, extensionId }, {
    plain: SHEETS_PLAIN,
    html: SHEETS_HTML,
  });

  // Nothing in this card came off the clipboard — it is what the tool derived —
  // so none of the payload's formatting reaches it. This is the contrast the
  // two columns are for: 2 KB of markup on the left, and what is left when it
  // goes on the right.
  expect(await cellStyle(page, '.card--simple-html', 'yellow highlight', 'background-color')).not.toBe('rgb(255, 255, 0)');
  expect(await cellStyle(page, '.card--simple-html', 'italics', 'font-style')).toBe('normal');
  expect(await cellStyle(page, '.card--simple-html', 'blue', 'color')).not.toBe('rgb(0, 0, 255)');
});

test('a payload cannot make the inspector fetch anything', async ({ context, server, extensionId }) => {
  const beacon = `${server.baseUrl}/beacon.png`;
  const page = await inspectClipboard({ context, server, extensionId }, {
    plain: 'tracked',
    html: `<p style="background-image: url(${beacon}); background-color: rgb(255, 0, 0);">tracked</p>`
        + `<p style="background: url(${beacon}) rgb(0, 255, 0);">shorthand</p>`,
  });

  await expect(page.locator('.card--html .card-render')).toBeVisible();
  // A request that 404s is still a request. Give one time to arrive.
  await page.waitForTimeout(500);

  // The seed page went through the same server, so an empty log would prove
  // nothing — this is what says the log works.
  expect(server.requests).toContain('/seed.html');
  expect(server.requests).not.toContain('/beacon.png');

  // The colour beside the fetch in the same declaration survives, and so does
  // the one folded into the same shorthand.
  const paras = page.locator('.card--html .card-render p');
  expect(await paras.nth(0).evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
  expect(await paras.nth(0).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 0, 0)');
  expect(await paras.nth(1).evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
  expect(await paras.nth(1).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(0, 255, 0)');
});

test('a payload cannot restyle the inspector around it', async ({ context, server, extensionId }) => {
  const page = await inspectClipboard({ context, server, extensionId }, {
    plain: 'hostile',
    html: '<style>.card, .replace-btn, .app-bar { display: none !important; }</style>'
        + '<p class="card-head" id="output-container" style="position: fixed; top: 0; left: 0;">hostile</p>',
  });

  // The <style> block never reached the document, so the chrome it named is
  // still there.
  await expect(page.locator('.app-bar')).toBeVisible();
  await expect(page.locator('.card--html')).toBeVisible();
  await expect(page.locator('.replace-btn').first()).toBeVisible();

  const para = page.locator('.card--html .card-render p');
  // The class and id are gone, so the payload cannot borrow the inspector's own
  // rules or answer to a getElementById the inspector makes.
  expect(await para.evaluate((el) => el.className)).toBe('');
  expect(await para.evaluate((el) => el.id)).toBe('');
  // And it did not get to lift itself out of the card.
  expect(await para.evaluate((el) => getComputedStyle(el).position)).not.toBe('fixed');

  const inside = await para.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const card = el.closest('.card').getBoundingClientRect();
    return box.top >= card.top - 1 && box.bottom <= card.bottom + 1;
  });
  expect(inside).toBe(true);
});
