/**
 * The capture control, end to end.
 *
 * These cover the half of the feature a unit test cannot reach: the split
 * button in a real app bar, the panel built from a real clipboard read, the
 * card builders called with state.view flipped, and — the one that needs a real
 * extension under the real manifest — an anchor download from a page that has
 * no downloads permission.
 *
 * The last test is the one that matters most. It opens a saved capture cold,
 * over file://, and asserts the test server was not touched. A capture is built
 * to be shared, and a shared file that fetches the images of the page it came
 * from tells that page's server who opened it and when.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect, inspectClipboard } = require('./fixtures.js');

/** What cmd+shift+U leaves behind: both equivalents already on the clipboard. */
const HOTKEY_PLAIN = '| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |';
const HOTKEY_HTML = '<table><tbody><tr><th>Name</th><th>Age</th></tr><tr><td>Alice</td><td>30</td></tr><tr><td>Bob</td><td>25</td></tr></tbody></table>';

/** A raw page copy: nothing derived yet, so all four cards have something. */
const RAW_PLAIN = 'Heading\nsome text';
const RAW_HTML = '<h1 style="color:red">Heading</h1><p>some <b>text</b></p>';

/**
 * Save a download somewhere a browser will open as a page.
 *
 * download.path() hands back a temp file with no extension, and Chrome shown
 * one of those renders it as text — so a test that opens the capture cold has
 * to give it its name back first.
 */
let saved = 0;
async function keep(download) {
    const file = path.join(os.tmpdir(), `capture-e2e-${process.pid}-${saved++}.html`);
    await download.saveAs(file);
    return file;
}

/** Press the left half and read the file it writes. */
async function capture(page) {
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#capture-btn').click()
    ]);
    const file = await keep(download);
    return { download, path: file, html: fs.readFileSync(file, 'utf8') };
}

/* ------------------------------------------------------------ the control */

test('sits in the app bar and opens its panel from the caret', async ({ context, server, extensionId }) => {
    const page = await inspectClipboard({ context, server, extensionId }, { plain: RAW_PLAIN, html: RAW_HTML });

    await expect(page.locator('#capture-btn')).toBeVisible();
    await expect(page.locator('#capture-menu')).toBeHidden();

    await page.locator('#capture-caret').click();
    await expect(page.locator('#capture-menu')).toBeVisible();
    await expect(page.locator('#capture-caret')).toHaveAttribute('aria-expanded', 'true');

    // Eight boxes for the four cards in two views, and every one of them ticked.
    const boxes = page.locator('#capture-menu .capture-row input');
    await expect(boxes).toHaveCount(10);
    expect(await page.locator('#capture-menu .capture-row input:checked').count()).toBe(10);
});

test('closes the panel on an outside click and on Escape', async ({ context, server, extensionId }) => {
    const page = await inspectClipboard({ context, server, extensionId }, { plain: RAW_PLAIN, html: RAW_HTML });

    await page.locator('#capture-caret').click();
    await expect(page.locator('#capture-menu')).toBeVisible();
    await page.locator('.app-bar-title h1').click();
    await expect(page.locator('#capture-menu')).toBeHidden();

    await page.locator('#capture-caret').click();
    await expect(page.locator('#capture-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#capture-menu')).toBeHidden();
});

test('switches off what this copy has nothing to say about', async ({ context, server, extensionId }) => {
    // A hotkey copy: both equivalents already sit on the clipboard, so both
    // derived cards are inert and there is nothing to capture from them.
    const page = await inspectClipboard({ context, server, extensionId }, { plain: HOTKEY_PLAIN, html: HOTKEY_HTML });

    await page.locator('#capture-caret').click();
    const off = page.locator('#capture-menu .capture-row.is-off');
    await expect(off).toHaveCount(4);
    await expect(off.first()).toContainText('already in text/plain');
    await expect(off.nth(1)).toContainText('already in text/html');

    for (const box of await off.locator('input').all()) {
        await expect(box).toBeDisabled();
        await expect(box).not.toBeChecked();
    }
});

/* ------------------------------------------------------------ the download */

test('writes a file from a page with no downloads permission', async ({ context, server, extensionId }) => {
    const page = await inspectClipboard({ context, server, extensionId }, { plain: RAW_PLAIN, html: RAW_HTML });

    const { download } = await capture(page);
    expect(download.suggestedFilename()).toMatch(/^capture-\d{4}-\d{2}-\d{2}-[a-z0-9-]+-\d{6}\.html$/);

    // The tab closes itself when it is hidden. A download does not hide it.
    await expect(page.locator('.app-bar')).toBeVisible();
    await expect(page.locator('#capture-label')).toHaveText('Saved');
});

test('names the page the copy came from', async ({ context, server, extensionId }) => {
    // The inspector never sees that page; the worker holds the URL from the
    // moment the inspect command ran. Opening the inspector directly, as these
    // tests do, means there is none — and the capture says so rather than
    // inventing one.
    const page = await inspectClipboard({ context, server, extensionId }, { plain: RAW_PLAIN, html: RAW_HTML });
    const { download, html } = await capture(page);

    expect(download.suggestedFilename()).toContain('-no-source-');
    expect(html).toContain('not recorded');
});

test('carries both views, the stylesheet and the payloads', async ({ context, server, extensionId }) => {
    const page = await inspectClipboard({ context, server, extensionId }, { plain: RAW_PLAIN, html: RAW_HTML });
    const { html } = await capture(page);

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('id="view-rendered"');
    expect(html).toContain('id="view-source"');

    // The inspector's own stylesheet, inlined — not a link to it.
    expect(html).toContain('.card-source');
    expect(html).not.toContain('<link');

    // All four payloads, and the machine-readable copy of them.
    for (const id of ['payload-text-plain', 'payload-text-html', 'payload-markdown', 'payload-simple-html']) {
        expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('id="capture-payloads"');
});

test('gives a fixture importer the payloads the pipeline takes', async ({ context, server, extensionId }) => {
    const page = await inspectClipboard({ context, server, extensionId }, { plain: RAW_PLAIN, html: RAW_HTML });
    const { path } = await capture(page);

    // Read it back the way an importer would: parse the file, take the JSON.
    const reader = await context.newPage();
    await reader.goto(`file://${path}`);
    const data = JSON.parse(await reader.locator('#capture-payloads').textContent());

    expect(data.captureVersion).toBe(1);
    expect(data.payloads.html).toContain('<h1');
    expect(data.equivalents.markdown).toContain('# Heading');
    expect(data.present).toEqual({ plain: true, html: true });
    expect(data.suggestedSlug).toMatch(/^\d{4}-\d{2}-\d{2}-no-source$/);
});

test('holds both views whichever one the page is showing', async ({ context, server, extensionId }) => {
    const page = await inspectClipboard({ context, server, extensionId }, { plain: RAW_PLAIN, html: RAW_HTML });

    await page.locator('#view-toggle .segment[data-view="source"]').click();
    await expect(page.locator('.card--html .card-source')).toBeVisible();

    const { html } = await capture(page);
    expect(html).toContain('id="view-rendered"');
    expect(html).toContain('id="view-source"');

    // The flip put the view back: the live page is where the tester left it.
    await expect(page.locator('.card--html .card-source')).toBeVisible();
    await expect(page.locator('#view-toggle .segment[data-view="source"]')).toHaveClass(/is-selected/);
});

/* ---------------------------------------------------- opening one, cold */

test('opens cold and phones nobody', async ({ context, server, extensionId }) => {
    // A remote image inside a clipboard payload. The live inspector fetches it
    // today — that is not what is under test. What is: whether the file the
    // tester sends a collaborator fetches it again on their machine.
    const pixel = `${server.baseUrl}/tracker-pixel.png`;
    const page = await inspectClipboard({ context, server, extensionId }, {
        plain: 'a cell',
        html: `<table><tbody><tr><td>a cell <img src="${pixel}" alt="pixel"></td></tr></tbody></table>`
    });

    const { path, html } = await capture(page);

    // The URL survives as evidence; the fetch does not.
    expect(html).toContain('data-original-src');
    expect(html).toContain('tracker-pixel.png');

    const before = server.requests.filter((url) => url.includes('tracker-pixel')).length;

    const reader = await context.newPage();
    await reader.goto(`file://${path}`);
    await expect(reader.locator('.capture-title')).toBeVisible();
    // The panes redraw from the same markup under the same stylesheet.
    await expect(reader.locator('#view-rendered .card--html table')).toBeVisible();
    await reader.waitForTimeout(500);

    // The grid carries the width the columns had, and the page around it is
    // the same width, so a reader as wide as the tester was scrolls nothing.
    const fits = await reader.evaluate(() => {
        const page = document.querySelector('.capture-page');
        const room = page.clientWidth
            - parseFloat(getComputedStyle(page).paddingLeft)
            - parseFloat(getComputedStyle(page).paddingRight);
        const grid = document.querySelector('#view-rendered .inspector-grid');
        return grid.getBoundingClientRect().width <= room + 1;
    });
    expect(fits).toBe(true);

    const after = server.requests.filter((url) => url.includes('tracker-pixel')).length;
    expect(after).toBe(before);
});

test('carries no script, and says so at the top', async ({ context, server, extensionId }) => {
    const page = await inspectClipboard({ context, server, extensionId }, {
        plain: 'hostile',
        html: '<p onclick="alert(1)">text</p><a href="javascript:alert(2)">link</a>'
            + '<style>.card { display: none }</style><script>alert(3)</script>'
    });

    const { path, html } = await capture(page);

    expect(html).not.toContain('<script');
    expect(html).toContain("script-src 'none'");

    const reader = await context.newPage();
    await reader.goto(`file://${path}`);
    expect(await reader.locator('script').count()).toBe(0);
    // The payload's own CSS cannot reach the report around it.
    await expect(reader.locator('.capture-title')).toBeVisible();
    await expect(reader.locator('#view-rendered .card--plain')).toBeVisible();
});

/* ------------------------------------------------------------- the panel */

test('saves only what is left ticked', async ({ context, server, extensionId }) => {
    const page = await inspectClipboard({ context, server, extensionId }, { plain: RAW_PLAIN, html: RAW_HTML });

    await page.locator('#capture-caret').click();

    // Rows run in the order the panel lays them out: four Rendered, four
    // Source, then the extras. Untick the Source group.
    const boxes = page.locator('#capture-menu .capture-row input');
    for (let i = 4; i < 8; i++) await boxes.nth(i).uncheck();

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#capture-menu .capture-save').click()
    ]);
    const html = fs.readFileSync(await keep(download), 'utf8');

    expect(html).toContain('id="view-rendered"');
    expect(html).not.toContain('id="view-source"');
});

test('keeps no tick between one save and the next', async ({ context, server, extensionId }) => {
    const page = await inspectClipboard({ context, server, extensionId }, { plain: RAW_PLAIN, html: RAW_HTML });

    await page.locator('#capture-caret').click();
    await page.locator('#capture-menu .capture-row input').first().uncheck();
    await page.keyboard.press('Escape');

    // Reopening gives a panel built from the copy, not from the last visit.
    await page.locator('#capture-caret').click();
    expect(await page.locator('#capture-menu .capture-row input:checked').count()).toBe(10);
});

/* ------------------------------------------------------------------ notes */

test('takes the three notes in the panel and writes them into the file', async ({ context, server, extensionId }) => {
    const page = await inspectClipboard({ context, server, extensionId }, { plain: RAW_PLAIN, html: RAW_HTML });

    await page.locator('#capture-caret').click();

    const fields = page.locator('#capture-menu .capture-field');
    await expect(fields.locator('.capture-field-name')).toHaveText(['Expected', 'Observed', 'Cause']);

    await fields.nth(0).locator('textarea').fill('a table with two rows');
    await fields.nth(1).locator('textarea').fill('one long line');
    await fields.nth(2).locator('textarea').fill('the wrapper div is dropped');

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#capture-menu .capture-save').click()
    ]);
    const file = await keep(download);

    // Read it back the way a reader and an importer each would.
    const reader = await context.newPage();
    await reader.goto(`file://${file}`);

    await expect(reader.locator('.capture-notes dt')).toHaveText(['Expected', 'Observed', 'Cause']);
    await expect(reader.locator('.capture-notes dd')).toHaveText([
        'a table with two rows', 'one long line', 'the wrapper div is dropped'
    ]);

    const data = JSON.parse(await reader.locator('#capture-payloads').textContent());
    expect(data.notes).toEqual({
        expected: 'a table with two rows',
        observed: 'one long line',
        cause: 'the wrapper div is dropped'
    });
});

test('keeps the notes across a close, and the left half writes them too', async ({ context, server, extensionId }) => {
    const page = await inspectClipboard({ context, server, extensionId }, { plain: RAW_PLAIN, html: RAW_HTML });

    await page.locator('#capture-caret').click();
    await page.locator('#capture-menu .capture-field textarea').first().fill('a table with two rows');
    await page.keyboard.press('Escape');

    await page.locator('#capture-caret').click();
    await expect(page.locator('#capture-menu .capture-field textarea').first())
        .toHaveValue('a table with two rows');
    await page.keyboard.press('Escape');

    expect((await capture(page)).html).toContain('a table with two rows');
});
