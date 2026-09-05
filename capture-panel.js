/**
 * The capture control, and the glue between it and the inspector's own state.
 *
 * Split in two on purpose. capture.js holds everything that can be reasoned
 * about without a browser — filenames, availability, the scrub pass, the
 * document builder — and is unit-tested. This file reads `state`, calls the
 * card builders, fetches the stylesheets and hands a blob to the browser, and
 * is covered end to end.
 *
 * The control is a split button. The left half saves everything this copy has.
 * The caret opens a panel with every available box ticked, for the times one of
 * them is in the way. The panel is rebuilt on each open and no tick is kept
 * between them: unticking trims one save, and the next panel is full again.
 *
 * The notes are the exception. They are the tester's own words, so they last as
 * long as the tab and both halves of the button write them.
 */
(function () {
    'use strict';

    /* --------------------------------------------------- reading the state */

    const BUILDERS = {
        plain: () => buildPlainCard(),
        html: () => buildHtmlCard(),
        markdown: () => buildMarkdownCard(),
        simpleHtml: () => buildSimpleHtmlCard()
    };

    /** Where each payload lives, and how the capture names it. */
    const PAYLOADS = {
        plain: { id: 'payload-text-plain', entry: 'text/plain', kind: 'mime', json: ['payloads', 'plain'] },
        html: { id: 'payload-text-html', entry: 'text/html', kind: 'mime', json: ['payloads', 'html'] },
        markdown: { id: 'payload-markdown', entry: 'markdown', kind: 'derived', json: ['equivalents', 'markdown'] },
        simpleHtml: { id: 'payload-simple-html', entry: 'simpleHtml', kind: 'derived', json: ['equivalents', 'simpleHtml'] }
    };

    const VIEWS = ['rendered', 'source'];

    /* ---------------------------------------------------------------- notes */

    /**
     * What the tester has typed, keyed the way Capture.NOTES_FIELDS names it.
     *
     * Reported and Source are not asked for. The header of the saved file
     * already carries the capture time and the page the copy came from.
     */
    const notes = {};

    const NOTE_HINT = {
        expected: 'What the copy should have produced.',
        observed: 'What it produced instead.',
        cause: 'Where it goes wrong, if you know yet.'
    };

    /** Only what was typed. An untouched field is absent, not empty. */
    function notesFor() {
        const filled = {};
        for (const field of Capture.NOTES_FIELDS) {
            const text = (notes[field.key] || '').trim();
            if (text) filled[field.key] = text;
        }
        return filled;
    }

    const textFor = (key) => ({
        plain: state.current.plain,
        html: state.current.html,
        markdown: state.equivalents.markdown,
        simpleHtml: state.equivalents.simpleHtml
    })[key] || '';

    /** The four predicates Capture.availability needs, read off the inspector. */
    function snapshot() {
        return {
            plainPresent: state.plainPresent,
            htmlPresent: state.htmlPresent,
            mdDone: state.mdDone,
            htmlDone: state.htmlDone,
            markdown: state.equivalents.markdown,
            simpleHtml: state.equivalents.simpleHtml,
            markdownOnClipboard: mdOnClipboard(),
            simpleHtmlOnClipboard: simpleHtmlOnClipboard()
        };
    }

    const anythingToCapture = (avail) => Capture.CARD_KEYS.some((key) => avail[key].on);

    /** Every pane this copy has. What the left half of the button saves. */
    function everything(avail) {
        const pick = {};
        for (const view of VIEWS) {
            pick[view] = {};
            for (const key of Capture.CARD_KEYS) pick[view][key] = avail[key].on;
        }
        return { ...pick, verbatim: true, url: true };
    }

    /* --------------------------------------------------- collecting the DOM */

    /**
     * Build one view's cards.
     *
     * The flip is safe because the builders return detached nodes and none of
     * them measures the document, and it is synchronous end to end so nothing
     * else can observe `state.view` mid-flight. The `finally` is what keeps the
     * live page on the view the tester left it on.
     */
    function cardsFor(selection, view) {
        const previous = state.view;
        const cards = {};
        try {
            state.view = view;
            for (const key of Capture.CARD_KEYS) {
                if (selection[view][key]) cards[key] = Capture.scrub(BUILDERS[key]());
            }
        } finally {
            state.view = previous;
        }
        return cards;
    }

    /**
     * The same three-column grid the inspector draws, with the gutter empty —
     * its buttons act on the clipboard, and a capture has none. A card left out
     * becomes a spacer so the two columns stay aligned row for row.
     *
     * The width goes on as a ceiling rather than a figure. A reader as wide as
     * the tester gets the columns at the width the tester had, so the text wraps
     * where it wrapped; a narrower one gets a narrower grid instead of a page
     * that scrolls sideways.
     */
    function gridFor(cards, width) {
        const grid = el('div', 'inspector-grid');
        if (width) grid.style.maxWidth = `${width}px`;

        const cell = (key) => cards[key] || el('div', 'grid-spacer');

        grid.appendChild(buildLeftHeading());
        grid.appendChild(el('div', 'grid-spacer'));
        grid.appendChild(buildRightHeading());

        grid.appendChild(cell('plain'));
        grid.appendChild(el('div', 'grid-spacer'));
        grid.appendChild(cell('markdown'));

        grid.appendChild(cell('html'));
        grid.appendChild(el('div', 'grid-spacer'));
        grid.appendChild(cell('simpleHtml'));

        return grid;
    }

    /* ----------------------------------------------------------- provenance */

    /**
     * The page the copy came from. The worker holds it from the moment the
     * inspect command ran and clears it on read, so read once and keep it: a
     * re-read of the clipboard must not go looking for it again.
     */
    let sourceUrlCache = null;

    async function sourceUrl() {
        if (sourceUrlCache !== null) return sourceUrlCache;
        try {
            const context = await chrome.runtime.sendMessage({ type: 'get-capture-context' });
            sourceUrlCache = context?.sourceUrl || '';
        } catch (err) {
            console.warn('Capture: could not read the source URL from the background worker:', err.message);
            sourceUrlCache = '';
        }
        return sourceUrlCache;
    }

    /** Both stylesheets, fetched once. Same origin, so connect-src 'self' allows it. */
    let stylesheets = null;

    async function css() {
        if (stylesheets) return stylesheets;
        const read = (name) => fetch(chrome.runtime.getURL(name)).then((r) => r.text());
        try {
            const [inspector, report] = await Promise.all([read('inspector.css'), read('capture-report.css')]);
            stylesheets = { inspector, report };
        } catch (err) {
            console.error('Capture: could not read the stylesheets:', err);
            stylesheets = { inspector: '', report: '' };
        }
        return stylesheets;
    }

    /**
     * The width the columns actually had, not the width of the box around them.
     *
     * The live grid carries its own padding and the capture's page carries the
     * padding instead, so handing the border-box figure across makes the grid
     * wider than the page that holds it and the section scrolls sideways for no
     * reason. The content box is the figure that means the same thing on both
     * sides: how much room the two columns of cards had to wrap text in.
     */
    function contentWidth(grid) {
        const box = getComputedStyle(grid);
        return Math.round(grid.clientWidth - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight));
    }

    /**
     * What the tester was looking at. The zoom and the pane caps go in so the
     * capture draws the panes at the size they were, which is the whole of its
     * claim to stand in for a screenshot.
     */
    function metaFor(at, url) {
        const grid = document.querySelector('.inspector-grid');
        const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--preview-zoom'));

        return {
            at,
            capturedAt: at.toISOString(),
            extensionVersion: chrome.runtime.getManifest().version,
            sourceUrl: url,
            platform: navigator.userAgent,
            zoom: Number.isFinite(zoom) ? zoom : 1,
            captureWidth: grid ? contentWidth(grid) : 0,
            paneCap: grid ? grid.style.getPropertyValue('--pane-cap') : '',
            paneCapHtml: grid ? grid.style.getPropertyValue('--pane-cap-html') : '',
            derivedFrom: state.derivedFrom || ''
        };
    }

    /** A payload rides along when its card is in either view and verbatim is on. */
    function payloadKeys(selection, avail) {
        if (!selection.verbatim) return [];
        return Capture.CARD_KEYS.filter((key) =>
            avail[key].on && VIEWS.some((view) => selection[view][key]));
    }

    function payloadsFor(keys) {
        return keys.map((key) => {
            const text = textFor(key);
            return {
                ...PAYLOADS[key],
                label: Capture.CARD_LABEL[key],
                size: formatBytes(byteLength(text)),
                text
            };
        });
    }

    /** The authoritative copy, and the provenance a fixture importer needs. */
    function dataFor(keys, meta) {
        const data = {
            captureVersion: Capture.CAPTURE_VERSION,
            extensionVersion: meta.extensionVersion,
            capturedAt: meta.capturedAt,
            sourceUrl: meta.sourceUrl,
            platform: meta.platform,
            zoom: meta.zoom,
            captureWidth: meta.captureWidth,
            suggestedSlug: Capture.suggestedSlug({ at: meta.at, sourceUrl: meta.sourceUrl }),
            present: { plain: state.plainPresent, html: state.htmlPresent },
            replaced: { plain: state.mdDone, html: state.htmlDone },
            derivedFrom: meta.derivedFrom,
            notes: notesFor(),
            payloads: {},
            equivalents: {}
        };

        for (const key of keys) {
            const [group, field] = PAYLOADS[key].json;
            data[group][field] = textFor(key);
        }
        return data;
    }

    /* ------------------------------------------------------------- assemble */

    async function build(selection) {
        const avail = Capture.availability(snapshot());
        const at = new Date();
        const url = selection.url ? await sourceUrl() : '';
        const sheets = await css();
        const meta = metaFor(at, url);

        const sections = VIEWS
            .filter((view) => Capture.CARD_KEYS.some((key) => selection[view][key] && avail[key].on))
            .map((view) => ({
                id: `view-${view}`,
                view,
                node: gridFor(cardsFor(selection, view), meta.captureWidth)
            }));

        const keys = payloadKeys(selection, avail);

        return {
            filename: Capture.filenameFor({ at, sourceUrl: url }),
            html: Capture.buildDocument({
                meta,
                sections,
                payloads: payloadsFor(keys),
                data: dataFor(keys, meta),
                notes: notesFor(),
                inspectorCss: sheets.inspector,
                reportCss: sheets.report
            })
        };
    }

    /**
     * Hand the file to the browser.
     *
     * An anchor, not chrome.downloads: that permission gates the API, and the
     * download attribute is honoured for a blob made on an extension page.
     */
    function save({ filename, html }) {
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    /* ------------------------------------------------------------ the panel */

    const els = {};

    /** Roughly what a card costs in markup, over and above the payload in it. */
    const PANE_CHROME = 1100;

    /** What the report's own header, notes and section titles come to. */
    const REPORT_CHROME = 4000;

    /**
     * A rough figure for what pressing Save writes, shown before it is written
     * rather than after.
     *
     * The constant terms are guesses and the figure is labelled as an estimate
     * because of them. They stop mattering in the case the number is for: a copy
     * carrying an inline base64 image runs to megabytes of payload, and beside
     * that the stylesheets and the card markup are rounding.
     */
    function estimate(selection, avail) {
        const sheets = stylesheets
            ? byteLength(stylesheets.inspector) + byteLength(stylesheets.report)
            : 30000;

        // Twice: once to be read, once as JSON.
        const payloads = payloadKeys(selection, avail)
            .reduce((total, key) => total + byteLength(textFor(key)), 0) * 2;

        const panes = VIEWS.reduce((total, view) =>
            total + Capture.CARD_KEYS.reduce((row, key) =>
                row + (selection[view][key] && avail[key].on
                    ? byteLength(textFor(key)) + PANE_CHROME
                    : 0), 0), 0);

        const written = Object.values(notesFor())
            .reduce((total, text) => total + byteLength(text), 0) * 2;

        return sheets + REPORT_CHROME + payloads + panes + written;
    }

    function row(label, checked, disabled, why, wire) {
        const label_ = el('label', disabled ? 'capture-row is-off' : 'capture-row');

        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = checked;
        box.disabled = disabled;
        box.addEventListener('change', wire);
        label_.appendChild(box);

        label_.appendChild(label);
        if (why) label_.appendChild(el('span', 'capture-why', why));

        return { node: label_, box };
    }

    /**
     * One note field, restored from what the tester has already typed.
     *
     * A textarea rather than an input: a cause runs to a sentence or two, and a
     * single line that scrolls sideways hides what is already written.
     */
    function noteField(field, changed) {
        const wrap = el('label', 'capture-field');
        wrap.appendChild(el('span', 'capture-field-name', field.label));

        const input = document.createElement('textarea');
        input.className = 'capture-field-input';
        input.rows = 3;
        input.value = notes[field.key] || '';
        input.placeholder = NOTE_HINT[field.key] || '';
        input.addEventListener('input', () => {
            notes[field.key] = input.value;
            changed();
        });
        wrap.appendChild(input);

        return wrap;
    }

    function cardLabel(key) {
        if (key === 'plain') return el('span', 'capture-name-mime', Capture.CARD_LABEL[key]);
        if (key === 'html') return el('span', 'capture-name-mime is-html', Capture.CARD_LABEL[key]);
        return el('span', 'capture-name-derived', Capture.CARD_LABEL[key]);
    }

    /** Rebuild the panel from what this copy has. Everything on offer is ticked. */
    function fillPanel() {
        const avail = Capture.availability(snapshot());
        const selection = everything(avail);
        const menu = els.menu;
        menu.textContent = '';

        const refresh = () => {
            els.size.textContent = `≈ ${formatBytes(estimate(selection, avail))}`;
        };

        for (const view of VIEWS) {
            menu.appendChild(el('div', 'capture-group', view === 'rendered' ? 'Rendered' : 'Source'));
            for (const key of Capture.CARD_KEYS) {
                const { node } = row(cardLabel(key), selection[view][key], !avail[key].on, avail[key].why, (event) => {
                    selection[view][key] = event.target.checked;
                    refresh();
                });
                menu.appendChild(node);
            }
        }

        menu.appendChild(el('div', 'capture-group', 'Also'));

        const verbatim = row(el('span', null, 'Verbatim payloads'), true, false, '', (event) => {
            selection.verbatim = event.target.checked;
            refresh();
        });
        menu.appendChild(verbatim.node);

        const host = Capture.hostSlug(sourceUrlCache || '');
        const urlRow = row(el('span', null, 'Source URL'), true, false,
            sourceUrlCache ? host : '', (event) => {
                selection.url = event.target.checked;
            });
        menu.appendChild(urlRow.node);

        menu.appendChild(el('div', 'capture-group', 'Notes'));
        for (const field of Capture.NOTES_FIELDS) {
            menu.appendChild(noteField(field, refresh));
        }

        const foot = el('div', 'capture-foot');
        els.size = el('span', 'capture-size');
        foot.appendChild(els.size);

        const saveBtn = el('button', 'capture-save', 'Save .html');
        saveBtn.type = 'button';
        saveBtn.addEventListener('click', () => {
            closePanel();
            run(selection);
        });
        foot.appendChild(saveBtn);
        menu.appendChild(foot);

        refresh();
    }

    function openPanel() {
        fillPanel();
        els.menu.hidden = false;
        els.caret.setAttribute('aria-expanded', 'true');
    }

    function closePanel() {
        if (els.menu.hidden) return;
        els.menu.hidden = true;
        els.caret.setAttribute('aria-expanded', 'false');
    }

    /** Say what happened on the button itself, the way the DOM-bypass card does. */
    function flash(message) {
        els.label.textContent = message;
        setTimeout(() => { els.label.textContent = 'Capture'; }, 2200);
    }

    async function run(selection) {
        try {
            save(await build(selection));
            flash('Saved');
        } catch (err) {
            console.error('Capture: could not write the file:', err);
            showError(`Could not write the capture: ${err.message}`);
            flash('Failed');
        }
    }

    /* -------------------------------------------------------------- wiring */

    function wire() {
        els.root = document.getElementById('capture');
        if (!els.root) return;

        els.button = document.getElementById('capture-btn');
        els.caret = document.getElementById('capture-caret');
        els.menu = document.getElementById('capture-menu');
        els.label = document.getElementById('capture-label');

        els.button.addEventListener('click', () => {
            const avail = Capture.availability(snapshot());
            if (!anythingToCapture(avail)) {
                flash('Nothing yet');
                return;
            }
            run(everything(avail));
        });

        els.caret.addEventListener('click', () => {
            els.menu.hidden ? openPanel() : closePanel();
        });

        document.addEventListener('click', (event) => {
            if (!els.menu.hidden && !event.target.closest('#capture')) closePanel();
        });

        document.addEventListener('keydown', (event) => {
            if (els.menu.hidden || event.key !== 'Escape') return;
            closePanel();
            els.caret.focus();
        });

        // Both are wanted the moment the button is pressed, and both are slow
        // enough to be worth having in hand before then.
        css();
        sourceUrl();
    }

    document.addEventListener('DOMContentLoaded', wire);
})();
