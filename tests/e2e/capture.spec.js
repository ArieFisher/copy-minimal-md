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

/** An image alone. No card has anything to say about it, so a capture of this
    clipboard carries no pane and no payload — and still carries the console. */
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

/** The three marks, in the order the bar lays them out. */
const MARK = {
    positive: '#intent .intent-btn[data-intent="positive"]',
    question: '#intent .intent-btn[data-intent="question"]',
    negative: '#intent .intent-btn[data-intent="negative"]'
};

/** Mark the capture, which opens the panel. */
const mark = (page, which = 'negative') => page.locator(MARK[which]).click();

/** Mark it, save it, and read the file that lands. A panel already open is
    saved as it stands, mark and all. */
async function capture(page, which = 'negative') {
    if (await page.locator('#capture-menu').isHidden()) await mark(page, which);
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#capture-menu .capture-save').click()
    ]);
    const file = await keep(download);
    return { download, path: file, html: fs.readFileSync(file, 'utf8') };
}

/* ------------------------------------------------------------ the control */

test('sits in the app bar and opens its panel from a mark', async ({ context, server, extensionId }) => {
    const page = await inspectClipboard({ context, server, extensionId }, { plain: RAW_PLAIN, html: RAW_HTML });

    await expect(page.locator('#intent')).toBeVisible();
    await expect(page.locator('#capture-menu')).toBeHidden();

    await mark(page);
    await expect(page.locator('#capture-menu')).toBeVisible();
    await expect(page.locator(MARK.negative)).toHaveAttribute('aria-checked', 'true');

    // Ten boxes: four cards in each of two views, then verbatim and the URL.
    const boxes = page.locator('#capture-menu .capture-row input');
    await expect(boxes).toHaveCount(10);
    expect(await page.locator('#capture-menu .capture-row input:checked').count()).toBe(10);
});

test('closes the panel on the lit mark, an outside click and Escape', async ({ context, server, extensionId }) => {
    const page = await inspectClipboard({ context, server, extensionId }, { plain: RAW_PLAIN, html: RAW_HTML });

    await mark(page);
    await expect(page.locator('#capture-menu')).toBeVisible();
    await page.locator('.app-bar-title h1').click();
    await expect(page.locator('#capture-menu')).toBeHidden();

    await mark(page);
    await expect(page.locator('#capture-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#capture-menu')).toBeHidden();

    // The lit mark is the door back out, the way the caret it replaced was.
    await mark(page);
    await expect(page.locator('#capture-menu')).toBeVisible();
    await mark(page);
    await expect(page.locator('#capture-menu')).toBeHidden();

    // Closing does not take the mark off.
    await expect(page.locator(MARK.negative)).toHaveAttribute('aria-checked', 'true');
});

test('switches off what this copy has nothing to say about', async ({ context, server, extensionId }) => {
    // A hotkey copy: both equivalents already sit on the clipboard, so both
    // derived cards are inert and there is nothing to capture from them.
    const page = await inspectClipboard({ context, server, extensionId }, { plain: HOTKEY_PLAIN, html: HOTKEY_HTML });

    await mark(page);
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
    await expect(page.locator('#capture-status')).toHaveText('Saved');
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

    expect(data.captureVersion).toBe(2);
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

    await mark(page);

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

    await mark(page);
    await page.locator('#capture-menu .capture-row input').first().uncheck();
    await page.keyboard.press('Escape');

    // Reopening gives a panel built from the copy, not from the last visit.
    await mark(page);
    expect(await page.locator('#capture-menu .capture-row input:checked').count()).toBe(10);
});

/* ------------------------------------------------------------------ notes */

test('takes one note above the boxes and writes it into the file', async ({ context, server, extensionId }) => {
    const page = await inspectClipboard({ context, server, extensionId }, { plain: RAW_PLAIN, html: RAW_HTML });

    await mark(page);

    const fields = page.locator('#capture-menu .capture-field');
    await expect(fields).toHaveCount(1);
    await expect(fields.locator('.capture-field-name')).toHaveText(['Notes']);

    // Above the boxes: what the tester came to write comes before what they
    // came to keep.
    const note = await fields.first().boundingBox();
    const firstBox = await page.locator('#capture-menu .capture-row').first().boundingBox();
    expect(note.y).toBeLessThan(firstBox.y);

    await fields.first().locator('textarea').fill('one long line, expected two rows');

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#capture-menu .capture-save').click()
    ]);
    const file = await keep(download);

    // Read it back the way a reader and an importer each would.
    const reader = await context.newPage();
    await reader.goto(`file://${file}`);

    await expect(reader.locator('.capture-notes dt')).toHaveText(['Intent', 'Notes']);
    await expect(reader.locator('.capture-notes dd')).toHaveText([
        '\u{1F44E} Something is wrong', 'one long line, expected two rows'
    ]);

    const data = JSON.parse(await reader.locator('#capture-payloads').textContent());
    expect(data.notes).toEqual({ note: 'one long line, expected two rows' });
    expect(data.intent).toBe('negative');
    expect(data.captureVersion).toBe(2);
});

test('keeps the note and the mark across a close', async ({ context, server, extensionId }) => {
    const page = await inspectClipboard({ context, server, extensionId }, { plain: RAW_PLAIN, html: RAW_HTML });

    await mark(page, 'question');
    await page.locator('#capture-menu .capture-field textarea').fill('a table with two rows');
    await page.keyboard.press('Escape');

    await expect(page.locator(MARK.question)).toHaveAttribute('aria-checked', 'true');

    await mark(page, 'question');
    await expect(page.locator('#capture-menu .capture-field textarea'))
        .toHaveValue('a table with two rows');

    expect((await capture(page)).html).toContain('a table with two rows');
});

test('saves a clipboard with nothing on it, for the console alone', async ({ context, server, extensionId }) => {
    // An image is the everyday version of this: nothing the panel can tick,
    // and a console that may still say why. The old button refused to run here
    // and flashed "Nothing yet"; a run that produced nothing is a finding.
    const page = await inspectClipboard({ context, server, extensionId }, { png: PNG_1PX });

    await mark(page, 'question');

    const off = page.locator('#capture-menu .capture-row.is-off');
    await expect(off).toHaveCount(8);

    const save = page.locator('#capture-menu .capture-save');
    await expect(save).toBeEnabled();

    await page.locator('#capture-menu .capture-field textarea')
        .fill('copied a screenshot and the panel went blank');

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        save.click()
    ]);
    const file = await keep(download);
    const html = fs.readFileSync(file, 'utf8');

    expect(html).not.toContain('id="view-rendered"');
    expect(html).not.toContain('id="view-source"');
    expect(html).toContain('id="capture-console"');

    const reader = await context.newPage();
    await reader.goto(`file://${file}`);
    const data = JSON.parse(await reader.locator('#capture-payloads').textContent());
    expect(data.intent).toBe('question');
    expect(data.notes).toEqual({ note: 'copied a screenshot and the panel went blank' });
    expect(data.console.entries.length).toBeGreaterThan(0);
});

/* ------------------------------------------------------------------- mark */

test('moves between the marks on the arrow keys', async ({ context, server, extensionId }) => {
    const page = await inspectClipboard({ context, server, extensionId }, { plain: RAW_PLAIN, html: RAW_HTML });

    // Nothing marked yet, so the group holds one tab stop and it is the first.
    await page.locator(MARK.positive).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator(MARK.question)).toBeFocused();
    await expect(page.locator(MARK.question)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#capture-menu')).toBeVisible();

    // It wraps, the way a radiogroup does.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator(MARK.positive)).toHaveAttribute('aria-checked', 'true');

    // One tab stop: the lit mark holds it and the other two are passed over.
    expect(await page.locator(MARK.positive).getAttribute('tabindex')).toBe('0');
    expect(await page.locator(MARK.question).getAttribute('tabindex')).toBe('-1');
    expect(await page.locator(MARK.negative).getAttribute('tabindex')).toBe('-1');
});

test('writes the mark the tester pressed', async ({ context, server, extensionId }) => {
    const page = await inspectClipboard({ context, server, extensionId }, { plain: RAW_PLAIN, html: RAW_HTML });

    for (const which of ['positive', 'question', 'negative']) {
        const { path } = await capture(page, which);
        const reader = await context.newPage();
        await reader.goto(`file://${path}`);
        const data = JSON.parse(await reader.locator('#capture-payloads').textContent());
        expect(data.intent).toBe(which);
        await reader.close();
    }
});

test('changes the mark without disturbing the panel or the note', async ({ context, server, extensionId }) => {
    const page = await inspectClipboard({ context, server, extensionId }, { plain: RAW_PLAIN, html: RAW_HTML });

    await mark(page, 'negative');
    const note = page.locator('#capture-menu .capture-field textarea');
    await note.fill('half a sentence so far');

    // The prompt follows the mark, because the three want different things.
    await expect(note).toHaveAttribute('placeholder', /Expected \/ observed \/ cause/);

    await page.locator(MARK.positive).click();

    await expect(page.locator('#capture-menu')).toBeVisible();
    await expect(note).toHaveValue('half a sentence so far');
    await expect(note).toHaveAttribute('placeholder', /^Remarks$/);
    await expect(page.locator(MARK.positive)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator(MARK.negative)).toHaveAttribute('aria-checked', 'false');

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#capture-menu .capture-save').click()
    ]);
    const reader = await context.newPage();
    await reader.goto(`file://${await keep(download)}`);
    const data = JSON.parse(await reader.locator('#capture-payloads').textContent());
    expect(data.intent).toBe('positive');
});

/* ---------------------------------------------------------------- console */

test('carries what the page logged, with no box to tick', async ({ context, server, extensionId }) => {
    const page = await inspectClipboard({ context, server, extensionId }, { plain: RAW_PLAIN, html: RAW_HTML });

    // Something the inspector logs on every load, so the assertion is about the
    // recorder and not about a message this test planted.
    const { path, html } = await capture(page);
    expect(html).toContain('id="capture-console"');
    expect(html).toContain('Requesting aria-preview data from background');

    const reader = await context.newPage();
    await reader.goto(`file://${path}`);

    const rows = reader.locator('.capture-log-row');
    expect(await rows.count()).toBeGreaterThan(0);
    await expect(rows.first().locator('.capture-log-time')).toHaveText(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);

    const data = JSON.parse(await reader.locator('#capture-payloads').textContent());
    expect(data.console.dropped).toBe(0);
    expect(data.console.entries.map((entry) => entry.text).join('\n'))
        .toContain('Requesting aria-preview data from background');
});

test('says the log is coming and how much of it there is', async ({ context, server, extensionId }) => {
    const page = await inspectClipboard({ context, server, extensionId }, { plain: RAW_PLAIN, html: RAW_HTML });

    await mark(page);
    const always = page.locator('#capture-menu .capture-always');
    await expect(always).toContainText('Console');
    await expect(always).toContainText(/\d+ messages?, always saved/);

    // It has no box, so unticking everything else still leaves it in the file.
    for (const box of await page.locator('#capture-menu .capture-row input:enabled').all()) {
        await box.uncheck();
    }

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#capture-menu .capture-save').click()
    ]);
    const html = fs.readFileSync(await keep(download), 'utf8');

    expect(html).not.toContain('id="view-rendered"');
    expect(html).not.toContain('id="payload-text-plain"');
    expect(html).toContain('id="capture-console"');
    expect(html).toContain('Requesting aria-preview data from background');
});

test('records a message written after the panel was opened', async ({ context, server, extensionId }) => {
    const page = await inspectClipboard({ context, server, extensionId }, { plain: RAW_PLAIN, html: RAW_HTML });

    await mark(page);
    await page.evaluate(() => console.warn('Inspector: something the tester did next'));

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#capture-menu .capture-save').click()
    ]);
    const html = fs.readFileSync(await keep(download), 'utf8');

    expect(html).toContain('Inspector: something the tester did next');
    expect(html).toContain('is-warn');
});
