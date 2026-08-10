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

/* ------------------------------------------------------------ pane geometry */

/**
 * Distance from each card's bottom edge to the bottom of the pane inside it,
 * keyed by card. A card with no pane is skipped — an inert card is a head and
 * an empty frame, and there is nothing in it to fill.
 */
function paneGaps(page) {
  return page.evaluate(() => {
    const gaps = {};
    for (const card of document.querySelectorAll('.card')) {
      const pane = card.querySelector('.card-render, .card-source');
      if (!pane) continue;
      const name = [...card.classList].find(
        (c) => c.startsWith('card--') && c !== 'card--clipboard' && c !== 'card--derived'
      );
      gaps[name] = Math.round(card.getBoundingClientRect().bottom - pane.getBoundingClientRect().bottom);
    }
    return gaps;
  });
}

test('every pane fills the card it sits in, in both views', async ({ context, server, extensionId }) => {
  // A row is as tall as its taller card, so the shorter card's pane has to grow
  // into space its own content never asked for. Two separate things have to
  // hold for that, and they fail in different ways, so they are checked apart.
  //
  // The fixture keeps the derived side well under its cap: the left card
  // renders the 40pt the payload asks for, the right strips it and renders
  // small. Below the cap, flex-grow is the only thing that can fill the card —
  // at the cap the cap does it, and a missing `flex: 1` would go unnoticed.
  const page = await inspectClipboard({ context, server, extensionId }, {
    plain: 'alpha\tbeta\ngamma\tdelta',
    html: '<table><tbody>'
        + '<tr><td style="font-size: 40pt">alpha</td><td style="font-size: 40pt">beta</td></tr>'
        + '<tr><td style="font-size: 40pt">gamma</td><td style="font-size: 40pt">delta</td></tr>'
        + '</tbody></table>',
  });

  // (1) Paired cards cap at the same height — the invariant the CSS comment
  // names. Exact, and independent of what is on the clipboard. Split the cap
  // and the shorter side strands tens of pixels.
  const caps = await page.evaluate(() => {
    const capOf = (sel) => getComputedStyle(document.querySelector(sel)).maxHeight;
    return {
      htmlRow: [capOf('.card--html .card-render'), capOf('.card--simple-html .card-render')],
      plainRow: [capOf('.card--plain .card-source'), capOf('.card--markdown .card-render')],
    };
  });
  expect(caps.htmlRow[0]).toBe(caps.htmlRow[1]);
  expect(caps.plainRow[0]).toBe(caps.plainRow[1]);

  // (2) Every pane reaches the bottom of its card. The row has to be uneven for
  // this to prove anything, so check that first.
  const content = await page.evaluate(() => ({
    html: document.querySelector('.card--html .card-render').scrollHeight,
    simple: document.querySelector('.card--simple-html .card-render').scrollHeight,
    simpleCap: parseFloat(getComputedStyle(document.querySelector('.card--simple-html .card-render')).maxHeight),
  }));
  expect(content.html).toBeGreaterThan(content.simple);
  expect(content.simple).toBeLessThan(content.simpleCap);

  // 1px of the gap is the card's own border. Soft, so a broken row names every
  // card it stranded rather than stopping at the first.
  for (const [card, gap] of Object.entries(await paneGaps(page))) {
    expect.soft(gap, `${card}, rendered view`).toBeLessThanOrEqual(2);
  }

  // The source view swaps every pane for a <pre> that has to fill the same way.
  await page.locator('#view-toggle .segment[data-view="source"]').click();
  await expect(page.locator('.card--html .card-source')).toBeVisible();
  for (const [card, gap] of Object.entries(await paneGaps(page))) {
    expect.soft(gap, `${card}, source view`).toBeLessThanOrEqual(2);
  }
});

/* ------------------------------------------------------------ preview zoom */

/**
 * A table `rows` deep, as both entries a spreadsheet copy would leave.
 *
 * The cells carry the styling a spreadsheet writes, and that is not decoration
 * here: strip it and the derived Simple HTML is the payload back again, the
 * card goes inert, and the row loses the pane these tests are about.
 */
function tableCopy(rows) {
  const cells = Array.from({ length: rows }, (_, i) => [`Region ${i + 1}`, `${(i + 1) * 1000}`]);
  const td = (text) => `<td style="border: 1px solid rgb(204, 204, 204); padding: 2px 3px;">${text}</td>`;
  return {
    plain: cells.map((row) => row.join('\t')).join('\n'),
    html: '<table style="font-size: 10pt; font-family: Arial; border-collapse: collapse;"><tbody>'
      + cells.map(([name, n]) => `<tr style="height: 21px;">${td(name)}${td(n)}</tr>`).join('')
      + '</tbody></table>',
  };
}

/** Overruns every pane's cap at the ceiling, and fits inside them well above
 *  the floor — so Fit is doing the arithmetic and not resting on either end of
 *  its band. */
const TALL_COPY = tableCopy(10);

/** Past what the floor can rescue. It holds, and the pane scrolls, the way it
 *  did before there was a zoom at all. */
const ENDLESS_COPY = tableCopy(40);

/** The scale the panes are actually drawing at. */
function previewZoom(page) {
  return page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--preview-zoom')));
}

/** Every pane still holding content past its cap, named by the card it sits in. */
function panesStillScrolling(page) {
  return page.evaluate(() => [...document.querySelectorAll('.zoom-layer')]
    .filter((layer) => layer.parentElement.scrollHeight - layer.parentElement.clientHeight > 1)
    .map((layer) => layer.closest('.card').className));
}

async function pickZoom(page, value) {
  await page.locator('#zoom-trigger').click();
  await page.locator(`.zoom-option[data-zoom="${value}"]`).click();
}

/**
 * Put the page into Fit, reaching past the interface to do it.
 *
 * The Fit row is out of the menu, so nothing a user can click arrives here any
 * more. The code behind it is kept on purpose, against the row coming back, and
 * code kept for later is code nothing exercises unless a test goes and calls it.
 * That is what these are for: they are not a claim that anyone can get here, and
 * they will start failing the moment the retained branches stop working.
 *
 * inspector.js is a classic script, so its function declarations are on the
 * global object.
 */
async function forceFit(page) {
  await page.evaluate(() => setZoom('fit'));
}

/**
 * The size of things that are not the payload, and of one thing that is.
 *
 * The payload is measured by height. A table cell's width is bounded by the
 * pane it sits in, and zooming out hands the layer more room in layout pixels
 * than it hands back in scale — so a full-width table can come out the same
 * width at 25% as at 150%. Its rows cannot.
 */
function boxes(page) {
  return page.evaluate(() => {
    const box = (sel) => {
      const rect = document.querySelector(sel).getBoundingClientRect();
      return `${Math.round(rect.width)}x${Math.round(rect.height)}`;
    };
    return {
      mime: box('.card--plain .card-name-mime'),
      replace: box('.replace-btn'),
      title: box('.app-bar-title h1'),
      toggle: box('#view-toggle'),
      rowHeight: document.querySelector('.card--simple-html .card-render td')
        .getBoundingClientRect().height,
    };
  });
}

test('the menu offers levels only, with no Fit row among them', async ({ context, server, extensionId }) => {
  const page = await inspectClipboard({ context, server, extensionId }, { ...TALL_COPY });

  await page.locator('#zoom-trigger').click();
  await expect(page.locator('#zoom-opt-fit')).toHaveCount(0);
  await expect(page.locator('.zoom-option')).toHaveText(['25%', '50%', '75%', '90%', '100%', '125%', '150%']);

  // Whatever the page opened on is one of them, named the same way. Fit as a
  // mode is gone from the interface; the arithmetic behind it is not, and the
  // tests below are what still hold it.
  await expect(page.locator('#zoom-value')).toHaveText(/^\d+%$/);
});

test('opens on a step from the menu, not on a figure of its own', async ({ context, server, extensionId }) => {
  const page = await inspectClipboard({ context, server, extensionId }, {
    ...TALL_COPY,
  });

  // This payload needs shrinking, and needs it by an amount that falls between
  // the two ends of the band — so the level it opens on is one Fit worked out
  // and then rounded, not one end standing in for an answer.
  const opened = await previewZoom(page);
  expect([0.5, 0.75]).toContain(opened);
  await expect(page.locator('#zoom-value')).toHaveText(`${opened * 100}%`);
  await expect(page.locator(`.zoom-option[data-zoom="${opened}"]`)).toHaveAttribute('aria-selected', 'true');
  expect(await panesStillScrolling(page)).toEqual([]);

  // …and the payload is one that would not have fitted on its own, which is
  // what makes the line above mean anything.
  await pickZoom(page, '1');
  expect((await panesStillScrolling(page)).length).toBeGreaterThan(0);
});

test('opens at 50% for a copy that cannot be fitted above the floor', async ({ context, server, extensionId }) => {
  const page = await inspectClipboard({ context, server, extensionId }, { ...ENDLESS_COPY });

  // Some copies cannot be seen whole at any size worth looking at. The
  // arithmetic bottoms out at the floor, the floor is the nearer end of the
  // band to itself, and what is left over scrolls — which is what the pane did
  // before there was a zoom at all.
  await expect.poll(() => previewZoom(page)).toBe(0.5);
  await expect(page.locator('#zoom-value')).toHaveText('50%');
  expect((await panesStillScrolling(page)).length).toBeGreaterThan(0);
});

test('the menu goes below where a copy will ever open', async ({ context, server, extensionId }) => {
  // Nothing opens below half size. Asked outright the menu will go lower, for
  // looking at the shape of something long without arguing with the window —
  // the floor is a default, not a limit.
  const page = await inspectClipboard({ context, server, extensionId }, { ...TALL_COPY });

  await pickZoom(page, '0.25');
  await expect(page.locator('#zoom-value')).toHaveText('25%');
  expect(await previewZoom(page)).toBe(0.25);
  expect(await panesStillScrolling(page)).toEqual([]);
});

test('a payload that would clear at full size still opens at 75%', async ({ context, server, extensionId }) => {
  const page = await inspectClipboard({ context, server, extensionId }, {
    plain: 'Heading\nsome text',
    html: '<h1>Heading</h1><p>some <b>text</b></p>',
  });

  // Small enough to clear at full size with room to spare, so the arithmetic
  // comes back at the ceiling and the nearer end of the band is the ceiling too.
  await expect.poll(() => previewZoom(page)).toBe(0.75);
  await expect(page.locator('#zoom-value')).toHaveText('75%');
  expect(await previewZoom(page)).toBe(0.75);
  expect(await panesStillScrolling(page)).toEqual([]);

  // 100% is there in the menu for anyone who wants it.
  await pickZoom(page, '1');
  expect(await previewZoom(page)).toBe(1);
  expect(await panesStillScrolling(page)).toEqual([]);
});

test('the chrome holds its size while the payload scales', async ({ context, server, extensionId }) => {
  const page = await inspectClipboard({ context, server, extensionId }, {
    ...TALL_COPY,
  });

  // The two ends of the menu.
  await pickZoom(page, '0.25');
  const small = await boxes(page);
  await pickZoom(page, '1.5');
  const large = await boxes(page);

  // The zoom is doing something…
  expect(large.rowHeight).toBeGreaterThan(small.rowHeight * 3);

  // …and none of it reaches the things the grid is read and operated with.
  // Soft, so a control that did move is named alongside any others.
  for (const part of ['mime', 'replace', 'title', 'toggle']) {
    expect.soft(large[part], part).toBe(small[part]);
  }
});

test('a level picked by hand replaces the one the copy opened on', async ({ context, server, extensionId }) => {
  const page = await inspectClipboard({ context, server, extensionId }, {
    ...TALL_COPY,
  });
  const opened = await previewZoom(page);

  await pickZoom(page, '1.25');
  await expect(page.locator('#zoom-value')).toHaveText('125%');
  expect(await previewZoom(page)).toBe(1.25);
  expect(await previewZoom(page)).not.toBe(opened);
  await expect(page.locator('.zoom-option[data-zoom="1.25"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(`.zoom-option[data-zoom="${opened}"]`)).toHaveAttribute('aria-selected', 'false');

  // The menu shuts behind the choice, and Escape is not needed to prove it.
  await expect(page.locator('#zoom-menu')).toBeHidden();
});

test('leaves the browser its own zoom shortcuts', async ({ context, server, extensionId }) => {
  const page = await inspectClipboard({ context, server, extensionId }, { ...TALL_COPY });
  const label = await page.locator('#zoom-value').textContent();
  const before = await previewZoom(page);

  // cmd or ctrl with plus, minus and 0 belong to the browser and zoom the page,
  // the way they do everywhere else. Nothing here may take them: an unhandled
  // key leaves the event uncancelled, which is what lets the browser act on it.
  const prevented = await page.evaluate(() => ['=', '+', '-', '0'].map((key) => {
    const event = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  }));

  expect(prevented).toEqual([false, false, false, false]);
  expect(await previewZoom(page)).toBe(before);
  await expect(page.locator('#zoom-value')).toHaveText(label);
});

test('Fit re-measures when the view switches', async ({ context, server, extensionId }) => {
  const page = await inspectClipboard({ context, server, extensionId }, { ...TALL_COPY });

  // Fit, not the level the page opened on: a fixed level is fixed, and
  // re-measuring is what this is about. Retained machinery — see forceFit.
  await forceFit(page);
  const rendered = await previewZoom(page);

  // Source shows the markup rather than the table it draws, and clipboard
  // markup stands far taller than the thing it describes. Same payload, a
  // different number — Fit is measured against what is on the page now, not
  // remembered from what was on it before.
  await page.locator('#view-toggle .segment[data-view="source"]').click();
  await expect(page.locator('.card--html .card-source')).toBeVisible();
  await expect(page.locator('#zoom-value')).toHaveText('Fit');
  expect(await previewZoom(page)).toBeLessThan(rendered);
});

test('Fit re-measures when a pane starts wrapping', async ({ context, server, extensionId }) => {
  // One long line, which is one line tall until it is wrapped. Everything else
  // in this copy is small, so the wrap toggle is the only thing that can move
  // the number. Long enough that the wrapped block lands inside the band and
  // not on the ceiling, where the move would be invisible.
  const longLine = 'lorem ipsum dolor sit amet '.repeat(80).trim();
  const page = await inspectClipboard({ context, server, extensionId }, {
    plain: longLine,
    html: '<p>a short paragraph</p>',
  });

  // On a window with room in it the panes would simply grow to take the new
  // lines and the zoom would never move, which is the right answer there and
  // no test of this one. Short enough that height has nothing left to give.
  await page.setViewportSize({ width: 1280, height: 620 });
  await forceFit(page);
  await expect.poll(() => previewZoom(page)).toBe(0.75);

  await page.locator('.card--plain .wrap-btn').click();
  await expect(page.locator('.card--plain .card-source')).toHaveClass(/is-wrapped/);
  expect(await previewZoom(page)).toBeLessThan(0.75);
  expect(await panesStillScrolling(page)).toEqual([]);
});

/* ------------------------------------------------------- pane height budget */

/** The cap a pane is currently allowed to grow to, in pixels. */
function paneCap(page, selector) {
  return page.locator(selector).evaluate((pane) => parseFloat(getComputedStyle(pane).maxHeight));
}

/** How far the grid's bottom edge sits above (positive) the fold. */
function roomBelowGrid(page) {
  return page.evaluate(() =>
    window.innerHeight - document.querySelector('.inspector-grid').getBoundingClientRect().bottom);
}

test('the panes take the room a tall window leaves them', async ({ context, server, extensionId }) => {
  // Endless on purpose: the panes want every pixel there is, so what they get
  // is the budget and nothing about the payload.
  const page = await inspectClipboard({ context, server, extensionId }, { ...ENDLESS_COPY });

  await page.setViewportSize({ width: 1280, height: 700 });
  // Never below the heights the stylesheet ships with, however little room
  // there is: a short window is no worse off than it was before any of this.
  await expect.poll(() => paneCap(page, '.card--html .card-render')).toBeGreaterThanOrEqual(300);
  const short = {
    html: await paneCap(page, '.card--html .card-render'),
    rest: await paneCap(page, '.card--plain .card-source'),
  };
  expect(short.rest).toBeGreaterThanOrEqual(200);

  // The same copy on a window with 800px more in it.
  await page.setViewportSize({ width: 1280, height: 1500 });
  await expect.poll(() => paneCap(page, '.card--html .card-render')).toBeGreaterThan(short.html + 100);
  expect(await paneCap(page, '.card--plain .card-source')).toBeGreaterThan(short.rest + 100);

  // Both cards in a row still share one cap — split them and the shorter side
  // strands.
  expect(await paneCap(page, '.card--simple-html .card-render'))
    .toBe(await paneCap(page, '.card--html .card-render'));
  expect(await paneCap(page, '.card--markdown .card-render'))
    .toBe(await paneCap(page, '.card--plain .card-source'));
});

test('the panes fill the window without running past it', async ({ context, server, extensionId }) => {
  const page = await inspectClipboard({ context, server, extensionId }, { ...ENDLESS_COPY });
  await page.setViewportSize({ width: 1280, height: 1500 });
  await expect.poll(() => paneCap(page, '.card--html .card-render')).toBeGreaterThan(300);

  // Room taken, but not more than there was: the comparison still ends inside
  // the window rather than sending the page itself scrolling.
  const room = await roomBelowGrid(page);
  expect(room).toBeGreaterThanOrEqual(0);
  expect(room).toBeLessThan(80);
});

test('a stacked single column keeps the panes at their base height', async ({ context, server, extensionId }) => {
  const page = await inspectClipboard({ context, server, extensionId }, { ...ENDLESS_COPY });

  // One column means the two rows sit end to end, so there is no spare room to
  // hand out — the page scrolls whatever the caps say, and taller panes would
  // only make it scroll further.
  await page.setViewportSize({ width: 700, height: 1500 });
  await expect.poll(() => paneCap(page, '.card--html .card-render')).toBe(300);
  expect(await paneCap(page, '.card--plain .card-source')).toBe(200);
});

test('room goes to the panes before the zoom starts shrinking', async ({ context, server, extensionId }) => {
  const page = await inspectClipboard({ context, server, extensionId }, { ...TALL_COPY });

  await page.setViewportSize({ width: 1280, height: 700 });
  await forceFit(page);
  await expect.poll(() => previewZoom(page)).toBeLessThan(0.75);

  // The same copy, the same Fit, a window with room in it: the panes grow into
  // it and the payload goes back up to the ceiling rather than being shrunk to
  // suit a cap that did not have to be that small.
  await page.setViewportSize({ width: 1280, height: 1500 });
  await expect(page.locator('#zoom-value')).toHaveText('Fit');
  await expect.poll(() => previewZoom(page)).toBe(0.75);
  expect(await panesStillScrolling(page)).toEqual([]);
});

/** A 96×96 square, standing in for a favicon: the natural size a news site
 *  serves one at, and four times the size the page actually draws it. */
const SQUARE_96 = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="orange"/></svg>'
).toString('base64');

test('the Simple HTML card draws an image at the size the copy asked for', async ({ context, server, extensionId }) => {
  // Unit tests can see that width/height reach the Simple HTML; they cannot see
  // this stylesheet take them away again. That is what happened — `width: auto`
  // on .card-render img outranked the attributes, because an attribute enters
  // the cascade as a presentational hint and loses to any author rule. Every
  // image drew at 96px regardless. This is the pane that catches it.
  const page = await inspectClipboard({ context, server, extensionId }, {
    plain: 'Publisher headline',
    html: `<div><img src="${SQUARE_96}" style="height: 14px;" alt="">`
        + `<figure><img src="${SQUARE_96}" style="width: 64px; height: 64px;" alt=""></figure>`
        + '<p>Publisher headline</p></div>',
  });

  const box = (sel) => page.locator(sel).evaluate((n) => {
    const r = n.getBoundingClientRect();
    return `${Math.round(r.width)}x${Math.round(r.height)}`;
  });

  // These are measured in rendered pixels, which the preview zoom scales. Pin it
  // at full size so the figures below are the ones the copy asked for, and not
  // those figures times whatever Fit made of this window.
  await pickZoom(page, '1');

  // 14px on one axis alone: the other comes from the file's own proportions.
  await expect.poll(() => box('.card--simple-html .card-render img >> nth=0')).toBe('14x14');
  await expect.poll(() => box('.card--simple-html .card-render img >> nth=1')).toBe('64x64');

  // Markdown has no syntax for a size, so its images are unsized by
  // construction and the cap is all that holds them. Asserted so the two cards
  // differing here reads as intended rather than as this bug coming back.
  await expect.poll(() => box('.card--markdown .card-render img >> nth=0')).toBe('96x96');
});
